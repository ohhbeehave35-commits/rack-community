import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MACHINE_FILES, machineKitFiles } from "./src/lib/dream/machine.ts";
import { SKILL_FILES, INSTALL_MD } from "./src/lib/dream/skills.ts";

const OUT = join(process.cwd(), "somnus-kit");

function put(path: string, body: string) {
  const full = join(OUT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, "utf8");
  return full;
}

let n = 0;

put("INSTALL.md", INSTALL_MD);
n++;

for (const f of SKILL_FILES) {
  put(join("skills", f.path), f.body);
  n++;
}

let machine: { path: string; body: string }[] = [];
try {
  machine = machineKitFiles() as { path: string; body: string }[];
} catch {
  machine = MACHINE_FILES as unknown as { path: string; body: string }[];
}
for (const f of machine) {
  if (!f || typeof f.path !== "string" || typeof f.body !== "string") continue;
  put(f.path, f.body);
  n++;
}

console.log("wrote " + n + " files to " + OUT);
