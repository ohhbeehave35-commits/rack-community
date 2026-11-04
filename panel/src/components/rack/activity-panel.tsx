import { useState } from 'react';
import { act, getActivity, getLive, useRackQuery } from '@/lib/rack/api';
import { holdBanner } from '@/lib/rack/job-state';
import { Button } from '@/components/ui/button';

const WHO = 'owner';

export function ActivityPanel() {
  const activity = useRackQuery(getActivity, 3000);
  const live = useRackQuery(getLive, 3000);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const banner = activity.data ? holdBanner(activity.data.hold) : null;
  async function request(action: 'pause' | 'resume') {
    setBusy(true); setMessage('');
    try {
      const result = await act(action, action === 'pause' ? { reason: reason.trim() || 'Owner pause' } : {}, WHO);
      setMessage('Request recorded. Waiting for the actor: ' + result.note);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Request failed'); }
    finally { setBusy(false); }
  }
  return <section aria-label="What is it doing?" className="mb-6 space-y-4 rounded-xl border border-border bg-card p-4">
    <h2 className="text-lg font-medium">What is it doing?</h2>
    <p className="text-xl">{activity.error ? 'Status unavailable — last information may be out of date' : activity.data?.sentence ?? 'Checking the Rack…'}</p>
    {banner ? <div role="alert" className="break-words rounded-lg border-2 border-destructive bg-destructive/10 p-5 text-xl font-semibold text-destructive">{banner}</div> : null}
    <p className="text-sm text-muted-foreground">{live.error ? 'Control mode unavailable' : live.data?.live ? 'Live controls: a pause stops work at its next safe point.' : 'Dry-run controls: pause and resume are recorded but change nothing.'}</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1">Reason for pausing
        <input value={reason} onChange={e => setReason(e.target.value)} maxLength={200} className="mt-1 block min-h-11 w-full rounded-md border border-border bg-background px-3" placeholder="Taking a break" />
      </label>
      <Button className="min-h-11" variant="destructive" disabled={busy || !activity.data || !!activity.error || !!live.error || !live.data} onClick={() => request('pause')}>Pause everything</Button>
      <Button className="min-h-11" variant="outline" disabled={busy || !activity.data?.hold.present || !!activity.error || !!live.error || !live.data} onClick={() => request('resume')}>Resume</Button>
    </div>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
