// Rule-64: the TalkBack room's PGLite instance must survive a process
// restart when PGLITE_DATA_DIR is set -- that is the whole point of the
// var (src/lib/db.ts's own comment: "Desktop packaging sets PGLITE_DATA_DIR
// ... so team state persists across restarts"). Nothing previously proved
// this end to end: wire-auth.itest.mjs seeds a token into a FRESH temp dir
// and boots once, which proves the auth gate, not that data outlives a
// restart. Root cause of "TalkBack messages and calls reached nobody"
// A room started without persistent storage loses its state, so
// EVERY restart silently wipes the Lead wire token -- this test proves the
// var, once set, actually fixes that class of loss.
//
// EXPECT it to bite: boot with dataDir unset (PGLITE_DATA_DIR="") between
// the two boots and the second boot's token read returns 401 -- the
// in-memory-fallback failure mode this whole fix exists to close.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, ".output", "server", "index.mjs");
const PORT = Number(process.env.PROBE_PORT || 8562);
const base = `http://127.0.0.1:${PORT}`;

function boot(dataDir) {
  return spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(PORT),
      NITRO_PORT: String(PORT),
      DATABASE_URL: "",
      PGLITE_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitReady(proc) {
  const deadline = Date.now() + 40000;
  return new Promise((resolve, reject) => {
    const hit = (d) => /Listening on/i.test(String(d)) && resolve();
    proc.stdout.on("data", hit);
    proc.stderr.on("data", hit);
    const iv = setInterval(async () => {
      try {
        await fetch(base + "/");
        clearInterval(iv);
        resolve();
      } catch {
        if (Date.now() > deadline) {
          clearInterval(iv);
          reject(new Error("server not ready"));
        }
      }
    }, 400);
  });
}

async function stop(proc) {
  proc.kill();
  await once(proc, "exit").catch(() => {});
}

const authHdr = (t) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

async function seedToken(dataDir, token) {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite({ dataDir });
  await pg.waitReady;
  await pg.exec(
    "create table if not exists talkback_tokens (id serial primary key, user_id text not null, desk text not null, token_hash text not null, token_prefix text, last_used timestamptz, created_at timestamptz not null default now())",
  );
  const hash = createHash("sha256").update(token).digest("hex");
  await pg.query("insert into talkback_tokens (user_id, desk, token_hash, token_prefix) values ($1,$2,$3,$4)", [
    "dev-user",
    "lead",
    hash,
    token.slice(0, 12),
  ]);
  await pg.close();
}

test("PGLITE_DATA_DIR: a minted token survives a real process restart", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "pglite-restart-"));
  const token = `tb_${randomBytes(24).toString("base64url")}`;
  await seedToken(dataDir, token);

  // First boot: the token seeded above must already be readable (sanity,
  // same shape wire-auth.itest.mjs already proves).
  let proc = boot(dataDir);
  try {
    await waitReady(proc);
    assert.equal((await fetch(`${base}/api/wire/snapshot`, { headers: authHdr(token) })).status, 200);
  } finally {
    await stop(proc);
  }

  // Second boot, SAME dataDir, a fresh process (a real restart, not a
  // long-lived one) -- the token from before the restart must still work,
  // and the migration guard must not choke on already-applied migrations
  // (a duplicate _migrations insert would 500 the whole boot, not just
  // this one row).
  proc = boot(dataDir);
  try {
    await waitReady(proc);
    assert.equal(
      (await fetch(`${base}/api/wire/snapshot`, { headers: authHdr(token) })).status,
      200,
      "a token minted before a restart must still authenticate after it -- this is the whole point of PGLITE_DATA_DIR",
    );
  } finally {
    await stop(proc);
  }
});

test("EXPECT IT TO BITE: without PGLITE_DATA_DIR, a restart loses the token (the bug this fix closes)", async () => {
  // Two DIFFERENT temp dirs with no shared PGLITE_DATA_DIR between boots is
  // exactly what "unset" degrades to today on the Spark's running room --
  // this reproduces the loss, so the fix above is proven necessary, not
  // just sufficient.
  const dataDir1 = mkdtempSync(join(tmpdir(), "pglite-nopersist-1-"));
  const dataDir2 = mkdtempSync(join(tmpdir(), "pglite-nopersist-2-"));
  const token = `tb_${randomBytes(24).toString("base64url")}`;
  await seedToken(dataDir1, token);

  let proc = boot(dataDir1);
  try {
    await waitReady(proc);
    assert.equal((await fetch(`${base}/api/wire/snapshot`, { headers: authHdr(token) })).status, 200);
  } finally {
    await stop(proc);
  }

  proc = boot(dataDir2); // simulates "restart with no persistent dir configured"
  try {
    await waitReady(proc);
    assert.equal(
      (await fetch(`${base}/api/wire/snapshot`, { headers: authHdr(token) })).status,
      401,
      "without a shared PGLITE_DATA_DIR, the token from before the restart must be gone -- reproducing TALKBACK-REQUIREMENTS.md's finding",
    );
  } finally {
    await stop(proc);
  }
});
