// Build the self-contained Nitro node-server bundle for desktop packaging,
// then copy PGLite's runtime assets into it. Cross-platform (no shell env
// prefix), invoked by `npm run desktop:build`.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const build = spawnSync(npm, ["run", "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NITRO_PRESET: "node-server" },
  shell: process.platform === "win32",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const copy = spawnSync(process.execPath, [join(root, "desktop", "copy-pglite-assets.mjs")], {
  cwd: root,
  stdio: "inherit",
});
process.exit(copy.status ?? 0);
