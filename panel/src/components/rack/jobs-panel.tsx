import { useState } from 'react';
import { act, getJobs, useRackQuery } from '@/lib/rack/api';
import { jobLabel, jobWarning } from '@/lib/rack/job-state';
import { Button } from '@/components/ui/button';

const WHO = 'owner';
const when = (seconds: number | null) => seconds === null ? 'Not saved yet' : new Date(seconds * 1000).toLocaleString();

export function JobsPanel() {
  const { data, error } = useRackQuery(getJobs);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Finished pause/resume/stop requests are bookkeeping, not work; keep them out of the list.
  const CONTROLS = ['pause', 'resume', 'stop', 'retry_job'];
  const jobs = (data?.jobs ?? []).filter((j) => !(CONTROLS.includes(j.name) && j.status === 'done'));
  const warnings = jobs.filter(jobWarning);
  return <section aria-label="Right now" className="mb-6 space-y-3 rounded-lg border border-border bg-card p-4">
    <h2 className="font-medium">Right now</h2>
    {error ? <p role="alert" className="text-destructive">Progress unavailable. Last received information may be out of date.</p> : null}
    {warnings.length ? <div role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive">
      {warnings.map((job) => <p key={job.id}>
        {job.name}: {job.stalled ? 'Running piece missed its save deadline. ' : ''}
        {job.memory_high ? 'Memory use is above the admission limit. ' : ''}
      </p>)}
    </div> : null}
    {!data && !error ? <p>Checking saved progress…</p> : null}
    {data && !jobs.length ? <p className="text-muted-foreground">No jobs yet. Start one from Recipes.</p> : null}
    <ul className="space-y-3">
      {jobs.map((job) => <li key={job.id} className="break-words border-t border-border pt-3 text-sm">
        <p className="font-medium">{job.name.replaceAll('_', ' ')} — {jobLabel(job.status)}</p>
        <p>{job.piece} of {job.total ?? 'not yet determined'} pieces saved. Last save: {when(job.last_durable_save)}.</p>
        {job.newest_output ? <p className="break-all">Newest saved output: {job.newest_output}</p> : null}
        {job.next_deadline ? <p>Next save due: {when(job.next_deadline)}.</p> : null}
        {job.detail ? <p className="text-muted-foreground">{job.detail}</p> : null}
        <p className="text-muted-foreground">Job {job.id}</p>
        {job.status === 'blocked' ?
          <Button variant="outline" disabled={busy || !!error} onClick={async () => {
            if (!window.confirm('Resume this job from its last saved piece? The same safety checks still apply.')) return;
            setBusy(true); setMessage('');
            try { const result = await act('retry_job', { job_id: job.id }, WHO); setMessage(result.note); }
            catch (err) { setMessage(err instanceof Error ? err.message : 'Could not resume saved work.'); }
            finally { setBusy(false); }
          }}>Resume saved work</Button> : null}
      </li>)}
    </ul>
    <Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setMessage('');
      try { const result = await act('stop', { reason: 'Stopped safely from Right now' }, WHO); setMessage(result.note); }
      catch (err) { setMessage(err instanceof Error ? err.message : 'Could not request stop.'); }
      finally { setBusy(false); }
    }}>Stop it safely</Button>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
  </section>;
}
