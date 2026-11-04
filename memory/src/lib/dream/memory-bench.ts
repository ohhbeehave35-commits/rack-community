/**
 * Memory quality benchmark for the sample project (PARITY8C). Each question has the file that answers it; the score is how often search
 * brings that file back first (recall@1), in the top 3 and top 5, and the mean reciprocal rank. Same method long-memory benchmarks report,
 * on this project's own memory (it is not the public LoCoMo or LongMemEval data set, which Somnus does not ship).
 */
import { HUMAN_FILE, MEMORY_FILES } from "./memory.ts";
import { runBenchmark, searchMemories, type BenchCase, type MemoryDoc } from "../../../sdk/somnus-sdk/src/search.ts";

export const MEMORY_DOCS: MemoryDoc[] = [HUMAN_FILE, ...MEMORY_FILES].map((f) => ({ name: f.name, body: f.body, hook: f.hook }));

export const BENCH_CASES: BenchCase[] = [
  { q: "which package manager do I use", expect: "user-preferences.md" },
  { q: "am I allowed to use moment.js", expect: "user-preferences.md" },
  { q: "can I commit my .env file", expect: "user-preferences.md" },
  { q: "what database does the shop use", expect: "stack.md" },
  { q: "how do users sign in", expect: "stack.md" },
  { q: "what css framework", expect: "stack.md" },
  { q: "why did the auth tests fail", expect: "debugging.md" },
  { q: "what was the graphql spike", expect: "debugging.md" },
  { q: "should a skill rewrite the claude file", expect: "CLAUDE.md" },
  { q: "who owns CLAUDE.md", expect: "CLAUDE.md" },
  { q: "do I snapshot memory before writes", expect: "workflow.md" },
  { q: "where do superseded topic files go", expect: "workflow.md" },
];

export const searchSample = (query: string, limit?: number, docs: MemoryDoc[] = MEMORY_DOCS) => searchMemories(docs, query, { limit });
export const benchSample = (docs: MemoryDoc[] = MEMORY_DOCS) => runBenchmark(docs, BENCH_CASES);
