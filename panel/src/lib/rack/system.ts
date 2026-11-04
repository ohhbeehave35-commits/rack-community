export type Reading = { value: number | null; last_read_at: number | null };
export type SystemReading = {
  sampled_at: number; cpu_cores: number | null; memory_total_gb: number | null;
  memory_source: 'gpu' | 'unified'; cpu_percent: Reading; gpu_percent: Reading;
  memory_used_gb: Reading; gpu_temperature_c: Reading; gpu_power_w: Reading;
};
export function readingValue(reading: Reading | undefined, failed: boolean) {
  return !failed && typeof reading?.value === 'number' && Number.isFinite(reading.value) ? reading.value : null;
}
export function readingLabel(reading: Reading | undefined, failed: boolean, unit: string) {
  const value = readingValue(reading, failed);
  return value === null ? 'unavailable' : value.toFixed(1) + unit;
}
export const HISTORY_POINTS = 60;
export function pushHistory(history: number[], value: number | null, max = HISTORY_POINTS) {
  return value === null ? history : [...history, value].slice(-max);
}
export function arcPath(cx: number, cy: number, r: number, fraction: number) {
  const f = Math.min(1, Math.max(0, fraction));
  if (f === 0) return '';
  const a = Math.PI * (1 - f);
  return 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r * Math.cos(a)).toFixed(2) + ' ' + (cy - r * Math.sin(a)).toFixed(2);
}
export function areaPoints(history: number[], max: number, width: number, height: number) {
  if (history.length < 2 || max <= 0) return '';
  const step = width / (history.length - 1);
  const line = history.map((v, i) => (i * step).toFixed(1) + ',' + (height - Math.min(1, Math.max(0, v / max)) * height).toFixed(1));
  return '0,' + height + ' ' + line.join(' ') + ' ' + width + ',' + height;
}
