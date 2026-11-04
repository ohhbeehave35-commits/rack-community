# Changelog

## 2.0.0 - 2026-11-04

- One install and owner: `./rack install && ./rack up`, persistent local databases, loopback binding, readiness and grouped shutdown.
- One panel: TalkBack in Jobs, Somnus in Recipes, with all four Rack views retained. Component manuals now live in the root README.
- Wire desk label and redirects from legacy Grok URLs; stored desk IDs and keys remain compatible.
- Tests green on the available host with explicit Linux dependency skips; desktop integration always rebuilds current code. Portable npm invocation and LF-canonical seed hash.
- Optional owner password gate via RACK_OWNER_PASSWORD; off by default, shared local session, engine controls token still required.
- Reproducible privacy scan and nine 1440px panel screenshots.

## 1.0.0 - 2026-11-04

First public release.

- **engine/**: durable job queue (SQLite), one-job-at-a-time actor with per-piece deadlines enforced from outside the worker, `admit.sh` memory admission control, recipes, host gauges, HTTP API with token-checked writes, pause/resume with a `HOLD` marker, dry-run by default. 38 tests. Each safety rule was checked by deliberately breaking it and confirming a test fails.
- **panel/**: control panel with live gauges, "what is it doing", jobs with saved progress, recipes and ledger, controls (unlock, LIVE, check it fits, typed START, pause, resume, stop), run status stream, phone layout.
- **memory/ (Somnus)**: memory control plane with a dream pass, approval queue, dual control, snapshots, diff and rollback, audit trail, a read-only SDK and MCP server.
- **room/ (TalkBack)**: team room with channels, threads, reactions, mentions, pins, recap, file attach, a wire for AI agents, huddles, and an Electron shell for a LAN-hosted room.
- **Bring your own AI**: `engine/samples/ask_model_pieces.py` talks to Ollama or any OpenAI-compatible endpoint; the key is never saved to the job's pieces.
- `start.sh` starts the API, the actor and the panel on `127.0.0.1` with a generated token.
- Somnus and TalkBack run as one local owner with no sign-in. Their server functions refuse requests a browser reports as cross-site.
- Fixed: TalkBack reactions could come back in the wrong order when two were saved in the same clock tick (new migration `0007_reaction_order.sql`).
- Removed before release: the app template's install-page and sign-in layer and the tests that only covered it, machine-specific backup tooling, and all company-specific content.
