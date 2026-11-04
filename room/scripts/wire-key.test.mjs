// Rule 64: wire keys must survive a restart, and be mintable with no browser.
// Bites: make resolvePgliteDataDir() return undefined (PGLITE_DATA_DIR ignored,
// in-memory store) and the persistence test fails; unset PGLITE_DATA_DIR and the
// CLI refuses.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { hashToken, mintToken } from "../src/lib/talkback/token.server.ts";
import { resolvePgliteDataDir } from "./pglite-data-dir.mjs";
import { findDataDirHolders, reissueWireKey } from "./wire-key.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "scripts", "wire-key.mjs");
const TABLE = readFileSync(join(ROOT, "migrations", "0004_wire.sql"), "utf8");

// Open the store the way db.ts does, from env alone.
async function openLikeRoom(env) {
  const dataDir = resolvePgliteDataDir(env);
  const pg = new PGlite(dataDir ? { dataDir } : {});
  await pg.waitReady;
  await pg.exec(TABLE);
  return pg;
}

// The resolveAuth query in wire-http.ts.
async function authenticates(pg, token) {
  const r = await pg.query("select id from talkback_tokens where token_hash = $1 limit 1", [
    hashToken(token),
  ]);
  return r.rows.length === 1;
}

async function issueCloseReopen(env) {
  const minted = mintToken();
  let pg = await openLikeRoom(env);
  await pg.query(
    "insert into talkback_tokens (user_id, desk, token_hash, token_prefix) values ($1,$2,$3,$4)",
    ["dev-user", "floor", minted.hash, minted.prefix],
  );
  await pg.close();
  pg = await openLikeRoom(env); // "restart"
  const rows = (await pg.query("select token_prefix from talkback_tokens")).rows;
  const ok = await authenticates(pg, minted.token);
  await pg.close();
  return { rows, ok, prefix: minted.prefix };
}

test("wire key survives a restart when PGLITE_DATA_DIR is set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wirekey-persist-"));
  try {
    const { rows, ok, prefix } = await issueCloseReopen({ PGLITE_DATA_DIR: dir });
    assert.deepEqual(rows, [{ token_prefix: prefix }]);
    assert.equal(ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wire key is lost on restart when PGLITE_DATA_DIR is unset (the Floor 401)", async () => {
  const { rows, ok } = await issueCloseReopen({});
  assert.deepEqual(rows, []);
  assert.equal(ok, false);
});

test("db.ts takes its data dir from resolvePgliteDataDir", () => {
  const src = readFileSync(join(ROOT, "src", "lib", "db.ts"), "utf8");
  assert.match(src, /resolvePgliteDataDir\(process\.env\)/);
  assert.match(src, /\.\.\.\(dataDir \? \{ dataDir \} : \{\}\)/);
});

test("reissueWireKey replaces the old key and the new one authenticates", async () => {
  const pg = await openLikeRoom({});
  const first = await reissueWireKey(pg, "dev-user", "floor");
  const second = await reissueWireKey(pg, "dev-user", "floor");
  assert.equal(await authenticates(pg, first.token), false);
  assert.equal(await authenticates(pg, second.token), true);
  assert.equal((await pg.query("select 1 from talkback_tokens")).rows.length, 1);
  await pg.close();
});

function runCli(args, env) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
}

test("CLI refuses when PGLITE_DATA_DIR is unset", () => {
  const r = runCli(["--user", "dev-user", "--desk", "floor"], {});
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /PGLITE_DATA_DIR is not set/);
});

test("CLI rejects an unknown desk", () => {
  const r = runCli(["--user", "dev-user", "--desk", "nope"], { PGLITE_DATA_DIR: "/tmp/x" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Usage/);
});

test("CLI mints a key that authenticates after reopening the store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wirekey-cli-"));
  try {
    const r = runCli(["--user", "dev-user", "--desk", "floor"], { PGLITE_DATA_DIR: dir });
    assert.equal(r.status, 0, r.stderr);
    const token = r.stdout.trim();
    assert.match(token, /^tb_/);
    assert.match(r.stderr, new RegExp(token.slice(0, 12)));
    const pg = await openLikeRoom({ PGLITE_DATA_DIR: dir });
    assert.equal(await authenticates(pg, token), true);
    await pg.close();
    const again = runCli(["--user", "dev-user", "--desk", "floor"], { PGLITE_DATA_DIR: dir });
    assert.equal(again.status, 0, again.stderr);
    const pg2 = await openLikeRoom({ PGLITE_DATA_DIR: dir });
    assert.equal(await authenticates(pg2, token), false);
    assert.equal(await authenticates(pg2, again.stdout.trim()), true);
    await pg2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI mints a key via the documented `npm run wire:key` invocation (own launcher isn't a holder)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wirekey-npmrun-"));
  try {
    const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "wire:key", "--", "--user", "dev-user", "--desk", "floor"], {
      cwd: ROOT,
      shell: process.platform === "win32",
      env: { ...process.env, PGLITE_DATA_DIR: dir },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^tb_/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI refuses while a process holds the data dir, naming the kill command", { skip: process.platform !== "linux" ? "Requires Linux /proc process environments; not available on this host" : false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "wirekey-held-"));
  const holder = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    env: { PATH: process.env.PATH, PGLITE_DATA_DIR: dir },
    stdio: "ignore",
  });
  try {
    assert.deepEqual(findDataDirHolders(dir), [holder.pid]);
    const r = runCli(["--user", "dev-user", "--desk", "floor"], { PGLITE_DATA_DIR: dir });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(`kill ${holder.pid}\\b`));
    assert.match(r.stderr, /rack\.mjs up/);
  } finally {
    holder.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
