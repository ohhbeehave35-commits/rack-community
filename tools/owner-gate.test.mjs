import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ownerCookie, ownerAuthorized, ownerGate } from './owner-gate.mjs';

test('owner gate is opt-in and rejects forged, expired and rotated sessions', () => {
  const password = randomUUID(), now = Date.now();
  const cookie = `rack_owner=${ownerCookie(password, now)}`;
  assert.equal(ownerAuthorized('', ''), true);
  assert.equal(ownerAuthorized('', password), false);
  assert.equal(ownerAuthorized(cookie, password, now), true);
  assert.equal(ownerAuthorized(cookie + 'x', password, now), false);
  assert.equal(ownerAuthorized(cookie, randomUUID(), now), false);
  assert.equal(ownerAuthorized(cookie, password, now + 43201000), false);
});

test('HTTP gate covers reads and writes, refuses cross-site login, shares owner session', async () => {
  const password = randomUUID();
  const gate = ownerGate(password);
  const server = createServer((q, r) => gate(q, r, () => r.end('owner')).catch(() => r.writeHead(500).end()));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { method: 'POST' })).status, 401);
    assert.equal((await fetch(base + '/rack-login', { method: 'POST', body: new URLSearchParams({ password }) })).status, 403);
    const response = await fetch(base + '/rack-login', { method: 'POST', headers: { Origin: base }, body: new URLSearchParams({ password }), redirect: 'manual' });
    assert.equal(response.status, 303);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    assert.equal(await (await fetch(base, { headers: { Cookie: cookie.split(';')[0] } })).text(), 'owner');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
