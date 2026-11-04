export type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const tokenKey = (base: string) => `rack-token:${base}`;

/** A read that sends the Rack token when this tab has been unlocked. The status reads need it; without it they answer 401 and say so. */
export async function rackGet<T>(base: string, path: string,
  storage: TokenStorage = window.sessionStorage, send: typeof fetch = fetch): Promise<T> {
  let token: string | null = null;
  try { token = storage.getItem(tokenKey(base)); } catch { token = null; }
  const response = await send(`${base}${path}`, token ? { headers: { 'X-Rack-Token': token } } : undefined);
  if (response.status === 401) throw new Error('Unlock controls to see this.');
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function rackPost<T>(base: string, path: string, body: unknown,
  storage: TokenStorage = window.sessionStorage, send: typeof fetch = fetch): Promise<T> {
  const token = storage.getItem(tokenKey(base));
  if (!token) throw new Error('Unlock controls before making changes.');
  const response = await send(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rack-Token': token },
    body: JSON.stringify(body),
  });
  if (response.status === 401) {
    storage.removeItem(tokenKey(base));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('rack-controls-locked'));
    throw new Error('Unlock controls with a valid Rack token.');
  }
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    const detail = error && typeof error === 'object' && 'detail' in error ? error.detail : null;
    throw new Error(typeof detail === 'string' ? detail : `Request failed (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
}
