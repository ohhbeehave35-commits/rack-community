# Keeping PGLite data across restarts (`PGLITE_DATA_DIR`)

**If `DATABASE_URL` is unset, this app's database is PGLite (embedded
Postgres, compiled to WASM) -- see `src/lib/db.ts`.** By default PGLite runs
**in memory**: every table, every row, every minted token is gone the moment
the process exits, restart or crash alike. A typical symptom: a wire token minted once is lost on the next restart, so messages and calls reach nobody until a new one is made.

## The fix: set `PGLITE_DATA_DIR`

Set `PGLITE_DATA_DIR` to a real, writable directory before starting the
server (preview, built node-server, or desktop packaging -- all three read
the same variable in `src/lib/db.ts`). PGLite then persists to that
directory and a restart re-opens the same data, migrations included
(`_migrations` is itself a table in that same directory, so an
already-applied migration is skipped, never re-run).

```bash
export PGLITE_DATA_DIR=/home/you/app-data   # any writable, persistent path
npm run preview                              # or the built node-server, or `vite dev`
```

- **Not a `VITE_` var.** `PGLITE_DATA_DIR` is server-only and is never sent to the browser, so it must be exported as a real
  environment variable wherever the process is started.
- **Unset = in-memory**, always. That's correct for a throwaway preview or a
  test run; it's a data-loss bug for anything meant to stay up (a long-running
  deployment like a preview server kept alive for days).
- **Migrations still run.** The same `migrations/*.sql` files apply on first
  boot against the persistent dir, exactly as they would in memory -- nothing
  else changes about the schema story.

## Proof this actually survives a restart

`scripts/pglite-restart-persist.itest.mjs` boots the built server twice
against the SAME `PGLITE_DATA_DIR`, with a real process kill between boots
(not just a fresh module instance) — a token minted before the "restart"
must still authenticate after it. A companion test in the same file proves
the failure mode this closes: two boots with no shared dir lose the token,
reproducing the original outage. Run after `NITRO_PRESET=node-server npm run
build`:

```bash
NITRO_PRESET=node-server npm run build
node --test scripts/pglite-restart-persist.itest.mjs
```
