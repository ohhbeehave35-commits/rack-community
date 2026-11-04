#!/usr/bin/env node
/**
 * PGLite runtime files → server build output.
 *
 * WHY THIS EXISTS. The build (nitro `vercel` preset, and the `node-server`
 * preset too) bundles `@electric-sql/pglite` but does NOT emit PGLite's three
 * runtime data files alongside the server chunk. At first request the server
 * then throws `ENOENT … _libs/pglite.data` and every SSR route 500s. PGLite is
 * the app's embedded database (the demo + the offline build depend on it), so a
 * build that ships without these files is broken even though `vite build`
 * exits 0. Found 2026-09-12 on the Spark; the identical gap exists in TalkBack.
 *
 * `copyPgliteLibs` copies the three files from node_modules into each server
 * output's `_libs` dir. `verifyPgliteLibs` fails LOUDLY (throws) if any of them
 * is missing from a built output — that is the build-time gate: the build runs
 * copy THEN verify, so deleting the copy step makes verify fail the build
 * (rule 64). Both are deterministic and idempotent.
 *
 * Delete this once the toolchain emits the PGLite runtime files itself.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(scriptDir, "..");

/** The three PGLite runtime files the server loads at request time. */
export const PGLITE_LIB_FILES = ["initdb.wasm", "pglite.wasm", "pglite.data"];

/** Source dir inside node_modules for a given repo root. */
export function pgliteSourceDir(repoRoot = DEFAULT_REPO_ROOT) {
  return join(repoRoot, "node_modules", "@electric-sql", "pglite", "dist");
}

/**
 * The `_libs` dirs of every server output present under `repoRoot` (vercel and
 * node-server). Only dirs whose parent build output actually exists are
 * returned — an unbuilt tree contributes nothing.
 */
export function serverLibsDirs(repoRoot = DEFAULT_REPO_ROOT) {
  const candidates = [
    {
      output: join(repoRoot, ".vercel", "output", "functions", "__server.func"),
      libs: join(repoRoot, ".vercel", "output", "functions", "__server.func", "_libs"),
    },
    {
      output: join(repoRoot, ".output", "server"),
      libs: join(repoRoot, ".output", "server", "_libs"),
    },
  ];
  return candidates.filter((c) => existsSync(c.output)).map((c) => c.libs);
}

/**
 * Copy the PGLite runtime files into every server output's `_libs` dir.
 * Throws if a SOURCE file is missing (a broken node_modules must not silently
 * ship a data-less build). No-ops when nothing is built yet.
 * Returns { built, copied: [{dir, files}] }.
 */
export function copyPgliteLibs(repoRoot = DEFAULT_REPO_ROOT) {
  const src = pgliteSourceDir(repoRoot);
  for (const f of PGLITE_LIB_FILES) {
    const from = join(src, f);
    if (!existsSync(from)) {
      throw new Error(
        `pglite-libs: source file missing: ${from} — cannot assemble a working build ` +
          `(is @electric-sql/pglite installed?)`,
      );
    }
  }
  const dirs = serverLibsDirs(repoRoot);
  const copied = [];
  for (const libs of dirs) {
    mkdirSync(libs, { recursive: true });
    for (const f of PGLITE_LIB_FILES) {
      copyFileSync(join(src, f), join(libs, f));
    }
    copied.push({ dir: libs, files: [...PGLITE_LIB_FILES] });
  }
  return { built: dirs.length > 0, copied };
}

/**
 * Verify every built server output carries the PGLite runtime files, non-empty.
 * Throws with the exact missing path on the first failure. This is the gate:
 * remove the copy step and this fails the build. No-ops when nothing is built.
 * Returns { built, checked: [dir] }.
 */
export function verifyPgliteLibs(repoRoot = DEFAULT_REPO_ROOT) {
  const dirs = serverLibsDirs(repoRoot);
  const checked = [];
  for (const libs of dirs) {
    for (const f of PGLITE_LIB_FILES) {
      const p = join(libs, f);
      if (!existsSync(p)) {
        throw new Error(
          `pglite-libs: MISSING ${p} — the build shipped without PGLite's runtime files; ` +
            `the server would 500 at first request. Did the copy step run?`,
        );
      }
      // A zero-byte data file is as broken as an absent one.
      if (statSync(p).size === 0) {
        throw new Error(`pglite-libs: EMPTY ${p} — PGLite runtime file is zero bytes.`);
      }
      // Cheap sanity: wasm files start with the '\0asm' magic.
      if (f.endsWith(".wasm")) {
        const head = readFileSync(p).subarray(0, 4);
        if (!(head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d)) {
          throw new Error(`pglite-libs: ${p} is not a valid wasm module (bad magic).`);
        }
      }
    }
    checked.push(libs);
  }
  return { built: dirs.length > 0, checked };
}
