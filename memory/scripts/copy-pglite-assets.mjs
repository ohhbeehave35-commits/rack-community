#!/usr/bin/env node
/**
 * vite preview (Vercel output) loads PGLite from _libs/*.wasm|data.
 * Nitro does not copy those sidecar files; without them the built
 * preview process dies on first getSql(). Production Neon is unaffected.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@electric-sql/pglite/dist");
const dest = join(root, ".vercel/output/functions/__server.func/_libs");
mkdirSync(dest, { recursive: true });
for (const name of ["pglite.data", "pglite.wasm", "initdb.wasm", "initdb.js"]) {
  copyFileSync(join(src, name), join(dest, name));
}
