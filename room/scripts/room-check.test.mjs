import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { waitForRoom } from "./room-check.mjs";
import { PGLITE_LIB_FILES } from "./pglite-libs.mjs";

const runCli = (...args) =>
  new Promise((res) =>
    spawn(process.execPath, ["scripts/room-check.mjs", ...args], { stdio: "ignore" }).on("close", res),
  );

function serve(handler) {
  return new Promise((resolve) => {
    const s = createServer(handler).listen(0, "127.0.0.1", () =>
      resolve({ s, url: `http://127.0.0.1:${s.address().port}/` }),
    );
  });
}

test("room answering 200 passes (CLI exit 0)", async () => {
  const { s, url } = await serve((_q, r) => r.writeHead(200).end("ok"));
  assert.equal((await waitForRoom({ url, timeoutMs: 5000 })).ok, true);
  assert.equal(await runCli(url, "5"), 0);
  s.closeAllConnections(); s.close();
});

test("room that turns 200 after a few 500s still passes", async () => {
  let n = 0;
  const { s, url } = await serve((_q, r) => r.writeHead(++n < 3 ? 500 : 200).end());
  assert.equal((await waitForRoom({ url, timeoutMs: 5000, intervalMs: 50 })).ok, true);
  s.closeAllConnections(); s.close();
});

test("room never 200 fails (CLI exit 1), and a dead port fails", async () => {
  const { s, url } = await serve((_q, r) => r.writeHead(500).end());
  const r = await waitForRoom({ url, timeoutMs: 600, intervalMs: 50 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /500/);
  assert.equal(await runCli(url, "1"), 1);
  s.closeAllConnections(); s.close();
  assert.equal((await waitForRoom({ url, timeoutMs: 400, intervalMs: 50 })).ok, false);
});

test("the config puts the pglite runtime files into a preview build, and the check is documented", () => {
  const cfg = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(cfg, /configurePreviewServer\(\)\s*\{\s*copyPgliteLibs\(\);\s*verifyPgliteLibs\(\)/);
  assert.match(cfg, /pglitePreviewLibsPlugin\(\),/);
  assert.ok(PGLITE_LIB_FILES.includes("pglite.data"));
  const docs = readFileSync(new URL("../docs/ROOM-REDEPLOY.md", import.meta.url), "utf8");
  assert.match(docs, /room-check\.mjs/);
});
