import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isMigrationFile, migrationName, pendingMigrations } from "./migration-plan.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = () => fileURLToPath(new URL("..", import.meta.url));

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

test("this workspace ships its ordered migration set", () => {
  // Assert the shipped, ordered set. (Add/rename/remove a migration and this bites.)
  const migrationsDir = join(projectRoot(), "migrations");
  const names = pendingMigrations(readdirSync(migrationsDir), []).map((m) => m.name);
  assert.deepEqual(names, [
    "0002_talkback.sql",
    "0003_floor.sql",
    "0004_wire.sql",
    "0005_via.sql",
    "0006_parity8e.sql",
    "0007_reaction_order.sql",
  ]);
});
