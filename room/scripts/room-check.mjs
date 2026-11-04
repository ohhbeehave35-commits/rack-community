#!/usr/bin/env node
/**
 * Room start check. Succeeds only when the room answers HTTP 200 within the
 * time limit; otherwise exits 1 so a bad build never replaces a working room
 * silently (TalkBack room crash, 29 Oct 2026: new build died on ENOENT pglite.data).
 *
 *   node scripts/room-check.mjs [url] [seconds]    default http://127.0.0.1:8422/ 30
 */
import { fileURLToPath } from "node:url";

export const DEFAULT_ROOM_URL = "http://127.0.0.1:8422/";
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Poll `url` until it returns 200 or `timeoutMs` passes. Never throws. */
export async function waitForRoom({
  url = DEFAULT_ROOM_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = 500,
  fetchFn = fetch,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = "no answer";
  while (Date.now() < deadline) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(Math.min(2000, timeoutMs)) });
      if (res.status === 200) return { ok: true, status: 200 };
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, reason: last };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.argv[2] || DEFAULT_ROOM_URL;
  const seconds = Number(process.argv[3] || DEFAULT_TIMEOUT_MS / 1000);
  const r = await waitForRoom({ url, timeoutMs: seconds * 1000 });
  if (r.ok) {
    console.log(`[room-check] OK ${url} answered 200`);
  } else {
    console.error(`[room-check] FAIL ${url} not 200 within ${seconds}s (${r.reason})`);
    process.exit(1);
  }
}
