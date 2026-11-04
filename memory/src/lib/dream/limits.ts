/**
 * Reviewer one pass, 27 Sep 2026: sizes for what one account may store.
 * Pure, so the test needs no database.
 */
export const USER_DATA_PAYLOAD_MAX = 1_000_000;
export const IMPORT_ITEMS_MAX = 500;
export const KEY_MAX = 200;
export const TEXT_MAX = 10_000;
export const PAYLOAD_TOO_BIG_WORDS = "That record is too big to save (over 1 MB). Split it up and try again.";
export const KEY_TOO_LONG_WORDS = "That name is too long. Use a shorter one.";
export const TOO_MANY_ITEMS_WORDS = `That import has too many records. Bring in at most ${IMPORT_ITEMS_MAX} at a time.`;
export const NOT_JSON_WORDS = "That record did not come through as JSON. Try again.";

/** Plain words when one user-data record may not be stored, else null. */
export function userDataRefusal(kind: unknown, key: unknown, payload: unknown): string | null {
  if (typeof kind !== "string" || typeof key !== "string" || !kind.trim() || !key.trim()) return KEY_TOO_LONG_WORDS;
  if (kind.length > KEY_MAX || key.length > KEY_MAX) return KEY_TOO_LONG_WORDS;
  if (typeof payload !== "string") return NOT_JSON_WORDS;
  if (payload.length > USER_DATA_PAYLOAD_MAX) return PAYLOAD_TOO_BIG_WORDS;
  try {
    JSON.parse(payload);
  } catch {
    return NOT_JSON_WORDS;
  }
  return null;
}

/** A text field kept to a size; never a refusal, the rest is cut. */
export function clampText(value: unknown, max: number = TEXT_MAX): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}
