import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { highlight, runMode } from "@/lib/dream/engine";
import { toJsonl } from "@/lib/dream/jsonl";
import { AUSTIN_BUCKETS, MODE_META } from "@/lib/dream/patterns";
import { TRANSCRIPTS } from "@/lib/dream/transcripts";
import { can } from "@/lib/dream/org";
import { useDream } from "@/lib/dream/store";
import type { PatternMode, SignalBucket } from "@/lib/dream/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/lab")({ component: Lab });

const MODES: PatternMode[] = [
  "raw",
  "bounded",
  "lookahead",
  "lookbehind",
  "twopass",
];

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function Lab() {
  const {
    mode,
    setMode,
    extraLines,
    pasteJsonl,
    clearPasted,
    setGatherPattern,
    gatherPattern,
    role,
  } = useDream();
  const [custom, setCustom] = useState(MODE_META[mode].pattern);
  const [paste, setPaste] = useState("");
  const [bucket, setBucket] = useState<SignalBucket | "all">("all");
  const [showJsonl, setShowJsonl] = useState(false);

  const corpus = useMemo(
    () => [...TRANSCRIPTS, ...(extraLines ?? [])],
    [extraLines],
  );

  const report = useMemo(
    () => runMode(mode, custom || MODE_META[mode].pattern, corpus),
    [mode, custom, corpus],
  );
  const [elapsed, setElapsed] = useState("n/a");

  useEffect(() => {
    setElapsed(`${report.elapsedMs.toFixed(2)} ms`);
  }, [report]);

  const hitsByLine = useMemo(() => {
    const map = new Map<string, typeof report.hits>();
    for (const h of report.hits) {
      const arr = map.get(h.lineId) ?? [];
      arr.push(h);
      map.set(h.lineId, arr);
    }
    return map;
  }, [report.hits]);

  const sessionCount = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const h of report.hits) {
      const line = corpus.find((l) => l.id === h.lineId);
      if (!line) continue;
      const key = h.text.toLowerCase();
      const set = map.get(key) ?? new Set();
      set.add(line.session);
      map.set(key, set);
    }
    return map;
  }, [report.hits, corpus]);

  const visible = corpus.filter((line) => {
    if (bucket === "all") return true;
    return line.gold.some((g) => g.bucket === bucket);
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Session analysis
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Signal lab</h1>
        <p className="mt-3 text-muted-foreground">
          Four buckets. Two-pass drops tool dumps. Recurrence needs the same
          stem in two sessions. Paste real JSONL, those hits are UNVERIFIED.{" "}
          <Link to="/notes" className="text-foreground underline-offset-4 hover:underline">
            Field notes
          </Link>
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={mode === m ? "default" : "outline"}
            onClick={() => {
              setMode(m);
              setCustom(MODE_META[m].pattern);
            }}
          >
            {MODE_META[m].label}
          </Button>
        ))}
      </div>

      <p className="max-w-2xl text-sm text-muted-foreground">{MODE_META[mode].blurb}</p>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={bucket === "all" ? "default" : "outline"}
          onClick={() => setBucket("all")}
        >
          All
        </Button>
        {AUSTIN_BUCKETS.map((b) => (
          <Button
            key={b.id}
            size="sm"
            variant={bucket === b.id ? "default" : "outline"}
            onClick={() => setBucket(b.id)}
          >
            {b.title}
          </Button>
        ))}
      </div>
      {bucket !== "all" ? (
        <p className="text-sm text-muted-foreground">
          {AUSTIN_BUCKETS.find((b) => b.id === bucket)?.hint}
        </p>
      ) : null}

      <label className="block">
        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Pattern
        </span>
        <textarea
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          spellCheck={false}
          className="mt-2 min-h-24 w-full rounded-lg border border-input bg-card px-3 py-3 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <div
        data-scroll-target
        className="sticky z-30 flex flex-wrap gap-2 bg-background/95 py-2 backdrop-blur-sm"
        style={{ top: "var(--header-h, 7rem)" }}
      >
        <Button
          size="sm"
          className="h-11"
          onClick={() => setGatherPattern(custom)}
          disabled={!can(role, "run")}
        >
          Use this pattern for gather
        </Button>
        {gatherPattern ? (
          <Button size="sm" variant="ghost" className="h-11" onClick={() => setGatherPattern(null)}>
            Clear override
          </Button>
        ) : null}
        <Button
          size="sm"
          className="h-11"
          variant={showJsonl ? "default" : "outline"}
          onClick={() => setShowJsonl((v) => !v)}
        >
          {showJsonl ? "Hide JSONL" : "Show JSONL envelope"}
        </Button>
      </div>
      {gatherPattern ? (
        <p className="text-xs text-muted-foreground">
          Next dream will grep with your lab pattern, not the stock two-pass.
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Precision", pct(report.precision)],
          ["Recall", pct(report.recall)],
          ["True", String(report.truePositives)],
          ["False", String(report.falsePositives)],
          ["Time", elapsed],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="mt-1 font-display text-xl tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      {report.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {report.error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Paste JSONL</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            spellCheck={false}
            placeholder='{"type":"user","message":{"content":"no, use bun from now on"}}'
            className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-3 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                pasteJsonl(paste);
                setPaste("");
              }}
              disabled={!paste.trim()}
            >
              Add to corpus
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const sample =
                  '{"type":"user","message":{"content":"no, use bun from now on. remember this."}}';
                pasteJsonl(sample);
              }}
            >
              Add example line
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearPasted}
              disabled={extraLines.length === 0}
            >
              Clear pasted ({extraLines.length})
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Transcripts since {TRANSCRIPTS[0]?.date} · {visible.length} lines
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {visible.map((line) => {
            const hits = hitsByLine.get(line.id) ?? [];
            const bits = highlight(line.text, hits);
            const recurring = hits.some((h) => (sessionCount.get(h.text.toLowerCase())?.size ?? 0) >= 2);
            return (
              <article
                key={line.id}
                className="rounded-lg border border-border px-3 py-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      line.kind === "user"
                        ? "default"
                        : line.kind === "tool_result"
                          ? "danger"
                          : "muted"
                    }
                  >
                    {line.kind}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {line.session} · {line.date}
                  </span>
                  {line.session === "pasted" ? (
                    <Badge variant="warn">UNVERIFIED</Badge>
                  ) : null}
                  {recurring ? <Badge variant="ok">recurring</Badge> : null}
                  {line.gold.map((g) => (
                    <Badge key={`${g.start}-${g.bucket}`} variant="outline">
                      {g.bucket}
                    </Badge>
                  ))}
                  {hits.length ? (
                    <span className="text-xs text-muted-foreground">
                      {hits.length} hit{hits.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
                <p
                  className={cn(
                    "font-mono text-xs leading-relaxed",
                    line.kind === "tool_result" && "max-h-24 overflow-hidden",
                  )}
                >
                  {bits.map((b, i) => (
                    <span
                      key={i}
                      className={
                        b.kind === "tp"
                          ? "hit"
                          : b.kind === "fp"
                            ? "hit-fp"
                            : b.kind === "uv"
                              ? "hit-uv"
                              : undefined
                      }
                    >
                      {b.text.length > 220 ? `${b.text.slice(0, 220)}…` : b.text}
                    </span>
                  ))}
                </p>
                {showJsonl ? (
                  <pre className="mt-2 overflow-x-auto text-xs text-muted-foreground">
                    {toJsonl(line).slice(0, 280)}
                  </pre>
                ) : null}
              </article>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
