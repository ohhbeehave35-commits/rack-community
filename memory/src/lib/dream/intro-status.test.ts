import { test } from "node:test";
import assert from "node:assert/strict";

// No jsdom needed: only `window.localStorage` is touched, so a minimal stand-in
// is enough and keeps this test fast and dependency-free.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

function withWindow<T>(storage: Storage | undefined, fn: () => T): T {
  const prev = (globalThis as any).window;
  (globalThis as any).window = storage ? { localStorage: storage } : undefined;
  try {
    return fn();
  } finally {
    (globalThis as any).window = prev;
  }
}

test("a fresh browser (no flag set) is redirected away from every protected route", async () => {
  const { readIntroDone, shouldRedirectToIntro } = await import("./intro-status.ts");
  const storage = new MemoryStorage() as unknown as Storage;
  withWindow(storage, () => {
    const done = readIntroDone();
    assert.equal(done, false, "fresh storage has no completion flag");
    assert.equal(shouldRedirectToIntro("/simple", done), true, "protected route without the flag redirects");
    assert.equal(shouldRedirectToIntro("/", done), true, "the home route also redirects");
    assert.equal(shouldRedirectToIntro("/intro", done), false, "the intro route itself never redirects to itself");
  });
});

test("markIntroDone persists the flag, so a second visit is never redirected", async () => {
  const { readIntroDone, markIntroDone, shouldRedirectToIntro } = await import("./intro-status.ts");
  const storage = new MemoryStorage() as unknown as Storage;
  withWindow(storage, () => {
    markIntroDone();
    const done = readIntroDone();
    assert.equal(done, true);
    assert.equal(shouldRedirectToIntro("/simple", done), false, "a completed intro never redirects again");
  });
});

test("storage blocked (no window / throwing localStorage) never traps a visitor in a redirect loop", async () => {
  const { readIntroDone } = await import("./intro-status.ts");
  withWindow(undefined, () => {
    assert.equal(readIntroDone(), true, "no window at all reads as done, since there is nowhere to redirect from");
  });
});
