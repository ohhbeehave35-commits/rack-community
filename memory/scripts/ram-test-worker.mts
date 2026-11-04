/**
 * RAM-capped adversarial gauntlet.
 * Parent (ram-test.mjs) runs this under --max-old-space-size=64.
 */
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bench, classifyLookahead, runMode } from "../src/lib/dream/engine.ts";
import { buildAnalysis } from "../src/lib/dream/analyze.ts";
import { parseJsonl } from "../src/lib/dream/jsonl.ts";
import { captureLock, MAX_LOCKS, MAX_LOCK_LINES } from "../src/lib/dream/lock.ts";
import { MACHINE_FILES, fanKitFiles, machineKitFiles } from "../src/lib/dream/machine.ts";
import { parseMachineSnap } from "../src/lib/dream/machine-status.ts";
import { can } from "../src/lib/dream/org.ts";
import { TRANSCRIPTS } from "../src/lib/dream/transcripts.ts";
import { zipStore, safeZipPath, zipUnixMode } from "../src/lib/zip.ts";
import { MODE_META } from "../src/lib/dream/patterns.ts";
import type { PatternMode } from "../src/lib/dream/types.ts";

const HEAP_CAP_MB = 48;
const cases: string[] = [];

function mb() {
  return Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2));
}

function assert(name: string, ok: boolean, detail = "") {
  if (!ok) throw new Error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  cases.push(name);
}

const start = mb();
const modes = Object.keys(MODE_META) as PatternMode[];

for (let round = 0; round < 8; round++) {
  for (const mode of modes) {
    const r = runMode(mode, MODE_META[mode].pattern, TRANSCRIPTS);
    if (r.error && mode !== "lookbehind") {
      throw new Error(`${mode} error: ${r.error}`);
    }
    void buildAnalysis({
      date: "2026-09-01",
      corpus: TRANSCRIPTS,
      hits: r.hits,
      applied: {},
      autoApplied: [],
      judged: [],
      waiting: [],
    });
  }
}
assert("engine-modes-capped", true);

const nested = runMode("raw", "(x+)+y", TRANSCRIPTS);
assert("nested-quantifier-refused", Boolean(nested.error), nested.error);

const nested2 = runMode("raw", "(a*)*b", TRANSCRIPTS);
assert("nested-star-refused", Boolean(nested2.error));

const evilClass = classifyLookahead("(x+)+y");
assert("classify-exponential", evilClass.cost === "exponential", evilClass.cost);

const anded = classifyLookahead("(?=.*wrong)(?=.*always)(?=.*REST)");
assert("anded-peeks-not-exponential", anded.cost !== "exponential", anded.cost);

const huge = "x".repeat(50_000);
const parsedHuge = parseJsonl(
  JSON.stringify({ type: "user", message: { content: huge } }),
);
assert(
  "paste-line-cap-4000",
  (parsedHuge[0]?.text.length ?? 0) <= 4000,
  String(parsedHuge[0]?.text.length),
);

const twoMeg = "y".repeat(2_000_000);
const parsedClip = parseJsonl(twoMeg);
const clipChars = parsedClip.reduce((n, l) => n + l.text.length, 0);
assert("paste-raw-cap-80k", clipChars <= 80_000, String(clipChars));

const flood = Array.from({ length: 400 }, (_, i) =>
  JSON.stringify({ type: "user", message: { content: `no, actually ${i}` } }),
).join("\n");
const flooded = parseJsonl(flood);
assert("paste-line-flood-bounded", flooded.length <= 400, String(flooded.length));
assert(
  "paste-each-line-capped",
  flooded.every((l) => l.text.length <= 4000),
);

assert("no-proto-pollution", parseJsonl('{"__proto__":{"x":1},"type":"user"}')[0]?.kind === "user");
assert("junk-jsonl-survives", parseJsonl("not-json at all")[0]?.kind === "user");
assert(
  "unicode-rtl-kept",
  (parseJsonl('{"type":"user","message":{"content":"no, use bun"}}')[0]?.text.length ?? 0) > 0,
);

