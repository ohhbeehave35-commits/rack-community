import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import type { AuditEvent, Cadence, Delivery, Job, Policy } from "./types";
import { webhookTargetRefusal } from "./webhook-guard";
import { pinnedRequest } from "./pinned-fetch.server";
import { IMPORT_ITEMS_MAX, TEXT_MAX, clampText, userDataRefusal } from "./limits";

/**
 * Server functions for the persisted control plane.
 *
 * EVERY function here is behind `authMiddleware` and EVERY statement, reads and
 * writes alike, is scoped to `context.userId`. The Postgres driver has full
 * database access, so nothing else constrains a query: an unscoped `where`
 * clause is the whole vulnerability. Rows are keyed `(user_id, id)` and ids are
 * minted client-side, so an upsert MUST carry the user id in both the insert and
 * the conflict target or one caller's write can land on another's row.
 *
 * Signed out, the middleware throws `UnauthorizedError` (message "Unauthorized",
 * status 401) before the handler runs, the store's call sites all catch, so the
 * UI degrades to local-only state instead of crashing while `<Shell>` redirects
 * to /login.
 */

export interface ControlPlane {
  jobs: Job[];
  audit: AuditEvent[];
  deliveries: Delivery[];
  hooks: { id: string; at: string; body: string }[];
  daemon: {
    armed: boolean;
    cadence: Cadence;
    frozen: boolean;
    sessions: number;
    nextFullAt: number | null;
    nextApplyAt: number | null;
    lastPulse: number | null;
    policy: Policy;
  };
}

const DEFAULT_POLICY_JSON =
  '{"dualControl":true,"precisionFloor":0.7,"autoApply":true,"deliverTo":"both","webhookUrl":"internal:sink","slaHours":48}';

function parsePolicy(raw: string): Policy {
  try {
    const p = JSON.parse(raw) as Policy;
    return {
      dualControl: Boolean(p.dualControl),
      precisionFloor: Number(p.precisionFloor) || 0.7,
      autoApply: Boolean(p.autoApply),
      deliverTo: p.deliverTo === "file" || p.deliverTo === "webhook" ? p.deliverTo : "both",
      webhookUrl: typeof p.webhookUrl === "string" ? p.webhookUrl : "internal:sink",
      slaHours: Number(p.slaHours) || 48,
    };
  } catch {
    return JSON.parse(DEFAULT_POLICY_JSON) as Policy;
  }
}

