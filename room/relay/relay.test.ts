import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac, createHash } from 'node:crypto';
import { once } from 'node:events';
import dgram from 'node:dgram';
import { RelaySignaling } from '../src/lib/multiplayer/relay-signaling.ts';
import { createHuddleVoice } from '../src/lib/talkback/huddle-voice.ts';
import WebSocket from 'ws';
import { startRelay, readSettings, turnPassword } from './server.mjs';

const settings = () => readSettings({ TURN_SHARED_KEY: randomBytes(32).toString('hex'), TURN_PUBLIC_HOST: '127.0.0.1', RELAY_PORT: '0', TURN_PORT: '34780' });
async function client(url: string, company: string, callId: string, peer: string) {
  const ws = new WebSocket(url);
  const messages: any[] = [];
  ws.on('message', raw => messages.push(JSON.parse(String(raw))));
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'join', company, callId, peer, name: peer }));
  await until(() => messages.some(m => m.type === 'peers'));
  return { ws, messages };
}
async function until(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) {
    assert.ok(Date.now() < end, 'expected relay event before timeout');
    await new Promise(r => setTimeout(r, 10));
  }
}

test('join, offer, answer and ICE stay in their company and call; departure updates roster', async () => {
  const relay = await startRelay(settings(), { startTurn: false });
  const clients: Awaited<ReturnType<typeof client>>[] = [];
  try {
    const a = await client(relay.wsUrl, 'one', 'call', 'a'); clients.push(a);
    const b = await client(relay.wsUrl, 'one', 'call', 'b'); clients.push(b);
    const c = await client(relay.wsUrl, 'two', 'call', 'c'); clients.push(c);
    const d = await client(relay.wsUrl, 'one', 'other', 'd'); clients.push(d);
    await until(() => a.messages.some(m => m.peers?.length === 2));
    for (const [sender, receiver, kind] of [[a, b, 'offer'], [b, a, 'answer'], [a, b, 'ice']] as const) {
      sender.ws.send(JSON.stringify({ type: 'signal', kind, payload: { marker: kind }, from: 'spoofed' }));
      await until(() => receiver.messages.some(m => m.kind === kind));
      const received = receiver.messages.find(m => m.kind === kind);
      assert.equal(received.from, sender === a ? 'a' : 'b');
      assert.deepEqual(received.payload, { marker: kind });
    }
    a.ws.send(JSON.stringify({ type: 'signal', kind: 'offer', to: 'c', payload: {} }));
    await new Promise(r => setTimeout(r, 80));
    assert.equal(c.messages.some(m => m.type === 'signal'), false);
    assert.equal(d.messages.some(m => m.type === 'signal'), false);
    b.ws.close();
    await until(() => a.messages.at(-1)?.peers?.length === 1);
  } finally { clients.forEach(c => c.ws.terminate()); await relay.close(); }
});

test('/ice emits short-lived TURN REST credentials and /healthz works', async () => {
  const config = settings();
  const relay = await startRelay(config, { startTurn: false });
  try {
    const res = await fetch(relay.url + '/ice');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const { iceServers } = await res.json();
    assert.equal(iceServers[0].urls, 'stun:127.0.0.1:34780');
    const turn = iceServers[1];
    assert.equal(turn.urls, 'turn:127.0.0.1:34780?transport=udp');
    assert.match(turn.username, /^\d+:[a-f0-9]+$/);
    const expiry = Number(turn.username.split(':')[0]);
    assert.ok(expiry > Date.now() / 1000 && expiry <= Date.now() / 1000 + 601);
    // Boolean checks prevent a failed assertion from printing a credential.
    assert.ok(turn.credential === createHmac('sha1', config.sharedKey).update(turn.username).digest('base64'));
    assert.ok(turnPassword(config, turn.username) === turn.credential);
    assert.equal(turnPassword(config, turn.username, expiry + 1), undefined);
    assert.equal(turnPassword(config, '__proto__'), undefined);
    assert.equal((await fetch(relay.url + '/healthz')).status, 200);
  } finally { await relay.close(); }
});

