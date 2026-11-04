import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { IMPORT_ITEMS_MAX, TOO_MANY_ITEMS_WORDS, userDataRefusal } from "./limits";

/**
 * Per-user data persistence for panel state (locked projects, snapshots, etc.).
 *
 * Every function is behind `authMiddleware` and scoped to `context.userId`.
 * Signed out = 401 before the handler runs, the client catches and stays
 * local-only. The table is `somnus_user_data (user_id, kind, key, payload,
 * version, updated_at)` with a unique constraint on `(user_id, kind, key)`.
 *
 * `payload` is transported as a JSON string for TanStack serialization safety.
 * The server stores it as JSONB.
 */

export interface UserDataRow {
  kind: string;
  key: string;
  payload: string;
  version: number;
  updatedAt: string;
}

export const listUserData = createServerFn({ method: "GET" })
  .validator((d: { kind: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<UserDataRow[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      kind: string;
      key: string;
      payload: string;
      version: number;
      updated_at: string;
    }>`
      select kind, key, payload::text, version, updated_at
      from somnus_user_data
      where user_id = ${context.userId} and kind = ${data.kind}
      order by updated_at desc
    `;
    return rows.map((r) => ({
      kind: r.kind,
      key: r.key,
      payload: typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload),
      version: r.version,
      updatedAt: String(r.updated_at),
    }));
  });

export const getUserData = createServerFn({ method: "GET" })
  .validator((d: { kind: string; key: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<UserDataRow | null> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      kind: string;
      key: string;
      payload: string;
      version: number;
      updated_at: string;
    }>`
      select kind, key, payload::text, version, updated_at
      from somnus_user_data
      where user_id = ${context.userId} and kind = ${data.kind} and key = ${data.key}
    `;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      kind: r.kind,
      key: r.key,
      payload: typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload),
      version: r.version,
      updatedAt: String(r.updated_at),
    };
  });

export type PutResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; serverVersion: number; serverPayload: string };

export const putUserData = createServerFn({ method: "POST" })
  .validator((d: { kind: string; key: string; payload: string; expectedVersion?: number }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<PutResult> => {
    // A record has a size and a shape (limits.ts); refused in plain words.
    const refused = userDataRefusal(data.kind, data.key, data.payload);
    if (refused) throw new Error(refused);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const userId = context.userId;

    if (data.expectedVersion != null) {
      const existing = await sql<{ version: number; payload: string }>`
        select version, payload::text from somnus_user_data
        where user_id = ${userId} and kind = ${data.kind} and key = ${data.key}
      `;
      if (existing.length > 0 && existing[0].version > data.expectedVersion) {
        return {
          ok: false,
          conflict: true,
          serverVersion: existing[0].version,
          serverPayload: typeof existing[0].payload === "string"
            ? existing[0].payload
            : JSON.stringify(existing[0].payload),
        };
      }
    }

    const rows = await sql<{ version: number }>`
      insert into somnus_user_data (user_id, kind, key, payload, version, updated_at)
      values (${userId}, ${data.kind}, ${data.key}, ${data.payload}::jsonb, 1, now())
      on conflict (user_id, kind, key) do update set
        payload = ${data.payload}::jsonb,
        version = somnus_user_data.version + 1,
        updated_at = now()
      returning version
    `;
    return { ok: true, version: rows[0].version };
  });

export const deleteUserData = createServerFn({ method: "POST" })
  .validator((d: { kind: string; key: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      delete from somnus_user_data
      where user_id = ${context.userId} and kind = ${data.kind} and key = ${data.key}
    `;
    return { ok: true };
  });

export const listAllUserDataKinds = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ kind: string; count: number }[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ kind: string; count: number }>`
      select kind, count(*)::int as count
      from somnus_user_data
      where user_id = ${context.userId}
      group by kind
      order by kind
    `;
    return rows;
  });

export const importUserData = createServerFn({ method: "POST" })
  .validator((d: { items: { kind: string; key: string; payload: string }[] }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ imported: number; skipped: number }> => {
    // Bounded (limits.ts): at most IMPORT_ITEMS_MAX records, each a sized JSON record.
    if (!Array.isArray(data.items)) throw new Error(TOO_MANY_ITEMS_WORDS);
    if (data.items.length > IMPORT_ITEMS_MAX) throw new Error(TOO_MANY_ITEMS_WORDS);
    for (const item of data.items) {
      const refused = userDataRefusal(item?.kind, item?.key, item?.payload);
      if (refused) throw new Error(refused);
    }
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const userId = context.userId;

    let imported = 0;
    let skipped = 0;
    for (const item of data.items) {
      const existing = await sql<{ key: string }>`
        select key from somnus_user_data
        where user_id = ${userId} and kind = ${item.kind} and key = ${item.key}
      `;
      if (existing.length > 0) {
        skipped++;
        continue;
      }
      await sql`
        insert into somnus_user_data (user_id, kind, key, payload, version, updated_at)
        values (${userId}, ${item.kind}, ${item.key}, ${item.payload}::jsonb, 1, now())
        on conflict (user_id, kind, key) do nothing
      `;
      imported++;
    }
    return { imported, skipped };
  });
