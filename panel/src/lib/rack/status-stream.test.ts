import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_STREAM, STREAM_CAP, matchOk, mergeStream, streamUrl, typedWordOk } from "./status-stream.ts";

// The run's STATUS lines on the Run status screen, and the typed word that starts a run.

const ans = (lines: [number, string][], cursor: number, reset = false) => ({ lines: lines.map(([at, text]) => ({ at, text })), cursor, size: cursor, reset });

test("new lines are added in order and the cursor moves to the server's", () => {
  const a = mergeStream(EMPTY_STREAM, ans([[0, "a"], [2, "b"]], 4));
  assert.deepEqual(a.lines.map((l) => l.text), ["a", "b"]);
  assert.equal(a.cursor, 4);
  const b = mergeStream(a, ans([[4, "c"]], 6));
  assert.deepEqual(b.lines.map((l) => l.text), ["a", "b", "c"]);
  assert.equal(b.cursor, 6);
});

test("a line the screen already has is not shown twice", () => {
  const a = mergeStream(EMPTY_STREAM, ans([[0, "a"], [2, "b"]], 4));
  const b = mergeStream(a, ans([[2, "b"], [4, "c"]], 6));
  assert.deepEqual(b.lines.map((l) => l.text), ["a", "b", "c"]);
});

test("a rotated file (reset) clears the old lines and starts over", () => {
  const a = mergeStream(EMPTY_STREAM, ans([[0, "old one"], [8, "old two"]], 16));
  const b = mergeStream(a, ans([[0, "new"]], 4, true));
  assert.deepEqual(b.lines.map((l) => l.text), ["new"]);
  assert.equal(b.cursor, 4);
});

test("only the newest lines are kept, so a long run never grows the page without end", () => {
  let s = EMPTY_STREAM;
  for (let i = 0; i < STREAM_CAP + 50; i++) s = mergeStream(s, ans([[i * 2, "l" + i]], i * 2 + 2));
  assert.equal(s.lines.length, STREAM_CAP);
  assert.equal(s.lines[0].text, "l50");
  assert.equal(s.lines[s.lines.length - 1].text, "l" + (STREAM_CAP + 49));
});

test("an empty answer changes nothing but the cursor", () => {
  const a = mergeStream(EMPTY_STREAM, ans([[0, "a"]], 2));
  const b = mergeStream(a, ans([], 2));
  assert.deepEqual(b.lines, a.lines);
});

test("the request keeps the cursor, the limit and a trimmed match the server accepts", () => {
  assert.equal(streamUrl(0), "/status/stream?since=0&limit=100");
  assert.equal(streamUrl(120.7, 50, "  C69 "), "/status/stream?since=120&limit=50&match=C69");
  assert.equal(streamUrl(-5), "/status/stream?since=0&limit=100");
  assert.equal(matchOk("C69"), true);
  assert.equal(matchOk("a|b"), false);
  assert.equal(matchOk("x".repeat(61)), false);
});

test("a run starts only when the person types the word START, nothing else", () => {
  assert.equal(typedWordOk("START"), true);
  assert.equal(typedWordOk("  START "), true);
  assert.equal(typedWordOk("start"), false);
  assert.equal(typedWordOk("STAR"), false);
  assert.equal(typedWordOk(""), false);
  assert.equal(typedWordOk("START now"), false);
});
