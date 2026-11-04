import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Rule 64: the desktop build config must define all three OS targets. Parse the
// electron-builder YAML into top-level sections and assert each platform's
// target type is present. Remove a block (or its target) and this bites.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const yml = readFileSync(join(root, "desktop", "electron-builder.yml"), "utf8");

/** Text of a top-level `key:` section, up to the next column-0 key. */
function section(key) {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `${key}:`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

test("electron-builder defines win, mac, and linux targets", () => {
  const win = section("win");
  const mac = section("mac");
  const linux = section("linux");
  assert.ok(win, "win: section missing");
  assert.ok(mac, "mac: section missing");
  assert.ok(linux, "linux: section missing");
  assert.match(win, /target:\s*nsis/);
  assert.match(mac, /target:\s*dmg/);
  assert.match(mac, /arm64/);
  assert.match(mac, /x64/);
  assert.match(linux, /target:\s*AppImage/);
});

test("win target is unchanged (nsis x64, StingerTalkBack-Setup artifact)", () => {
  const win = section("win");
  assert.match(win, /icon:\s*desktop\/build\/icon\.ico/);
  assert.match(win, /StingerTalkBack-Setup-\$\{version\}\.\$\{ext\}/);
});
