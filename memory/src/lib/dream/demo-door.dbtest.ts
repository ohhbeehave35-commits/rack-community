/**
 * THE DOOR, PROVEN: a brand-new account can open the demo, and it cannot open
 * anyone else's.
 *
 * The finding this comes from (Desktop\DEMO-DOOR-GAP-2026-09-09.md): seeded
 * rows are not a demo. An account lands attached to nothing, so a filled
 * database is invisible and the screen reads as a product that has never run.
 * The door fixes that, and these are the three things it must never get wrong.
 *
 * The assertion that matters is the one a screenshot would have failed: a fresh
 * account, having created nothing, ends up with rows in front of it.
 *
 * Runs through scripts/run-db-test.mjs. `fixtureCount` is checked before any of
 * this executes, so a clean result cannot come from an empty fixture.
 */
import { getSql } from "../db";
import { cleanDemo, writeDemo } from "./demo-seed";

const STAMP = Date.now();
const NEWCOMER = `door-new-${STAMP}`;
const NEIGHBOUR = `door-neighbour-${STAMP}`;

let seeded = 0;

/** The door's own write, as the server function does it: every row under the
 *  caller's id, taken from the session. Kept here rather than importing the
 *  server function because that one needs a request context; the rule under
 *  test is what it writes and where. */
async function openTheDoorAs(userId: string) {
  // The door's own write, as the server function does it: under the caller's
  // id, daemon only when the account has no history of its own.
  const sql = await getSql();
  const own = await sql<{ id: string }>`select id from somnus_jobs where user_id = ${userId} and id not like 'sdemo-%' limit 1`;
  const rows = await writeDemo(userId, sql, { daemon: own.length === 0 });
  return { loaded: true, rows };
}

async function seed() {
  const sql = await getSql();
  // The neighbour is a real account with its own history, the thing the door
  // must never overwrite.
  await sql`
    insert into somnus_jobs (user_id, id, kind, status, actor, at, ended_at, detail)
    values (${NEIGHBOUR}, ${`real-${STAMP}`}, 'full', 'done', 'daemon', '2026-09-08T06:00:00.000Z', '2026-09-08T06:12:00.000Z',
            'A real week belonging to the neighbour, not a demo.')
  `;
  seeded = 1;
  return sql;
}

async function cleanup() {
  const sql = await getSql();
  for (const u of [NEWCOMER, NEIGHBOUR]) {
    await sql`delete from somnus_audit where user_id = ${u}`;
    await sql`delete from somnus_jobs where user_id = ${u}`;
    await sql`delete from somnus_deliveries where user_id = ${u}`;
    await sql`delete from somnus_hooks where user_id = ${u}`;
    await sql`delete from somnus_daemon where user_id = ${u}`;
  }
}

const sql = await seed();

export const fixtureCount = () => seeded;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export const tests = [
  {
    name: "a brand-new account opens the demo and has rows in front of it",
    fn: async () => {
      const before = await sql<{ id: string }>`select id from somnus_jobs where user_id = ${NEWCOMER}`;
      assert(before.length === 0, "the newcomer already had rows, so this proves nothing");

      const result = await openTheDoorAs(NEWCOMER);
      assert(result.loaded, "the door refused a brand-new account");

      const jobs = await sql<{ detail: string }>`select detail from somnus_jobs where user_id = ${NEWCOMER}`;
      assert(jobs.length >= 5, `the newcomer sees ${jobs.length} jobs, expected the seeded week`);
      const text = JSON.stringify(jobs);
      assert(text.includes("Full pass"), "the demo week is not what the newcomer got");
      assert(text.includes("Refused"), "the refused-batch row is missing, which is the one that shows dual control working");
    },
  },
  {
    name: "the demo lands under the caller's own id and nowhere else",
    fn: async () => {
      const neighbourJobs = await sql<{ detail: string }>`select detail from somnus_jobs where user_id = ${NEIGHBOUR}`;
      assert(neighbourJobs.length === 1, `the neighbour has ${neighbourJobs.length} jobs, so the demo reached across`);
      assert(JSON.stringify(neighbourJobs).includes("real week"), "the neighbour's own row was replaced");
    },
  },
  {
    name: "an account with its own week keeps every row and its schedule; the sample sits beside it",
    fn: async () => {
      await sql`insert into somnus_daemon (user_id, armed, cadence, frozen, sessions, policy_json) values (${NEIGHBOUR}, false, 'off', true, 1, '{}')`;
      await openTheDoorAs(NEIGHBOUR);
      const real = await sql<{ detail: string }>`select detail from somnus_jobs where user_id = ${NEIGHBOUR} and id = ${`real-${STAMP}`}`;
      assert(real.length === 1 && real[0].detail.includes("real week"), "the neighbour's own job changed or vanished");
      const daemon = await sql<{ cadence: string; frozen: boolean }>`select cadence, frozen from somnus_daemon where user_id = ${NEIGHBOUR}`;
      assert(daemon[0]?.cadence === "off" && daemon[0]?.frozen === true, `the neighbour's schedule was overwritten: ${JSON.stringify(daemon)}`);
      await cleanDemo(NEIGHBOUR, sql);
      const after = await sql<{ id: string }>`select id from somnus_jobs where user_id = ${NEIGHBOUR}`;
      assert(after.length === 1, `after removing the sample the neighbour has ${after.length} jobs`);
      await sql`delete from somnus_daemon where user_id = ${NEIGHBOUR}`;
    },
  },
  {
    name: "opening the door twice does not double the week",
    fn: async () => {
      const first = await sql<{ id: string }>`select id from somnus_jobs where user_id = ${NEWCOMER}`;
      await openTheDoorAs(NEWCOMER);
      const second = await sql<{ id: string }>`select id from somnus_jobs where user_id = ${NEWCOMER}`;
      assert(second.length === first.length, `a second press turned ${first.length} jobs into ${second.length}`);
    },
  },
  {
    name: "removing the sample takes out only sample rows, never the account's own",
    fn: async () => {
      // The newcomer also wrote a row of their own after opening the door.
      await sql`
        insert into somnus_jobs (user_id, id, kind, status, actor, at, ended_at, detail)
        values (${NEWCOMER}, ${`own-${STAMP}`}, 'full', 'done', 'daemon', '2026-09-20T06:00:00.000Z', null, 'Mine, not the sample')
      `;
      await cleanDemo(NEWCOMER, sql);
      const left = await sql<{ id: string }>`select id from somnus_jobs where user_id = ${NEWCOMER}`;
      assert(left.length === 1 && left[0].id === `own-${STAMP}`, `after cleanup the newcomer has ${JSON.stringify(left)}`);
      const audit = await sql<{ id: string }>`select id from somnus_audit where user_id = ${NEWCOMER}`;
      assert(audit.length === 0, "sample audit lines survived cleanup");
      const neighbour = await sql<{ id: string }>`select id from somnus_jobs where user_id = ${NEIGHBOUR}`;
      assert(neighbour.length === 1, "cleaning one account touched another");
    },
  },
  {
    name: "the fixture is put away again",
    fn: async () => {
      await cleanup();
      const left = await sql<{ id: string }>`select id from somnus_jobs where user_id in (${NEWCOMER}, ${NEIGHBOUR})`;
      assert(left.length === 0, "the test left its accounts behind in the database");
    },
  },
];
