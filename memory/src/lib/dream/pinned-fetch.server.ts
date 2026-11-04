/**
 * Follow-up, 27 Sep 2026 (PRELAND-READ-somnus-rv-f218a67f-0632ET.md, SO1b),
 * ported from Live Call Assist (pinned-fetch.server.ts, L2b/L2c fixes):
 * webhook-guard.ts refuses a PRIVATE literal address, but a public hostname
 * that RESOLVES to a private address (127.0.0.1.nip.io, localtest.me, ...)
 * sailed through, and deliverWebhook (control-fns.ts) followed any redirect
 * Location header wherever it pointed.
 *
 * This module resolves the target hostname itself, refuses the whole
 * request if ANY returned address is private, then connects DIRECTLY to
 * that one checked address (never re-resolving) so a second lookup
 * answering differently -- a DNS-rebinding attack -- cannot matter. TLS
 * SNI and the Host header still carry the real hostname, so certificate
 * validation is unaffected. A 3xx response is treated as the whole
 * answer (redirect: manual, in effect) -- never followed -- and only a
 * status code and a short plain message ever reach the caller; the
 * response body is discarded here, not read into memory or returned.
 */
import { lookup as systemDnsLookup } from "node:dns";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { privateIpv4, privateIpv6 } from "./webhook-guard.ts";

export type LookupAddr = { address: string; family: number };
export type LookupFn = (hostname: string) => Promise<LookupAddr[]>;

function defaultLookup(hostname: string): Promise<LookupAddr[]> {
  return new Promise((resolvePromise, reject) => {
    systemDnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolvePromise(addresses as LookupAddr[]);
    });
  });
}

export const PINNED_DNS_WORDS = "That address could not be found.";
export const PINNED_PRIVATE_WORDS = "That address is not reachable.";
export const PINNED_REDIRECT_WORDS = "That address redirected; redirects are not sent.";
export const PINNED_FAILED_WORDS = "That call did not succeed.";

export type PinnedResolution = { ok: true; address: string; family: number } | { ok: false; error: string };

/** Resolve `hostname` and refuse the whole request if ANY answer is private. */
export async function resolvePinned(hostname: string, lookupFn: LookupFn = defaultLookup): Promise<PinnedResolution> {
  let addrs: LookupAddr[];
  try {
    addrs = await lookupFn(hostname);
  } catch {
    return { ok: false, error: PINNED_DNS_WORDS };
  }
  if (!addrs || addrs.length === 0) return { ok: false, error: PINNED_DNS_WORDS };
  for (const a of addrs) {
    const bad = a.family === 6 ? privateIpv6(a.address) : privateIpv4(a.address);
    if (bad) return { ok: false, error: PINNED_PRIVATE_WORDS };
  }
  const chosen = addrs[0];
  return { ok: true, address: chosen.address, family: chosen.family };
}

export type PinnedRequestInit = {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

export type PinnedRequestResult = { status: number; ok: boolean };

/** Injectable so tests never open a real socket. Default: node:https,
 *  connected to the pinned address with the real hostname kept for TLS
 *  SNI and the Host header. Callers never re-request a Location header --
 *  `pinnedRequest` below reports any 3xx to its caller instead. */
export type SendPinnedFn = (
  target: { address: string; family: number; hostname: string; port: number; path: string },
  init: PinnedRequestInit,
) => Promise<PinnedRequestResult>;

function defaultSend(
  target: { address: string; family: number; hostname: string; port: number; path: string },
  init: PinnedRequestInit,
): Promise<PinnedRequestResult> {
  return new Promise((resolvePromise) => {
    const options: RequestOptions & {
      lookup?: (hostname: string, opts: unknown, cb: (err: Error | null, address: string, family: number) => void) => void;
    } = {
      host: target.address,
      port: target.port,
      path: target.path,
      method: init.method,
      servername: target.hostname,
      headers: { host: target.hostname, ...init.headers },
      timeout: init.timeoutMs ?? 8000,
      // Belt-and-suspenders: hand back only the already-checked address,
      // even if something upstream tried to resolve again.
      lookup: (_h, _o, cb) => cb(null, target.address, target.family),
    };
    const req = httpsRequest(options, (res) => {
      res.resume(); // discard the body -- it is never returned to the caller
      const status = res.statusCode ?? 0;
      resolvePromise({ status, ok: status >= 200 && status < 300 });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolvePromise({ status: 0, ok: false }));
    req.end(init.body);
  });
}

export type PinnedResult = { ok: true; status: number } | { ok: false; status: number; error: string };

/** Send an https request to `urlStr`, pinned to its DNS-checked address.
 *  https only; a redirect is reported to the caller, never followed; the
 *  response body never reaches the caller (status + a plain message only). */
export async function pinnedRequest(
  urlStr: string,
  init: PinnedRequestInit,
  deps: { lookupFn?: LookupFn; sendFn?: SendPinnedFn } = {},
): Promise<PinnedResult> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, status: 0, error: PINNED_FAILED_WORDS };
  }
  if (url.protocol !== "https:") return { ok: false, status: 0, error: PINNED_FAILED_WORDS };
  const resolved = await resolvePinned(url.hostname, deps.lookupFn ?? defaultLookup);
  if (!resolved.ok) return { ok: false, status: 0, error: resolved.error };
  const send = deps.sendFn ?? defaultSend;
  const result = await send(
    {
      address: resolved.address,
      family: resolved.family,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
    },
    { method: init.method, headers: init.headers, body: init.body, timeoutMs: init.timeoutMs },
  );
  if (result.status >= 300 && result.status < 400) {
    return { ok: false, status: result.status, error: PINNED_REDIRECT_WORDS };
  }
  if (!result.ok) return { ok: false, status: result.status, error: PINNED_FAILED_WORDS };
  return { ok: true, status: result.status };
}