test('/ice lists Cloudflare servers first and the Spark fallback last', async () => {
  const config = readSettings({ TURN_SHARED_KEY: randomBytes(32).toString('hex'),
    TURN_PUBLIC_HOST: '127.0.0.1', RELAY_PORT: '0', TURN_PORT: '34780',
    CF_TURN_KEY_ID: randomBytes(16).toString('hex'), CF_TURN_KEY_TOKEN: randomBytes(32).toString('hex') });
  const cloudflare = [{ urls: ['turn:turn.example.test:3478?transport=udp'],
    username: randomBytes(16).toString('hex'), credential: randomBytes(32).toString('hex') }];
  let requests = 0;
  const relay = await startRelay(config, { startTurn: false, fetchCloudflare: async (url: string, options: RequestInit) => {
    requests++;
    assert.ok(url === `https://rtc.live.cloudflare.com/v1/turn/keys/${config.cfTurnKeyId}/credentials/generate-ice-servers`);
    assert.equal(options.method, 'POST');
    const headers = new Headers(options.headers);
    assert.ok(headers.get('Authorization') === `Bearer ${config.cfTurnKeyToken}`);
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(String(options.body)), { ttl: 600 });
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ iceServers: cloudflare });
  } });
  try {
    const response = await fetch(relay.url + '/ice');
    assert.equal(response.status, 200);
    const { iceServers } = await response.json();
    assert.equal(requests, 1);
    assert.equal(iceServers.length, 3);
    assert.ok(JSON.stringify(iceServers.slice(0, 1)) === JSON.stringify(cloudflare));
    assert.equal(iceServers[1].urls, 'stun:127.0.0.1:34780');
    assert.equal(iceServers[2].urls, 'turn:127.0.0.1:34780?transport=udp');
    assert.ok(iceServers[2].credential === turnPassword(config, iceServers[2].username));
  } finally { await relay.close(); }
});

test('/ice returns only the Spark fallback with status 200 when Cloudflare fails', async () => {
  const config = readSettings({ TURN_SHARED_KEY: randomBytes(32).toString('hex'),
    TURN_PUBLIC_HOST: '127.0.0.1', RELAY_PORT: '0', TURN_PORT: '34780',
    CF_TURN_KEY_ID: randomBytes(16).toString('hex'), CF_TURN_KEY_TOKEN: randomBytes(32).toString('hex') });
  const failures = [
    async () => new Response(null, { status: 503 }),
    async () => { throw new Error('network unavailable'); },
    async () => new Response('invalid JSON'),
    async () => Response.json({ iceServers: [null] }),
  ];
  for (const fetchCloudflare of failures) {
    const relay = await startRelay(config, { startTurn: false, fetchCloudflare });
    try {
      const response = await fetch(relay.url + '/ice');
      assert.equal(response.status, 200);
      const { iceServers } = await response.json();
      assert.equal(iceServers.length, 2);
      assert.equal(iceServers[0].urls, 'stun:127.0.0.1:34780');
      assert.equal(iceServers[1].urls, 'turn:127.0.0.1:34780?transport=udp');
      assert.ok(iceServers[1].credential === turnPassword(config, iceServers[1].username));
    } finally { await relay.close(); }
  }
});

test('missing shared key refuses startup in plain words', () => {
  assert.throws(() => readSettings({}), /TURN_SHARED_KEY must be set before the relay can start\./);
});

test('browser transport fetches ICE, joins, signals and closes over the real relay', async () => {
  const relay = await startRelay(settings(), { startTurn: false });
  const a = new RelaySignaling(relay.url, 'company', 'call', 'a', 'A');
  const b = new RelaySignaling(relay.url, 'company', 'call', 'b', 'B');
  try {
    await a.poll();
    const joined = await b.poll();
    assert.equal(joined.peers.length, 2);
    assert.equal(b.iceServers.length, 2);
    a.send('b', 'offer', { sdp: 'test-offer' });
    let received: any[] = [];
    for (let i = 0; i < 30 && !received.length; i++) {
      await new Promise(r => setTimeout(r, 10));
      received = (await b.poll()).signals;
    }
    assert.equal(received.length, 1);
    assert.equal(received[0].from, 'a');
    assert.equal(received[0].kind, 'offer');
    a.close();
    await assert.rejects(a.poll(), /closed/);
  } finally { a.close(); b.close(); await relay.close(); }
});

