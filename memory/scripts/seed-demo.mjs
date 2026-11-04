#!/usr/bin/env node
/**
 * Fill a demo house with real work, so a prospect opens the app and sees a
 * business rather than an empty screen.
 *
 * WHICH DATABASE THIS WRITES TO, and it prints the answer before it writes a
 * row, because seeding the wrong database is the one mistake here that costs a
 * morning:
 *
 *   DATABASE_URL set          -> that Postgres. This is how the DEPLOYED demo
 *                                gets filled. The connection string is a deploy
 *                                secret; this script never invents one.
 *   DATABASE_URL unset        -> the embedded PGLite database.
 *   PGLITE_DATA_DIR set    -> that PGLite lives in a folder, so the dev
 *                                server started with the same folder serves the
 *                                rows this script wrote. Without it the rows die
 *                                with this process and the screens stay empty.
 *
 * Run it (mode is seed | clean | reset | check, default seed):
 *   PGLITE_DATA_DIR=.demo-db node scripts/seed-demo.mjs reset
 *   SOMNUS_DEMO_TARGET=demo DATABASE_URL=postgres://... node scripts/seed-demo.mjs check
 *
 * seed   writes the sample week under the demo role (clears its own rows first)
 * clean  removes ONLY the sample's rows: demo role AND an id from the data file
 * reset  clean, then seed
 * check  counts the sample's rows, writes nothing
 *
 * GUARDS (demoTargetRefusal in demo-seed.ts): a real Postgres, NODE_ENV or
 * VERCEL_ENV production are refused unless SOMNUS_DEMO_TARGET=demo says this
 * target IS the demo platform; a host listed in SOMNUS_PROD_DB_HOSTS is refused
 * always. Nothing seeds on boot; this script is the only way in.
 *
 * It boots Vite the same way scripts/run-db-test.mjs does, because the app's
 * migrations load through import.meta.glob and will not run under plain node.
 */
import { createServer } from "vite";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const MODE = process.argv[2] ?? "seed";
if (!["seed", "clean", "reset", "check"].includes(MODE)) {
  console.error(`[seed] unknown mode ${MODE}; use seed, clean, reset or check`);
  process.exit(2);
}
const SEED = join(ROOT, "src/lib/dream/demo-seed.ts");

const url = process.env.DATABASE_URL?.trim();
const dir = process.env.PGLITE_DATA_DIR?.trim();
const where = url
  ? `Postgres at ${url.replace(/:\/\/[^@]*@/, "://***@")}`
  : dir
    ? `embedded PGLite in ${dir}`
    : "embedded PGLite in memory (nothing will survive this process)";
console.log(`[seed] writing to: ${where}`);
if (!url && !dir) {
  console.log("[seed] set PGLITE_DATA_DIR to keep it, or DATABASE_URL to fill a real one.");
}

const server = await createServer({
  root: ROOT,
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
  logLevel: "error",
});

try {
  const mod = await server.ssrLoadModule(pathToFileURL(SEED).pathname);
  const refusal = mod.demoTargetRefusal(process.env);
  if (refusal && MODE !== "check") {
    console.error(`[seed] REFUSED: ${refusal}`);
    process.exitCode = 3;
  } else {
    const show = (label, counts) => {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      console.log(`[seed] ${label}: ${JSON.stringify(counts)} (${total} rows, role ${mod.DEMO_SEAT})`);
      return total;
    };
    if (MODE === "clean" || MODE === "reset") show("removed", await mod.cleanDemo());
    if (MODE === "seed" || MODE === "reset") {
      const total = show("seeded", await mod.seed());
      // A seeder that wrote nothing is a failure, not a quiet success.
      if (total === 0) {
        console.error("[seed] wrote zero rows. Nothing to show is the thing this exists to prevent.");
        process.exitCode = 1;
      }
    }
    show("now present", await mod.countDemo());
  }
} finally {
  // Close the database first: a folder-backed PGLite left open keeps its lock
  // file, and the next run (or the dev server) hangs waiting on it.
  const db = await server.ssrLoadModule(pathToFileURL(join(ROOT, "src/lib/db.ts")).pathname);
  await db.closeDb();
  await server.close();
}
