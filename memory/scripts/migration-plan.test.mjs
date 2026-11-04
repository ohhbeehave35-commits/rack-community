import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isMigrationFile, migrationName, pendingMigrations } from "./migration-plan.mjs";

test("_migrations keys on basename, not path", () => {
  assert.equal(migrationName("/migrations/0002_todos.sql"), "0002_todos.sql");
  assert.equal(migrationName("migrations/sub/0001_init.sql"), "0001_init.sql");
  assert.equal(migrationName("0001_init.sql"), "0001_init.sql");
});

test("a file already applied from another directory does not re-apply", () => {
  // A database that already recorded the name must not run it twice.
  assert.deepEqual(pendingMigrations(["/migrations/0001_init.sql"], ["0001_init.sql"]), []);
});

test("pending migrations are returned in name order", () => {
  assert.deepEqual(
    pendingMigrations(
      ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql"],
      ["0001_a.sql"],
    ),
    [
      { name: "0002_b.sql", path: "/migrations/0002_b.sql" },
      { name: "0003_c.sql", path: "/migrations/0003_c.sql" },
    ],
  );
});

test("non-.sql entries are dropped (readdir can also yield directories)", () => {
  assert.equal(isMigrationFile("sub"), false);
  assert.deepEqual(pendingMigrations(["sub", "README.md"], []), []);
});

test("a subdirectory of migrations/ is not globbed", () => {
  // Its own migrations directory with a known set of files, so this tests the
  // function and not whatever the real migrations/ folder holds this week.
  const migrationsDir = mkdtempSync(join(tmpdir(), "migrations-"));
  writeFileSync(join(migrationsDir, "0001_a.sql"), "select 1;");
  writeFileSync(join(migrationsDir, "0002_b.sql"), "select 2;");
  mkdirSync(join(migrationsDir, "sub"));
  writeFileSync(join(migrationsDir, "sub", "0001_x.sql"), "select 3;");
  const names = pendingMigrations(readdirSync(migrationsDir), []).map((m) => m.name);
  assert.deepEqual(names, ["0001_a.sql", "0002_b.sql"]);
  assert.ok(readdirSync(join(migrationsDir, "sub")).includes("0001_x.sql"));
});
