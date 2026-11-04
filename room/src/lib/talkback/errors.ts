// A dropped connection surfaces as a bare "Failed to fetch" / NetworkError.
// Say what happened in plain words instead, and never claim it was sent.
// Server text that is not a sentence for a person (validation JSON, an HTTP
// status line, a stack trace, a JavaScript error) is never shown; the plain
// fallback is.
const TECHNICAL =
  /^\s*[[{]|\bHTTP\s*\d{3}\b|^\s*\d{3}\b|\bat\s+\S+\s+\(|\b(?:invalid_enum_value|invalid_type|ZodError|TypeError|ReferenceError|ECONNREFUSED|ECONNRESET|undefined|null)\b|Cannot read properties/i;

export function friendlyError(err: unknown, fallback: string) {
  const raw = err instanceof Error ? err.message : "";
  if (!raw) return fallback;
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(raw)) {
    return "Not done — this computer can't reach the room right now, so nothing was sent or saved. Anything you typed is still here; try again when the room is back.";
  }
  if (TECHNICAL.test(raw) || raw.length > 300) return fallback;
  return raw;
}
