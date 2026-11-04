export function jobLabel(status: string): string {
  return status === 'queued' || status === 'blocked' ? 'waiting' : status.replaceAll('_', ' ');
}
export function jobWarning(job: { status: string; stalled: boolean; memory_high: boolean }): boolean {
  return job.status === 'running' && (job.stalled || job.memory_high);
}

export type HoldState = { present: boolean; who: string | null; at: string | null; reason: string | null };

export function holdBanner(hold: HoldState): string | null {
  if (!hold.present) return null;
  const t = hold.at ? Date.parse(hold.at) : NaN;
  const at = hold.at ? (Number.isNaN(t) ? hold.at : new Date(t).toLocaleString()) : 'unknown';
  return `Paused by ${hold.who || 'unknown'} at ${at}: ${hold.reason || 'No reason recorded'}`;
}
