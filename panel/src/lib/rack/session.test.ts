import assert from 'node:assert/strict';
import test from 'node:test';
import { rackGet, rackPost, tokenKey } from './session.ts';

function storage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); } };
}

test('locked controls cannot send a POST', async () => {
  let called = false;
  await assert.rejects(rackPost('http://rack', '/act', {}, storage(), async () => {
    called = true; return new Response('{}');
  }), /Unlock controls/);
  assert.equal(called, false);
});

test('every POST sends the session token as a header only', async () => {
  const session = storage(); session.setItem(tokenKey('http://rack'), 'test-only');
  for (const path of ['/act', '/preview', '/live']) {
    await rackPost('http://rack', path, { action: 'pause' }, session, async (url, init) => {
      assert.equal(url, 'http://rack' + path);
      assert.equal(new Headers(init?.headers).get('X-Rack-Token'), 'test-only');
      assert.ok(!String(init?.body).includes('test-only'));
      return new Response('{"ok":true}', { status: 200 });
    });
  }
});

test('401 clears the session and a duplicate refusal explains why', async () => {
  const session = storage(); session.setItem(tokenKey('http://rack'), 'test-only');
  await assert.rejects(rackPost('http://rack', '/act', {}, session, async () =>
    new Response('{}', { status: 401 })), /Unlock controls/);
  assert.equal(session.getItem(tokenKey('http://rack')), null);
  session.setItem(tokenKey('http://rack'), 'test-only');
  await assert.rejects(rackPost('http://rack', '/act', {}, session, async () =>
    new Response('{"detail":"Same action within 60 seconds; nothing queued."}', { status: 409 })), /60 seconds/);
});

test('a hold or admission refusal keeps the unlock and is never retried', async () => {
  const session = storage(); session.setItem(tokenKey('http://rack'), 'test-only');
  for (const detail of ['Work is held; nothing queued or started.',
    'Admission refused the start (not enough memory budget); nothing queued or started.']) {
    let calls = 0;
    await assert.rejects(rackPost('http://rack', '/act', {
      action: 'hello', params: {}, requested_by: 'owner',
    }, session, async () => {
      calls++;
      return new Response(JSON.stringify({ detail }), { status: 409 });
    }), { message: detail });
    assert.equal(calls, 1);
    assert.equal(session.getItem(tokenKey('http://rack')), 'test-only');
  }
});

test('a read sends the token when unlocked and nothing when it is not', async () => {
  const locked = storage();
  await rackGet('http://rack', '/status', locked, async (url, init) => {
    assert.equal(url, 'http://rack/status');
    assert.equal(init, undefined);
    return new Response('{"live":false}', { status: 200 });
  });
  const open = storage(); open.setItem(tokenKey('http://rack'), 'test-only');
  const out = await rackGet<{ live: boolean }>('http://rack', '/status/stream?since=0', open, async (url, init) => {
    assert.equal(url, 'http://rack/status/stream?since=0');
    assert.equal(new Headers(init?.headers).get('X-Rack-Token'), 'test-only');
    return new Response('{"live":true}', { status: 200 });
  });
  assert.equal(out.live, true);
});

test('a refused read says to unlock controls and other failures keep their status', async () => {
  await assert.rejects(rackGet('http://rack', '/status', storage(), async () => new Response('{}', { status: 401 })), /Unlock controls to see this/);
  await assert.rejects(rackGet('http://rack', '/status', storage(), async () => new Response('{}', { status: 500 })), /\/status -> HTTP 500/);
});
