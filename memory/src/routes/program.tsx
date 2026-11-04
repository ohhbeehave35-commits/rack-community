import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { INSTALL_MD, packMarkdown, SKILL_FILES } from "@/lib/dream/skills";
import { MACHINE_FILES, machineKitFiles } from "@/lib/dream/machine";
import { captureLock, lockToZipFiles } from "@/lib/dream/lock";
import { can, DEFAULT_POLICY, slaWindowMs } from "@/lib/dream/org";
import { stampShort } from "@/lib/dream/stamp";
import { CADENCE_MS, useDream } from "@/lib/dream/store";
import type { Cadence } from "@/lib/dream/types";
import { downloadText } from "@/lib/utils";
import { downloadZip } from "@/lib/zip";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/copy-button";

export const Route = createFileRoute("/program")({ component: ProgramPage });

/**
 * Live wall clock for the countdowns on this page.
 *
 * Returns `null` on the server and on the client's first (hydrating) render,
 * then starts ticking from an effect, so the server HTML and the client's
 * first pass are identical by construction. Everything derived from it renders
 * a stable placeholder while it is `null`.
 *
 * Seeding the state with `Date.now()` instead is what made `/program` fail
 * hydration on every hard load. The countdown targets (`nextFullAt`,
 * `nextApplyAt`) are computed once when the store module loads, and the SSR
 * module is long-lived, so by the time a request rendered, the server's "45s
 * from now" had drifted to "due" while the freshly-loaded client still said
 * "45s". React threw away the whole tree and re-rendered it on the client.
 */
