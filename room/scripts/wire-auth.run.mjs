// One command for the wire LAN-exposure invariant (rule 64). Builds the
// current node-server bundle, then runs the wire-auth integration test.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

{ // Always test the current source, never a stale bundle.
  const b = spawnSync(npm, ["run", "desktop:build"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
const r = spawnSync(process.execPath, ["--test", join(root, "scripts", "wire-auth.itest.mjs")], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 0);
