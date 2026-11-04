// Rule-64: the wire API is the app's LAN exposure seam. A second host must not
// reach it without a valid per-desk token, and a token must never be mintable
// over the wire. Boots the packaged node-server against a temp PGLite dir that
// already holds one known token, then probes as a remote caller would.
//
//   no token            → 401   (heartbeat + snapshot)
//   wrong token         → 401
//   valid token         → 200   (heartbeat + snapshot)
//   mint over the wire  → 404   (no such op; issuing is a server function, gated
//                                by authMiddleware, never a wire route)
//
// EXPECT it to bite: point the server at an empty dir (no token row) and the
// valid-token cases stop returning 200.
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
const PORT = Number(process.env.PROBE_PORT || 8561);
const base = `http://127.0.0.1:${PORT}`;

const VALID = `tb_${randomBytes(24).toString("base64url")}`;
const hash = createHash("sha256").update(VALID).digest("hex");

async function seedToken(dataDir) {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite({ dataDir });
  await pg.waitReady;
  await pg.exec(
    "create table if not exists talkback_tokens (id serial primary key, user_id text not null, desk text not null, token_hash text not null, token_prefix text, last_used timestamptz, created_at timestamptz not null default now())",
  );
  await pg.query("insert into talkback_tokens (user_id, desk, token_hash, token_prefix) values ($1,$2,$3,$4)", [
    "dev-user",
    "lead",
    hash,
    VALID.slice(0, 12),
  ]);
  await pg.close();
}

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
const authHdr = (t) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

test("wire API rejects unauthenticated/forged callers and cannot mint over the wire", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "wire-auth-"));
  await seedToken(dataDir);
  const proc = boot(dataDir);
  try {
    await waitReady(proc);

    // No token → 401 on both the mutating and reading wire ops.
    assert.equal((await fetch(`${base}/api/wire/heartbeat`, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(`${base}/api/wire/snapshot`)).status, 401);

    // Wrong/forged token → 401.
    assert.equal(
      (await fetch(`${base}/api/wire/heartbeat`, { method: "POST", headers: authHdr("tb_not_a_real_token"), body: "{}" })).status,
      401,
    );
    assert.equal((await fetch(`${base}/api/wire/snapshot`, { headers: authHdr("tb_not_a_real_token") })).status, 401);

    // A token that isn't even in tb_ shape → 401.
    assert.equal((await fetch(`${base}/api/wire/snapshot`, { headers: authHdr("bogus") })).status, 401);

    // Valid token → 200 on both.
    assert.equal(
      (await fetch(`${base}/api/wire/heartbeat`, { method: "POST", headers: authHdr(VALID), body: JSON.stringify({ status: "working" }) })).status,
      200,
    );
    assert.equal((await fetch(`${base}/api/wire/snapshot`, { headers: authHdr(VALID) })).status, 200);

    // No mint over the wire: issuing is a server function behind authMiddleware,
    // never a wire op — plausible mint paths are unknown ops (404), even with a
    // valid token.
    for (const op of ["mint", "issue", "token", "issue-token"]) {
      const res = await fetch(`${base}/api/wire/${op}`, { method: "POST", headers: authHdr(VALID), body: "{}" });
      assert.equal(res.status, 404, `POST /api/wire/${op} should be an unknown op`);
    }
  } finally {
    proc.kill();
    await once(proc, "exit").catch(() => {});
  }
});
