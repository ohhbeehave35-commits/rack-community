/**
 * The demo control plane, for the same house as the rest of the demo: Blue
 * Water Pools and Outdoor Living, Port St. Lucie. A prospect clicking between
 * the products should see one business rather than four sample accounts.
 *
 * WHAT SOMNUS IS, so the rows read as the product rather than as filler. It is
 * the control plane over the memory an assistant is allowed to keep: jobs that
 * ran, an audit line for every decision a person made, deliveries out to the
 * places the shop asked to be told, and a daemon with a policy that says how
 * much of it happens without asking. An empty control plane says the thing has
 * never run. This fills it with one believable week.
 *
 * THE DATA lives in demo/somnus-demo-seed.json (schema somnus-demo-seed/1),
 * with its hash and counts in demo/somnus-demo-seed.manifest.json. One file
 * feeds the seed script, the in-app demo door and the tests, because two copies
 * of a demo drift within a week. Everything in it is synthetic: a made-up
 * business, .example email addresses, and every record id starting "sdemo-".
 *
 * THE SAFETY RULES
 *   - Seeding is never automatic. Nothing calls seed() on boot; only
 *     scripts/seed-demo.mjs does, and only when a person runs it.
 *   - The script refuses a production target unless the person says, in the
 *     environment, that the target is the demo (assertDemoTarget below).
 *   - Every write and every delete is scoped to one role (user_id) AND to the
 *     exact ids in the data file. Cleanup can only remove rows this file made.
 *   - Seed clears its own rows first, so running it twice refreshes rather
 *     than doubles.
 */
import { getSql, type Sql } from "../db";
import DATA from "../../../demo/somnus-demo-seed.json";

export const DEMO_SEED = DATA;
export const DEMO_SEAT = DATA.demoSeat;
export const DEMO_ID_PREFIX = DATA.idPrefix;

/** The same week, as plain rows, for the in-app demo door (control-fns.ts). */
export function demoRowsFor() {
  return {
    jobs: DATA.jobs,
    audit: DATA.audit,
    deliveries: DATA.deliveries,
    hooks: DATA.hooks,
    daemon: {
      nextFull: DATA.daemon.nextFull,
      nextApply: DATA.daemon.nextApply,
      lastPulse: DATA.daemon.lastPulse,
      policy: DATA.daemon.policy,
    },
  };
}

const ids = {
  jobs: DATA.jobs.map((r) => r.id),
  audit: DATA.audit.map((r) => r.id),
  deliveries: DATA.deliveries.map((r) => r.id),
  hooks: DATA.hooks.map((r) => r.id),
};

/**
 * Refuse to seed or clean a target that looks like production unless the
 * person running it has named it the demo. Pure, so it can be tested.
 */
