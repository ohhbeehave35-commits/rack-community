/**
 * Client-side sync between the Zustand persist store (localStorage) and the
 * server-side `somnus_user_data` table.
 *
 * - localStorage remains the offline cache and instant read source.
 * - On login, we pull server state and merge it with local state.
 * - On every write, we push to the server (fire-and-forget, retried on next login).
 * - If the server version is newer, we keep both (server wins for display,
 *   local copy preserved as a snapshot until the next write overwrites it).
 * - First-login import: if the server has no data for this user, import
 *   whatever is in localStorage so nobody loses what they already made.
 */

import {
  listUserData,
  putUserData,
  importUserData,
  listAllUserDataKinds,
  deleteUserData,
  type UserDataRow,
} from "./user-data-fns";
import type { LockedProject, Snapshot, DreamReport, DreamLog } from "./types";

const STORAGE_KEY = "somnus-dream-v8";

type SyncableKind =
  | "lockedProject"
  | "snapshot"
  | "report"
  | "log"
  | "artifact";

interface VersionMap {
  [kindKey: string]: number;
}

let versionCache: VersionMap = {};
let syncInProgress = false;

function versionKey(kind: string, key: string): string {
  return `${kind}:${key}`;
}

function getLocalState(): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.state ?? null;
  } catch {
    return null;
  }
}

function extractSyncItems(
  state: Record<string, unknown>,
): { kind: SyncableKind; key: string; payload: string }[] {
  const items: { kind: SyncableKind; key: string; payload: string }[] = [];

  const projects = state.lockedProjects as LockedProject[] | undefined;
  if (Array.isArray(projects)) {
    for (const p of projects) {
      items.push({ kind: "lockedProject", key: p.id, payload: JSON.stringify(p) });
    }
  }

  const snapshots = state.snapshots as Snapshot[] | undefined;
  if (Array.isArray(snapshots)) {
    for (const s of snapshots) {
      items.push({ kind: "snapshot", key: s.at, payload: JSON.stringify(s) });
    }
  }

  const reports = state.reports as DreamReport[] | undefined;
  if (Array.isArray(reports)) {
    for (const r of reports) {
      items.push({ kind: "report", key: r.at, payload: JSON.stringify(r) });
    }
  }

  const logs = state.logs as DreamLog[] | undefined;
  if (Array.isArray(logs)) {
    for (const l of logs) {
      items.push({ kind: "log", key: l.at, payload: JSON.stringify(l) });
    }
  }

  const artifacts = state.artifacts as { id: string }[] | undefined;
  if (Array.isArray(artifacts)) {
    for (const a of artifacts) {
      items.push({ kind: "artifact", key: a.id, payload: JSON.stringify(a) });
    }
  }

  return items;
}

export async function pushItem(
  kind: SyncableKind,
  key: string,
  payload: unknown,
): Promise<void> {
  try {
    const vk = versionKey(kind, key);
    const result = await putUserData({
      data: {
        kind,
        key,
        payload: JSON.stringify(payload),
        expectedVersion: versionCache[vk],
      },
    });
    if (result.ok) {
      versionCache[vk] = result.version;
    }
  } catch {
    // Offline or signed out, localStorage has the data, next login syncs.
  }
}

export async function removeItem(
  kind: SyncableKind,
  key: string,
): Promise<void> {
  try {
    await deleteUserData({ data: { kind, key } });
    delete versionCache[versionKey(kind, key)];
  } catch {
    // Offline, will be cleaned up on next full sync.
  }
}

function parsePayload(row: UserDataRow): unknown {
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

/**
 * Pull server state for a given kind and return the rows.
 * Updates the local version cache.
 */
export async function pullKind(kind: SyncableKind): Promise<UserDataRow[]> {
  try {
    const rows: UserDataRow[] = await listUserData({ data: { kind } });
    for (const r of rows) {
      versionCache[versionKey(r.kind, r.key)] = r.version;
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Full sync on login. Called once when the user signs in.
 *
 * 1. Check if server has any data for this user.
 * 2. If not, import from localStorage (first-login migration).
 * 3. Pull all server data and merge into the store.
 *
 * Returns the merged state to apply to the store, or null if sync failed.
 */
export async function syncOnLogin(): Promise<{
  lockedProjects: LockedProject[];
  snapshots: Snapshot[];
  reports: DreamReport[];
  logs: DreamLog[];
} | null> {
  if (syncInProgress) return null;
  syncInProgress = true;
  try {
    const kinds = await listAllUserDataKinds({});
    const hasServerData = kinds.length > 0;

    if (!hasServerData) {
      const localState = getLocalState();
      if (localState) {
        const items = extractSyncItems(localState);
        if (items.length > 0) {
          await importUserData({ data: { items } });
          for (const item of items) {
            versionCache[versionKey(item.kind, item.key)] = 1;
          }
        }
      }
    }

    const [projects, snapshots, reports, logs] = await Promise.all([
      pullKind("lockedProject"),
      pullKind("snapshot"),
      pullKind("report"),
      pullKind("log"),
    ]);

    return {
      lockedProjects: projects.map((r) => parsePayload(r) as LockedProject).filter(Boolean),
      snapshots: snapshots.map((r) => parsePayload(r) as Snapshot).filter(Boolean),
      reports: reports.map((r) => parsePayload(r) as DreamReport).filter(Boolean),
      logs: logs.map((r) => parsePayload(r) as DreamLog).filter(Boolean),
    };
  } catch {
    return null;
  } finally {
    syncInProgress = false;
  }
}

export function resetVersionCache(): void {
  versionCache = {};
}
