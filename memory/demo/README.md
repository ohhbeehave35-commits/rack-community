# Somnus demo data: seed, check, clean, reset

Everything in this folder is synthetic: one made-up week for a made-up business
(Blue Water Pools and Outdoor Living). Every email is on the reserved `.example`
domain. Every record id, and the demo role, starts with `sdemo-`.

| File | What it is |
| --- | --- |
| `somnus-demo-seed.json` | The data. Schema `somnus-demo-seed/1`. |
| `somnus-demo-seed.manifest.json` | Schema version, sha256 of the data file, row counts per table, the demo role, the id prefix. |

`src/lib/dream/demo-seed.ts` is the only loader. The seed script, the in-app
"Load the sample week" button (Tour page) and the tests all read this one file.
`npm run test:somnus` fails if the data changes without a new manifest, or if a
record is missing the `sdemo-` prefix, or if any email is not `.example`.

## The rules

- **Nothing seeds automatically.** No code path calls the seeder on boot or on
  deploy. Seeding happens only when a person runs one of the commands below, or
  presses "Load the sample week" in their own account.
- **Production is guarded.** The script refuses when `VERCEL_ENV` or `NODE_ENV`
  is `production`, or when `DATABASE_URL` is set, unless `SOMNUS_DEMO_TARGET=demo`
  says this target IS the demo platform. A host listed in
  `SOMNUS_PROD_DB_HOSTS` (comma separated) is refused even then.
- **The in-app button is off on production** unless that deployment sets
  `SOMNUS_DEMO_DOOR=on` (set it only on the demo platform).
- **Cleanup touches only the sample.** Every delete requires the demo role (or
  the signed-in account, for the button) AND an id listed in the data file.
  Other accounts, and any row with another id, are never touched. No table or
  database is ever dropped.
- **Idempotent.** `seed` clears its own rows first, so running it twice gives
  the same 18 rows, not 36.
- **The demo role never becomes the owner.** Somnus lets its first signed-in
  account claim the control plane; `sdemo-` rows are ignored for that claim, so
  seeding a fresh database cannot lock real people out.

## Commands

Mode is `seed`, `clean`, `reset` (clean then seed) or `check` (count only, writes nothing).

Local, kept in a folder the dev server can then serve:

    PGLITE_DATA_DIR=.demo-db npm run demo:reset
    PGLITE_DATA_DIR=.demo-db npm run demo:check

Demo platform database (never the production one):

    SOMNUS_DEMO_TARGET=demo DATABASE_URL=<demo database url> npm run demo:check
    SOMNUS_DEMO_TARGET=demo DATABASE_URL=<demo database url> npm run demo:reset
    SOMNUS_DEMO_TARGET=demo DATABASE_URL=<demo database url> npm run demo:clean

Each run prints which database it is writing to before it writes, then the
counts: `removed`, `seeded`, `now present`. Expected after `reset`:
`{"jobs":5,"audit":6,"deliveries":4,"hooks":2,"daemon":1}`. After `clean`: all zero.

## Walking the demo as a prospect

1. Start the app on the demo database, with the prospect's (or a synthetic)
   account allowed: `SOMNUS_ALLOWED_USERS=<email>`. On the demo platform also set
   `SOMNUS_DEMO_DOOR=on`.
2. Sign in, open **Tour**, press **Load the sample week**. The sample sits next to
   anything the account already has; it never replaces a record.
3. Follow the ten tour stops. **Backup** is the five-button restore walkthrough.
4. When finished, press **Remove the sample week** on the Tour page. Only the
   sample goes.

## Screenshots

`node scripts/capture-screenshots.mjs` (app running, synthetic accounts
`sdemo-qa-{phone,tablet,desktop}@example.test` allowed) writes
`store/screenshots/{phone,tablet,desktop}/`. See `store/screenshots.md`.
