import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fmtMb, heapRatio, heapTone, useRam } from "@/lib/dream/ram";

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export function RamMeter({
  onDropWeight,
}: {
  onDropWeight?: () => void;
}) {
  const { sample, history } = useRam();
  const [ready, setReady] = useState(false);
  const [dropped, setDropped] = useState(false);
  useEffect(() => setReady(true), []);
  const live = ready ? sample : null;
  const ratio = heapRatio(live);
  const tone = heapTone(live);
  const limit = live?.limitMb ?? 0;
  const points = history
    .filter((h) => h.usedMb != null)
    .map((h) => ({
      t: h.at,
      used: Number((h.usedMb ?? 0).toFixed(2)),
      limit: Number((h.limitMb ?? 0).toFixed(1)),
    }));
  const data = !ready
    ? []
    : points.length > 1
      ? points
      : live?.usedMb != null
        ? [
            { t: live.at - 1000, used: Number(live.usedMb.toFixed(2)), limit },
            { t: live.at, used: Number(live.usedMb.toFixed(2)), limit },
          ]
        : [];
  const stroke =
    tone === "danger"
      ? "var(--color-destructive)"
      : tone === "warn"
        ? "var(--color-warn)"
        : "var(--color-ok)";

  const clear = () => {
    onDropWeight?.();
    setDropped(true);
    window.setTimeout(() => setDropped(false), 2200);
  };

  return (
    <Card id="ram" className="scroll-mt-28 border-primary/40">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>RAM climbing</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tone === "muted" ? "outline" : tone}>
              {!ready || live?.usedMb == null
                ? "measuring…"
                : `${fmtMb(live.usedMb)} / ${fmtMb(live.limitMb)}`}
            </Badge>
            {onDropWeight ? (
              <Button
                variant="secondary"
                className="h-11 w-full sm:w-auto"
                onClick={clear}
              >
                {dropped ? "Dropped extra weight" : "Clear this tab’s RAM"}
              </Button>
            ) : null}
          </div>
        </div>
        <CardDescription>
          Live graph of this tab climbing. Not the assistant’s process on your computer.
          When the line gets high, drop weight here, then copy a summon pack so
          a reset does not take the project with it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Used now", fmtMb(live?.usedMb ?? null)],
            ["Heap limit", fmtMb(live?.limitMb ?? null)],
            ["Fill", ratio == null ? "n/a" : pct(ratio)],
            [
              "Device hint",
              live?.deviceGb != null ? `~${live.deviceGb} GB` : "hidden",
            ],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="mt-1 font-display text-2xl tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {ratio != null ? (
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={
                tone === "danger"
                  ? "h-full bg-destructive"
                  : tone === "warn"
                    ? "h-full bg-warn"
                    : "h-full bg-ok"
              }
              style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
            />
          </div>
        ) : null}
        <div className="h-64 w-full min-h-64">
          {!ready ? (
            <div className="grid h-full place-items-center rounded-lg border border-border text-sm text-muted-foreground">
              Watching heap… one second.
            </div>
          ) : live && live.usedMb == null ? (
            <div className="grid h-full place-items-center rounded-lg border border-border px-6 text-center text-sm text-muted-foreground">
              This browser hides JavaScript heap size. Chrome reports it; Firefox
              and Safari usually do not. Device hint above is still live.
            </div>
          ) : data.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="heapFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="t"
                  tickFormatter={(t) =>
                    new Date(t).toLocaleTimeString([], {
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  }
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 16 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, (max: number) => Math.max(max * 1.15, 8)]}
                  tickFormatter={(v) => `${Math.round(v)}`}
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 16 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                  unit=" MB"
                />
                <Tooltip
                  formatter={(v: number) => [`${v.toFixed(1)} MB`, "heap"]}
                  labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString()}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-foreground)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="used"
                  stroke={stroke}
                  strokeWidth={2}
                  fill="url(#heapFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center rounded-lg border border-border text-sm text-muted-foreground">
              Watching heap… one second.
            </div>
          )}
        </div>
        {onDropWeight ? (
          <p className="text-sm text-muted-foreground">
            {dropped
              ? "Pasted dumps and extra snapshots dropped. Locked projects stayed. The graph will settle."
              : "Drop pasted dumps, old reports, and extra snapshots in this tab. Locked projects and memory files stay."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}