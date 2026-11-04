import { createFileRoute, Link } from "@tanstack/react-router";
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
import { fmtMb, heapRatio, heapTone, useRam } from "@/lib/dream/ram";
import { buildSummonPack } from "@/lib/dream/summon";
import { useDream } from "@/lib/dream/store";
import { stampShort } from "@/lib/dream/stamp";

export const Route = createFileRoute("/claude")({ component: ClaudePage });

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function ClaudePage() {
  const {
    lastDream,
    files,
    extraCleanup,
    applied,
    analysisMd,
    claudeProposal,
    extraLines,
    jobs,
    frozen,
    running,
    armed,
    planeOk,
    lastPulse,
    waitingCount,
    deliveries,
    dropWeight,
    lockedProjects,
  } = useDream();
  const { sample } = useRam();
  const items = catalog(extraCleanup);
  const lastJob = jobs[0];
  const pack = buildSummonPack({
    at: new Date().toISOString(),
    lastDream,
    files,
    extras: extraCleanup,
    applied,
    analysisMd,
    claudeProposal,
    pastedLines: extraLines.length,
    lastJob: lastJob ? `${lastJob.kind} · ${lastJob.status} · ${lastJob.detail}` : null,
    frozen,
    locks: (lockedProjects ?? []).map((l) => ({
      name: l.name,
      at: l.at,
      files: l.files.length,
    })),
  });

  const ratio = heapRatio(sample);
  const tone = heapTone(sample);
  const pulseAge =
    lastPulse == null ? null : Math.max(0, Math.round((Date.now() - lastPulse) / 1000));
  const failedHooks = deliveries.filter(
    (d) => d.channel === "webhook" && d.status !== 200,
  ).length;
  const locks = lockedProjects ?? [];

  const checks: { label: string; detail: string; tone: "ok" | "warn" | "danger" | "muted" }[] = [
    {
      label: "This tab",
      detail: sample?.visible === false ? "Hidden, the timer sleeps" : "Open and sampling",
      tone: sample?.visible === false ? "warn" : "ok",
    },
    {
      label: "Control plane",
      detail: planeOk
        ? pulseAge == null
          ? "Live"
          : `Pulse ${pulseAge}s ago`
        : "Database not answering",
      tone: planeOk ? (pulseAge != null && pulseAge > 15 ? "warn" : "ok") : "danger",
    },
    {
      label: "Daemon",
      detail: frozen ? "Writes frozen" : running ? "Gathering" : armed ? "Armed" : "Idle",
      tone: frozen ? "danger" : armed ? "ok" : "warn",
    },
    {
      label: "Last dream",
      detail: lastDream
        ? stampShort(lastDream)
        : "Never, nothing to revive from yet",
      tone: lastDream ? "ok" : "warn",
    },
    {
      label: "Heap",
      detail:
        sample?.usedMb == null
          ? "This browser does not report JS heap"
          : `${fmtMb(sample.usedMb)} of ${fmtMb(sample.limitMb)} (${pct(ratio ?? 0)})`,
      tone,
    },
    {
      label: "Locked copies",
      detail:
        locks.length === 0
          ? "None, lock a project before the next reset"
          : `${locks.length} held in this browser`,
      tone: locks.length === 0 ? "warn" : "ok",
    },
    {
      label: "Waiting judgment",
      detail: waitingCount === 0 ? "None" : `${waitingCount} still need a human`,
      tone: waitingCount > 0 ? "warn" : "ok",
    },
    {
      label: "Webhooks",
      detail: failedHooks ? `${failedHooks} failed, retrying` : "Last delivery ok or none yet",
      tone: failedHooks ? "warn" : "ok",
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          When the agent dies
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Assistant</h1>
        <p className="mt-3 text-muted-foreground">
          Watch this tab’s RAM climb. Clear weight when it gets high. Lock
          projects so a reset does not take the work. Copy a summon pack
          into a fresh session. Somnus cannot see the assistant on your computer and
          cannot start it.
        </p>
      </header>

      <CrashKit />

      <RamMeter onDropWeight={dropWeight} />

      <MachineMeter />

      <ProjectLocker />

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Diagnostics</CardTitle>
            <CardDescription>
              What Somnus can see. It cannot attach to the assistant, Codex, or a
              crashed window on your machine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {checks.map((c) => (
                <li
                  key={c.label}
                  className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm">{c.label}</p>
                    <p className="text-xs text-muted-foreground">{c.detail}</p>
                  </div>
                  <Badge
                    variant={
                      c.tone === "ok"
                        ? "ok"
                        : c.tone === "warn"
                          ? "warn"
                          : c.tone === "danger"
                            ? "danger"
                            : "outline"
                    }
                  >
                    {c.tone === "ok" ? "ok" : c.tone === "muted" ? "n/a" : c.tone}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What you have to do</CardTitle>
            <CardDescription>Plain English. There is no magic start button for the assistant.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>1. Lock the project before you reset the assistant. Restore it after.</p>
            <p>2. When the RAM line climbs, hit Clear this tab’s RAM. That is this tab, not the assistant’s process.</p>
            <p>3. When the assistant dies: copy the summon pack, paste it into a new session.</p>
            <p>4. Hard calls still need you. Mechanical cleanup can apply itself.</p>
            <p>5. Want it on disk next to the assistant? Download the machine kit. Windows: double-click install-watch.bat, then sidecar.bat and leave it open. Mac/Linux: run install-watch. Paste the assistant fragment yourself.</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Held while it was dead</CardTitle>
          <CardDescription>
            {items.filter((c) => applied[c.id]).length} applied · {waitingCount} waiting
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {files
            .filter((f) => ["index", "prefs", "stack"].includes(f.id))
            .map((f) => (
              <div key={f.id} className="rounded-lg border border-border px-3 py-2">
                <p className="font-mono text-xs">{f.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{f.hook}</p>
              </div>
            ))}
          <div className="flex flex-wrap gap-2">
            <CopyButton text={pack} label="Copy pack again" />
            <Button variant="outline" size="sm" asChild>
              <Link to="/memory">Memory files</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/lab">Signal lab</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
