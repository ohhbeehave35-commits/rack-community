import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * Rule 7/readability floor (first-day walk, 2026-09-12): src/styles.css set
 * --text-xs to 0.75rem (12px) and --text-sm to 0.875rem (14px), so every
 * text-xs/text-sm class in the app — labels on the very first "Who sits
 * here?" screen included — rendered under 16px. Rule 64: restore the old
 * values and this fails.
 */
const STYLES_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles.css");

function readVarRem(css, name) {
  const m = css.match(new RegExp(`--${name}:\\s*([\\d.]+)rem`));
  assert.ok(m, `--${name} not found as a rem value in styles.css`);
  return parseFloat(m[1]);
}

test("text-xs and text-sm tokens render at 16px or larger", () => {
  const css = readFileSync(STYLES_PATH, "utf8");
  const xs = readVarRem(css, "text-xs");
  const sm = readVarRem(css, "text-sm");
  assert.ok(xs >= 1, `--text-xs is ${xs}rem (${xs * 16}px), under the 16px floor`);
  assert.ok(sm >= 1, `--text-sm is ${sm}rem (${sm * 16}px), under the 16px floor`);
});

test("no component hardcodes an arbitrary sub-16px text utility", () => {
  let out = "";
  try {
    out = execSync(
      'grep -rlE "text-\\[(9|10|11|12|13|14|15)px\\]" src',
      { cwd: dirname(dirname(STYLES_PATH)), encoding: "utf8" },
    );
  } catch (err) {
    if (err.status === 1) out = ""; // grep found nothing
    else throw err;
  }
  assert.equal(out.trim(), "", `sub-16px arbitrary text utilities found in:\n${out}`);
});
