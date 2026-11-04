import { CLEANUP } from "./memory";
import type { CleanupItem, Lesson, SignalBucket } from "./types";

const DEST: Record<Exclude<SignalBucket, "noise">, { file: string; memId: string }> = {
  preference: { file: "user-preferences.md", memId: "prefs" },
  decision: { file: "stack.md", memId: "stack" },
  correction: { file: "debugging.md", memId: "debug" },
  recurring: { file: "workflow.md", memId: "flow" },
};

function clip(text: string, n: number) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function stemId(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `sig-${Math.abs(h).toString(36).slice(0, 8)}`;
}

export function catalogCover(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bpnpm\b|\bnpm\b/.test(t)) return "pnpm";
  if (/\bmoment(?:\.js)?\b/.test(t)) return "moment";
  if (/\bgraphql\b/.test(t)) return "rest-gql";
  if (/\brest\b/.test(t) && /\b(wrong|instead|from now on)\b/.test(t)) return "rest-gql";
  if (/\blast week\b|\byesterday\b/.test(t)) return "dates";
  return null;
}

export function fileToMemId(file?: string) {
  if (!file) return "prefs";
  if (file.includes("pref")) return "prefs";
  if (file.includes("stack")) return "stack";
  if (file.includes("debug")) return "debug";
  if (file.includes("workflow")) return "flow";
  if (file.includes("MEMORY") || file.includes("index")) return "index";
  return "prefs";
}

export function catalog(extra: CleanupItem[] = []): CleanupItem[] {
  const seen = new Set(CLEANUP.map((c) => c.id));
  return [...CLEANUP, ...extra.filter((e) => !seen.has(e.id))];
}

export function deriveCleanup(
  lessons: Lesson[],
  extra: CleanupItem[] = [],
): CleanupItem[] {
  const known = catalog(extra);
  const out: CleanupItem[] = [];
  for (const lesson of lessons) {
    if (lesson.bucket === "noise") continue;
    const words = lesson.text.trim().split(/\s+/).length;
    if (words < 4) continue;
    if (catalogCover(lesson.text)) continue;
    const dest = DEST[lesson.bucket] ?? DEST.preference;
    const id = stemId(lesson.text.toLowerCase());
    if (known.some((k) => k.id === id) || out.some((k) => k.id === id)) continue;
    out.push({
      id,
      kind: "judgment",
      derived: true,
      unverified: lesson.unverified,
      lessonText: lesson.text,
      bucket: lesson.bucket,
      title: lesson.unverified
        ? `UNVERIFIED: ${clip(lesson.text, 72)}`
        : clip(lesson.text, 72),
      detail: lesson.unverified
        ? `Unlabeled paste. Dual-sign to append to ${dest.file}. Do not treat as fact until you confirm.`
        : `From gather (${lesson.bucket}, ${lesson.sessions.length} session${lesson.sessions.length === 1 ? "" : "s"}). Dual-sign to append to ${dest.file}.`,
      file: dest.file,
    });
    if (out.length >= 8) break;
  }
  return out;
}
