# RACK3 DONE - 2026-11-04

Branch: rack3. Base: b0faf9f5f3000bda3c001d8f5a137ba09ff18eea. Local commit only; no push.

## Delivered

- One entry point: ./rack install && ./rack up. Persistent engine and app data, one supervisor, loopback ports, startup readiness, duplicate-owner refusal, grouped shutdown and worker cleanup.
- Four-view panel retained. Jobs contains TalkBack; Recipes contains Somnus and its page selector. Embedded Somnus has no second global navigation. Component README content is consolidated into README.md.
- Wire desk label, legacy /grok and ?desk=grok redirects, existing stored desk identifiers and keys retained.
- RACK_OWNER_PASSWORD enables a shared local owner session; off by default. All four HTTP services reject unauthenticated access when enabled. Engine control tokens remain required. Neither owner password nor controls token reaches recipe workers.
- All six package manifests and four lockfile roots are 2.0.0. CHANGELOG.md has the 2.0.0 entry.
- The checkout's line endings were recorded with git ls-files --eol before edits and checked again after builds. All 303 original files retain their working-tree line-ending classification (290 text files); generated route files were restored to their original CRLF endings.

## Exact verification result lines

Commands were run only against this repository. No tests were removed.

```text
Rack 2.0.0 installed. Run: node rack.mjs up
RACK TEST: PASS (exit 0)
25 passed, 14 skipped, 1 warning in 2.21s
RACK TYPECHECK: PASS (exit 0)
PUBLIC SCAN: CLEAN (0 findings)
LIVE GATE: PASS (all four services reject unauthenticated requests; legacy redirects pass)
SCREENSHOTS: PASS (9 files, 1440px wide)
```

Suite count: 146 passed, 15 skipped, 0 failed. Owner gate: 2 passed. Engine: 25 passed / 14 skipped. Panel: 19 passed. Somnus: 9 script + 30 TypeScript tests passed. TalkBack: 29 script + 31 TypeScript tests passed / 1 script test skipped. Desktop wire integration: 1 passed against a freshly rebuilt packaged server. Typecheck: each app's own tsc --noEmit exited 0.

The desktop integration runner now rebuilds current source every time. The six old template failures named in the order were not reproduced as six failures in this base, whose README had no Known issues block. Actual defects fixed: Windows npm invocation, canonical LF seed-data hashing while preserving checkout line endings, and explicit platform-dependency skips. New gate tests cover missing/forged/expired/rotated sessions, cross-site login, and the controls-token boundary.

Neither the export scan script nor NOTICE.md/its strip list was present (the base has NOTICE). tools/scan.mjs is the replacement public-tree scan. It checks tracked and unignored new text for credential formats, private URLs, machine paths and workspace markers; only exact synthetic SSRF refusal fixtures are excepted. Screenshots were visually reviewed. No credentials or private records were added.

## Screenshots

Nine files saved in the requested FLEET/2026-11-04/RACK3 folder, also copied into docs/screenshots for the updated README. All are 1440px wide. They show the real local API and apps on a fresh local test store; the Linux actor was not running on this Windows host. They do not claim a completed training/job run.

| File | Dimensions | SHA256 |
| --- | --- | --- |
| 01-overview.png | 1440 x 1000 | 072d74195f1bf62cf8fa740cff146b890107b40805feb27625df5685d874830f |
| 02-jobs.png | 1440 x 1000 | 8392174d37878c2005c17872e168680047eb5299e9c8ef5895d601e959e06c44 |
| 03-controls.png | 1440 x 1021 | 7ebf9e9e440b63a1edcd933a69d35220c594e2f776a0b856979ab0321ba0fec3 |
| 04-recipes.png | 1440 x 1000 | 256beebd64f4c1c7e8511b42d474f87ba4b12f13c62e3c6392d6f84b6ae9166c |
| 05-run-status.png | 1440 x 1000 | 401eef436ca1f358313c295d234484743c34ff991e8f182ab05cb31a2182a842 |
| 06-talkback.png | 1440 x 1055 | 49205ab20ae27a0194e7bc0f535ab60ae2fca28ee86e5ee5ab1ea9239b1d211b |
| 07-wire-desk.png | 1440 x 1055 | cd7b35963fa6c924d48688d79f7b6abe9a1fa8d882612f5241e25df9a46a8e1c |
| 08-somnus.png | 1440 x 1107 | 34a33603489fd478c9246555fdc0f504ae81eb14af6a233e0eab5dc135320c6d |
| 09-memory-gate.png | 1440 x 1107 | 95bdc82f0c9b8c24f7481181c8627fa5f6efba96025f9a606f8d08171dda235f |

## Files and lines changed

61 files; 894 insertions, 295 deletions; nine new binary screenshots. Counts are the staged diff against the base, including this report.

