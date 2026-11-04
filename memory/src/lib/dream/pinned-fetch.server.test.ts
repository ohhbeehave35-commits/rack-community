/**
 * Follow-up, 27 Sep 2026 (PRELAND-READ-somnus-rv-f218a67f-0632ET.md, SO1b):
 * a public hostname that RESOLVES to a private address must be refused even
 * though its literal text passes webhookTargetRefusal, and a redirect must
 * never be followed. DNS is always mocked here -- no live network.
 * Ported from Live Call Assist pinned-fetch.server.test.ts (L2b/L2c).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PINNED_DNS_WORDS,
  PINNED_PRIVATE_WORDS,
  PINNED_REDIRECT_WORDS,
  type LookupAddr,
  pinnedRequest,
  resolvePinned,
} from "./pinned-fetch.server.ts";

const mockLookup = (addrs: LookupAddr[]) => async (_hostname: string) => addrs;
const failLookup = () => async (_hostname: string): Promise<LookupAddr[]> => {
  throw new Error("ENOTFOUND");
};

// -- a hostname that resolves to a private address is refused --

test("127.0.0.1.nip.io resolving to 127.0.0.1 is refused (Rule 64: fails without the fix)", async () => {
  const result = await resolvePinned("127.0.0.1.nip.io", mockLookup([{ address: "127.0.0.1", family: 4 }]));
  assert.deepEqual(result, { ok: false, error: PINNED_PRIVATE_WORDS });
});

test("localtest.me resolving to ::1 is refused", async () => {
  const result = await resolvePinned("localtest.me", mockLookup([{ address: "::1", family: 6 }]));
  assert.deepEqual(result, { ok: false, error: PINNED_PRIVATE_WORDS });
});

test("a literal 169.254.169.254 answer (the metadata address) is refused", async () => {
  const result = await resolvePinned("evil.example.com", mockLookup([{ address: "169.254.169.254", family: 4 }]));
  assert.deepEqual(result, { ok: false, error: PINNED_PRIVATE_WORDS });
});

test("a literal [::1] answer is refused", async () => {
  const result = await resolvePinned("evil.example.com", mockLookup([{ address: "::1", family: 6 }]));
  assert.deepEqual(result, { ok: false, error: PINNED_PRIVATE_WORDS });
});

test("ANY private answer among several refuses the whole lookup", async () => {
  const result = await resolvePinned(
    "multi.example.com",
    mockLookup([
      { address: "203.0.113.9", family: 4 },
      { address: "10.20.30.5", family: 4 },
    ]),
  );
  assert.deepEqual(result, { ok: false, error: PINNED_PRIVATE_WORDS });
});

test("a hostname resolving into 198.18.0.0/15 (RFC 2544 benchmark range) is refused", async () => {
  const result = await resolvePinned("bench.example.com", mockLookup([{ address: "198.18.4.4", family: 4 }]));
  assert.deepEqual(result, { ok: false, error: PINNED_PRIVATE_WORDS });
});

test("a hostname resolving into 64:ff9b::/96 (NAT64) is refused", async () => {
  const result = await resolvePinned("nat64.example.com", mockLookup([{ address: "64:ff9b::c000:221", family: 6 }]));
  assert.deepEqual(result, { ok: false, error: PINNED_PRIVATE_WORDS });
});

test("a hostname resolving into fec0::/10 (deprecated site-local) is refused", async () => {
  const result = await resolvePinned("sitelocal.example.com", mockLookup([{ address: "fec0::1", family: 6 }]));
  assert.deepEqual(result, { ok: false, error: PINNED_PRIVATE_WORDS });
});

test("a public host with only public answers is allowed and pinned to the checked address", async () => {
  const result = await resolvePinned("hooks.slack.com", mockLookup([{ address: "203.0.113.9", family: 4 }]));
  assert.deepEqual(result, { ok: true, address: "203.0.113.9", family: 4 });
});

test("a DNS failure refuses rather than silently allowing", async () => {
  const result = await resolvePinned("nowhere.invalid", failLookup());
  assert.deepEqual(result, { ok: false, error: PINNED_DNS_WORDS });
});

// -- redirect: manual -- a 3xx is refused, never re-requested --

test("a 3xx response is refused and the send function is called exactly once (no redirect followed)", async () => {
  let calls = 0;
  const sendFn = async () => {
    calls += 1;
    return { status: 302, ok: false };
  };
  const result = await pinnedRequest(
    "https://hooks.slack.com/services/T0/B0/xyz",
    { method: "POST", body: "{}" },
    { lookupFn: mockLookup([{ address: "203.0.113.9", family: 4 }]), sendFn },
  );
  assert.deepEqual(result, { ok: false, status: 302, error: PINNED_REDIRECT_WORDS });
  assert.equal(calls, 1, "a redirect must not be followed with a second request");
});

test("a successful pinned request reports only a status code, never a response body", async () => {
  const sendFn = async () => ({ status: 200, ok: true });
  const result = await pinnedRequest(
    "https://hooks.slack.com/services/T0/B0/xyz",
    { method: "POST", body: "{}" },
    { lookupFn: mockLookup([{ address: "203.0.113.9", family: 4 }]), sendFn },
  );
  assert.deepEqual(result, { ok: true, status: 200 });
  assert.ok(!("body" in result) && !("snippet" in result) && !("text" in result));
});

test("a private target never reaches the send function at all", async () => {
  let calls = 0;
  const sendFn = async () => {
    calls += 1;
    return { status: 200, ok: true };
  };
  const result = await pinnedRequest(
    "https://rebind.example.com/hook",
    { method: "POST" },
    { lookupFn: mockLookup([{ address: "127.0.0.1", family: 4 }]), sendFn },
  );
  assert.equal(result.ok, false);
  assert.equal(calls, 0, "a private address must never be connected to");
});

test("http (non-https) is refused before any DNS lookup", async () => {
  let lookups = 0;
  const lookupFn = async (_h: string) => {
    lookups += 1;
    return [{ address: "203.0.113.9", family: 4 }];
  };
  const result = await pinnedRequest("http://hooks.slack.com/services/x", { method: "POST" }, { lookupFn });
  assert.equal(result.ok, false);
  assert.equal(lookups, 0);
});