export function demoTargetRefusal(env: Record<string, string | undefined>): string | null {
  const named = env.SOMNUS_DEMO_TARGET === "demo";
  if (env.VERCEL_ENV === "production" && !named) {
    return "VERCEL_ENV is production. Set SOMNUS_DEMO_TARGET=demo only if this deployment is the demo platform.";
  }
  if (env.NODE_ENV === "production" && !named) {
    return "NODE_ENV is production. Set SOMNUS_DEMO_TARGET=demo only if this is the demo platform.";
  }
  if (env.DATABASE_URL?.trim() && !named) {
    return "DATABASE_URL points at a real Postgres. Set SOMNUS_DEMO_TARGET=demo only if it is the demo database.";
  }
  const blocked = (env.SOMNUS_PROD_DB_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const url = env.DATABASE_URL ?? "";
  const host = url.replace(/^[a-z]+:\/\/([^@]*@)?/i, "").split(/[/:?]/)[0];
  if (host && blocked.includes(host)) {
    return `DATABASE_URL host ${host} is listed in SOMNUS_PROD_DB_HOSTS. Refusing, whatever else is set.`;
  }
  return null;
}

/** Count the seed's own rows under one role. Rows with other ids are not counted. */
export async function countDemo(role: string = DEMO_SEAT, sql?: Sql): Promise<Record<string, number>> {
  const q = sql ?? (await getSql());
  const n = async (rows: { n: number | string }[]) => Number(rows[0]?.n ?? 0);
  return {
    jobs: await n(await q`select count(*) as n from somnus_jobs where user_id = ${role} and id = any(${ids.jobs})`),
    audit: await n(await q`select count(*) as n from somnus_audit where user_id = ${role} and id = any(${ids.audit})`),
    deliveries: await n(await q`select count(*) as n from somnus_deliveries where user_id = ${role} and id = any(${ids.deliveries})`),
    hooks: await n(await q`select count(*) as n from somnus_hooks where user_id = ${role} and id = any(${ids.hooks})`),
    daemon: role === DEMO_SEAT ? await n(await q`select count(*) as n from somnus_daemon where user_id = ${role}`) : 0,
  };
}

/**
 * Remove exactly the seed's rows under one role: same role AND an id from the
 * data file. The daemon row is removed only for the dedicated demo role, which
 * the seed owns outright; in a real account the daemon row is the account's.
 */
export async function cleanDemo(role: string = DEMO_SEAT, sql?: Sql): Promise<Record<string, number>> {
  const q = sql ?? (await getSql());
  const before = await countDemo(role, q);
  await q`delete from somnus_hooks where user_id = ${role} and id = any(${ids.hooks})`;
  await q`delete from somnus_deliveries where user_id = ${role} and id = any(${ids.deliveries})`;
  await q`delete from somnus_audit where user_id = ${role} and id = any(${ids.audit})`;
  await q`delete from somnus_jobs where user_id = ${role} and id = any(${ids.jobs})`;
  if (role === DEMO_SEAT) await q`delete from somnus_daemon where user_id = ${role}`;
  return before;
}

/** Write the seed's rows under one role. Clears its own rows first. */
export async function writeDemo(role: string, sql: Sql, opts: { daemon: boolean }): Promise<number> {
  await cleanDemo(role, sql);
  for (const j of DATA.jobs) {
    await sql`
      insert into somnus_jobs (user_id, id, kind, status, actor, at, ended_at, detail)
      values (${role}, ${j.id}, ${j.kind}, ${j.status}, ${j.actor}, ${j.at}, ${j.ended_at}, ${j.detail})
    `;
  }
  for (const a of DATA.audit) {
    await sql`
      insert into somnus_audit (user_id, id, at, actor, action, target, detail)
      values (${role}, ${a.id}, ${a.at}, ${a.actor}, ${a.action}, ${a.target}, ${a.detail})
    `;
  }
  for (const d of DATA.deliveries) {
    await sql`
      insert into somnus_deliveries (user_id, id, at, channel, status, target, body, attempts, next_retry)
      values (${role}, ${d.id}, ${d.at}, ${d.channel}, ${d.status}, ${d.target}, ${d.body}, ${d.attempts}, ${d.next_retry})
    `;
  }
  for (const h of DATA.hooks) {
    await sql`insert into somnus_hooks (user_id, id, at, body) values (${role}, ${h.id}, ${h.at}, ${h.body})`;
  }
  if (opts.daemon) {
    const d = DATA.daemon;
    await sql`
      insert into somnus_daemon (user_id, armed, cadence, frozen, sessions, next_full, next_apply, last_pulse, policy_json)
      values (${role}, ${d.armed}, ${d.cadence}, ${d.frozen}, ${d.sessions}, ${d.nextFull}, ${d.nextApply}, ${d.lastPulse}, ${JSON.stringify(d.policy)})
      on conflict (user_id) do update set
        armed = excluded.armed, cadence = excluded.cadence, frozen = excluded.frozen,
        sessions = excluded.sessions, next_full = excluded.next_full,
        next_apply = excluded.next_apply, last_pulse = excluded.last_pulse,
        policy_json = excluded.policy_json
    `;
  }
  return DATA.jobs.length + DATA.audit.length + DATA.deliveries.length + DATA.hooks.length + (opts.daemon ? 1 : 0);
}

/** The seed script's entry: the dedicated demo role only. */
export async function seed(): Promise<Record<string, number>> {
  const sql = await getSql();
  await writeDemo(DEMO_SEAT, sql, { daemon: true });
  return countDemo(DEMO_SEAT, sql);
}
