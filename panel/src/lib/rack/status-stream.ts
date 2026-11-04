/**
 * The Rack's STATUS lines as the Run status screen shows them. Pure: no fetch, no React.
 * The server hands back lines after a cursor (GET /status/stream); this keeps the newest ones, drops a repeat, starts over when
 * the server says the file was rotated, and checks the typed word that confirms starting a run.
 */
export type StreamLine = { at: number; text: string };
export type StreamAnswer = { lines: StreamLine[]; cursor: number; size: number; reset: boolean };
export type StreamState = { lines: StreamLine[]; cursor: number };

export const STREAM_CAP = 300;
export const START_WORD = "START";
export const EMPTY_STREAM: StreamState = { lines: [], cursor: 0 };

export function mergeStream(prev: StreamState, answer: StreamAnswer, cap = STREAM_CAP): StreamState {
  const base = answer.reset ? [] : prev.lines;
  const seen = new Set(base.map((l) => l.at));
  const fresh = answer.lines.filter((l) => !seen.has(l.at));
  const lines = [...base, ...fresh].slice(-cap);
  return { lines, cursor: answer.cursor };
}

/** The first ask uses cursor 0, which the server answers with only the newest lines. */
export function streamUrl(since: number, limit = 100, match = ""): string {
  const q = new URLSearchParams({ since: String(Math.max(0, Math.floor(since))), limit: String(limit) });
  if (match.trim()) q.set("match", match.trim().slice(0, 60));
  return `/status/stream?${q.toString()}`;
}

/** The match the server accepts: at most 60 letters, digits, space or . _ : / - */
export function matchOk(match: string): boolean {
  return /^[A-Za-z0-9._:/ -]{0,60}$/.test(match);
}

/** Starting a run needs the person to type the word, exactly. */
export function typedWordOk(typed: string, word = START_WORD): boolean {
  return typed.trim() === word;
}
