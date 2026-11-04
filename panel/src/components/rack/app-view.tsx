import { useState } from 'react';

const memoryPages = [['/simple', 'Simple'], ['/', 'Dream'], ['/claude', 'Assistant'], ['/memory', 'Memory'], ['/gate', 'Gate'], ['/program', 'Jobs and policy'], ['/audit', 'Audit'], ['/tour', 'Tour'], ['/lab', 'Signal lab'], ['/notes', 'Notes'], ['/quad', 'Four views']];

/** App tools live inside the Rack view; no new window or second app switcher. */
export function AppView({ app, wire = false }: { app: 'Somnus' | 'TalkBack'; wire?: boolean }) {
  const [path, setPath] = useState('/simple');
  const base = app === 'Somnus'
    ? (import.meta.env.VITE_RACK_MEMORY_URL || 'http://127.0.0.1:8081')
    : (import.meta.env.VITE_RACK_ROOM_URL || 'http://127.0.0.1:8082');
  return <section aria-label={app} className="mt-4 space-y-3">
    {app === 'Somnus' ? <label className="flex items-center gap-3">Somnus page
      <select aria-label="Somnus page" className="rounded border bg-background p-2" value={path} onChange={event => setPath(event.target.value)}>
        {memoryPages.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
    </label> : null}
    <iframe title={app} src={`${base}${app === 'Somnus' ? path : wire ? '/?desk=wire' : '/'}`} className="h-[75vh] min-h-96 w-full rounded-lg border" allow="microphone; clipboard-write" />
  </section>;
}