const allowlist = (): string[] =>
  (process.env.SOMNUS_ALLOWED_USERS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

/**
 * Whether an explicit owner allowlist is configured at all.
 *
 * Read by `getAccountFootprint` (bottom of this file) so the delete panel can
 * tell a departing owner whether removing their account re-opens the
 * trust-on-first-use claim below (unset allowlist) or leaves it configured
 * (set). One reader of the variable, one answer.
 */
export const controlPlaneAllowlistConfigured = (): boolean => allowlist().length > 0;

export class ControlPlaneAccessError extends Error {
  readonly status = 403;
  constructor() {
    super("This Somnus control plane is private. Your signed-in account is not on the owner allowlist.");
    this.name = "ControlPlaneAccessError";
  }
}

/**
 * Where an account stands with this control plane, WITHOUT changing anything.
 *
 * `"unclaimed"` means the allowlist is unset and every control-plane table is
 * empty, so this caller would take ownership on its first write, the
 * trust-on-first-use claim below. Split out from `assertControlPlaneAccess` so
 * `getAccountFootprint` (bottom of this file) can tell a refused visitor why
 * the app is empty for them without a read of the account page silently
 * claiming the plane on their behalf.
 */
export async function controlPlaneAccessState(
  sql: Sql,
  userId: string,
  userEmail: string | null | undefined,
): Promise<"granted" | "refused" | "unclaimed"> {
  const configured = allowlist();
  if (configured.length > 0) {
    const email = userEmail?.trim().toLowerCase();
    const listed =
      configured.includes(userId.toLowerCase()) ||
      (Boolean(email) && configured.includes(email as string));
    return listed ? "granted" : "refused";
  }
  // The seed script's demo role (every id "sdemo-...") is not a person and must
  // never count as the owner: seeding a fresh demo database would otherwise
  // claim the control plane for nobody and lock every real account out.
  const owners = await sql<{ user_id: string }>`
    select user_id from somnus_daemon where user_id not like 'sdemo-%'
    union all select user_id from somnus_jobs where user_id not like 'sdemo-%'
    union all select user_id from somnus_audit where user_id not like 'sdemo-%'
    union all select user_id from somnus_deliveries where user_id not like 'sdemo-%'
    union all select user_id from somnus_hooks where user_id not like 'sdemo-%'
    limit 1
  `;
  if (owners.length === 0) return "unclaimed";
  return owners[0].user_id === userId ? "granted" : "refused";
}

/**
 * Explicit configuration wins. Before configuration exists, claim the first
 * authenticated user only while every control-plane table is empty. The claim
 * is written to somnus_daemon, so an unset variable cannot remain an open
 * multi-tenant control plane after the owner has started using it.
 */
export async function assertControlPlaneAccess(
  sql: Sql,
  userId: string,
  userEmail: string | null | undefined,
): Promise<void> {
  const state = await controlPlaneAccessState(sql, userId, userEmail);
  if (state === "refused") throw new ControlPlaneAccessError();
  if (state === "unclaimed") {
    await sql`
      insert into somnus_daemon (user_id, policy_json)
      values (${userId}, ${DEFAULT_POLICY_JSON})
      on conflict (user_id) do nothing
    `;
  }
}

/**
 * THE DEMO DOOR (9 Sep 2026).
 *
 * Seeded rows are not a demo. A brand-new account lands attached to nothing, so
 * a seeded control plane is invisible to it and the screen reads as a product
 * that has never run. Cage solved this with a first-run button that builds its
 * demo for the signed-in account; this is the same door for Somnus.
 *
 * Three rules it keeps, and they are the reason this is safe to ship:
 *   1. It writes ONLY under the caller's own user id, taken from the session,
 *      never from the request body. One account's demo cannot reach another's.
 *   2. It refuses when the caller already has jobs, so it can never overwrite a
 *      real week of somebody's work with a sample one.
 *   3. It creates no account, no tenant and no billing row. It fills the
 *      caller's own control plane and nothing else.
 */
/**
 * The door is off on production unless the deployment says it is the demo
 * platform (SOMNUS_DEMO_DOOR=on). A real customer must never be one tap away
 * from a sample week landing in their account. Local dev and previews keep it.
 */
function demoDoorOff(): string | null {
  if (process.env.SOMNUS_DEMO_DOOR === "on") return null;
  if (process.env.VERCEL_ENV === "production") return "the sample week is switched off on this site";
  return null;
}

export const loadDemoControlPlane = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ loaded: boolean; rows: number; reason?: string }> => {
    const off = demoDoorOff();
    if (off) return { loaded: false, rows: 0, reason: off };
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await assertControlPlaneAccess(sql, context.userId, context.userEmail);
    const userId = context.userId;

    // Rule 2: never write over a real week. Every sample row has an "sdemo-"
    // id and rows are keyed (user_id, id), so the sample can only sit NEXT to
    // the account's own records, never replace one. The daemon row (schedule
    // and policy) is the account's own once it has any history, so it is only
    // written for an account with none. (The app runs its first check by
    // itself on first load, so "has history" is true almost at once; refusing
    // then, as this door first did, meant it never opened for anyone.)
    const own = await sql<{ id: string }>`
      select id from somnus_jobs where user_id = ${userId} and id not like 'sdemo-%' limit 1
    `;
    const { writeDemo } = await import("./demo-seed");
    const rows = await writeDemo(userId, sql, { daemon: own.length === 0 });
    return { loaded: true, rows };
  });

/**
 * Take the sample week back out. Deletes ONLY rows under the caller's own id
 * whose id is one of the sample's ids (all start "sdemo-"). Anything the
 * account wrote itself stays, and the account's daemon row stays.
 */
