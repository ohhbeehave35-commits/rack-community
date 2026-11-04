import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The seed data file, its manifest and the loader must agree. Read with fs
// (demo-seed.ts imports the database and cannot load under plain node).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const text = readFileSync(join(ROOT, "demo/somnus-demo-seed.json"), "utf8");
const data = JSON.parse(text);
const manifest = JSON.parse(readFileSync(join(ROOT, "demo/somnus-demo-seed.manifest.json"), "utf8"));

test("manifest matches the data file: schema, hash, counts", () => {
  assert.equal(data.schema, "somnus-demo-seed/1");
  assert.equal(manifest.dataSchema, data.schema);
  assert.equal(manifest.sha256, createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex"), "data changed without a new manifest");
  for (const k of ["jobs", "audit", "deliveries", "hooks"]) assert.equal(manifest.counts[k], data[k].length, k);
  assert.equal(manifest.demoSeat, data.demoSeat);
});

test("every record is identifiable as synthetic and every email is .example", () => {
  assert.equal(data.synthetic, true);
  for (const k of ["jobs", "audit", "deliveries", "hooks"]) {
    for (const r of data[k]) assert.ok(r.id.startsWith(data.idPrefix), `${k} ${r.id} lacks ${data.idPrefix}`);
    const ids = data[k].map((r: { id: string }) => r.id);
    assert.equal(new Set(ids).size, ids.length, `${k} has duplicate ids`);
  }
  assert.ok(data.demoSeat.startsWith(data.idPrefix));
  const emails = text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
  assert.ok(emails.length > 0);
  for (const e of emails) assert.match(e, /\.example$/, `non-reserved email ${e}`);
});

test("demo-seed.ts reads this file and has no auto-seed on import", () => {
  const src = readFileSync(join(ROOT, "src/lib/dream/demo-seed.ts"), "utf8");
  assert.match(src, /from "\.\.\/\.\.\/\.\.\/demo\/somnus-demo-seed\.json"/);
  // Nothing at module top level calls seed/writeDemo/cleanDemo.
  for (const line of src.split("\n")) {
    if (/^(await |seed\(|writeDemo\(|cleanDemo\()/.test(line)) assert.fail(`top-level call: ${line}`);
  }
  // The app never calls the seeder: only the script and tests import seed().
  const control = readFileSync(join(ROOT, "src/lib/dream/control-fns.ts"), "utf8");
  assert.doesNotMatch(control, /\bseed\(\)/);
  assert.match(control, /VERCEL_ENV === "production"/, "demo door has a production guard");
});
