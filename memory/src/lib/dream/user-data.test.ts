import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

async function freshDb(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.waitReady;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
  assert.ok(files.includes("0005_user_data.sql"), "expected the migrations to include 0005_user_data.sql");
  for (const name of files) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
  }
  return pg;
}

describe("somnus_user_data", () => {
  describe("tenant boundary", () => {
    it("user B cannot read user A's rows", async () => {
      const pg = await freshDb();
      await pg.query(
        `insert into somnus_user_data (user_id, kind, key, payload)
         values ($1, $2, $3, $4)`,
        ["user-a", "lockedProject", "proj-1", JSON.stringify({ name: "Alpha" })],
      );
      await pg.query(
        `insert into somnus_user_data (user_id, kind, key, payload)
         values ($1, $2, $3, $4)`,
        ["user-b", "lockedProject", "proj-2", JSON.stringify({ name: "Beta" })],
      );

      const aRows = await pg.query(
        `select key, payload from somnus_user_data where user_id = $1 and kind = $2`,
        ["user-a", "lockedProject"],
      );
      assert.equal(aRows.rows.length, 1);
      assert.equal((aRows.rows[0] as { key: string }).key, "proj-1");

      const bRows = await pg.query(
        `select key, payload from somnus_user_data where user_id = $1 and kind = $2`,
        ["user-b", "lockedProject"],
      );
      assert.equal(bRows.rows.length, 1);
      assert.equal((bRows.rows[0] as { key: string }).key, "proj-2");

      const allRows = await pg.query(
        `select * from somnus_user_data where kind = $1`,
        ["lockedProject"],
      );
      assert.equal(allRows.rows.length, 2, "both rows exist in the table");
    });

    it("user B cannot overwrite user A's row via upsert", async () => {
      const pg = await freshDb();
      await pg.query(
        `insert into somnus_user_data (user_id, kind, key, payload)
         values ($1, $2, $3, $4)`,
        ["user-a", "lockedProject", "proj-1", JSON.stringify({ name: "Original" })],
      );

      await pg.query(
        `insert into somnus_user_data (user_id, kind, key, payload, version, updated_at)
         values ($1, $2, $3, $4::jsonb, 1, now())
         on conflict (user_id, kind, key) do update set
           payload = $4::jsonb, version = somnus_user_data.version + 1, updated_at = now()`,
        ["user-b", "lockedProject", "proj-1", JSON.stringify({ name: "Hijack" })],
      );

      const aRow = await pg.query(
        `select payload from somnus_user_data where user_id = $1 and kind = $2 and key = $3`,
        ["user-a", "lockedProject", "proj-1"],
      );
      assert.equal(aRow.rows.length, 1);
      const aPayload = (aRow.rows[0] as { payload: { name: string } }).payload;
      assert.equal(aPayload.name, "Original", "user A's row must not be touched");

      const bRow = await pg.query(
        `select payload from somnus_user_data where user_id = $1 and kind = $2 and key = $3`,
        ["user-b", "lockedProject", "proj-1"],
      );
      assert.equal(bRow.rows.length, 1);
      const bPayload = (bRow.rows[0] as { payload: { name: string } }).payload;
      assert.equal(bPayload.name, "Hijack", "user B gets their own row");
    });
  });

  describe("version tracking", () => {
    it("version increments on upsert", async () => {
      const pg = await freshDb();
      await pg.query(
        `insert into somnus_user_data (user_id, kind, key, payload, version, updated_at)
         values ($1, $2, $3, $4::jsonb, 1, now())
         on conflict (user_id, kind, key) do update set
           payload = excluded.payload, version = somnus_user_data.version + 1, updated_at = now()
         returning version`,
        ["user-a", "lockedProject", "proj-1", JSON.stringify({ v: 1 })],
      );

      const r2 = await pg.query<{ version: number }>(
        `insert into somnus_user_data (user_id, kind, key, payload, version, updated_at)
         values ($1, $2, $3, $4::jsonb, 1, now())
         on conflict (user_id, kind, key) do update set
           payload = excluded.payload, version = somnus_user_data.version + 1, updated_at = now()
         returning version`,
        ["user-a", "lockedProject", "proj-1", JSON.stringify({ v: 2 })],
      );
      assert.equal(r2.rows[0].version, 2);
    });
  });

  describe("import (first-login migration)", () => {
    it("imports items that do not exist yet", async () => {
      const pg = await freshDb();
      const items = [
        { kind: "lockedProject", key: "p1", payload: { name: "First" } },
        { kind: "lockedProject", key: "p2", payload: { name: "Second" } },
        { kind: "snapshot", key: "2026-09-01", payload: { at: "2026-09-01" } },
      ];

      let imported = 0;
      let skipped = 0;
      for (const item of items) {
        const existing = await pg.query(
          `select key from somnus_user_data where user_id = $1 and kind = $2 and key = $3`,
          ["user-a", item.kind, item.key],
        );
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }
        await pg.query(
          `insert into somnus_user_data (user_id, kind, key, payload, version, updated_at)
           values ($1, $2, $3, $4::jsonb, 1, now())
           on conflict (user_id, kind, key) do nothing`,
          ["user-a", item.kind, item.key, JSON.stringify(item.payload)],
        );
        imported++;
      }

      assert.equal(imported, 3);
      assert.equal(skipped, 0);

      const rows = await pg.query(
        `select * from somnus_user_data where user_id = $1`,
        ["user-a"],
      );
      assert.equal(rows.rows.length, 3);
    });

    it("skips items that already exist on the server", async () => {
      const pg = await freshDb();
      await pg.query(
        `insert into somnus_user_data (user_id, kind, key, payload)
         values ($1, $2, $3, $4::jsonb)`,
        ["user-a", "lockedProject", "p1", JSON.stringify({ name: "ServerVersion" })],
      );

      const items = [
        { kind: "lockedProject", key: "p1", payload: { name: "LocalVersion" } },
        { kind: "lockedProject", key: "p2", payload: { name: "New" } },
      ];

      let imported = 0;
      let skipped = 0;
      for (const item of items) {
        const existing = await pg.query(
          `select key from somnus_user_data where user_id = $1 and kind = $2 and key = $3`,
          ["user-a", item.kind, item.key],
        );
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }
        await pg.query(
          `insert into somnus_user_data (user_id, kind, key, payload, version, updated_at)
           values ($1, $2, $3, $4::jsonb, 1, now())
           on conflict (user_id, kind, key) do nothing`,
          ["user-a", item.kind, item.key, JSON.stringify(item.payload)],
        );
        imported++;
      }

      assert.equal(imported, 1);
      assert.equal(skipped, 1);

      const p1 = await pg.query<{ payload: { name: string } }>(
        `select payload from somnus_user_data where user_id = $1 and kind = $2 and key = $3`,
        ["user-a", "lockedProject", "p1"],
      );
      assert.equal((p1.rows[0] as { payload: { name: string } }).payload.name, "ServerVersion", "existing server data must not be overwritten");
    });
  });

  describe("delete", () => {
    it("removes only the targeted row", async () => {
      const pg = await freshDb();
      await pg.query(
        `insert into somnus_user_data (user_id, kind, key, payload)
         values ($1, $2, $3, $4::jsonb)`,
        ["user-a", "lockedProject", "p1", JSON.stringify({ name: "Keep" })],
      );
      await pg.query(
        `insert into somnus_user_data (user_id, kind, key, payload)
         values ($1, $2, $3, $4::jsonb)`,
        ["user-a", "lockedProject", "p2", JSON.stringify({ name: "Delete" })],
      );

      await pg.query(
        `delete from somnus_user_data where user_id = $1 and kind = $2 and key = $3`,
        ["user-a", "lockedProject", "p2"],
      );

      const rows = await pg.query(
        `select key from somnus_user_data where user_id = $1`,
        ["user-a"],
      );
      assert.equal(rows.rows.length, 1);
      assert.equal((rows.rows[0] as { key: string }).key, "p1");
    });
  });
});
