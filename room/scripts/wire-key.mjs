#!/usr/bin/env node
/**
 * Mint a TalkBack wire key with no browser and no password.
 *
 *   PGLITE_DATA_DIR=$HOME/.talkback-data npm run wire:key -- --user dev-user --desk floor
 *
 * Deletes the old key for that user+desk, inserts a new one, prints the token
 * once. Same effect as the "New key" button (issueWireToken, src/lib/talkback/api.ts).
 * PGLite is single-writer: refuses while the room server holds the data dir.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mintToken } from "../src/lib/talkback/token.server.ts";
import { DESK_IDS } from "../src/lib/talkback/roles.ts";
import { pendingMigrations } from "./migration-plan.mjs";
import { resolvePgliteDataDir } from "./pglite-data-dir.mjs";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * This process's own pid plus every ancestor (parent, grandparent, ...). A
 * `PGLITE_DATA_DIR=... npm run wire:key` invocation puts the env var on the
 * npm and shell wrapper processes too, not just this script — without this,
 * findDataDirHolders flags our own launcher as a "holder" and refuses every
 * time it's run the documented way.
 */
function selfAndAncestorPids(pid) {
  const pids = new Set([pid]);
  let current = pid;
  for (let i = 0; i < 64; i++) {
    let stat;
    try {
      stat = readFileSync(`/proc/${current}/stat`, "utf8");
    } catch {
      break;
    }
    const match = stat.match(/\)\s+\S\s+(\d+)/);
    const ppid = match ? Number(match[1]) : 0;
    if (!ppid || ppid === 1 || pids.has(ppid)) break;
    pids.add(ppid);
    current = ppid;
  }
  return pids;
}

/** Pids (other than ours or our launcher's) whose environment points at `dataDir`. Linux /proc. */
export function findDataDirHolders(dataDir, selfPid = process.pid) {
  const want = resolve(dataDir);
  const holders = [];
  const excluded = selfAndAncestorPids(selfPid);
  let pids = [];
  try {
    pids = readdirSync("/proc").filter((n) => /^\d+$/.test(n));
  } catch {
    return holders;
  }
  for (const pid of pids) {
    if (excluded.has(Number(pid))) continue;
    try {
      const env = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
      const line = env.find((e) => e.startsWith("PGLITE_DATA_DIR="));
      if (line && resolve(line.slice("PGLITE_DATA_DIR=".length).trim()) === want) {
        holders.push(Number(pid));
      }
    } catch {
      // process gone or not ours to read
    }
  }
  return holders;
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user") out.user = argv[++i];
    else if (argv[i] === "--desk") out.desk = argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}.`);
  }
  return out;
}

/** Same SQL as issueWireToken (api.ts): delete the old row, insert the new one. */
export async function reissueWireKey(pg, userId, desk) {
  const minted = mintToken();
  await pg.query(
    "delete from talkback_tokens where user_id = $1 and desk = $2",
    [userId, desk],
  );
  await pg.query(
    "insert into talkback_tokens (user_id, desk, token_hash, token_prefix) values ($1, $2, $3, $4)",
    [userId, desk, minted.hash, minted.prefix],
  );
  return minted;
}

async function applyMigrations(pg) {
  await pg.exec(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = (await pg.query("select name from _migrations")).rows.map((r) => r.name);
  const files = readdirSync(migrationsDir);
  for (const { name } of pendingMigrations(files, done)) {
    await pg.transaction(async (tx) => {
      await tx.exec(readFileSync(`${migrationsDir}/${name}`, "utf8"));
      await tx.query("insert into _migrations (name) values ($1)", [name]);
    });
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail(`${err.message}\nUsage: npm run wire:key -- --user <userId> --desk <${DESK_IDS.join("|")}>`);
  }
  if (!args.user || !args.desk || !DESK_IDS.includes(args.desk)) {
    fail(`Usage: npm run wire:key -- --user <userId> --desk <${DESK_IDS.join("|")}>`);
  }
  const dataDir = resolvePgliteDataDir(process.env);
  if (!dataDir) {
    fail(
      "PGLITE_DATA_DIR is not set, so a key minted now would live in a throwaway in-memory database.\n" +
        "Set it to the room's data folder, e.g. PGLITE_DATA_DIR=$HOME/.talkback-data npm run wire:key -- ...",
    );
  }
  const holders = findDataDirHolders(dataDir);
  if (holders.length) {
    fail(
      `The TalkBack room (pid ${holders.join(", ")}) is running and holds ${resolve(dataDir)}.\n` +
        "Writing now would be lost or corrupt the store. Stop it first with:\n" +
        `  kill ${holders.join(" ")}\n` +
        "then run this command again, then start the room again with:\n" +
        "  node rack.mjs up",
    );
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite({ dataDir });
  await pg.waitReady;
  try {
    await applyMigrations(pg);
    const minted = await reissueWireKey(pg, args.user, args.desk);
    console.log(minted.token);
    console.error(`New ${args.desk} key for ${args.user} (prefix ${minted.prefix}). Old key deleted. Shown once.`);
  } finally {
    await pg.close();
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(`wire-key failed: ${err?.message || err}`));
}
