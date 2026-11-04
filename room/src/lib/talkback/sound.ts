let ctx: AudioContext | null = null;

function context() {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Two-tone talkback beep. Needs a prior user gesture to unlock audio. */
export async function playCue() {
  const audio = context();
  if (!audio) return;
  if (audio.state === "suspended") {
    try {
      await audio.resume();
    } catch {
      return;
    }
  }
  const now = audio.currentTime;
  tone(audio, 784, now, 0.09);
  tone(audio, 1174, now + 0.1, 0.12);
}

function tone(audio: AudioContext, freq: number, start: number, dur: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.07, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export async function unlockAudio() {
  const audio = context();
  if (!audio) return;
  if (audio.state === "suspended") {
    try {
      await audio.resume();
    } catch {
      /* ignore */
    }
  }
}

export async function requestDesktopAlerts() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported" as const;
  }
  if (Notification.permission === "granted") return "granted" as const;
  if (Notification.permission === "denied") return "denied" as const;
  const result = await Notification.requestPermission();
  return result === "granted" ? ("granted" as const) : ("denied" as const);
}

export function fireDesktopAlert(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: "talkback-cue" });
  } catch {
    /* ignore — some embedded browsers block this */
  }
}
