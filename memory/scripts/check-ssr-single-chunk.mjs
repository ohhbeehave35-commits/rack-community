#!/usr/bin/env node
/**
 * Fails the build when the Nitro/rolldown beta has split the SSR entry chunk
 * into a broken facade.
 *
 * The split leaves `_ssr/ssr.mjs` re-exporting an `ssr_exports` binding it never
 * defines, beside the real code in `_ssr/ssr2.mjs`. `vite build` still exits 0,
 * and every route then answers 500 with
 * `SyntaxError: Export 'ssr_exports' is not defined in module` (shipped to
 * production at 69e4b8d3, 26 Oct 2026). See the note in src/components/shell.tsx.
 * Failing here stops the deploy instead of shipping a site that is down.
 *
 * Reads the newest build output only (Vercel preset or plain Nitro), so a stale
 * folder from the other preset cannot pass or fail the build.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const candidates = [".vercel/output/functions/__server.func/_ssr", ".output/server/_ssr"].filter((d) => existsSync(d));
if (candidates.length === 0) {
  console.error("check-ssr-single-chunk: no _ssr folder found; run after vite build");
  process.exit(1);
}
const dir = candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const files = readdirSync(dir);
const problems = [];

if (!files.includes("ssr.mjs")) {
  problems.push("no ssr.mjs (the SSR entry is missing)");
} else {
  // The exact failure: a local name in an `export { ... }` list with no binding anywhere in the file.
  const src = readFileSync(join(dir, "ssr.mjs"), "utf8");
  const body = src.replace(/export\s*\{[^}]*\}\s*(from\s*["'][^"']*["'])?\s*;?/g, "");
  const exported = [...src.matchAll(/export\s*\{([^}]*)\}\s*(from\s*["'][^"']*["'])?/g)]
    .filter((m) => !m[2]) // `export { x } from "..."` re-exports need no local binding
    .flatMap((m) => m[1].split(","))
    .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
  const missing = exported.filter((name) => !new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(body));
  if (missing.length > 0) problems.push(`ssr.mjs exports names it never defines: ${missing.join(", ")}`);
}

const split = files.filter((f) => /^ssr\d+\.mjs$/.test(f));
if (split.length > 0) problems.push(`split SSR entry: ${split.join(", ")} beside ssr.mjs`);

if (problems.length > 0) {
  console.error(`check-ssr-single-chunk: ${dir}: ${problems.join("; ")}. Every route would answer 500 (ssr_exports). See src/components/shell.tsx.`);
  process.exit(1);
}
console.log(`check-ssr-single-chunk: ${dir}: one SSR entry chunk, every export defined`);
