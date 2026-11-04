import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PGLITE_LIB_FILES,
  copyPgliteLibs,
  verifyPgliteLibs,
  serverLibsDirs,
} from "./pglite-libs.mjs";

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** A fake repo root: node_modules source files + a built vercel server output. */
function makeRepo({ built = true, withSource = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pglite-libs-"));
  if (withSource) {
    const src = join(root, "node_modules", "@electric-sql", "pglite", "dist");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "initdb.wasm"), WASM_MAGIC);
    writeFileSync(join(src, "pglite.wasm"), WASM_MAGIC);
    writeFileSync(join(src, "pglite.data"), Buffer.from("PGDATA")); // non-empty
  }
  if (built) {
    // A server output must exist (and its _libs, as the real build leaves it).
    mkdirSync(join(root, ".vercel", "output", "functions", "__server.func", "_libs"), {
      recursive: true,
    });
  }
  return root;
}

test("copy then verify: a built output passes", () => {
  const root = makeRepo();
  const { built, copied } = copyPgliteLibs(root);
  assert.equal(built, true);
  assert.equal(copied.length, 1);
  for (const f of PGLITE_LIB_FILES) {
    assert.ok(existsSync(join(copied[0].dir, f)), `${f} copied`);
  }
  const { checked } = verifyPgliteLibs(root);
  assert.equal(checked.length, 1);
  rmSync(root, { recursive: true, force: true });
});

test("RULE 64 — without the copy, verify FAILS the build", () => {
  const root = makeRepo();
  // The build output exists but the copy step never ran.
  assert.equal(serverLibsDirs(root).length, 1);
  assert.throws(() => verifyPgliteLibs(root), /MISSING .*\.(wasm|data)/);
  // Now run the copy: verify must pass — proving the copy is what satisfies it.
  copyPgliteLibs(root);
  assert.doesNotThrow(() => verifyPgliteLibs(root));
  rmSync(root, { recursive: true, force: true });
});

test("a zero-byte runtime file is treated as broken", () => {
  const root = makeRepo();
  copyPgliteLibs(root);
  const libs = serverLibsDirs(root)[0];
  writeFileSync(join(libs, "pglite.data"), Buffer.alloc(0)); // truncate
  assert.throws(() => verifyPgliteLibs(root), /EMPTY .*pglite\.data/);
  rmSync(root, { recursive: true, force: true });
});

test("copy throws when the node_modules source is missing", () => {
  const root = makeRepo({ withSource: false });
  assert.throws(() => copyPgliteLibs(root), /source file missing/);
  rmSync(root, { recursive: true, force: true });
});

test("no build output — both steps are a no-op", () => {
  const root = makeRepo({ built: false });
  assert.equal(serverLibsDirs(root).length, 0);
  assert.deepEqual(copyPgliteLibs(root), { built: false, copied: [] });
  assert.deepEqual(verifyPgliteLibs(root), { built: false, checked: [] });
  rmSync(root, { recursive: true, force: true });
});
