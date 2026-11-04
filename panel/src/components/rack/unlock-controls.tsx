import { useEffect, useState } from 'react';
import { RACK_API_BASE } from '@/lib/rack/api';
import { rackPost, tokenKey } from '@/lib/rack/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function UnlockControls() {
  const [unlocked, setUnlocked] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try { setUnlocked(Boolean(sessionStorage.getItem(tokenKey(RACK_API_BASE)))); }
    catch { setError('This browser must allow session storage to unlock controls.'); }
    const lock = () => setUnlocked(false);
    window.addEventListener('rack-controls-locked', lock);
    return () => window.removeEventListener('rack-controls-locked', lock);
  }, []);
  if (unlocked) return <div className="mb-4 flex items-center justify-between gap-3 text-sm">
    <span>Controls unlocked for this tab.</span>
    <Button variant="outline" onClick={() => {
      sessionStorage.removeItem(tokenKey(RACK_API_BASE)); setUnlocked(false);
    }}>Lock controls</Button>
  </div>;
  return <form className="mb-6 space-y-3 rounded-lg border border-border bg-card p-4" onSubmit={async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      sessionStorage.setItem(tokenKey(RACK_API_BASE), token);
      await rackPost(RACK_API_BASE, '/unlock', {});
      setUnlocked(true);
    } catch (err) {
      try { sessionStorage.removeItem(tokenKey(RACK_API_BASE)); } catch { /* unavailable storage */ }
      setError(err instanceof Error ? err.message : 'Could not unlock controls.');
    } finally { setToken(''); setBusy(false); }
  }}>
    <label htmlFor="rack-token" className="block font-medium">Unlock controls</label>
    <p className="text-sm text-muted-foreground">Enter your Rack token once for this tab (the RACK_TOKEN you started the API with). You can view progress while locked.</p>
    <div className="flex flex-wrap gap-3">
      <Input id="rack-token" type="password" autoComplete="off" value={token}
        className="min-w-0 flex-1" onChange={(e) => setToken(e.target.value)} required />
      <Button type="submit" disabled={busy || !token}>{busy ? 'Checking…' : 'Unlock controls'}</Button>
    </div>
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
  </form>;
}
