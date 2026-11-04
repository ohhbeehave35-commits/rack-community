import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SomnusMemory, searchMemories, runBenchmark, type MemoryDoc } from "../src/index.ts";

const FILES: MemoryDoc[] = [
  { name: "CLAUDE.md", body: "# CLAUDE.md\n\nThis file is human-owned. Skills must not rewrite it.\n\n- Default HTTP: REST at /api\n- Package manager: npm\n" },
  { name: "user-preferences.md", hook: "Standing taste and tooling locks.", body: "# User preferences\n\n- Package manager: pnpm (do not use npm).\n- Never commit .env files.\n- Never use moment.js, date-fns instead.\n" },
  { name: "stack.md", hook: "Architecture and API choices.", body: "# Stack\n\n- Vite + TanStack Start + Tailwind v4.\n- Shop catalog: REST at /api/boats.\n- Auth: Better Auth, email + password.\n- Database: Postgres.\n" },
  { name: "debugging.md", hook: "Recent failures and how they were fixed.", body: "# Debugging\n\n- Auth tests failed last week on WrongPassword copy.\n- GraphQL spike left unused resolvers in src/gql, ignore for now.\n" },
  { name: "workflow.md", hook: "How Somnus may touch this store.", body: "# Workflow\n\n- Snapshot memory before writes.\n- Never rm topic files; move superseded ones to TRASH/.\n" },
];

test("a plain-English question finds the line that answers it, with file and line number", () => {
  const r = searchMemories(FILES, "which package manager do I use?");
  assert.equal(r[0].file, "user-preferences.md");
  assert.match(r[0].text, /pnpm/);
  assert.equal(r[0].line, 3);
  assert.equal(searchMemories(FILES, "what database do we run")[0].file, "stack.md");
  assert.equal(searchMemories(FILES, "why did the login tests break")[0].file, "debugging.md");
  assert.equal(searchMemories(FILES, "can a skill edit the claude file")[0].file, "CLAUDE.md");
  assert.equal(searchMemories(FILES, "where do old topic files go")[0].file, "workflow.md");
});

test("nothing matching returns nothing, limit is honoured, empty query is empty", () => {
  assert.deepEqual(searchMemories(FILES, "zebra quantum banana"), []);
  assert.deepEqual(searchMemories(FILES, "   "), []);
  assert.equal(searchMemories(FILES, "never", { limit: 1 }).length, 1);
});

test("benchmark scores recall at 1, 3 and 5 and mean reciprocal rank, and shows a miss", () => {
  const cases = [
    { q: "which package manager", expect: "user-preferences.md" },
    { q: "what database", expect: "stack.md" },
    { q: "zebra quantum", expect: "stack.md" },
  ];
  const b = runBenchmark(FILES, cases);
  assert.equal(b.cases, 3);
  assert.equal(b.recallAt1, 2 / 3);
  assert.equal(b.recallAt5, 2 / 3);
  assert.equal(b.misses[0].q, "zebra quantum");
  assert.ok(b.mrr > 0.6 && b.mrr < 0.7);
});

test("SomnusMemory reads a directory of memory files: list, read, search, benchmark", () => {
  const dir = mkdtempSync(join(tmpdir(), "somnus-sdk-"));
  for (const f of FILES) writeFileSync(join(dir, f.name), f.body);
  writeFileSync(join(dir, "notes.txt"), "not a memory file");
  const m = SomnusMemory.fromDirectory(dir);
  assert.deepEqual(m.list().map((f) => f.name).sort(), FILES.map((f) => f.name).sort());
  assert.match(m.read("stack.md")!, /Postgres/);
  assert.equal(m.read("../secret.md"), null);
  assert.equal(m.search("what database")[0].file, "stack.md");
  assert.equal(m.benchmark([{ q: "what database", expect: "stack.md" }]).recallAt1, 1);
});