| File | Added lines | Deleted lines |
| --- | ---: | ---: |
| CHANGELOG.md | 9 | 0 |
| README.md | 237 | 29 |
| docs/screenshots/01-overview.png | binary | binary |
| docs/screenshots/02-jobs.png | binary | binary |
| docs/screenshots/03-controls.png | binary | binary |
| docs/screenshots/04-recipes.png | binary | binary |
| docs/screenshots/05-run-status.png | binary | binary |
| docs/screenshots/06-talkback.png | binary | binary |
| docs/screenshots/07-wire-desk.png | binary | binary |
| docs/screenshots/08-somnus.png | binary | binary |
| docs/screenshots/09-memory-gate.png | binary | binary |
| engine/rack_actor.py | 6 | 0 |
| engine/rack_api.py | 7 | 0 |
| engine/tests/test_admit.py | 3 | 0 |
| engine/tests/test_api_and_actor.py | 23 | 0 |
| memory/demo/README.md | 2 | 71 |
| memory/package-lock.json | 4 | 2 |
| memory/package.json | 3 | 2 |
| memory/sdk/somnus-sdk/README.md | 2 | 28 |
| memory/sdk/somnus-sdk/package.json | 10 | 4 |
| memory/src/components/shell.tsx | 4 | 2 |
| memory/src/lib/dream/demo-seed.test.ts | 1 | 1 |
| memory/src/lib/dream/memory.ts | 2 | 2 |
| memory/src/lib/dream/org.ts | 4 | 4 |
| memory/src/lib/dream/review-fixes.test.ts | 6 | 6 |
| memory/src/routes/intro.tsx | 4 | 2 |
| memory/vite.config.ts | 2 | 0 |
| package.json | 16 | 0 |
| panel/package-lock.json | 2 | 2 |
| panel/package.json | 1 | 1 |
| panel/src/components/rack/app-view.tsx | 19 | 0 |
| panel/src/components/rack/shell.tsx | 21 | 3 |
| panel/src/lib/rack/api.ts | 1 | 1 |
| panel/vite.config.ts | 3 | 1 |
| rack | 2 | 0 |
| rack.mjs | 98 | 0 |
| room/desktop/README-DESKTOP.md | 2 | 35 |
| room/docs/PERSISTENT-DATA-DIR.md | 1 | 1 |
| room/package-lock.json | 2 | 2 |
| room/package.json | 1 | 1 |
| room/relay/README.md | 2 | 44 |
| room/relay/package-lock.json | 4 | 2 |
| room/relay/package.json | 6 | 2 |
| room/scripts/pglite-restart-persist.itest.mjs | 1 | 2 |
| room/scripts/wire-auth.itest.mjs | 3 | 2 |
| room/scripts/wire-auth.run.mjs | 2 | 3 |
| room/scripts/wire-key.mjs | 1 | 1 |
| room/scripts/wire-key.test.mjs | 4 | 3 |
| room/src/components/talkback/room.tsx | 7 | 1 |
| room/src/lib/talkback/grok-desk.test.ts | 1 | 1 |
| room/src/lib/talkback/log-export.test.ts | 1 | 1 |
| room/src/lib/talkback/roles.ts | 3 | 3 |
| room/vite.config.ts | 2 | 0 |
| start.sh | 3 | 30 |
| tools/check.mjs | 23 | 0 |
| tools/owner-gate.d.mts | 5 | 0 |
| tools/owner-gate.mjs | 74 | 0 |
| tools/owner-gate.test.mjs | 35 | 0 |
| tools/scan.mjs | 29 | 0 |
| tools/screenshots.mjs | 63 | 0 |
| RACK3-DONE.md | 127 | 0 |

## Dependency exceptions and acceptance limit

- Engine: 14 admission/actor tests are marked skipped on non-Linux hosts. Required dependencies are Linux fcntl, flock, /proc and POSIX process groups; a Linux kernel cannot be bundled into this repository. They run normally on Linux/WSL2.
- TalkBack: one holder-detection test is marked skipped outside Linux because it reads /proc process environments. Its test remains present and enabled on Linux.
- The full rack up launch and Linux worker shutdown still require acceptance on Linux/WSL2. Native Windows is explicitly refused by the launcher, rather than starting a partial Rack. Browser checks here started the real API and three app servers under a temporary verification owner, with the password gate enabled.
- The Vite development renderer logged aborted requests when readiness probes or iframe navigation cancelled in-flight renders. Browser page-error checks passed; the nine requested captures and authenticated service checks completed.

ALL OTHER ITEMS DONE
QUESTIONS FOR THE DIRECTOR:
- Run the complete launcher and the 15 Linux-only checks on a Linux/WSL2 host before declaring Linux runtime acceptance. No other known test failure remains.
