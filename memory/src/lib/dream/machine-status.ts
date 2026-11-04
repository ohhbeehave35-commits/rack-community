import type { ClientKind } from "./platform";
import type { FanMode, MachineSnap } from "./types";

export const MACHINE_SIDECAR_URL = "http://127.0.0.1:7733/machine.json";
export const MACHINE_SIDECAR_FAN_URL = "http://127.0.0.1:7733/fan";
export const MACHINE_SIDECAR_CLEAR_URL = "http://127.0.0.1:7733/clear";

export const FAN_PRESETS = [
  { id: "auto" as const, label: "Auto", pct: null, hint: "Firmware decides" },
  { id: "quiet" as const, label: "Quiet", pct: 30, hint: "About 30%" },
  { id: "balanced" as const, label: "Balanced", pct: 55, hint: "About 55%" },
  { id: "full" as const, label: "Full", pct: 100, hint: "Hold at max" },
];

export const COMMANDS = {
  mac: {
    status: 'sh "$HOME/Somnus/machine/status.sh"',
    clear: 'sh "$HOME/Somnus/machine/clear.sh"',
    sidecar: 'python3 "$HOME/Somnus/machine/sidecar.py"',
    grant:
      'osascript -e \'do shell script "SOMNUS_HOME=$HOME/Somnus SOMNUS_KIT=$HOME/Somnus/machine python3 $HOME/Somnus/machine/sidecar.py" with administrator privileges\'',
    fan: 'sh "$HOME/Somnus/machine/fan.sh"',
  },
  linux: {
    status: 'sh "$HOME/Somnus/machine/status.sh"',
    clear: 'sh "$HOME/Somnus/machine/clear.sh"',
    sidecar: 'python3 "$HOME/Somnus/machine/sidecar.py"',
    grant: 'sudo python3 "$HOME/Somnus/machine/sidecar.py"',
    fan: 'sh "$HOME/Somnus/machine/fan.sh"',
  },
  windows: {
    status:
      'powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\\Somnus\\machine\\status.ps1"',
    clear:
      'powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\\Somnus\\machine\\clear.ps1" -All',
    sidecar:
      'powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\\Somnus\\machine\\sidecar.ps1"',
    grant:
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList \'-NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\\Somnus\\machine\\sidecar.ps1\'"',
    fan: 'powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\\Somnus\\machine\\fan.ps1"',
  },
} as const;

export function commandsFor(kind: ClientKind) {
  if (kind === "windows") return COMMANDS.windows;
  if (kind === "linux") return COMMANDS.linux;
  return COMMANDS.mac;
}

export function fanCommand(kind: ClientKind, mode: string, pct?: number) {
  const base = commandsFor(kind).fan;
  const arg =
    mode === "manual" && pct != null
      ? String(Math.max(10, Math.min(100, Math.round(pct))))
      : mode;
  if (kind === "windows") return `${base} -Mode ${arg}`;
  return `${base} ${arg}`;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fanModeOf(v: unknown): FanMode {
  if (
    v === "auto" ||
    v === "quiet" ||
    v === "balanced" ||
    v === "full" ||
    v === "manual" ||
    v === "hidden"
  ) {
    return v;
  }
  return "hidden";
}

export function parseMachineSnap(
  raw: string,
  source: MachineSnap["source"] = "paste",
): MachineSnap | null {
  const text = raw.trim().slice(0, 8000);
  if (!text) return null;
  const tagged = text.match(/SOMNUS_MACHINE=(\{[\s\S]*\})/);
  const blob = tagged?.[1] ?? text.match(/\{[\s\S]*\}/)?.[0];
  if (!blob) return null;
  try {
    const j = JSON.parse(blob) as Record<string, unknown>;
    const pressure =
      j.pressure === "ok" || j.pressure === "warn" || j.pressure === "danger"
        ? j.pressure
        : "unknown";
    const fanPctRaw = num(j.fanPct);
    const fanRpmRaw = num(j.fanRpm);
    const fanCountRaw = num(j.fanCount);
    return {
      at: typeof j.at === "string" && j.at ? j.at : new Date().toISOString(),
      os: typeof j.os === "string" ? j.os.slice(0, 40) : "unknown",
      totalMb: num(j.totalMb),
      usedMb: num(j.usedMb),
      availMb: num(j.availMb),
      pressure,
      tempC: num(j.tempC),
      fanRpm:
        fanRpmRaw != null && fanRpmRaw >= 0 && fanRpmRaw <= 30000
          ? Math.round(fanRpmRaw)
          : null,
      fanPct:
        fanPctRaw != null && fanPctRaw >= 0 && fanPctRaw <= 100
          ? Math.round(fanPctRaw)
          : null,
      fanMode: fanModeOf(j.fanMode),
      fanCount:
        fanCountRaw != null && fanCountRaw >= 0 && fanCountRaw <= 16
          ? Math.round(fanCountRaw)
          : null,
      fanLocked: j.fanLocked === true,
      fanNeedsAdmin: j.needsAdmin === true || j.fanNeedsAdmin === true,
      fanHolding: j.holding === true || j.fanHolding === true,
      note: typeof j.note === "string" ? j.note.slice(0, 240) : "",
      source,
    };
  } catch {
    return null;
  }
}

export function machineTone(snap: MachineSnap | null): "ok" | "warn" | "danger" | "muted" {
  if (!snap) return "muted";
  if (snap.pressure === "danger") return "danger";
  if (snap.pressure === "warn") return "warn";
  if (snap.pressure === "ok") return "ok";
  if (snap.totalMb && snap.availMb != null) {
    const r = snap.availMb / snap.totalMb;
    if (r < 0.12) return "danger";
    if (r < 0.22) return "warn";
    return "ok";
  }
  return "muted";
}