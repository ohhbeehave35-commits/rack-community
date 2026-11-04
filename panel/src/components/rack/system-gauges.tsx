import { useEffect, useRef, useState } from 'react';
import { getSystem, useRackQuery } from '@/lib/rack/api';
import { areaPoints, arcPath, pushHistory, readingLabel, readingValue } from '@/lib/rack/system';
import type { Reading } from '@/lib/rack/system';

type Spec = { key: string; label: string; reading: Reading | undefined; unit: string; max: number | null; sub?: string };

function Gauge({ spec, failed, history }: { spec: Spec; failed: boolean; history: number[] }) {
  const value = readingValue(spec.reading, failed);
  const fraction = value !== null && spec.max ? value / spec.max : 0;
  const hot = fraction > 0.9 ? 'var(--destructive, #e5484d)' : fraction > 0.75 ? '#f0a020' : '#a3e635';
  const text = value === null ? 'unavailable' : spec.max === 100 && spec.unit === '%' ? value.toFixed(0) + '%' : readingLabel(spec.reading, failed, spec.unit);
  const last = spec.reading?.last_read_at ? new Date(spec.reading.last_read_at * 1000).toLocaleTimeString() : 'never';
  return <div className="min-w-0 rounded-lg border border-border bg-card px-3 py-2">
    <p className="text-sm text-muted-foreground">{spec.label}</p>
    {spec.max ? <div className="flex items-end gap-2">
      <svg viewBox="0 0 100 58" className="h-16 w-28 shrink-0" role="img" aria-label={spec.label + ' ' + text}>
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="9" strokeLinecap="round" />
        {value !== null ? <path d={arcPath(50, 50, 40, fraction)} fill="none" stroke={hot} strokeWidth="9" strokeLinecap="round" /> : null}
        <text x="50" y="48" textAnchor="middle" className="fill-foreground font-mono" fontSize={value === null ? 9 : 13} fontWeight="600">{text}</text>
      </svg>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-12 min-w-0 flex-1" aria-hidden="true">
        {history.length > 1 ? <polygon points={areaPoints(history, spec.max, 100, 40)} fill="#1ea7e1" fillOpacity="0.85" /> : null}
      </svg>
    </div> : <p className="py-4 font-mono text-2xl font-semibold">{text}</p>}
    <p className="text-xs text-muted-foreground">{spec.sub ?? ''}{spec.sub ? ' · ' : ''}Last reading: {last}</p>
  </div>;
}

export function SystemGauges() {
  const { data, error } = useRackQuery(getSystem, 5000);
  const [now, setNow] = useState(Date.now());
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const lastSample = useRef<number | null>(null);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const failed = !!error || !data || now / 1000 - data.sampled_at > 15;
  useEffect(() => {
    if (!data || lastSample.current === data.sampled_at) return;
    lastSample.current = data.sampled_at;
    const total = data.memory_total_gb;
    setHistory(h => ({
      cpu: pushHistory(h.cpu ?? [], readingValue(data.cpu_percent, false)),
      gpu: pushHistory(h.gpu ?? [], readingValue(data.gpu_percent, false)),
      mem: total ? pushHistory(h.mem ?? [], readingValue(data.memory_used_gb, false)) : (h.mem ?? []),
    }));
  }, [data]);
  const total = data?.memory_total_gb ?? null;
  const specs: Spec[] = [
    { key: 'cpu', label: 'CPU · all cores', reading: data?.cpu_percent, unit: '%', max: 100, sub: data?.cpu_cores ? data.cpu_cores + ' cores' : undefined },
    { key: 'gpu', label: 'GPU utilisation', reading: data?.gpu_percent, unit: '%', max: 100 },
    { key: 'mem', label: data?.memory_source === 'gpu' ? 'GPU memory' : 'Memory', reading: data?.memory_used_gb, unit: ' GB', max: total, sub: total ? total.toFixed(1) + ' GB total' : undefined },
    { key: 'temp', label: 'GPU temperature', reading: data?.gpu_temperature_c, unit: ' °C', max: 100 },
    { key: 'power', label: 'GPU power', reading: data?.gpu_power_w, unit: ' W', max: null },
  ];
  return <section aria-label="Live gauges" className="grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
    {specs.map(s => <Gauge key={s.key} spec={s} failed={failed} history={history[s.key] ?? []} />)}
  </section>;
}
