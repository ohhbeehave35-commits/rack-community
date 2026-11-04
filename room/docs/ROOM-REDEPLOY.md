# Redeploying a TalkBack room

A new build made without the PGLite copy step lacks `pglite.data` under the build output, and the first request dies with
`ENOENT`. `vite preview` now copies and verifies the PGLite runtime files before it listens (see `vite.config.ts`), and
`npm run build` copies and verifies them too.

Never stop the working room first.

1. Build: `npm ci && npm run build`.
2. Start the new build on a spare port, with a copy of the data folder (two previews must not share `PGLITE_DATA_DIR`
   at the same time):
   `cp -r "$PGLITE_DATA_DIR" "$PGLITE_DATA_DIR-check"` then
   `PGLITE_DATA_DIR="$PGLITE_DATA_DIR-check" npx vite preview --host 127.0.0.1 --port 8423 &`
3. Check it: `node scripts/room-check.mjs http://127.0.0.1:8423/ 30` must exit 0. It fails unless the room answers 200
   within 30 seconds.
4. Only then stop the old room, start the new build on the real port, and run `node scripts/room-check.mjs` against it.
5. If step 3 or 4 fails, leave or restore the old build and report it. Delete the data copy when you are done.
