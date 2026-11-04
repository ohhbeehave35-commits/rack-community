// Test support only: an in-memory PGLite with every migration applied, behind the same tagged-template `sql` the room uses.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./room-store.ts";

export async function testDb(): Promise<{ sql: Sql; close: () => Promise<void> }> {
  const pg = new PGlite();
  await pg.waitReady;
  const dir = join(process.cwd(), "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await pg.exec(readFileSync(join(dir, f), "utf8"));
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1];
    const r = await pg.query(text, values as never[]);
    return r.rows as never[];
  }) as unknown as Sql;
  return { sql, close: () => pg.close() };
}
