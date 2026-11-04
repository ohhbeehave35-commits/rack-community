import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

// Minimal DOM before importing anything that touches React/react-dom, both
// need `document`/`window` at module-eval time.
const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React as unknown as { act: (fn: () => void | Promise<void>) => Promise<void> };
const { useSidecarStatus } = await import("./use-sidecar-status.ts");
const { MACHINE_SIDECAR_URL } = await import("./machine-status.ts");

type Api = { wantSidecar: boolean; sidecarLive: boolean; sidecarTried: boolean } | null;

/** Mounts the hook via a tiny harness (no JSX, this file runs under
 *  `--experimental-strip-types`, which strips types but does not compile
 *  JSX) and returns a live snapshot getter plus an unmount function. */
function mountHook(handheld: boolean, fetchImpl: typeof fetch, setMachineSnap: (s: unknown) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest: Api = null;
  function Harness() {
    const api = useSidecarStatus(handheld, setMachineSnap as any, fetchImpl);
    latest = { wantSidecar: api.wantSidecar, sidecarLive: api.sidecarLive, sidecarTried: api.sidecarTried };
    return null;
  }
  return {
    render: () => act(() => { root.render(React.createElement(Harness)); }),
    get: () => latest,
    unmount: () => act(() => { root.unmount(); container.remove(); }),
  };
}

const SNAP_JSON = JSON.stringify({
  at: "2026-09-06T12:00:00.000Z",
  os: "mock",
  totalMb: 16384,
  usedMb: 9000,
  availMb: 7384,
  pressure: "ok",
  tempC: 52,
  fanMode: "manual",
  fanPct: 63,
  fanRpm: 2646,
  fanCount: 2,
});

test("useSidecarStatus: a sidecar already running is auto-detected on mount, reopen lands on the real %, not a stale default", async () => {
  const calls: string[] = [];
  const fakeFetch = (async (url: string) => {
    calls.push(String(url));
    return { ok: true, text: async () => SNAP_JSON } as Response;
  }) as typeof fetch;
  let snapped: any = null;
  const h = mountHook(false, fakeFetch, (s) => (snapped = s));
  await h.render();
  // Flush the probe's microtasks/interval-kickoff.
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

  assert.ok(calls.some((u) => u === MACHINE_SIDECAR_URL), "the probe hit the real sidecar URL");
  assert.equal(h.get()?.wantSidecar, true, "auto-detect adopted the running sidecar without a Listen click");
  // sidecarLive is the exact flag FanDeck's apply() checks (`sidecarLive && !handheld`)
  // to decide whether a drag POSTs live or falls through to grant()'s zip download , 
  // this is what "drag -> POST, never the zip path" actually depends on.
  assert.equal(h.get()?.sidecarLive, true, "sidecarLive flipped true, a drag now POSTs instead of downloading the zip");
  assert.equal(snapped?.fanPct, 63, "the slider's source-of-truth snap carries the sidecar's REAL fan %, not a stale default");
  await h.unmount();
});

test("useSidecarStatus: no sidecar running, probe fails silently, no behavior change for a first-time user", async () => {
  const fakeFetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  const h = mountHook(false, fakeFetch, () => {});
  await h.render();
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

  assert.equal(h.get()?.wantSidecar, false, "never adopted, matches today's behavior for someone with no sidecar");
  assert.equal(h.get()?.sidecarLive, false, "a drag would still correctly fall through to the zip/grant path");
  await h.unmount();
});

test("useSidecarStatus: handheld devices never probe", async () => {
  let called = false;
  const fakeFetch = (async () => {
    called = true;
    return { ok: true, text: async () => SNAP_JSON } as Response;
  }) as typeof fetch;
  const h = mountHook(true, fakeFetch, () => {});
  await h.render();
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

  assert.equal(called, false, "a phone/tablet has no fan to auto-detect");
  assert.equal(h.get()?.wantSidecar, false);
  await h.unmount();
});
