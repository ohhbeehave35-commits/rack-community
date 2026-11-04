import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { clearDemoControlPlane, loadDemoControlPlane } from "@/lib/dream/control-fns";
import { useDream } from "@/lib/dream/store";

/**
 * The guided demo: every step of the product, in order, in plain words, with a
 * button that opens the screen. A sample week (made-up business, see
 * demo/somnus-demo-seed.json) can be loaded into this store and taken back
 * out. Plain <a href> links only (the SSR facade landmine in shell.tsx).
 */
export const Route = createFileRoute("/tour")({ component: TourPage });

const STEPS = [
  { href: "/simple", title: "Start on the simple screen", what: "Two buttons: check the memory, and approve what the check found. Most people only need this." },
  { href: "/", title: "Run a check", what: "Press Run dream. Somnus reads the assistant's memory and tidies what is safe to tidy, like old dates and duplicates." },
  { href: "/gate", title: "Approve or turn down", what: "Anything that needs judgment waits here. Nothing changes until a person approves it, and some changes need two people." },
  { href: "/memory", title: "Look at the memory", what: "See each memory file, compare it with an earlier copy, and roll a change back." },
  { href: "/claude", title: "If the assistant crashes", what: "Copy the summon pack into a fresh session so it picks up where it left off, and lock a copy of the project." },
  { href: "/program", title: "Set the schedule", what: "Choose how often checks run, freeze everything with one tap, and see the backup history." },
  { href: "/audit", title: "See who did what", what: "Every approval, every refusal and every message sent, with a name on it." },
  { href: "/lab", title: "Compare methods (optional)", what: "Try different ways of finding lessons in pasted sessions." },
] as const;

const KEY = "somnus-tour-done-v1";
const SAMPLE = "sdemo-";

function readDone(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function TourPage() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const jobs = useDream((s) => s.jobs);
  const hasSample = jobs.some((j) => j.id.startsWith(SAMPLE));

  useEffect(() => setDone(readDone()), []);
  const mark = (href: string, v: boolean) => {
    const next = { ...done, [href]: v };
    setDone(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage blocked: the tick lasts this visit */
    }
  };
  const count = STEPS.filter((s) => done[s.href]).length;

  const load = async () => {
    setBusy(true);
    try {
      const r = await loadDemoControlPlane();
      setMsg(r.loaded ? "The sample week is in. Open Jobs or Audit to see it." : `Not loaded: ${r.reason ?? "refused"}.`);
      if (r.loaded) window.location.reload();
    } catch (e) {
      setMsg(`Could not load the sample week: ${(e as Error)?.message ?? "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      // Drop the sample from this browser first, so nothing pushes it back up.
      const s = useDream.getState();
      useDream.setState({
        jobs: s.jobs.filter((x) => !x.id.startsWith(SAMPLE)),
        audit: s.audit.filter((x) => !x.id.startsWith(SAMPLE)),
        deliveries: s.deliveries.filter((x) => !x.id.startsWith(SAMPLE)),
        hooks: s.hooks.filter((x) => !x.id.startsWith(SAMPLE)),
      });
      const r = await clearDemoControlPlane();
      setMsg(`Removed ${r.removed} sample records. Your own records were not touched.`);
    } catch (e) {
      setMsg(`Could not remove the sample week: ${(e as Error)?.message ?? "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header>
        <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">Guided tour</p>
        <h1 className="mt-3 font-display text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
          Everything Somnus does, in order
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Ten short stops. Open each one, try it, then tick it off. {count} of {STEPS.length} done.
        </p>
        <p className="mt-2 text-base">
          <a href="/intro" className="underline-offset-4 hover:underline">
            Watch the short walkthrough
          </a>{" "}
          instead.
        </p>
      </header>

      <Card className="border-primary/40">
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium">Sample week</h2>
            <Badge variant={hasSample ? "ok" : "outline"}>{hasSample ? "loaded" : "not loaded"}</Badge>
          </div>
          <p className="text-base text-muted-foreground">
            Fills the screens with one made-up week for a made-up pool company, so there is something to look
            at. Remove it any time; only the sample goes, never your own records.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" className="h-12 w-full sm:w-auto" disabled={busy || hasSample} onClick={() => void load()}>
              Load the sample week
            </Button>
            <Button size="lg" variant="outline" className="h-12 w-full sm:w-auto" disabled={busy || !hasSample} onClick={() => void clear()}>
              Remove the sample week
            </Button>
          </div>
          {msg ? <p className="text-base" role="status">{msg}</p> : null}
        </CardContent>
      </Card>

      <ol className="flex flex-col gap-3">
        {STEPS.map((s, i) => (
          <li key={s.href}>
            <Card className={done[s.href] ? "border-ok/60" : ""}>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-base ${done[s.href] ? "bg-ok text-ok-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {done[s.href] ? "✓" : i + 1}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg font-medium">{s.title}</h2>
                    <p className="text-base text-muted-foreground">{s.what}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button asChild size="lg" className="h-12 w-full sm:w-auto">
                    <a href={s.href}>Open</a>
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 w-full sm:w-auto"
                    aria-pressed={!!done[s.href]}
                    onClick={() => mark(s.href, !done[s.href])}
                  >
                    {done[s.href] ? "Done (undo)" : "Mark done"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
