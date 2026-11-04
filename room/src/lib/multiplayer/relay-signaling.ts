import type { RtcPollResponse, SignalKind } from './p2p';

/** Ephemeral WebSocket transport; existing P2PRoom negotiation stays in charge. */
export class RelaySignaling {
  private socket: WebSocket | null = null;
  private closed = false;
  private peers: RtcPollResponse['peers'] = [];
  private signals: RtcPollResponse['signals'] = [];
  private sequence = 0;
  iceServers: RTCIceServer[] = [];
  private iceReadAt = 0;
  private url: string;
  private company: string;
  private callId: string;
  private peer: string;
  private name: string;

  constructor(url: string, company: string, callId: string, peer: string, name: string) {
    this.url = url; this.company = company; this.callId = callId; this.peer = peer; this.name = name;
  }

  async poll(): Promise<RtcPollResponse> {
    if (this.closed) throw new Error('Call closed.');
    if (this.socket?.readyState !== WebSocket.OPEN) await this.connect();
    else if (Date.now() - this.iceReadAt > 300000) await this.readIce();
    return { peers: this.peers, signals: this.signals.splice(0) };
  }

  private async readIce() {
    const base = this.url.replace(/\/$/, '');
    const response = await fetch(base + '/ice', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Voice relay is unavailable.');
    const data = await response.json() as { iceServers: RTCIceServer[] };
    if (!Array.isArray(data.iceServers) || !data.iceServers.length) throw new Error('Voice relay returned no ICE servers.');
    if (this.closed) return;
    this.iceServers = data.iceServers;
    this.iceReadAt = Date.now();
  }

  private async connect() {
    await this.readIce();
    if (this.closed) return;
    const base = this.url.replace(/\/$/, '');
    this.peers = [];
    this.signals = [];
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
    this.socket = ws;
    await new Promise<void>((resolve, reject) => {
      let joined = false;
      const timer = setTimeout(() => { ws.close(); reject(new Error('Voice relay join timed out.')); }, 10000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', company: this.company,
        callId: this.callId, peer: this.peer, name: this.name }));
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Voice relay is unavailable.')); };
      ws.onclose = () => {
        clearTimeout(timer);
        this.peers = [];
        if (!joined) reject(new Error('Voice relay disconnected.'));
      };
      ws.onmessage = event => {
        if (this.closed) return;
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.type === 'peers' && Array.isArray(msg.peers)) {
            this.peers = msg.peers;
            joined = true; clearTimeout(timer); resolve();
          } else if (msg.type === 'signal') {
            this.signals.push({ id: ++this.sequence, from: msg.from, kind: msg.kind, payload: msg.payload });
          }
        } catch { /* Ignore malformed relay messages. */ }
      };
    });
  }

  send(to: string, kind: SignalKind, payload: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('Voice relay disconnected.');
    this.socket.send(JSON.stringify({ type: 'signal', to, kind, payload }));
  }

  close() { this.closed = true; this.socket?.close(); this.peers = []; this.signals = []; }
}
