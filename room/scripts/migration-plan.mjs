// @ts-check
/**
 * Migration bookkeeping shared by the two appliers — `scripts/migrate.mjs`
 * (deploy, `readdir`) and `src/lib/db.ts` (PGLite preview, `import.meta.glob`).
 *
 * Applied files are keyed by BASENAME, so the same file applies once no matter
 * which directory it is globbed from. Neither applier descends into
 * subdirectories.
 */

/**
 * The `_migrations` key for a migration path (or bare filename).
 * @param {string} path
 * @returns {string}
 */
export function migrationName(path) {
  return path.split("/").pop() ?? path;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isMigrationFile(path) {
  return path.endsWith(".sql");
}

/**
 * Migrations in `paths` that are not yet in `applied`, in apply order.
 * Non-`.sql` entries (a `readdir` can also yield directories) are dropped.
 * @param {Iterable<string>} paths
 * @param {Iterable<string>} applied
 * @returns {Array<{ name: string, path: string }>}
 */
export function pendingMigrations(paths, applied) {
  const done = new Set(applied);
  return [...paths]
    .filter(isMigrationFile)
    .map((path) => ({ name: migrationName(path), path }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(({ name }) => !done.has(name));
}

/**
 * Which database a build may migrate (PREVIEWGUARD, 31 Oct 2026). A Vercel Preview build shares the project's environment variables,
 * so its DATABASE_URL is the PRODUCTION address: a branch push once applied a migration to production six minutes before the
 * production build. Rule: a build whose VERCEL_ENV is set and is not "production" never touches the production address. It migrates
 * only a dedicated preview database (PREVIEW_DATABASE_URL), or skips.
 * @param {Record<string, string | undefined>} env
 * @returns {{ run: boolean, url: string, message: string }}
 */
export function migrationTarget(env) {
  const prod = env.DATABASE_URL_UNPOOLED || env.DATABASE_POSTGRES_URL_NON_POOLING || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL || "";
  const vercelEnv = String(env.VERCEL_ENV || "").trim();
  if (!vercelEnv || vercelEnv === "production") return { run: true, url: prod, message: "" };
  const preview = String(env.PREVIEW_DATABASE_URL || "").trim();
  if (preview) return { run: true, url: preview, message: `preview: migrating the dedicated preview database (VERCEL_ENV=${vercelEnv})` };
  return { run: false, url: "", message: `preview: migrations skipped (VERCEL_ENV=${vercelEnv}; a preview build never touches the production database)` };
}