const floodedHits = runMode("twopass", MODE_META.twopass.pattern, [
  ...TRANSCRIPTS,
  ...flooded.slice(0, 80),
]);
assert("hit-cap-400", floodedHits.hits.length <= 400, String(floodedHits.hits.length));
assert("match-budget-ms", floodedHits.elapsedMs < 2000, String(floodedHits.elapsedMs));
assert(
  "hit-text-capped",
  floodedHits.hits.every((h) => h.text.length <= 4096),
);

const emptyLock = {
  files: [],
  trash: [],
  applied: {},
  extraCleanup: [],
  analysisMd: null,
  claudeProposal: null,
  lastDream: null,
  extraLines: Array.from({ length: 80 }, (_, i) => ({
    id: `x${i}`,
    session: "s",
    date: "2026-09-01",
    kind: "user" as const,
    text: "n",
    gold: [],
  })),
  checked: {},
  signed: {},
  proposedBy: {},
  signedBy: {},
  glass: {},
  cleanupMd: null,
};
const locked = captureLock(emptyLock, { id: "a", name: "a", kind: "named" });
assert("lock-cap-8", MAX_LOCKS === 8);
assert("lock-lines-cap-40", locked.extraLines.length <= MAX_LOCK_LINES);

assert("zip-path-dotdot", !safeZipPath("../etc/passwd").includes(".."));
assert("zip-path-abs", !safeZipPath("/tmp/x").startsWith("/"));
assert("zip-path-win", !safeZipPath("C:\\\\Windows\\\\x").includes(".."));
assert("zip-path-null", !safeZipPath("a\\0b").includes("\0"));
assert("zip-unix-command-exec", zipUnixMode("machine/sidecar.command") === 0o100755);
assert("zip-unix-md-not-exec", zipUnixMode("machine/MACHINE.md") === 0o100644);
const zipBlob = zipStore([
  { path: "seed/MEMORY.md", body: "ok" },
  { path: "../x", body: "no" },
  { path: "machine/sidecar.command", body: "#!/bin/sh\necho hi\n" },
]);
assert("zip-built", zipBlob.size > 0);
const zipBuf = Buffer.from(await zipBlob.arrayBuffer());
const zipText = zipBuf.toString("binary");
assert("zip-no-dotdot-stored", !zipText.includes("../"));
assert("zip-keeps-seed", zipText.includes("MEMORY.md"));
assert(
  "zip-stores-unix-exec-bit",
  zipBuf.includes(Buffer.from([0x00, 0x00, 0xed, 0x81])),
  "missing 0o100755 attributes",
);

assert("reviewer-cannot-propose", !can("reviewer", "propose"));
assert("reviewer-cannot-write-policy", !can("reviewer", "policy"));
assert("operator-cannot-sign", !can("operator", "sign"));
assert("operator-cannot-rollback", !can("operator", "rollback"));
assert("admin-can-break-glass", can("admin", "break-glass"));

const chart = bench();
assert("bench-rows", chart.length >= 3);

