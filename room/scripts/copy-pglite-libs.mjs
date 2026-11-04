#!/usr/bin/env node
/** CLI: copy PGLite runtime files into the server build output. See pglite-libs.mjs. */
import { copyPgliteLibs } from "./pglite-libs.mjs";

const { built, copied } = copyPgliteLibs();
if (!built) {
  console.log("[copy-pglite-libs] no server output found (nothing built yet) — no-op");
} else {
  for (const { dir, files } of copied) {
    console.log(`[copy-pglite-libs] copied ${files.join(", ")} -> ${dir}`);
  }
}
