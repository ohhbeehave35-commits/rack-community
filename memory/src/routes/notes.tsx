import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  bench,
  classifyLookahead,
  ENGINE_LABEL,
  inspectLookbehind,
} from "@/lib/dream/engine";
import type { EngineId, Support } from "@/lib/dream/types";

export const Route = createFileRoute("/notes")({ component: NotesPage });

const LB_SAMPLES = [
  { label: "Fixed phrase", pattern: "(?<=remember )(this|that)" },
  { label: "Punctuation no,", pattern: "(?<=\\bno)," },
  { label: "Reject obj.wrong", pattern: "(?<![\\w.])wrong\\b" },
  { label: "Mixed alt lengths", pattern: "(?<=ab|cde)word" },
  { label: "JSONL field (bound 200)", pattern: '(?<="type":"user".{0,200})\\bactually\\b' },
  { label: "JSONL field (bound 800)", pattern: '(?<="type":"user".{0,800})\\bactually\\b' },
  { label: "Unbounded", pattern: "(?<=remember.*)this" },
];

const LA_SAMPLES = [
  { label: "Word bound", pattern: String.raw`\bwrong\b` },
  { label: "Correction no,", pattern: String.raw`\bno(?=\s*[,.!?])` },
  { label: "Scan rest of line", pattern: String.raw`(?=.*wrong)` },
  { label: "AND peeks", pattern: String.raw`(?=.*wrong)(?=.*always)(?=.*REST)` },
  { label: "Nested stars", pattern: "(x+)+y" },
];

function supportBadge(s: Support) {
  if (s === "yes") return <Badge variant="ok">{s}</Badge>;
  if (s === "no") return <Badge variant="danger">{s}</Badge>;
  return <Badge variant="warn">{s}</Badge>;
}

function NotesPage() {
  const [lb, setLb] = useState(LB_SAMPLES[0]!.pattern);
  const [la, setLa] = useState(LA_SAMPLES[2]!.pattern);
  const [tick, setTick] = useState(0);
  const report = useMemo(() => inspectLookbehind(lb), [lb]);
  const laClass = useMemo(() => classifyLookahead(la), [la]);
  const [data, setData] = useState<
    { n: number; bounded: number; scan: number; anded: number }[]
  >([]);

  useEffect(() => {
    setData(bench());
  }, [tick]);

  const engines = Object.keys(ENGINE_LABEL) as EngineId[];

  return (
    <div className="flex flex-col gap-10">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Field notes
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">
          Lookahead cost, lookbehind law
        </h1>
        <p className="mt-3 text-muted-foreground">
          Compiled from the signal-pattern work. Default ripgrep has neither.
          Claude Code’s Grep tool needs <code className="text-foreground">--pcre2</code>{" "}
          before any of this compiles. Two-pass grep is still the production shape.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-2xl tracking-tight">
            Lookahead performance
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Lookahead does not consume, so it rescan. A short peek at a comma is
            O(n). <code className="text-foreground">(?=.*token)</code> from each
            position is O(n²). Several of those multiply. Nested quantifiers
            inside a peek can go exponential, that is the tool_result trap.
          </p>
        </div>

        <div
          data-scroll-target
          className="sticky z-30 flex flex-wrap gap-2 bg-background/95 py-2 backdrop-blur-sm"
          style={{ top: "var(--header-h, 7rem)" }}
        >
          {LA_SAMPLES.map((s) => (
            <Button
              key={s.label}
              size="sm"
              className="h-11"
              variant={la === s.pattern ? "default" : "outline"}
              onClick={() => setLa(s.pattern)}
            >
              {s.label}
            </Button>
          ))}
        </div>

        <Input
          value={la}
          onChange={(e) => setLa(e.target.value)}
          spellCheck={false}
          className="font-mono text-xs"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{laClass.cost}</Badge>
          <p className="text-sm text-muted-foreground">{laClass.blurb}</p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Milliseconds on a growing tool dump</CardTitle>
            <Button size="sm" variant="secondary" onClick={() => setTick((n) => n + 1)}>
              Re-run
            </Button>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="n" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                <RTooltip
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="bounded" fill="var(--color-ok)" name="\\bwrong\\b" />
                <Bar dataKey="scan" fill="var(--color-primary)" name="(?=.*wrong)" />
                <Bar dataKey="anded" fill="var(--color-warn)" name="three peeks" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-2xl tracking-tight">
            Lookbehind constraints
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The pattern inside <code className="text-foreground">{'(?<=…)'}</code>{" "}
            must end at the cursor. Engines that cannot compute that width at
            compile time reject the pattern. PCRE2 allows a bound, default 255
            characters, the JSONL field lookbehind dies here.
          </p>
        </div>

        <div
          data-scroll-target
          className="sticky z-30 flex flex-wrap gap-2 bg-background/95 py-2 backdrop-blur-sm"
          style={{ top: "var(--header-h, 7rem)" }}
        >
          {LB_SAMPLES.map((s) => (
            <Button
              key={s.label}
              size="sm"
              className="h-11"
              variant={lb === s.pattern ? "default" : "outline"}
              onClick={() => setLb(s.pattern)}
            >
              {s.label}
            </Button>
          ))}
        </div>

        <Input
          value={lb}
          onChange={(e) => setLb(e.target.value)}
          spellCheck={false}
          className="font-mono text-xs"
        />

        <p className="text-sm leading-relaxed text-muted-foreground">
          {report.note}
          {report.jsError ? ` JS: ${report.jsError}` : ""}
        </p>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Engine</th>
                <th className="px-4 py-3 font-medium">This pattern</th>
              </tr>
            </thead>
            <tbody>
              {engines.map((id) => (
                <tr key={id} className="border-t border-border">
                  <td className="px-4 py-3">{ENGINE_LABEL[id]}</td>
                  <td className="px-4 py-3">{supportBadge(report.engines[id])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          {
            t: "Prefer two-pass",
            d: "Filter type:user, drop tool_result, then phrase-grep. No lookaround required. This is what session-analysis should ship.",
          },
          {
            t: "Lookahead for tails",
            d: "no, / always use / remember this. Peek the continuation; keep the word. Cheap if the peek is short.",
          },
          {
            t: "Lookbehind only for left edges",
            d: "obj.wrong, remember this. Split mixed-length alts. Never use lookbehind-star. Use \\K or a first grep instead.",
          },
        ].map((x) => (
          <Card key={x.t}>
            <CardHeader>
              <CardTitle>{x.t}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground">
              {x.d}
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
