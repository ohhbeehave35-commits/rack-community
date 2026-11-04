import test from "node:test";
import assert from "node:assert/strict";
import { BENCH_CASES, MEMORY_DOCS, benchSample, searchSample } from "./memory-bench.ts";

test("natural-language search answers a question from the sample memory with file and line", () => {
  const r = searchSample("which package manager do I use");
  assert.equal(r[0].file, "user-preferences.md");
  assert.match(r[0].text, /pnpm/);
});

test("the quality benchmark on the sample memory: 12 questions, recall@3 at least 0.9, recall@5 at least 0.95, a floor on recall@1", () => {
  const b = benchSample();
  assert.equal(b.cases, BENCH_CASES.length);
  assert.ok(b.recallAt1 >= 0.75, `recall@1 ${b.recallAt1}`);
  assert.ok(b.recallAt3 >= 0.9, `recall@3 ${b.recallAt3}`);
  assert.ok(b.recallAt5 >= 0.95, `recall@5 ${b.recallAt5}`);
  assert.ok(b.mrr >= 0.8, `mrr ${b.mrr}`);
});

test("the benchmark notices a worse search: with the index file only, the score drops", () => {
  const worse = benchSample(MEMORY_DOCS.filter((d) => d.name === "MEMORY.md"));
  assert.ok(worse.recallAt5 < 0.5);
});
