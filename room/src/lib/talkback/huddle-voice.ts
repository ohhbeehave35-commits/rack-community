import { P2PRoom } from '../multiplayer/p2p.ts';

export function createHuddleVoice() {
  let room: P2PRoom | null = null;
  let stream: MediaStream | null = null;
  let generation = 0;
  const audio = new Map<string, HTMLAudioElement>();
  const stop = () => {
    generation++;
    room?.close(); room = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    audio.forEach(el => { el.pause(); el.srcObject = null; }); audio.clear();
  };
  return {
    stop,
    mute(muted: boolean) { stream?.getAudioTracks().forEach(track => { track.enabled = !muted; }); },
    async start(relayUrl: string, company: string, callId: string, name: string, onError: (e: unknown) => void) {
      stop();
      const version = generation;
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (version !== generation) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media;
      room = new P2PRoom({ relayUrl, company, room: callId, selfId: crypto.randomUUID(), name, media,
        onError,
        onTrack(peer, remote) {
          let el = audio.get(peer);
          if (!el) { el = new Audio(); el.autoplay = true; audio.set(peer, el); }
          el.srcObject = remote;
          void el.play().catch(onError);
        },
        onPeersChanged(peers) {
          const alive = new Set(peers.map(p => p.id));
          for (const [peer, el] of audio) if (!alive.has(peer)) { el.pause(); el.srcObject = null; audio.delete(peer); }
        },
      });
      await room.join();
    },
  };
}
