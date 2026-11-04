# TalkBack desktop app

The Electron shell wraps the TalkBack web app. It starts the app's own Nitro `node-server` build as a child process
(using Electron's bundled Node, `ELECTRON_RUN_AS_NODE=1`, so no system Node is needed) and loads it in a window.

Data is a local PGLite (embedded Postgres) database under the per-user application-data folder, so the team room
survives restarts. There is no sign-in: one local owner.

## Two LAN modes, no cloud

One computer runs the room as the host, bound to that machine's own network address. Other computers on the same
network join by typing that address in. There is no internet-hosted server in this flow.

## Build the installer

```
npm install
npm run desktop:build   # NITRO_PRESET=node-server build + copy PGLite assets
npm run desktop:dist    # electron-builder -> installer in dist/
```

Run unpackaged for a quick check: `npm run desktop:dev`.

The macOS build is unsigned and not notarized. Gatekeeper will refuse to open it until you add your own Apple Developer ID
certificate and notarize it; until then, right-click and choose Open.

## Data and reset

The local database lives under the user's application-data folder in a `TalkBack/db` directory. Deleting it resets the room.
`docs/PERSISTENT-DATA-DIR.md` explains `PGLITE_DATA_DIR` for keeping the data in a folder you choose.

## Changes made to the base web app (all additive)

- `vite.config.ts` reads the Nitro preset from `NITRO_PRESET` (unset by default), so a desktop `node-server` build is possible.
- `src/lib/db.ts` honours `PGLITE_DATA_DIR` for a persistent store; unset keeps an in-memory instance.
- `package.json` carries `main`, `version`, `description`, `author` and the `desktop:*` scripts.
