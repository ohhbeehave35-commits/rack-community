import { rackGet, rackPost } from "./session";
import { streamUrl } from "./status-stream";
import type { HoldState } from "./job-state";
import type { SystemReading } from "./system";
import { useEffect, useState } from "react";

/** Where the Rack API listens. Build with VITE_RACK_API_BASE to point somewhere else. */
export const RACK_API_BASE: string =
  (import.meta.env.VITE_RACK_API_BASE as string | undefined) || "http://127.0.0.1:8797";

/** Poll a fetcher every `intervalMs` (default 5s). No cache layer: a handful of small JSON endpoints on a plain timer. */
export function useRackQuery<T>(fetcher: () => Promise<T>, intervalMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      fetcher()
        .then((d) => {
          if (!cancelled) {
            setData(d);
            setError(null);
            setLoading(false);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : String(e));
            setLoading(false);
          }
        });
    };
    run();
    const id = window.setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return { data, error, loading };
}

const getJson = <T,>(path: string) => rackGet<T>(RACK_API_BASE, path);
const postJson = <T,>(path: string, body: unknown) => rackPost<T>(RACK_API_BASE, path, body);

export type StatusResponse = {
  live: boolean;
  hold_present: boolean;
  memory_used_gb: number | null;
  memory_total_gb: number | null;
  status_tail: string[];
};
export const getStatus = () => getJson<StatusResponse>("/status");
export const getSystem = () => getJson<SystemReading>("/system");

export type Recipe = { action: string; label: string; available: boolean; reason: string | null; admission: string; peak_gb: number };
export const getRecipes = () => getJson<{ recipes: Recipe[] }>("/recipes");

export type Admission = { time?: string; action?: "ADMIT" | "WAIT"; job?: string; peak?: number; detail?: string; raw?: string };
export const getAdmissions = () => getJson<{ admissions: Admission[] }>("/admissions");

export type LiveStatus = { live: boolean; detail?: string; by?: string | null; at?: string | null };
export const getLive = () => getJson<LiveStatus>("/live");
export const setLive = (live: boolean, who: string) => postJson<{ ok: boolean; live: boolean }>("/live", { live, who });

export type ActResult = { ok: boolean; job_id: string; note: string };
export const act = (action: string, params: Record<string, unknown>, requestedBy: string) =>
  postJson<ActResult>("/act", { action, params, requested_by: requestedBy });
export const getActions = (limit = 20) => getJson<{ rows: string[] }>(`/actions?limit=${limit}`);

export const previewStart = (recipe: string) =>
  postJson<{ recipe: string; job: string; admitted: boolean; verdict: string }>("/preview", { recipe });

export type StatusStreamAnswer = { lines: { at: number; text: string }[]; cursor: number; size: number; reset: boolean };
export const getStatusStream = (since: number, limit = 100, match = "") =>
  getJson<StatusStreamAnswer>(streamUrl(since, limit, match));

export type Job = {
  id: string; name: string; status: string; piece: number; total: number | null;
  newest_output: string | null; last_durable_save: number | null; next_deadline: number | null;
  stalled: boolean; memory_high: boolean; detail: string;
};
export const getJobs = () => getJson<{ jobs: Job[] }>("/slivers");

export const getActivity = () => getJson<{
  sentence: string; hold: HoldState; queued: number; running: number; blocked: number;
}>("/activity");
