import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { SomnusMemory } from "../src/index.ts";
import { createMcpHandler } from "../src/mcp.ts";

const mem = new SomnusMemory([{ name: "stack.md", body: "# Stack\n\n- Database: Postgres.\n" }, { name: "user-preferences.md", body: "# P\n\n- Package manager: pnpm.\n" }]);
const call = (h: ReturnType<typeof createMcpHandler>, name: string, args: unknown, id = 1) => h({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) as any;

test("initialize, list tools, search, list, read; errors are answers not crashes", () => {
  const h = createMcpHandler(mem);
  assert.equal((h({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }) as any).result.serverInfo.name, "somnus-memory");
  assert.equal(h({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.deepEqual((h({ jsonrpc: "2.0", id: 2, method: "tools/list" }) as any).result.tools.map((t: any) => t.name), ["somnus_search_memory", "somnus_list_memory", "somnus_read_memory"]);
  assert.match(call(h, "somnus_search_memory", { query: "what database" }).result.content[0].text, /^stack\.md:3 /);
  assert.match(call(h, "somnus_list_memory", {}).result.content[0].text, /stack\.md \(\d+ lines\)/);
  assert.match(call(h, "somnus_read_memory", { name: "stack.md" }).result.content[0].text, /Postgres/);
  assert.equal(call(h, "somnus_read_memory", { name: "../x" }).result.isError, true);
  assert.equal(call(h, "somnus_search_memory", { query: "" }).result.isError, true);
  assert.equal(call(h, "somnus_write_memory", {}).error.code, -32602);
  assert.equal((h({ jsonrpc: "2.0", id: 9, method: "nope" }) as any).error.code, -32601);
});

test("the stdio server answers over a real pipe", async () => {
  const dir = mkdtempSync(join(tmpdir(), "somnus-mcp-"));
  writeFileSync(join(dir, "stack.md"), "# Stack\n\n- Database: Postgres.\n");
  const p = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "..", "src", "bin.ts")], { env: { ...process.env, SOMNUS_MEMORY_DIR: dir }, stdio: ["pipe", "pipe", "inherit"] });
  const out: string[] = [];
  p.stdout.setEncoding("utf8");
  const got = new Promise<void>((resolve) => p.stdout.on("data", (c: string) => { out.push(...c.split("\n").filter(Boolean)); if (out.length >= 2) resolve(); }));
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "somnus_search_memory", arguments: { query: "database" } } }) + "\n");
  await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error("no answer from the server")), 8000))]);
  p.kill();
  assert.equal(JSON.parse(out[0]).id, 1);
  assert.match(JSON.parse(out[1]).result.content[0].text, /Postgres/);
});
