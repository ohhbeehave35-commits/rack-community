// PARITY9A Somnus: the memories screen has a plain-English search box over the same search the SDK and Assistant use.
// A look change: built and pictured, NOT landed until the owner says approved.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MEMORY_DOCS, searchSample } from "./memory-bench.ts";

const page = readFileSync(new URL("../../routes/memory.tsx", import.meta.url), "utf8");

test("the memory page has an Ask your memory box that uses the SDK search and opens the file a hit came from", () => {
  assert.match(page, /sdk\/somnus-sdk\/src\/search\.ts/);
  assert.match(page, /aria-label="Ask your memory"/);
  assert.match(page, /searchMemories\(files\.map/);
  assert.match(page, /\{h\.file\} · line \{h\.line\}/);
  assert.match(page, /setTab\("live"\);\s*setActive\(f\.id\)/);
  assert.match(page, /Nothing in the memory matches that/);
});

test("the question in the box finds the right file first (same search the box runs)", () => {
  assert.equal(searchSample("which package manager do I use", 5, MEMORY_DOCS)[0]!.file, "user-preferences.md");
  assert.equal(searchSample("what database does the shop use", 5, MEMORY_DOCS)[0]!.file, "stack.md");
  assert.equal(searchSample("zzzzqqq nothing", 5, MEMORY_DOCS).length, 0);
});