const watchBody = MACHINE_FILES.find((f) => f.path === "machine/somnus-watch.sh")?.body;
assert("watch-script-present", Boolean(watchBody));
if (watchBody) {
  const root = join(tmpdir(), `somnus-watch-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  const home = join(root, "home");
  const claude = join(home, ".claude");
  const somnus = join(home, "Somnus");
  const proj = join(claude, "projects", "demo");
  mkdirSync(join(proj, "memory"), { recursive: true });
  mkdirSync(join(somnus, "machine"), { recursive: true });
  writeFileSync(join(proj, "memory", "MEMORY.md"), "keep-me");
  writeFileSync(join(proj, "small.jsonl"), '{"type":"user"}\n');
  writeFileSync(join(proj, "huge.jsonl"), "x".repeat(4_100_000));
  const script = join(somnus, "machine", "somnus-watch.sh");
  writeFileSync(script, watchBody, { mode: 0o755 });
  const run = spawnSync("sh", [script], {
    encoding: "utf8",
    timeout: 8_000,
    env: { ...process.env, HOME: home, CLAUDE_HOME: claude, SOMNUS_HOME: somnus },
  });
  assert("watch-exit-0", run.status === 0, run.stderr || run.stdout);
  assert("watch-source-memory-kept", existsSync(join(proj, "memory", "MEMORY.md")));
  assert("watch-source-jsonl-kept", existsSync(join(proj, "small.jsonl")));
  assert("watch-source-huge-kept", existsSync(join(proj, "huge.jsonl")));
  const lockDir = join(somnus, "locks");
  const copies = existsSync(lockDir)
    ? spawnSync("find", [lockDir, "-name", "MEMORY.md"], { encoding: "utf8" }).stdout
    : "";
  assert("watch-copied-small", copies.includes("MEMORY.md"), copies);
  const hugeCopy = existsSync(lockDir)
    ? spawnSync("find", [lockDir, "-name", "huge.jsonl"], { encoding: "utf8" }).stdout.trim()
    : "";
  assert("watch-skipped-huge", hugeCopy === "");
  assert("watch-no-dead-on-first-run", !existsSync(join(somnus, "DEAD.md")));
  mkdirSync(join(somnus, "watch"), { recursive: true });
  writeFileSync(join(somnus, "watch", "last-alive"), "old");
  spawnSync("sh", [script], {
    encoding: "utf8",
    timeout: 8_000,
    env: { ...process.env, HOME: home, CLAUDE_HOME: claude, SOMNUS_HOME: somnus },
  });
  assert("watch-dead-after-seen-alive", existsSync(join(somnus, "DEAD.md")));
  rmSync(root, { recursive: true, force: true });
}

const sampleJson =
  'SOMNUS_MACHINE={"at":"2026-09-02T00:00:00Z","os":"Darwin","totalMb":16384,"usedMb":9000,"availMb":7384,"pressure":"ok","tempC":54,"note":"test"}';
const parsedSnap = parseMachineSnap(sampleJson, "paste");
assert("machine-json-parse", parsedSnap?.os === "Darwin" && parsedSnap.tempC === 54);
assert("machine-json-fan-default", parsedSnap?.fanMode === "hidden");
assert("machine-json-fan-admin-default", parsedSnap?.fanNeedsAdmin === false);
assert(
  "machine-json-holding",
  parseMachineSnap(
    '{"at":"t","os":"Darwin","totalMb":1,"usedMb":1,"availMb":1,"pressure":"ok","fanMode":"full","holding":true,"note":"x"}',
    "paste",
  )?.fanHolding === true,
);
assert(
  "machine-json-fan-fields",
  parseMachineSnap(
    'SOMNUS_MACHINE={"at":"t","os":"Linux","totalMb":1,"usedMb":1,"availMb":1,"pressure":"ok","tempC":40,"fanRpm":2400,"fanPct":55,"fanMode":"balanced","fanCount":2,"fanLocked":false,"needsAdmin":true,"note":"x"}',
    "paste",
  )?.fanNeedsAdmin === true,
);
assert("machine-json-junk", parseMachineSnap("not json") == null);

const statusBody = MACHINE_FILES.find((f) => f.path === "machine/status.sh")?.body;
assert("status-script-present", Boolean(statusBody));
if (statusBody) {
  const dir = join(tmpdir(), `somnus-status-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "status.sh"), statusBody, { mode: 0o755 });
  const run = spawnSync("sh", [join(dir, "status.sh"), "--json"], {
    encoding: "utf8",
    timeout: 8_000,
    env: { ...process.env, HOME: dir, SOMNUS_HOME: join(dir, "Somnus") },
  });
  assert("status-exit-0", run.status === 0, run.stderr || run.stdout);
  const snap = parseMachineSnap(run.stdout || "", "file");
  assert("status-has-ram", Boolean(snap && snap.totalMb && snap.totalMb > 0), run.stdout);
  assert("status-wrote-json", existsSync(join(dir, "Somnus/watch/machine.json")));
  assert(
    "windows-bat-present",
    Boolean(MACHINE_FILES.find((f) => f.path === "machine/status.bat")),
  );
  assert(
    "windows-hook-fragment",
    Boolean(
      MACHINE_FILES.find((f) => f.path === "machine/hooks-fragment-win.json")
        ?.body.includes("somnus-watch.ps1"),
    ),
  );
  const fanBody = MACHINE_FILES.find((f) => f.path === "machine/fan.sh")?.body ?? "";
  assert("fan-script-present", fanBody.includes("pwm") && fanBody.includes("smc.py"));
  writeFileSync(join(dir, "fan.sh"), fanBody, { mode: 0o755 });
  const fanRun = spawnSync("sh", [join(dir, "fan.sh"), "quiet", "--no-sudo", "--json"], {
    encoding: "utf8",
    timeout: 8_000,
    env: { ...process.env, HOME: dir, SOMNUS_HOME: join(dir, "Somnus") },
  });
  assert("fan-no-sudo-exits", fanRun.status === 0, fanRun.stderr || fanRun.stdout);
  const fanSnap = parseMachineSnap(fanRun.stdout || "", "file");
  assert(
    "fan-json-mode",
    fanSnap?.fanMode === "quiet" || (fanRun.stdout || "").includes("fanMode"),
    fanRun.stdout,
  );
  assert(
    "fan-bat-present",
    Boolean(MACHINE_FILES.find((f) => f.path === "machine/fan.bat")),
  );
  const smcBody = MACHINE_FILES.find((f) => f.path === "machine/smc.py")?.body ?? "";
  assert("smc-py-present", smcBody.includes("AppleSMC") && smcBody.includes("Ftst"));
  writeFileSync(join(dir, "smc.py"), smcBody, { mode: 0o755 });
  const smcRun = spawnSync("python3", [join(dir, "smc.py"), "--json"], {
    encoding: "utf8",
    timeout: 8_000,
  });
  assert("smc-py-json-exits", smcRun.status === 0, smcRun.stderr || smcRun.stdout);
  assert(
    "smc-py-linux-hidden",
    (smcRun.stdout || "").includes("hidden") || (smcRun.stdout || "").includes("not-darwin"),
    smcRun.stdout,
  );
  const smcCompile = spawnSync("python3", ["-m", "py_compile", join(dir, "smc.py")], {
    encoding: "utf8",
    timeout: 8_000,
  });
  assert("smc-py-compiles", smcCompile.status === 0, smcCompile.stderr);
  assert(
    "sidecar-command-present",
    Boolean(
      MACHINE_FILES.find((f) => f.path === "machine/sidecar.command")?.body.includes(
        "SOMNUS_HOME",
      ) &&
        MACHINE_FILES.find((f) => f.path === "machine/sidecar.command")?.body.includes(
          "administrator privileges",
        ),
    ),
  );
  const sidecarBody = MACHINE_FILES.find((f) => f.path === "machine/sidecar.py")?.body ?? "";
  assert("sidecar-pna", sidecarBody.includes("Access-Control-Allow-Private-Network"));
  assert("sidecar-hold-loop", sidecarBody.includes("hold_loop") && sidecarBody.includes("SOMNUS_KIT"));
  writeFileSync(join(dir, "sidecar.py"), sidecarBody, { mode: 0o755 });
  const sideCompile = spawnSync("python3", ["-m", "py_compile", join(dir, "sidecar.py")], {
    encoding: "utf8",
    timeout: 8_000,
  });
  assert("sidecar-py-compiles", sideCompile.status === 0, sideCompile.stderr);
  const kit = fanKitFiles();
  assert(
    "fan-kit-has-sidecar",
    kit.some((f) => f.path === "sidecar.command") && kit.some((f) => f.path === "smc.py"),
  );
  assert(
    "fan-kit-has-windows-sidecar",
    kit.some((f) => f.path === "sidecar.ps1") && kit.some((f) => f.path === "sidecar.bat"),
  );
  const winSidecar = MACHINE_FILES.find((f) => f.path === "machine/sidecar.ps1")?.body ?? "";
  assert(
    "windows-sidecar-httplistener",
    winSidecar.includes("HttpListener") &&
      winSidecar.includes("Access-Control-Allow-Private-Network") &&
      winSidecar.includes("/clear"),
  );
  assert(
    "windows-install-bat",
    Boolean(
      MACHINE_FILES.find((f) => f.path === "machine/install-watch.bat")?.body.includes(
        "ExecutionPolicy Bypass",
      ),
    ),
  );
  assert(
    "windows-merge-hooks-ps1",
    Boolean(
      MACHINE_FILES.find((f) => f.path === "machine/merge-hooks.ps1")?.body.includes(
        "somnus-watch.ps1",
      ),
    ),
  );
  assert(
    "windows-md-present",
    Boolean(MACHINE_FILES.find((f) => f.path === "machine/WINDOWS.md")?.body.includes("START-SIDECAR.bat")),
  );
  const fullKit = machineKitFiles();
  assert(
    "windows-root-install-bat",
    fullKit.some((f) => f.path === "INSTALL-WINDOWS.bat" && f.body.includes("install-watch.bat")),
  );
  assert(
    "windows-root-sidecar-bat",
    fullKit.some((f) => f.path === "START-SIDECAR.bat" && f.body.includes("sidecar.bat")),
  );
  assert(
    "windows-merge-no-system-web",
    !(MACHINE_FILES.find((f) => f.path === "machine/merge-hooks.ps1")?.body.includes("System.Web")),
  );
  assert(
    "windows-sidecar-no-vary-header",
    !(winSidecar.includes("Headers.Add('Vary'") || winSidecar.includes('Headers.Add("Vary"')),
  );
  assert("windows-sidecar-decorate", winSidecar.includes("function Decorate") && winSidecar.includes("needsAdmin"));
  const watchWin = MACHINE_FILES.find((f) => f.path === "machine/somnus-watch.ps1")?.body ?? "";
  assert(
    "windows-watch-claude-cmdline",
    watchWin.includes("Test-ClaudeAlive") && watchWin.includes("claude-code"),
  );
  const installWin = MACHINE_FILES.find((f) => f.path === "machine/install-watch.ps1")?.body ?? "";
  assert(
    "windows-install-startup-fallback",
    installWin.includes("Startup") && installWin.includes("merge-hooks.ps1"),
  );
  assert("sidecar-py-clear", sidecarBody.includes("/clear") && sidecarBody.includes("run_clear"));
  assert(
    "smc-iokit-argtypes",
    smcBody.includes("mach_task_self") && smcBody.includes("c_size_t") && smcBody.includes("ensure_manual"),
  );
  const clearBody = MACHINE_FILES.find((f) => f.path === "machine/clear.sh")?.body ?? "";
  writeFileSync(join(dir, "clear.sh"), clearBody, { mode: 0o755 });
  const clr = spawnSync("sh", [join(dir, "clear.sh"), "--no-sudo"], {
    encoding: "utf8",
    timeout: 8_000,
    env: { ...process.env, HOME: dir, SOMNUS_HOME: join(dir, "Somnus") },
  });
  assert("clear-no-sudo-exits", clr.status === 0, clr.stderr || clr.stdout);
  rmSync(dir, { recursive: true, force: true });
}

const end = mb();
const rss = Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2));
const delta = Number((end - start).toFixed(2));
assert("heap-under-48mb", end <= HEAP_CAP_MB, `${end}MB`);

console.log(
  JSON.stringify(
    {
      ok: true,
      cases: cases.length,
      passed: cases,
      heapStartMB: start,
      heapEndMB: end,
      heapDeltaMB: delta,
      rssMB: rss,
      nestedRefused: Boolean(nested.error),
      pasteCap: parsedHuge[0]?.text.length,
      clipChars,
      lockCount: 1,
      hitCount: floodedHits.hits.length,
      benchRows: chart.length,
      zipBytes: zipBlob.size,
      capMB: 64,
      heapCapMB: HEAP_CAP_MB,
    },
    null,
    2,
  ),
);
