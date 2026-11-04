import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { rackPlugin } from "../tools/owner-gate.mjs";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { isMigrationFile } from "./scripts/migration-plan.mjs";
// @ts-expect-error JS helper alongside the TS vite config
import { copyPgliteLibs, verifyPgliteLibs } from "./scripts/pglite-libs.mjs";

/** The files `src/lib/db.ts` globs — same directory, same non-recursive scope. */
function hasGlobbedMigrations(root: string): boolean {
  try {
    return readdirSync(join(root, "migrations")).some(isMigrationFile);
  } catch {
    return false;
  }
}

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 *
 * Vite awaiting the hook puts this on time-to-first-render, so an app with no
 * migrations — no schema to apply — skips it entirely rather than paying for a
 * PGLite instance it never queries.
 */
function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "app-builder:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      if (!hasGlobbedMigrations(server.config.root)) return;
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[app-builder] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

/**
 * A room started with `vite preview` on a build made by bare `vite build` (no
 * `npm run build`) has no PGLite runtime files in the server output, so the first
 * request dies with ENOENT ..._libs/pglite.data (TalkBack room, 29 Oct 2026).
 * Copy them in (idempotent) and verify BEFORE the preview server listens, so a
 * bad build fails at start instead of at the first request.
 */
function pglitePreviewLibsPlugin(): Plugin {
  return {
    name: "app-builder:pglite-preview-libs",
    configurePreviewServer() {
      copyPgliteLibs();
      verifyPgliteLibs();
    },
  };
}

// Dev server: 127.0.0.1:8080. Pass --host to change it.
export default defineConfig(({ command, isPreview }) => ({
  server: { host: "127.0.0.1", port: 8080, strictPort: true },
  preview: { host: "127.0.0.1", port: 8081, strictPort: true },
  resolve: { tsconfigPaths: true },
  plugins: [
    rackPlugin(),
    pgliteBootstrapPlugin(),
    pglitePreviewLibsPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            // Desktop packaging builds with NITRO_PRESET=node-server to emit a
            // self-contained HTTP server.
            preset: process.env.NITRO_PRESET || undefined,
          }),
        ]
      : []),
    viteReact(),
  ],
}));
