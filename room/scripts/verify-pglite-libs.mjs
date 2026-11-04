#!/usr/bin/env node
/** CLI: fail the build if a server output is missing PGLite runtime files. See pglite-libs.mjs. */
import { verifyPgliteLibs } from "./pglite-libs.mjs";

try {
  const { built, checked } = verifyPgliteLibs();
  if (!built) {
    console.log("[verify-pglite-libs] no server output found (nothing built yet) — no-op");
  } else {
    console.log(`[verify-pglite-libs] OK — PGLite runtime files present in: ${checked.join(", ")}`);
  }
} catch (err) {
  console.error(`[verify-pglite-libs] ${err.message}`);
  process.exit(1);
}
