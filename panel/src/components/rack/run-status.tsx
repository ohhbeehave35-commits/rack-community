import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getStatusStream } from "@/lib/rack/api";
import { EMPTY_STREAM, matchOk, mergeStream, type StreamState } from "@/lib/rack/status-stream";

/** The Rack's STATUS lines, following a run live. Read-only; Pause just stops asking. */
export function RunStatus({ everyMs = 3000 }: { everyMs?: number }) {
  const [state, setState] = useState<StreamState>(EMPTY_STREAM);
  const [match, setMatch] = useState("");
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const cursor = useRef(0);
  const box = useRef<HTMLUListElement | null>(null);
  const bad = !matchOk(match);

  const lastMatch = useRef(match);
  useEffect(() => {
    // A different filter shows a different set of lines: start that view from the newest, before asking again.
    if (lastMatch.current !== match) { lastMatch.current = match; cursor.current = 0; setState(EMPTY_STREAM); setAsked(false); }
    if (paused || bad) return;
    let cancelled = false;
    const run = () => {
      getStatusStream(cursor.current, 100, match)
        .then((a) => {
          if (cancelled) return;
          setState((s) => {
            const next = mergeStream(s, a);
            cursor.current = next.cursor;
            return next;
          });
          setError(null);
          setAsked(true);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
    };
    run();
    const id = window.setInterval(run, everyMs);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [paused, bad, match, everyMs]);

  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [state.lines.length]);

  return (
    <section aria-label="Run status" data-testid="run-status" className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-medium">Run status</h3>
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" data-testid="run-status-live">
          <span aria-hidden className={paused || error ? "size-2 rounded-full bg-muted-foreground" : "size-2 rounded-full bg-primary"} />
          {error ? "Not reachable right now" : paused ? "Paused" : "Following"}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">The status lines your jobs write to the STATUS file, newest at the bottom. When you start a run, its lines appear here as they are written.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Only lines that contain</span>
          <input
            className="w-full max-w-full rounded-md border border-border bg-background px-2 py-1 text-sm sm:w-64"
            value={match}
            maxLength={60}
            placeholder="for example hello"
            aria-invalid={bad}
            onChange={(e) => setMatch(e.target.value)}
          />
        </label>
        <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)} data-testid="run-status-pause">{paused ? "Follow again" : "Pause"}</Button>
      </div>
      {bad ? <p role="alert" className="text-sm text-destructive">Use letters, numbers, spaces and . _ : / - only.</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">Status lines unavailable right now: {error}</p> : null}
      {!error && asked && !state.lines.length ? <p className="text-sm">No status lines {match.trim() ? "match that yet" : "yet"}. They appear here when a job writes one.</p> : null}
      <ul ref={box} className="max-h-72 space-y-1 overflow-y-auto rounded-md bg-secondary p-3 font-mono text-sm" data-testid="run-status-lines">
        {state.lines.map((l) => (
          <li key={l.at} className="min-w-0 break-words">{l.text}</li>
        ))}
      </ul>
    </section>
  );
}
