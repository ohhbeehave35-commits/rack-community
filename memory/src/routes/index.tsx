import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, Circle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { CrashKit } from "@/components/crash-kit";
import { MachineMeter } from "@/components/machine-meter";
import { ProjectLocker } from "@/components/project-locker";
import { RamMeter } from "@/components/ram-meter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { catalog } from "@/lib/dream/derive";
import { ORG, can, slaWindowMs } from "@/lib/dream/org";
import { stampDate, stampTime } from "@/lib/dream/stamp";
import { PHASES, useDream } from "@/lib/dream/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

const WHATS_THIS_KEY = "somnus-whats-this-dismissed-v1";

function WhatsThis() {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(WHATS_THIS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);
  if (dismissed) return null;
  const close = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(WHATS_THIS_KEY, "1");
    } catch {
      // storage blocked; the card just won't stay dismissed across reloads
    }
  };
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="text-sm leading-relaxed">
          <p className="font-display text-lg tracking-tight text-foreground">
            What Somnus is for
          </p>
          <p className="mt-2 text-muted-foreground">
            If your AI assistant crashes or freezes, Somnus already has a
            backup copy of its recent work, saved automatically every 15
            minutes on this computer. You don't have to do anything for that
            part.
          </p>
          <p className="mt-2 text-muted-foreground">
            The rest of this page is for reviewing and cleaning up what the
            assistant remembers long-term. Most people only ever need two
            buttons: <span className="text-foreground">Run full dream</span>{" "}
            (check for cleanup) and <span className="text-foreground">Open
            gate</span> (approve or reject what it found).
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Dismiss this explanation"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </CardContent>
    </Card>
  );
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function Home() {
  const {
    phase,
    running,
    lastDream,
    appliedCount,
    waitingCount,
    gatherPrecision,
    gatherRecall,
    runDream,
    reset,
    applied,
    signed,
    checked,
    policy,
    frozen,
    role,
    jobs,
    lastDreamAt,
    alreadyTight,
    analysisMd,
    gatherPattern,
    extraCleanup,
    armed,
    planeOk,
    cadence,
    dropWeight,
    lockedProjects,
  } = useDream();

  const items = catalog(extraCleanup);

  const done = phase === "done";
  const activeIndex = PHASES.findIndex((p) => p.id === phase);
  const f1 =
    gatherPrecision && gatherRecall
      ? (2 * gatherPrecision * gatherRecall) / (gatherPrecision + gatherRecall)
      : 0;
  const overdue =
    waitingCount > 0 &&
    lastDreamAt != null &&
    Date.now() - lastDreamAt > slaWindowMs(policy, cadence);
  const unsigned = items.filter(
    (c) => c.kind === "judgment" && checked[c.id] && !signed[c.id] && !applied[c.id],
  ).length;
  const lastJob = jobs[0];

  return (
    <div className="flex flex-col gap-10">
      <WhatsThis />

      <CrashKit />

      <RamMeter onDropWeight={dropWeight} />

      <MachineMeter />

      <section className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {ORG.name} · {ORG.unit}
          </p>
          <h1 className="mt-3 max-w-xl font-display text-4xl font-medium leading-[1.1] tracking-tight sm:text-5xl">
            When the assistant dies, keep the work.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
            Copy a summon pack. Restore a lock. Drop RAM in this tab. Put a
            night watchman on disk next to it. Mechanical cleanup applies
            itself. Hard calls still need two hats.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              onClick={() => runDream()}
              disabled={running || frozen || !can(role, "run")}
              size="lg"
            >
              {running ? "Dreaming…" : done ? "Run again" : "Run full dream"}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                if (window.confirm("Reset this workspace? Jobs and snapshots are wiped. Locked copies and the audit stay.")) {
                  reset();
                }
              }}
            >
              Reset
            </Button>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3">
          {(
            [
              // "Last dream" is stored as a full ISO stamp; read it as a clock
              // time with the day beside it, or the tile clips at phone width.
              [
                "Last dream",
                stampTime(lastDream, "never"),
                lastDream ? stampDate(lastDream) : null,
              ],
              ["Auto-applied", String(appliedCount)],
              ["Waiting", String(waitingCount)],
              ["Gather F1", done ? pct(f1) : "n/a"],
              [
                "Precision floor",
                `${done ? pct(gatherPrecision) : "n/a"} / ${pct(policy.precisionFloor)}`,
              ],
              ["Last job", lastJob ? lastJob.status : "n/a"],
            ] as [string, string, (string | null)?][]
          ).map(([k, v, sub]) => (
            <div
              key={k}
              className="min-w-0 rounded-lg border border-border bg-card px-4 py-3"
            >
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="mt-1 flex min-w-0 items-baseline gap-1.5 font-display text-2xl tabular-nums tracking-tight">
                <span className="truncate">{v}</span>
                {sub ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {sub}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <Card className="border-primary/40">
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Do this next
            </p>
            <p className="mt-1 text-sm">
              {frozen
                ? "Writes are frozen. Lift the freeze if the store should move again."
                : running
                  ? "Daemon is gathering. Mechanical items will apply when this pass lands."
                  : !lastDream
                    ? armed
                      ? "Daemon is armed. First gather runs on this tab, you do not have to click."
                      : "Arm the daemon on Jobs, or run a full dream now."
                    : unsigned > 0
                      ? `${unsigned} proposed item${unsigned === 1 ? "" : "s"} need a reviewer signature.`
                      : waitingCount > 0
                        ? `${waitingCount} judgment call${waitingCount === 1 ? "" : "s"} waiting on the gate.`
                        : alreadyTight
                          ? "Already tight. If the assistant crashed, copy the summon pack instead of replaying logs."
                          : "Open the gate or leave the daemon running."}
            </p>
            {gatherPattern ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Gather is using a lab pattern override.
              </p>
            ) : null}
          </div>
          {!lastDream && !frozen && !armed ? (
            <Button
              className="h-11 w-full shrink-0 sm:w-auto"
              onClick={() => runDream()}
              disabled={running || !can(role, "run")}
            >
              Run now <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button asChild className="h-11 w-full shrink-0 sm:w-auto">
              <Link
                to={
                  frozen || (!lastDream && armed) || running
                    ? "/program"
                    : unsigned > 0 || waitingCount > 0
                      ? "/gate"
                      : alreadyTight
                        ? "/claude"
                        : "/gate"
                }
              >
                {frozen
                  ? "Jobs"
                  : running || (!lastDream && armed)
                    ? "Jobs"
                    : unsigned > 0 || waitingCount > 0
                      ? "Open gate"
                      : alreadyTight
                        ? "Summon the assistant"
                        : "Open gate"}{" "}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {overdue || frozen || unsigned > 0 || alreadyTight || armed || !lastDream || lockedProjects.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {armed ? <Badge variant="ok">daemon armed</Badge> : <Badge variant="outline">daemon idle</Badge>}
          {planeOk ? <Badge variant="ok">control plane live</Badge> : <Badge variant="warn">control plane…</Badge>}
          {!lastDream && armed ? <Badge variant="warn">first gather due</Badge> : null}
          {alreadyTight ? <Badge variant="ok">already tight</Badge> : null}
          {frozen ? <Badge variant="danger">writes frozen</Badge> : null}
          {overdue ? (
            <Badge variant="danger">
              judgment SLA {cadence === "preview" ? "90s" : `${policy.slaHours}h`} breached
            </Badge>
          ) : null}
          {unsigned > 0 ? (
            <Badge variant="warn">
              {unsigned} unsigned proposal{unsigned === 1 ? "" : "s"}
            </Badge>
          ) : null}
          {lockedProjects.length > 0 ? (
            <Badge variant="ok">
              {lockedProjects.length} locked{" "}
              {lockedProjects.length === 1 ? "copy" : "copies"}
            </Badge>
          ) : null}
          {gatherPrecision > 0 && gatherPrecision < policy.precisionFloor ? (
            <Badge variant="danger">below precision floor</Badge>
          ) : null}
        </div>
      ) : null}

      <ProjectLocker />

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PHASES.map((step, i) => {
          const isActive = phase === step.id;
          const isDone = done || (activeIndex >= 0 && i < activeIndex);
          return (
            <li
              key={step.id}
              className={cn(
                "rounded-xl border bg-card p-5 transition-[border-color,background-color] duration-200",
                isActive ? "border-primary" : "border-border",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs tabular-nums text-muted-foreground">
                  0{i + 1}
                </span>
                {isDone ? (
                  <Check className="size-4 text-ok" />
                ) : isActive ? (
                  <Circle className="size-3.5 animate-pulse text-primary" />
                ) : (
                  <Circle className="size-3.5 text-border" />
                )}
              </div>
              <h2 className="mt-3 font-display text-xl tracking-tight">
                {step.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </li>
          );
        })}
      </ol>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tonight’s split</CardTitle>
            <CardDescription>
              Mechanical work applies. Meaning waits for two roles. Protected
              files cannot be “cleaned.”
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.file}</p>
                </div>
                <Badge
                  variant={
                    applied[item.id]
                      ? "ok"
                      : item.kind === "auto"
                        ? "ok"
                        : item.kind === "judgment"
                          ? "warn"
                          : "outline"
                  }
                >
                  {applied[item.id]
                    ? "applied"
                    : item.kind === "auto"
                      ? "auto"
                      : item.kind === "judgment"
                        ? signed[item.id]
                          ? "signed"
                          : checked[item.id]
                            ? "proposed"
                            : "judgment"
                        : "hands off"}
                </Badge>
              </div>
            ))}
            <Button variant="outline" asChild>
              <Link to="/gate">
                Open the gate <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How production stays boring</CardTitle>
            <CardDescription>
              Two-pass grep. Precision floor. Dual control. Freeze. Rollback.
              Evidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              Switch the lab to unanchored and run a dream, apply should
              block if precision drops under the floor. That is the difference
              between a demo grep and a program you can hand to platform.
            </p>
            <p>
              Roles in the header are not accounts. They exist so you can feel
              dual control: propose as Operator, sign as Reviewer, freeze as
              Admin.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" asChild>
                <Link to="/program">Jobs & policy</Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link to="/audit">Audit</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/claude">Assistant · summon</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/lab">Signal lab</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/memory">Dream files</Link>
              </Button>
            </div>
            {analysisMd ? (
              <div className="flex flex-col gap-2">
                <CopyButton text={analysisMd} label="Copy analysis" />
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-foreground/80">
                  {analysisMd.split("\n").slice(0, 12).join("\n")}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
