// Rule 34: no em dash in anything a person reads on screen. This scans the
// component source for em dashes in rendered text -- JSX text and string
// literals -- after stripping code comments, which are not on screen. It fails
// if one returns (it would have failed before the sweep on 2026-09-08).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const SRC_DIRS = [join(ROOT, "components"), join(ROOT, "routes")];

function tsxFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

// Strip /* block */ and // line comments so only rendered text is scanned.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

test("no em dash in rendered component or route text (rule 34)", () => {
  const offenders = [];
  const files = SRC_DIRS.flatMap((d) => tsxFiles(d));
  for (const f of files) {
    const code = stripComments(readFileSync(f, "utf8"));
    code.split("\n").forEach((line, i) => {
      if (line.includes("—")) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(offenders, [], "em dash in on-screen text:\n" + offenders.join("\n"));
});