function useNow(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function fmtRemain(ms: number | null, now: number | null) {
  if (ms == null || now == null) return "n/a";
  const d = ms - now;
  if (d <= 0) return "due";
  const s = Math.ceil(d / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

function ProgramPage() {
  const {
    armed,
    cadence,
    arm,
    setCadence,
    nextFullAt,
    nextApplyAt,
    sessionsSince,
    bumpSession,
    running,
    reports,
    waitingCount,
    lastDream,
    lastDreamAt,
    role,
    frozen,
    setFrozen,
    policy,
    setPolicy,
    jobs,
    lastPulse,
    planeOk,
    hooks,
    deliveries,
    slaNagged,
  } = useDream();
  const now = useNow(true);
  const latest = reports[0];
  const admin = can(role, "policy");
  const operator = can(role, "arm");
  const failedHooks = deliveries.filter(
    (d) => d.channel === "webhook" && d.status !== 200,
  );
  const retrying = failedHooks.filter((d) => (d.attempts ?? 1) < 3);
  const dead = failedHooks.filter((d) => (d.attempts ?? 1) >= 3);
  const sinkRows =
    hooks.length > 0
      ? hooks
      : deliveries
          .filter((d) => d.channel === "webhook" && d.status === 200)
          .map((d) => ({ id: d.id, at: d.at, body: d.body }));
  const hookOk = sinkRows.length;
  const slaMs = slaWindowMs(policy, cadence);
  const slaRemain =
    now == null || lastDreamAt == null || waitingCount === 0
      ? null
      : lastDreamAt + slaMs - now;

  return (
    <div className="flex flex-col gap-10">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Control plane
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Jobs</h1>
        <p className="mt-3 text-muted-foreground">
          Armed on load. First gather fires itself. Mechanical work applies on
          the clock. Judgment still needs two hats. Failed webhooks retry with
          backoff. This tab is the timer; catch-up runs when you return.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Badge variant={armed ? "ok" : "outline"}>{armed ? "armed" : "idle"}</Badge>
        <Badge variant={planeOk ? "ok" : "warn"}>{planeOk ? "db live" : "db…"}</Badge>
        <Badge variant={frozen ? "danger" : "muted"}>{frozen ? "frozen" : "writes live"}</Badge>
        {retrying.length ? (
          <Badge variant="warn">{retrying.length} webhook retry</Badge>
        ) : null}
        {dead.length ? (
          <Badge variant="danger">{dead.length} dead letter</Badge>
        ) : null}
        {slaNagged || (slaRemain != null && slaRemain <= 0) ? (
          <Badge variant="danger">SLA breached</Badge>
        ) : slaRemain != null && now != null ? (
          <Badge variant="outline">
            SLA {fmtRemain(now + slaRemain, now)}
          </Badge>
        ) : null}
        {hookOk ? <Badge variant="ok">{hookOk} webhook 200</Badge> : null}
      </div>

      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle>Live next to the assistant</CardTitle>
          <CardDescription>
            This browser cannot write your home directory. Unzip this kit on
            the machine that runs the assistant. Skills, a 15-minute disk copy, and
            a session-end hook. Copy only, it never deletes the assistant’s files.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              onClick={() => {
                const seed = lockToZipFiles(
                  captureLock(useDream.getState(), {
                    id: "current",
                    name: "current-workspace",
                    kind: "named",
                  }),
                );
                downloadZip("somnus-machine-kit.zip", machineKitFiles(seed));
              }}
            >
              Download machine kit
            </Button>
            <Button
              variant="secondary"
              onClick={() => downloadText("somnus-dream-pack.md", packMarkdown())}
            >
              Skills as one file
            </Button>
            <Button
              variant="secondary"
              onClick={() => downloadText("INSTALL.md", INSTALL_MD)}
            >
              INSTALL.md
            </Button>
            <CopyButton
              label="Copy assistant fragment"
              text={
                MACHINE_FILES.find((f) => f.path === "machine/CLAUDE-FRAGMENT.md")
                  ?.body ?? ""
              }
            />
          </div>
          <p className="text-sm text-muted-foreground">
            After unzip: Mac/Linux run machine/install-watch.sh. Windows
            double-click INSTALL-WINDOWS.bat, then START-SIDECAR.bat and leave
            it open (Python is not required). Phone and tablet: locker + summon
            here; run the kit on the PC or Mac that has the assistant. Paste the
            assistant fragment yourself. Hook merge is automatic; otherwise merge
            hooks-fragment.json (Mac/Linux) or hooks-fragment-win.json (Windows)
           , do not replace the whole settings file.
          </p>
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {[...SKILL_FILES, ...MACHINE_FILES].map((f) => (
              <li
                key={f.path}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="truncate font-mono text-xs">{f.path}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => downloadText(f.path.replaceAll("/", "-"), f.body)}
                >
                  Save
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Last dream {stampShort(lastDream)}.
          </p>
          {latest ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadText("REPORT.md", latest.markdown)}
            >
              Save latest REPORT.md
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Daemon</CardTitle>
              <Badge variant={armed ? "ok" : "outline"}>
                {armed ? "armed" : "idle"}
              </Badge>
              <Badge variant={planeOk ? "ok" : "warn"}>
                {planeOk ? "db live" : "db…"}
              </Badge>
            </div>
            <CardDescription>
              This tab. Catch-up runs when you reopen. Preview cadence is compressed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CADENCE_MS) as Cadence[]).map((key) => (
                <Button
                  key={key}
                  size="sm"
                  variant={cadence === key ? "default" : "outline"}
                  disabled={!operator}
                  onClick={() => setCadence(key)}
                >
                  {key === "off" ? "Off" : key === "preview" ? "Preview" : "Weekly"}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => arm(!armed)}
                disabled={!operator || cadence === "off" || (frozen && !armed)}
              >
                {armed ? "Disarm" : "Arm daemon"}
              </Button>
              <Button variant="secondary" onClick={bumpSession}>
                Simulate session
              </Button>
              <Button
                variant={frozen ? "destructive" : "outline"}
                disabled={!admin}
                onClick={() => setFrozen(!frozen)}
              >
                {frozen ? "Lift freeze" : "Freeze writes"}
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border px-3 py-2">
                <dt className="text-xs text-muted-foreground">Next full dream</dt>
                <dd className="mt-1 font-display text-xl tabular-nums">
                  {fmtRemain(nextFullAt, now)}
                </dd>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <dt className="text-xs text-muted-foreground">Next apply-fixes</dt>
                <dd className="mt-1 font-display text-xl tabular-nums">
                  {fmtRemain(nextApplyAt, now)}
                </dd>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <dt className="text-xs text-muted-foreground">Sessions since</dt>
                <dd className="mt-1 font-display text-xl tabular-nums">
                  {sessionsSince}
                </dd>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <dt className="text-xs text-muted-foreground">Waiting on you</dt>
                <dd className="mt-1 font-display text-xl tabular-nums">
                  {waitingCount}
                </dd>
              </div>
              <div className="rounded-lg border border-border px-3 py-2 col-span-2">
                <dt className="text-xs text-muted-foreground">Control-plane pulse</dt>
                <dd className="mt-1 font-display text-xl tabular-nums">
                  {lastPulse == null || now == null
                    ? "n/a"
                    : `${Math.max(0, Math.round((now - lastPulse) / 1000))}s ago`}
                </dd>
              </div>
            </dl>
            {sinkRows.length ? (
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Webhook sink
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  {sinkRows.slice(0, 4).map((h) => (
                    <li key={h.id} className="rounded-lg border border-border px-3 py-2 font-mono text-xs text-muted-foreground">
                      {h.at.slice(11, 19)} · {h.body.slice(0, 120)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {failedHooks.length ? (
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Retry queue
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  {failedHooks.slice(0, 4).map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs"
                    >
                      <span className="truncate font-mono text-muted-foreground">
                        {d.target} · try {d.attempts ?? 1}/3
                      </span>
                      <Badge variant={(d.attempts ?? 1) >= 3 ? "danger" : "warn"}>
                        {(d.attempts ?? 1) >= 3
                          ? "dead"
                          : d.nextRetry
                            ? fmtRemain(d.nextRetry, now)
                            : "due"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {running ? (
              <p className="text-sm text-muted-foreground">Dreaming…</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Weekly / AutoDream gate: {sessionsSince}/5 sessions
              {lastDreamAt == null
                ? " · no last dream"
                : now == null
                  ? ""
                  : ` · ${Math.max(0, Math.round((now - lastDreamAt) / 3600000))}h since last dream`}
              . Preview cadence ignores the 5-session wait so you can see it fire.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Policy</CardTitle>
            <CardDescription>
              Admin only. Precision floor blocks apply when gather is too noisy.
              Default floor {Math.round(DEFAULT_POLICY.precisionFloor * 100)}%.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <label className="flex items-center justify-between gap-3 text-sm">
              Dual control
              <Checkbox
                checked={policy.dualControl}
                disabled={!admin}
                onCheckedChange={(v) => setPolicy({ dualControl: v === true })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              Auto-apply mechanical
              <Checkbox
                checked={policy.autoApply}
                disabled={!admin}
                onCheckedChange={(v) => setPolicy({ autoApply: v === true })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Precision floor ({Math.round(policy.precisionFloor * 100)}%)
              <input
                type="range"
                min={0.4}
                max={0.95}
                step={0.05}
                value={policy.precisionFloor}
                disabled={!admin}
                onChange={(e) =>
                  setPolicy({ precisionFloor: Number(e.target.value) })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Judgment SLA (hours)
              <Input
                type="number"
                min={1}
                max={168}
                value={policy.slaHours}
                disabled={!admin}
                onChange={(e) =>
                  setPolicy({ slaHours: Number(e.target.value) || 48 })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Webhook
              <Input
                value={policy.webhookUrl}
                disabled={!admin}
                placeholder="internal:sink"
                onChange={(e) => setPolicy({ webhookUrl: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {(["file", "webhook", "both"] as const).map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={policy.deliverTo === d ? "default" : "outline"}
                  disabled={!admin}
                  onClick={() => setPolicy({ deliverTo: d })}
                >
                  {d}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {jobs.slice(0, 8).map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
                    <span className="text-sm">
                      {j.kind} · {j.detail}
                    </span>
                    <Badge
                      variant={
                        j.status === "ok"
                          ? "ok"
                          : j.status === "blocked" || j.status === "failed"
                            ? "danger"
                            : "warn"
                      }
                    >
                      {j.status}
                    </Badge>
                  </li>
                ))}
              </ol>
            )}
            <Button variant="ghost" size="sm" className="mt-3" asChild>
              <Link to="/audit">Open audit</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
