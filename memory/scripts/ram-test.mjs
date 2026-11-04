#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CAP_MB = 64;
const root = dirname(fileURLToPath(import.meta.url));
const jiti = join(root, "..", "node_modules", ".bin", "jiti");
const worker = join(root, "ram-test-worker.mts");

const child = spawnSync(jiti, [worker], {
  encoding: "utf8",
  timeout: 25_000,
  env: {
    ...process.env,
    NODE_OPTIONS: `--max-old-space-size=${CAP_MB}`,
  },
});

process.stdout.write(child.stdout || "");
process.stderr.write(child.stderr || "");
if (child.error) {
  console.error(child.error);
  process.exit(1);
}
if (child.status !== 0) {
  console.error(`ram-test worker exit ${child.status} signal ${child.signal}`);
  process.exit(child.status || 1);
}
