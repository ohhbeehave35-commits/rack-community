import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RamMeter } from "@/components/ram-meter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ORG, slaWindowMs } from "@/lib/dream/org";
import { stampDate, stampTime } from "@/lib/dream/stamp";
import { useDream } from "@/lib/dream/store";

/**
 * Simple mode: one screen for a non-technical owner. Two buttons, the RAM
 * meter, and when the last backup ran -- nothing else. Everything the full
 * Dream page shows is still there for whoever wants it; this is the plain door
 * (rule 65 words). The "What is this?" help is a toggle, so it can be replayed
 * from here any time, not a one-time banner.
 */
export const Route = createFileRoute("/simple")({ component: SimpleMode });

function SimpleMode() {
  const {
    running,
    lastDream,
    lastDreamAt,
    runDream,
    dropWeight,
    waitingCount,
    policy,
    cadence,
  } = useDream();
  const [showHelp, setShowHelp] = useState(false);

  const overdue =
    waitingCount > 0 &&
    lastDreamAt != null &&
    Date.now() - lastDreamAt > slaWindowMs(policy, cadence);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {ORG.name} · Simple mode
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
          Keep the work safe
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Somnus saves a backup of the assistant's recent work every 15 minutes
          on this computer, on its own. Two buttons are all most people need.
        </p>
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="mt-3 text-sm text-primary underline-offset-4 hover:underline"
        >
          {showHelp ? "Hide help" : "What is this?"}
        </button>
      </header>

      {showHelp ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col gap-2 p-5 text-base leading-relaxed text-muted-foreground">
            <p>
              <span className="text-foreground">Run full dream</span> checks the
              assistant's long-term memory for anything to tidy up, like stale
              dates or dead links. It only looks; it changes nothing on its own.
            </p>
            <p>
              <span className="text-foreground">Open gate</span> is where you
              approve or turn down what the check found. Nothing is changed until
              you say so.
            </p>
            <p>
              The graph below is this browser tab's memory. If it climbs, press
              Drop weight, then copy a summon pack so a reset does not take the
              project with it.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <RamMeter onDropWeight={dropWeight} />

      <section className="flex flex-col gap-4 sm:flex-row">
        <Button
          type="button"
          size="lg"
          className="flex-1"
          onClick={() => runDream()}
          disabled={running}
        >
          {running ? "Checking…" : "Run full dream"}
        </Button>
        <Button asChild size="lg" variant="secondary" className="flex-1">
          {/* Plain anchor, not <Link>: a new route module importing Link from
              the router splits the SSR bundle into a broken facade (see the
              landmine note in shell.tsx). A full navigation to /gate is fine. */}
          <a href="/gate">
            Open gate{waitingCount > 0 ? ` (${waitingCount} waiting)` : ""}
          </a>
        </Button>
      </section>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5 text-base">
          <span className="text-muted-foreground">Last backup check</span>
          <span className="text-foreground">
            {stampTime(lastDream, "never")}
            {lastDream ? ` · ${stampDate(lastDream)}` : ""}
            {overdue ? " · due for another run" : ""}
          </span>
        </CardContent>
      </Card>

      <a
        href="/"
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Show the full page
      </a>
    </div>
  );
}
