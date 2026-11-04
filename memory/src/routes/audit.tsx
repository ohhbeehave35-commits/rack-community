import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { actorLabel, buildEvidence, ORG } from "@/lib/dream/org";
import { useDream } from "@/lib/dream/store";
import { downloadText } from "@/lib/utils";
import { CopyButton } from "@/components/copy-button";

export const Route = createFileRoute("/audit")({ component: AuditPage });

function statusBadge(status: string) {
  if (status === "ok") return "ok" as const;
  if (status === "blocked" || status === "failed") return "danger" as const;
  if (status === "running") return "warn" as const;
  return "outline" as const;
}

function AuditPage() {
  const { audit, jobs, deliveries, policy, frozen, waitingCount } = useDream();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filteredJobs = useMemo(
    () =>
      needle
        ? jobs.filter((j) =>
            `${j.kind} ${j.status} ${j.actor} ${j.detail}`.toLowerCase().includes(needle),
          )
        : jobs,
    [jobs, needle],
  );
  const filteredAudit = useMemo(
    () =>
      needle
        ? audit.filter((e) =>
            `${e.action} ${e.target} ${e.detail} ${e.actor}`.toLowerCase().includes(needle),
          )
        : audit,
    [audit, needle],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {ORG.classification}
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tight">Audit</h1>
          <p className="mt-3 text-muted-foreground">
            Ring buffer of 200. Reset wipes jobs, not this log. Default webhook
            is a real POST to the internal sink (status 200). Hats are not logins.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter jobs and events"
            className="h-10 w-56"
          />
          <CopyButton
            label="Copy evidence"
            text={buildEvidence({
              at: new Date().toISOString(),
              policy,
              frozen,
              jobs,
              audit,
              waiting: waitingCount,
            })}
          />
        <Button
          onClick={() =>
            downloadText(
              `somnus-evidence-${new Date().toISOString().slice(0, 10)}.md`,
              buildEvidence({
                at: new Date().toISOString(),
                policy,
                frozen,
                jobs,
                audit,
                waiting: waitingCount,
              }),
            )
          }
        >
          Export evidence pack
        </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>Full dream, apply-fixes, rollback, delivery.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet.</p>
          ) : (
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-4 font-medium">When</th>
                  <th className="pb-2 pr-4 font-medium">Kind</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Actor</th>
                  <th className="pb-2 pr-4 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((j) => (
                  <tr key={j.id} className="border-t border-border">
                    <td className="py-2 pr-4 font-mono whitespace-nowrap text-xs text-muted-foreground">
                      {j.at.slice(11, 19)}
                    </td>
                    <td className="py-2 pr-4">{j.kind}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={statusBadge(j.status)}>{j.status}</Badge>
                    </td>
                    <td className="py-2 pr-4">{actorLabel(j.actor)}</td>
                    <td className="py-2 text-muted-foreground">{j.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Event log</CardTitle>
          </CardHeader>
          <CardContent className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
            {filteredAudit.length === 0 ? (
              <p className="text-sm text-muted-foreground">Empty until someone acts.</p>
            ) : (
              filteredAudit.map((e) => (
                <div key={e.id} className="border-b border-border pb-2 last:border-0">
                  <p className="font-mono text-xs text-muted-foreground">
                    {e.at.slice(11, 19)} · {actorLabel(e.actor)} · {e.action}
                  </p>
                  <p className="text-sm">
                    {e.target}, {e.detail}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery</CardTitle>
            <CardDescription>
            File write is stored. Default webhook is the internal sink (real
            POST, status 200). External URLs are fetched from the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing delivered yet.</p>
            ) : (
              deliveries.map((d) => (
                <div
                  key={d.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs">{d.channel}</p>
                    <p className="truncate text-xs text-muted-foreground">{d.target}</p>
                    <p className="mt-1 line-clamp-3 font-mono text-xs text-muted-foreground">
                      {d.body}
                    </p>
                  </div>
                  <Badge variant={d.status === 200 ? "ok" : d.status === 0 ? "warn" : "danger"}>
                    {d.status === 0
                      ? (d.attempts ?? 1) >= 3
                        ? "dead letter"
                        : `retry ${d.attempts ?? 1}/3`
                      : d.status}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
