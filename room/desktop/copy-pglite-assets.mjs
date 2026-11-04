// Nitro does not copy PGLite's runtime `.data`/`.wasm` next to the bundled
// module, so the built server crashes on first query with ENOENT. This copies
// them into .output/server/_libs/ after a node-server build. Run by
// `npm run desktop:build`.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "@electric-sql", "pglite", "dist");
const dst = join(root, ".output", "server", "_libs");

if (!existsSync(join(root, ".output", "server", "index.mjs"))) {
  console.error("[copy-pglite] no node-server build found — run the build first");
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
// Copy PGLite's runtime assets (pglite.data, pglite.wasm, initdb.wasm, and the
// extension .tar.gz bundles) that Nitro leaves out. Persistent (dataDir) mode
// needs initdb.wasm on top of the two the in-memory path uses.
let n = 0;
for (const f of readdirSync(src)) {
  if (/\.(wasm|data|tar\.gz)$/.test(f)) {
    copyFileSync(join(src, f), join(dst, f));
    n++;
  }
}
console.log(`[copy-pglite] copied ${n} runtime assets -> .output/server/_libs/`);