export const clearDemoControlPlane = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ removed: number }> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await assertControlPlaneAccess(sql, context.userId, context.userEmail);
    const { cleanDemo } = await import("./demo-seed");
    const before = await cleanDemo(context.userId, sql);
    return { removed: Object.values(before).reduce((x, y) => x + y, 0) };
  });

export const loadControl = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ControlPlane> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await assertControlPlaneAccess(sql, context.userId, context.userEmail);
    const userId = context.userId;
    const jobRows = await sql<{
      id: string;
      kind: Job["kind"];
      status: Job["status"];
      actor: Job["actor"];
      at: string;
      endedAt?: string;
      ended_at?: string;
      detail: string;
    }>`
      select id, kind, status, actor, at, ended_at as "endedAt", detail
      from somnus_jobs where user_id = ${userId} order by at desc limit 30
    `;
    const jobs: Job[] = jobRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      actor: r.actor,
      at: r.at,
      endedAt: r.endedAt ?? r.ended_at,
      detail: r.detail,
    }));
    const audit = await sql<AuditEvent>`
      select id, at, actor, action, target, detail
      from somnus_audit where user_id = ${userId} order by at desc limit 200
    `;
    const deliveryRows = await sql<{
      id: string;
      at: string;
      channel: Delivery["channel"];
      status: number;
      target: string;
      body: string;
      attempts?: number;
      nextRetry?: number | null;
    }>`
      select id, at, channel, status, target, body, attempts, next_retry as "nextRetry"
      from somnus_deliveries where user_id = ${userId} order by at desc limit 24
    `;
    const deliveries: Delivery[] = deliveryRows.map((r) => ({
      id: r.id,
      at: r.at,
      channel: r.channel,
      status: Number(r.status),
      target: r.target,
      body: r.body,
      attempts: Number(r.attempts) || 1,
      nextRetry: r.nextRetry == null ? null : Number(r.nextRetry),
    }));
    const hooks = await sql<{ id: string; at: string; body: string }>`
      select id, at, body from somnus_hooks where user_id = ${userId} order by at desc limit 24
    `;
    const rows = await sql<{
      armed: boolean;
      cadence: string;
      frozen: boolean;
      sessions: number;
      next_full: number | null;
      next_apply: number | null;
      last_pulse: number | null;
      policy_json: string;
    }>`
      select armed, cadence, frozen, sessions, next_full, next_apply, last_pulse, policy_json
      from somnus_daemon where user_id = ${userId}
    `;
    const d = rows[0];
    return {
      jobs,
      audit,
      deliveries,
      hooks,
      daemon: {
        armed: d?.armed ?? true,
        cadence: (d?.cadence as Cadence) ?? "preview",
        frozen: d?.frozen ?? false,
        sessions: d?.sessions ?? 6,
        nextFullAt: d?.next_full ?? null,
        nextApplyAt: d?.next_apply ?? null,
        lastPulse: d?.last_pulse ?? null,
        policy: parsePolicy(d?.policy_json ?? DEFAULT_POLICY_JSON),
      },
    };
  });

