import { createFileRoute } from "@tanstack/react-router";
import { Check, Minus } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { catalog } from "@/lib/dream/derive";
import { can } from "@/lib/dream/org";
import { useDream } from "@/lib/dream/store";

export const Route = createFileRoute("/gate")({ component: GatePage });

function GatePage() {
  const {
    checked,
    signed,
    applied,
    toggleCheck,
    countersign,
    breakGlass,
    applyChecked,
    role,
    policy,
    frozen,
    claudeProposal,
    extraCleanup,
    proposedBy,
  } = useDream();

  const items = catalog(extraCleanup);

  const groups = [
    {
      kind: "auto" as const,
      title: "Auto-approved",
      blurb: "No interpretation. Relative dates, dead links, near-duplicates, index trim.",
    },
    {
      kind: "judgment" as const,
      title: "Needs dual control",
      blurb: policy.dualControl
        ? "Operator proposes. Reviewer countersigns. Apply will not take a one-sided tick."
        : "Dual control is off in policy. A single check is enough, that is a policy choice, not a default.",
    },
    {
      kind: "protected" as const,
      title: "Do not touch",
      blurb: "Propose only. Unverified facts stay unlabeled rather than invented.",
    },
  ];

  const pending = items.filter(
    (c) => c.kind === "judgment" && !applied[c.id] && checked[c.id] && !signed[c.id],
  ).length;
  const ready = items.filter(
    (c) =>
      c.kind === "judgment" &&
      !applied[c.id] &&
      checked[c.id] &&
      (!policy.dualControl || signed[c.id]),
  ).length;
  const pendingAuto = items.filter((c) => c.kind === "auto" && !applied[c.id]).length;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex max-w-2xl flex-col gap-4">
        <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          improve-memory · {role}
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">The gate</h1>
        <p className="mt-3 text-muted-foreground">
          {policy.autoApply
            ? "Mechanical items apply on the clock."
            : "Auto-apply is off, mechanical items wait for Apply mechanical."}{" "}
          Judgment still needs two hats. Same hat cannot propose and sign.
          Break-glass is the audited exception.
        </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="warn">{pending} awaiting signature</Badge>
          <Badge variant="ok">{ready} ready to apply</Badge>
          {policy.dualControl ? (
            <Badge variant="outline">dual control on</Badge>
          ) : (
            <Badge variant="danger">dual control off</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => applyChecked()}
            disabled={frozen || !can(role, "run") || ready === 0}
          >
            Apply signed fixes
          </Button>
          {pendingAuto > 0 ? (
            <Button
              variant="secondary"
              onClick={() => applyChecked(undefined, true)}
              disabled={frozen || !can(role, "run")}
            >
              Apply mechanical ({pendingAuto})
            </Button>
          ) : null}
        </div>
      </header>

      {groups.map((group) => (
        <section key={group.kind} className="flex flex-col gap-3">
          <div>
            <h2 className="font-display text-2xl tracking-tight">{group.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{group.blurb}</p>
          </div>
          <ul className="flex flex-col gap-3">
            {items.filter((item) => item.kind === group.kind).map((item) => (
              <li
                key={item.id}
                className="flex gap-4 rounded-xl border border-border bg-card p-5"
              >
                {item.kind === "judgment" ? (
                  <div className="flex flex-col gap-3">
                    <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <Checkbox
                        checked={!!checked[item.id]}
                        onCheckedChange={() => toggleCheck(item.id)}
                        disabled={!can(role, "propose") || !!applied[item.id]}
                        aria-label={`Propose ${item.title}`}
                      />
                      Propose
                    </label>
                    <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <Checkbox
                        checked={!!signed[item.id]}
                        onCheckedChange={() => countersign(item.id)}
                        disabled={
                          !can(role, "sign") ||
                          !checked[item.id] ||
                          !!applied[item.id] ||
                          (policy.dualControl && proposedBy[item.id] === role)
                        }
                        aria-label={`Sign ${item.title}`}
                      />
                      Sign
                    </label>
                  </div>
                ) : item.kind === "auto" ? (
                  applied[item.id] ? (
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm bg-ok text-ok-foreground">
                    <Check className="size-3.5" strokeWidth={2.4} />
                  </span>
                  ) : (
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm border border-border text-muted-foreground">
                    <Minus className="size-3" />
                  </span>
                  )
                ) : (
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm border border-border text-muted-foreground">
                    <Minus className="size-3" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium">{item.title}</h3>
                    {applied[item.id] ? <Badge variant="ok">applied</Badge> : null}
                    {item.kind === "judgment" && checked[item.id] && !signed[item.id] ? (
                      <Badge variant="warn">unsigned</Badge>
                    ) : null}
                    {item.kind === "judgment" && signed[item.id] && !applied[item.id] ? (
                      <Badge variant="ok">signed</Badge>
                    ) : null}
                    {item.derived ? <Badge variant="outline">from gather</Badge> : null}
                    {item.unverified ? <Badge variant="warn">UNVERIFIED</Badge> : null}
                    {item.kind === "judgment" &&
                    policy.dualControl &&
                    proposedBy[item.id] === role &&
                    checked[item.id] &&
                    !applied[item.id] ? (
                      <Badge variant="warn">switch role to sign</Badge>
                    ) : null}
                    {item.file ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {item.file}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                  {item.kind === "judgment" && can(role, "break-glass") && !applied[item.id] ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-3 h-8 px-2 text-xs"
                      onClick={() => breakGlass(item.id)}
                    >
                      Break glass
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {claudeProposal ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl tracking-tight" title="CLAUDE.md">Assistant config proposal</h2>
            <CopyButton text={claudeProposal} label="Copy block" />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Human-owned. Copy this and paste it yourself. Somnus will not write the file.
          </p>
          <pre className="mt-4 overflow-x-auto whitespace-pre-wrap font-mono text-xs">
            {claudeProposal}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
