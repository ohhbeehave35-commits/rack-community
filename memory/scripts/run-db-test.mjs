#!/usr/bin/env node
/**
 * Run the tests that need a real database, through Vite.
 *
 * WHY THIS EXISTS
 *
 * The app's local database is PGLite, and `src/lib/db.ts` loads its migrations
 * with `import.meta.glob`. That is a Vite feature. Under plain `node --test`
 * the glob is undefined, migration throws, and every database assertion fails
 * for a reason that has nothing to do with what was being tested. So the
 * two-company isolation test could be written but never run, and the same wall
 * stands in front of Bound, Example Co, Signet, Cage, Desk and Somnus, which are
 * the same shape.
 *
 * This boots Vite in middleware mode and loads each `*.dbtest.ts` file through
 * `ssrLoadModule`, so the app's own module graph applies: the glob resolves,
 * `.server` modules load, and the test talks to the same PGLite the app uses.
 *
 * THE SHAPE OF A TEST FILE
 *
 *     export const tests = [
 *       { name: "what it proves", fn: async () => { ... throw on failure ... } },
 *     ];
 *     export const fixtureCount = 2;   // optional, see below
 *
 * WHAT THIS RUNNER ASSERTS ABOUT ITSELF
 *
 * Two things, both learned the hard way in this repo. First, a run that
 * collected zero tests is a failure, not a pass: `scripts/run-node-test.mjs`
 * exists because a quoted glob once matched nothing and exited 0 while
 * fourteen real failures sat unrun. Second, and this is the one that matters
 * for an isolation test, a test file may declare `fixtureCount`, the number of
 * rows or companies it seeded. If a file declares one and the value is zero,
 * the run fails: a two-company test that seeded no companies would otherwise
 * pass by finding no leak in an empty database, which is the most convincing
 * false green there is.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

const ROOT = process.cwd();

function findDbTests(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findDbTests(full, out);
    else if (/\.dbtest\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const explicit = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const files = explicit.length
  ? explicit.map((f) => join(ROOT, f))
  : findDbTests(join(ROOT, "src"));

if (files.length === 0) {
  console.error("[db-test] no *.dbtest.ts files found. A runner that matched nothing is not a passing suite.");
  process.exit(1);
}

const server = await createServer({
  root: ROOT,
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
  logLevel: "error",
});

let collected = 0;
let passed = 0;
const failures = [];

try {
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    let mod;
    try {
      mod = await server.ssrLoadModule(pathToFileURL(file).pathname);
    } catch (err) {
      failures.push([rel, "could not load the test file: " + (err?.message ?? err)]);
      continue;
    }
    const tests = Array.isArray(mod.tests) ? mod.tests : [];
    if (tests.length === 0) {
      failures.push([rel, "exports no tests. Export `tests` as an array of { name, fn }."]);
      continue;
    }
    // The guard on the fixture: a leak test that seeded nothing proves nothing.
    if ("fixtureCount" in mod) {
      const count = typeof mod.fixtureCount === "function" ? await mod.fixtureCount() : mod.fixtureCount;
      if (!Number.isFinite(count) || count <= 0) {
        failures.push([rel, `declared fixtureCount ${count}: it seeded nothing, so a green run would mean nothing`]);
        continue;
      }
      console.log(`# ${rel} seeded ${count}`);
    }
    for (const { name, fn } of tests) {
      collected += 1;
      try {
        await fn();
        passed += 1;
        console.log(`ok ${collected} - ${rel} :: ${name}`);
      } catch (err) {
        failures.push([`${rel} :: ${name}`, err?.stack ?? String(err)]);
        console.log(`not ok ${collected} - ${rel} :: ${name}`);
      }
    }
  }
} finally {
  await server.close();
}

console.log(`\n1..${collected}`);
console.log(`# collected ${collected}, passed ${passed}, failed ${failures.length}`);

// Detail first, always: a runner that exits without saying why is the same
// species of problem as a suite that passes without looking at anything.
if (failures.length) {
  console.error("\nfailures:");
  for (const [where, detail] of failures) console.error(`\n  ${where}\n    ${detail}`);
}
if (collected === 0) {
  console.error("\n[db-test] collected zero tests. That is a failure, not a pass.");
  process.exit(1);
}
if (failures.length) process.exit(1);

/**
 * WHAT TO WRITE HERE FIRST, in somnus:
 * the control plane it sells as private: memory, policy and audit rows for one account must never be readable by another.
 * Name it a tenant-isolation.dbtest.ts beside the code it tests, seed TWO companies with two
 * different owners, read back as each, and declare fixtureCount. Chair's is the
 * worked example: rack-community-chair src/lib/chair/tenant-isolation.dbtest.ts.
 */
