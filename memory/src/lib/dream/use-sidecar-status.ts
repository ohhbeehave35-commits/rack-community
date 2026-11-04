import { useEffect, useState } from "react";
import { MACHINE_SIDECAR_URL, parseMachineSnap } from "./machine-status.ts";
import type { MachineSnap } from "./types.ts";

/**
 * Sidecar liveness for the machine meter, auto-detect on mount, then a
 * recurring poll once adopted.
 *
 * History: the recurring poll used to be the ONLY way `wantSidecar` ever
 * became true, and it only ran once the user clicked "Listen on this
 * computer." On a fresh reopen `wantSidecar` defaulted false, so `sidecarLive`
 * stayed false until that click, meaning a bare fan-slider drag (which only
 * goes live when `sidecarLive && !handheld`) fell through to the zip-download
 * grant() path, and the slider showed a stale/default position instead of the
 * sidecar's real one. Fixed 2026-09-06 (the owner, 12:15) by adding the one-shot
 * silent probe below: if a sidecar from a prior session is still running, it
 * is picked up automatically, with no behavior change for anyone who has
 * never installed one (the probe just fails once, silently).
 */
export function useSidecarStatus(
  handheld: boolean,
  setMachineSnap: (snap: MachineSnap) => void,
  fetchImpl: typeof fetch = fetch,
) {
  const [wantSidecar, setWantSidecar] = useState(false);
  const [sidecarLive, setSidecarLive] = useState(false);
  const [sidecarTried, setSidecarTried] = useState(false);

  // Silent one-shot probe on mount/reopen, see history above.
  useEffect(() => {
    if (handheld) return;
    let cancelled = false;
    const probe = async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 1200);
        const res = await fetchImpl(MACHINE_SIDECAR_URL, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error("sidecar");
        const text = await res.text();
        const snap = parseMachineSnap(text, "sidecar");
        if (!cancelled && snap) {
          setMachineSnap(snap);
          setWantSidecar(true);
        }
      } catch {
        // Not running, leave wantSidecar false, exactly like today.
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
    // Only on mount / when handheld-ness resolves, the recurring poll below
    // takes over once wantSidecar flips true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handheld]);

  useEffect(() => {
    if (!wantSidecar || handheld) {
      setSidecarLive(false);
      setSidecarTried(false);
      return;
    }
    let cancelled = false;
    const pull = async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 1200);
        const res = await fetchImpl(MACHINE_SIDECAR_URL, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error("sidecar");
        const text = await res.text();
        const snap = parseMachineSnap(text, "sidecar");
        if (!cancelled && snap) {
          setMachineSnap(snap);
          setSidecarLive(true);
        } else if (!cancelled) {
          setSidecarLive(false);
        }
      } catch {
        if (!cancelled) setSidecarLive(false);
      } finally {
        if (!cancelled) setSidecarTried(true);
      }
    };
    void pull();
    const id = setInterval(() => void pull(), 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [wantSidecar, handheld, setMachineSnap, fetchImpl]);

  return { wantSidecar, setWantSidecar, sidecarLive, sidecarTried };
}
