import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import Turn from 'node-turn';
import { WebSocketServer, WebSocket } from 'ws';

export function readSettings(env = process.env) {
  if (!env.TURN_SHARED_KEY?.trim()) throw new Error('TURN_SHARED_KEY must be set before the relay can start.');
  const port = (name, fallback) => {
    const n = Number(env[name] ?? fallback);
    if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error('Relay and TURN ports must be valid port numbers.');
    return n;
  };
  const host = env.TURN_PUBLIC_HOST || '127.0.0.1';
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error('TURN_PUBLIC_HOST must be an IPv4 address or hostname.');
  return { port: port('RELAY_PORT', 8787), turnPort: port('TURN_PORT', 3478), host,
    realm: env.TURN_REALM || 'talkback', sharedKey: env.TURN_SHARED_KEY,
    cfTurnKeyId: env.CF_TURN_KEY_ID, cfTurnKeyToken: env.CF_TURN_KEY_TOKEN };
}

export function turnPassword(config, username, now = Math.floor(Date.now() / 1000)) {
  if (typeof username !== 'string' || !/^\d+:[a-f0-9]{32}$/.test(username)) return undefined;
  const expiry = Number(username.split(':')[0]);
  if (expiry <= now || expiry > now + 600) return undefined;
  return createHmac('sha1', config.sharedKey).update(username).digest('base64');
}

export async function startRelay(config, { startTurn = true, fetchCloudflare = fetch } = {}) {
  let turn;
  if (startTurn) {
    const publicIp = (await lookup(config.host, { family: 4 })).address;
    // node-turn reads this map for both password lookup and MESSAGE-INTEGRITY.
    // Derive on demand, including expiry checks, without retaining credentials.
    const credentials = new Proxy(Object.create(null), { get: (_, name) => turnPassword(config, name) });
    turn = new Turn({ listeningPort: config.turnPort, listeningIps: ['0.0.0.0'],
      externalIps: publicIp, minPort: 49152, maxPort: 65535,
      authMech: 'long-term', credentials, realm: config.realm,
      debug: () => {}, debugLevel: 'OFF', maxAllocateLifetime: 600 });
    // Compatibility fixes for pinned node-turn: refresh uses these older names;
    // deleting an expired allocation otherwise leaves its UDP sockets open.
    turn.defaultLifetime = 600;
    turn.maxAllocateTimeout = 600;
    turn.allocations = new Proxy(Object.create(null), {
      deleteProperty(target, key) {
        const allocation = target[key];
        if (allocation) {
          clearTimeout(allocation.timer);
          for (const socket of allocation.sockets) { try { socket.close(); } catch {} }
        }
        return Reflect.deleteProperty(target, key);
      },
    });
    // Stateless signed nonces avoid node-turn's retained one-hour nonce timers.
    const nonceMac = value => createHmac('sha256', config.sharedKey).update(`nonce:${value}`).digest('hex');
    turn.authentification.generateNonce = () => {
      const value = `${Math.floor(Date.now() / 1000) + 600}.${randomBytes(16).toString('hex')}`;
      return `${value}.${nonceMac(value)}`;
    };
    turn.authentification.checkNonce = nonce => {
      if (typeof nonce !== 'string' || !/^\d+\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(nonce)) return false;
      const [expiry, random, mac] = nonce.split('.');
      return Number(expiry) > Date.now() / 1000 && timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(nonceMac(`${expiry}.${random}`), 'hex'));
    };
    turn.start();
    try { await Promise.all(turn.network.sockets.map(socket => once(socket, 'listening'))); }
    catch { turn.stop(); throw new Error('The TURN listener could not start.'); }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/healthz') return res.end(JSON.stringify({ ok: true }));
    if (req.method === 'GET' && req.url === '/ice') {
      const username = `${Math.floor(Date.now() / 1000) + 600}:${randomBytes(16).toString('hex')}`;
      const iceServers = [
        { urls: `stun:${config.host}:${config.turnPort}` },
        { urls: `turn:${config.host}:${config.turnPort}?transport=udp`, username, credential: turnPassword(config, username) },
      ];
      if (config.cfTurnKeyId && config.cfTurnKeyToken) {
        try {
          const response = await fetchCloudflare(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(config.cfTurnKeyId)}/credentials/generate-ice-servers`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.cfTurnKeyToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl: 600 }),
            signal: AbortSignal.timeout(5000),
          });
          if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data.iceServers) && data.iceServers.every(server =>
              server && (typeof server.urls === 'string' ||
                (Array.isArray(server.urls) && server.urls.length > 0 && server.urls.every(url => typeof url === 'string'))))) {
              iceServers.unshift(...data.iceServers);
            }
          }
        } catch {
          // Keep the Spark fallback on HTTP, network, timeout or invalid JSON failures.
          // Never log the provider response, credentials or request settings.
        }
      }
      return res.end(JSON.stringify({ iceServers }));
    }
    res.writeHead(404); res.end('{}');
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 65536 });
  const rooms = new Map();
  const send = (ws, value) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
  const roster = room => {
    const peers = [...room.values()].map(({ peer, name }) => ({ id: peer, name }));
    for (const ws of room.keys()) send(ws, { type: 'peers', peers });
  };
  const valid = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
  wss.on('connection', ws => {
    let key;
    ws.on('error', () => {});
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { ws.close(1008); return; }
      if (!msg || typeof msg !== 'object') return ws.close(1008);
      if (msg.type === 'join' && !key) {
        if (![msg.company, msg.callId, msg.peer].every(valid)) return ws.close(1008);
        key = JSON.stringify([msg.company, msg.callId]);
        const room = rooms.get(key) ?? new Map();
        if ([...room.values()].some(p => p.peer === msg.peer) || room.size >= 32) { key = undefined; return ws.close(1008); }
        room.set(ws, { peer: msg.peer, name: typeof msg.name === 'string' ? msg.name.slice(0, 100) : '' });
        rooms.set(key, room); roster(room); return;
      }
      if (msg.type !== 'signal' || !key || !['offer', 'answer', 'ice'].includes(msg.kind)) return;
      const room = rooms.get(key);
      for (const [other, member] of room) {
        if (other !== ws && (!msg.to || member.peer === msg.to)) {
          send(other, { type: 'signal', from: room.get(ws).peer, kind: msg.kind, payload: msg.payload });
        }
      }
    });
    ws.on('close', () => {
      const room = rooms.get(key);
      if (!room) return;
      room.delete(ws);
      if (room.size) roster(room); else rooms.delete(key);
    });
  });
  try { server.listen(config.port, '0.0.0.0'); await once(server, 'listening'); }
  catch { turn?.stop(); wss.close(); throw new Error('The relay listener could not start.'); }
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, wsUrl: url.replace('http:', 'ws:') + '/ws', turn,
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      if (turn) for (const key of Object.keys(turn.allocations)) delete turn.allocations[key];
      turn?.stop();
    } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const relay = await startRelay(readSettings());
    console.log('TalkBack relay is running.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await relay.close(); process.exit(0); });
  } catch (error) {
    console.error(error instanceof Error && error.message.startsWith('TURN_SHARED_KEY') ? error.message : 'TalkBack relay could not start. Check its settings and ports.');
    process.exitCode = 1;
  }
}
