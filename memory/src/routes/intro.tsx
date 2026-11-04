import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { markIntroDone } from "@/lib/dream/intro-status";

/**
 * The forced first-run walkthrough (House's cinematic-step pattern): one
 * full-bleed image per major screen, a running "N of M", Back/Next/Skip, plain
 * words. `shell.tsx` redirects a first-time signed-in visitor here; `tour.tsx`
 * stays the deeper "everything the product does" reference page, linked from
 * the last step.
 *
 * Plain `<a href>` only, no `<Link>` import: a new route module that imports
 * `Link` from `@tanstack/react-router` splits the SSR bundle and every route
 * answers 500 (see the landmine comment in `shell.tsx`).
 */
export const Route = createFileRoute("/intro")({ component: IntroPage });

const STEPS = [
  {
    href: "/simple",
    title: "Start on the simple screen",
    what: "Two buttons: check the memory, and approve what the check found. Most people only need this.",
  },
  {
    href: "/",
    title: "Run a check",
    what: "Press Run dream. Somnus reads the assistant's memory and tidies what is safe to tidy, like old dates and duplicates.",
  },
  {
    href: "/gate",
    title: "Approve or turn down",
    what: "Anything that needs judgment waits here. Nothing changes until a person approves it, and some changes need two people.",
  },
  {
    href: "/memory",
    title: "Look at the memory",
    what: "See each memory file, compare it with an earlier copy, and roll a change back.",
  },
  {
    href: "/audit",
    title: "See who did what",
    what: "Every approval, every refusal and every message sent, with a name on it.",
  },
] as const;

function finish(href: string) {
  markIntroDone();
  window.location.assign(href);
}

function IntroPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <main data-somnus-ready={ready} className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto grid min-h-dvh max-w-5xl lg:grid-cols-2">
        <div className="relative min-h-[42vw] bg-secondary lg:min-h-dvh">
        </div>
        <div className="flex flex-col justify-between px-6 py-8 md:px-10">
          <div>
            <p className="text-base tracking-wide text-muted-foreground">
              {i + 1} of {STEPS.length}
            </p>
            <h1 className="mt-3 font-display text-4xl leading-none md:text-5xl">{step.title}</h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">{step.what}</p>
          </div>
          <div className="mt-8 flex flex-wrap gap-2">
            {i > 0 ? (
              <Button variant="ghost" size="lg" onClick={() => setI(i - 1)}>
                Back
              </Button>
            ) : null}
            {!last ? (
              <Button size="lg" onClick={() => setI(i + 1)}>
                Next
              </Button>
            ) : (
              <Button size="lg" onClick={() => finish(step.href)}>
                Enter Somnus
              </Button>
            )}
            <Button variant="ghost" size="lg" onClick={() => finish("/tour")}>
              Skip, show me the full tour instead
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
