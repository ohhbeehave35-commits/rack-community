import assert from "node:assert/strict";
import { test } from "node:test";
import { migrationTarget } from "./migration-plan.mjs";

test("a preview build never migrates the production database", () => {
  const env = { DATABASE_URL: "postgres://prod/db", VERCEL_ENV: "preview" };
  const t = migrationTarget(env);
  assert.equal(t.run, false);
  assert.equal(t.url, "");
  assert.match(t.message, /preview: migrations skipped/);
  assert.equal(migrationTarget({ ...env, VERCEL_ENV: "development" }).run, false);
});

test("a preview build with its own preview database migrates only that one", () => {
  const t = migrationTarget({ DATABASE_URL: "postgres://prod/db", PREVIEW_DATABASE_URL: "postgres://preview/db", VERCEL_ENV: "preview" });
  assert.equal(t.run, true);
  assert.equal(t.url, "postgres://preview/db");
});

test("a production build, and a local build with no VERCEL_ENV, migrate the production address as before", () => {
  const prod = { DATABASE_URL: "postgres://prod/db", DATABASE_URL_UNPOOLED: "postgres://prod/direct" };
  assert.deepEqual(migrationTarget({ ...prod, VERCEL_ENV: "production" }), { run: true, url: "postgres://prod/direct", message: "" });
  assert.deepEqual(migrationTarget(prod), { run: true, url: "postgres://prod/direct", message: "" });
  assert.equal(migrationTarget({}).url, "");
});