test('same process starts the real TURN UDP listener and answers a STUN binding request', async () => {
  const config = settings();
  const relay = await startRelay(config);
  const socket = dgram.createSocket('udp4');
  try {
    const request = Buffer.alloc(20);
    request.writeUInt16BE(1, 0);
    request.writeUInt32BE(0x2112a442, 4);
    randomBytes(12).copy(request, 8);
    const response = once(socket, 'message', { signal: AbortSignal.timeout(2000) });
    socket.send(request, config.turnPort, '127.0.0.1');
    const [packet] = await response;
    assert.equal(packet.readUInt16BE(0), 0x0101);
    assert.ok(packet.subarray(8, 20).equals(request.subarray(8, 20)));
    const { iceServers } = await (await fetch(relay.url + '/ice')).json();
    const issued = iceServers[1];
    assert.ok(relay.turn.authentification.credentials[issued.username] === issued.credential);
    assert.equal(relay.turn.authentification.credentials['1:00000000000000000000000000000000'], undefined);
  } finally { socket.close(); await relay.close(); }
});

test('TURN accepts an issued password on a real authenticated allocation and rejects a wrong one', async () => {
  const config = settings();
  const relay = await startRelay(config);
  const socket = dgram.createSocket('udp4');
  const attr = (kind: number, value: Buffer) => {
    const out = Buffer.alloc(4 + Math.ceil(value.length / 4) * 4);
    out.writeUInt16BE(kind); out.writeUInt16BE(value.length, 2); value.copy(out, 4); return out;
  };
  const attributes = (packet: Buffer) => {
    const result = new Map<number, Buffer>();
    for (let offset = 20; offset + 4 <= packet.length;) {
      const size = packet.readUInt16BE(offset + 2);
      result.set(packet.readUInt16BE(offset), packet.subarray(offset + 4, offset + 4 + size));
      offset += 4 + Math.ceil(size / 4) * 4;
    }
    return result;
  };
  const packet = (attrs: Buffer[], key?: Buffer) => {
    const header = Buffer.alloc(20);
    header.writeUInt16BE(3); // Allocate request
    header.writeUInt16BE(attrs.reduce((n, a) => n + a.length, 0) + (key ? 24 : 0), 2);
    header.writeUInt32BE(0x2112a442, 4); randomBytes(12).copy(header, 8);
    const body = Buffer.concat([header, ...attrs]);
    return key ? Buffer.concat([body, attr(8, createHmac('sha1', key).update(body).digest())]) : body;
  };
  const exchange = async (request: Buffer): Promise<Buffer> => {
    const response = once(socket, 'message', { signal: AbortSignal.timeout(2000) });
    socket.send(request, config.turnPort, '127.0.0.1');
    return (await response)[0];
  };
  try {
    const requested = attr(0x0019, Buffer.from([17, 0, 0, 0]));
    const challenge = await exchange(packet([requested]));
    assert.equal(challenge.readUInt16BE(0), 0x0113);
    const fields = attributes(challenge);
    const { iceServers } = await (await fetch(relay.url + '/ice')).json();
    const issued = iceServers[1];
    const auth = [requested, attr(6, Buffer.from(issued.username)), attr(0x0014, fields.get(0x0014)!), attr(0x0015, fields.get(0x0015)!)];
    const wrong = await exchange(packet(auth, randomBytes(16)));
    assert.equal(wrong.readUInt16BE(0), 0x0113);
    const key = createHash('md5').update(`${issued.username}:${config.realm}:${issued.credential}`).digest();
    const accepted = await exchange(packet(auth, key));
    assert.equal(accepted.readUInt16BE(0), 0x0103);
    assert.ok(attributes(accepted).has(0x0016), 'TURN returned a relayed address');
  } finally { socket.close(); await relay.close(); }
});

test('huddle microphone follows mute and stop; late permission cannot reopen a closed call', async () => {
  const relay = await startRelay(settings(), { startTurn: false });
  const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  let stops = 0;
  const track = { enabled: true, stop() { stops++; } };
  const media = { getTracks: () => [track], getAudioTracks: () => [track] };
  const voice = createHuddleVoice();
  const errors: unknown[] = [];
  try {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => media } });
    await voice.start(relay.url, 'company', 'call', 'desk', e => errors.push(e));
    assert.equal(errors.length, 0);
    voice.mute(true); assert.equal(track.enabled, false);
    voice.mute(false); assert.equal(track.enabled, true);
    voice.stop(); assert.equal(stops, 1);
    let allow!: (media: unknown) => void;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(resolve => { allow = resolve; }) } });
    const pending = voice.start(relay.url, 'company', 'call', 'desk', e => errors.push(e));
    voice.stop(); allow(media); await pending;
    assert.equal(stops, 2);
  } finally {
    voice.stop();
    if (original) Object.defineProperty(navigator, 'mediaDevices', original);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
    await relay.close();
  }
});
