// @ts-check
/**
 * Where PGLite keeps its data. Set PGLITE_DATA_DIR and the store (TalkBack wire
 * keys included) survives a restart; unset, PGLite is in-memory and every key
 * dies with the process. Shared by src/lib/db.ts and scripts/wire-key.mjs.
 * @param {Record<string, string | undefined>} env
 * @returns {string | undefined}
 */
export function resolvePgliteDataDir(env) {
  const dir = env.PGLITE_DATA_DIR?.trim();
  return dir ? dir : undefined;
}