export const saveControl = createServerFn({ method: "POST" })
  .validator((d: {
    jobs: Job[];
    audit: AuditEvent[];
    deliveries: Delivery[];
    daemon: ControlPlane["daemon"];
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await assertControlPlaneAccess(sql, context.userId, context.userEmail);
    const userId = context.userId;
    for (const j of data.jobs.slice(0, 30)) {
      await sql`
        insert into somnus_jobs (user_id, id, kind, status, actor, at, ended_at, detail)
        values (${userId}, ${j.id}, ${j.kind}, ${j.status}, ${j.actor}, ${j.at}, ${j.endedAt ?? null}, ${clampText(j.detail)})
        on conflict (user_id, id) do update set
          status = excluded.status,
          ended_at = excluded.ended_at,
          detail = excluded.detail
      `;
    }
    for (const e of data.audit.slice(0, 80)) {
      await sql`
        insert into somnus_audit (user_id, id, at, actor, action, target, detail)
        values (${userId}, ${e.id}, ${e.at}, ${e.actor}, ${e.action}, ${clampText(e.target, 2000)}, ${clampText(e.detail)})
        on conflict (user_id, id) do nothing
      `;
    }
    for (const d of data.deliveries.slice(0, 24)) {
      await sql`
        insert into somnus_deliveries (user_id, id, at, channel, status, target, body, attempts, next_retry)
        values (${userId}, ${d.id}, ${d.at}, ${d.channel}, ${d.status}, ${clampText(d.target, 2000)}, ${clampText(d.body)}, ${d.attempts ?? 1}, ${d.nextRetry ?? null})
        on conflict (user_id, id) do update set
          status = excluded.status,
          body = excluded.body,
          attempts = excluded.attempts,
          next_retry = excluded.next_retry
      `;
    }
    const dn = data.daemon;
    await sql`
      insert into somnus_daemon (
        user_id, armed, cadence, frozen, sessions, next_full, next_apply, last_pulse, policy_json
      ) values (
        ${userId}, ${dn.armed}, ${dn.cadence}, ${dn.frozen}, ${dn.sessions},
        ${dn.nextFullAt}, ${dn.nextApplyAt}, ${dn.lastPulse}, ${JSON.stringify(dn.policy)}
      )
      on conflict (user_id) do update set
        armed = excluded.armed,
        cadence = excluded.cadence,
        frozen = excluded.frozen,
        sessions = excluded.sessions,
        next_full = excluded.next_full,
        next_apply = excluded.next_apply,
        last_pulse = excluded.last_pulse,
        policy_json = excluded.policy_json
    `;
    return { ok: true as const };
  });

export const pulseControl = createServerFn({ method: "POST" })
  .validator((d: Record<string, never> = {}) => d ?? {})
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await assertControlPlaneAccess(sql, context.userId, context.userEmail);
    const now = Date.now();
    // Upsert: the daemon row is created on first contact rather than seeded by a
    // migration, so a brand-new owner's first pulse must not be a silent no-op.
    await sql`
      insert into somnus_daemon (user_id, last_pulse, policy_json)
      values (${context.userId}, ${now}, ${DEFAULT_POLICY_JSON})
      on conflict (user_id) do update set last_pulse = excluded.last_pulse
    `;
    return { lastPulse: now };
  });

export const deliverWebhook = createServerFn({ method: "POST" })
  .validator((d: { url: string; markdown: string; id: string; at: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await assertControlPlaneAccess(sql, context.userId, context.userEmail);
    const url = data.url.trim();
    const snippet = data.markdown.slice(0, 2000);
    if (!url || url === "internal:sink" || url.endsWith("/api/hooks/sink")) {
      await sql`
        insert into somnus_hooks (user_id, id, at, body)
        values (${context.userId}, ${data.id}, ${data.at}, ${snippet})
        on conflict (user_id, id) do nothing
      `;
      return { status: 200, target: "internal:sink" as const };
    }
    // Only an https address on the public internet (webhook-guard.ts): a
    // report never goes to localhost, a private range or a metadata address.
    const refused = webhookTargetRefusal(url);
    if (refused) return { status: 0, target: url, error: refused };
    // pinned-fetch.server.ts: webhookTargetRefusal only checks the LITERAL
    // host. This resolves it, refuses a private answer (DNS rebinding),
    // connects to the checked address, and never follows a redirect.
    const result = await pinnedRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: snippet }),
      timeoutMs: 4000,
    });
    if (!result.ok) return { status: result.status, target: url, error: result.error };
    return { status: result.status, target: url };
  });

export const bumpControlSession = createServerFn({ method: "POST" })
  .validator((d: Record<string, never> = {}) => d ?? {})
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await assertControlPlaneAccess(sql, context.userId, context.userEmail);
    // A first-contact insert starts from the column default (6) plus this bump.
    const rows = await sql<{ sessions: number }>`
      insert into somnus_daemon (user_id, sessions, policy_json)
      values (${context.userId}, 7, ${DEFAULT_POLICY_JSON})
      on conflict (user_id) do update set sessions = somnus_daemon.sessions + 1
      returning sessions
    `;
    return { sessions: Number(rows[0]?.sessions) || 0 };
  });
