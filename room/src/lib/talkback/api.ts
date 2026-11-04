import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  DESK_IDS,
  SEAT_IDS,
  type DeskId,
  type RecipientId,
  type SeatId,
} from "./roles";
import {
  ackInput, createChannelInput, deleteInput, editInput, fileIdInput, heartbeatInput, huddleDeskInput, huddleMuteInput, huddleStartInput,
  kindSchema, mentionsInput, pinInput, reactInput, recapInput, sendInput2, shareFileInput, statusSchema, workflowIdInput, workflowInput,
} from "./inputs";
import * as Store from "./room-store";

const seatSchema = z.enum(SEAT_IDS);
const deskSchema = z.enum(DESK_IDS);
const taskStateSchema = z.enum(["open", "doing", "done", "blocked"]);

export type MessageKind = z.infer<typeof kindSchema>;
export type SeatStatus = z.infer<typeof statusSchema>;
export type TaskState = z.infer<typeof taskStateSchema>;
export type MessageVia = "ui" | "wire";

export type TalkbackMessage = {
  id: number;
  fromSeat: DeskId;
  toSeat: RecipientId | null;
  kind: MessageKind;
  body: string;
  createdAt: string;
  seenBy: DeskId[];
  via: MessageVia;
  // PARITY8E (all present on every message the room returns; optional so older callers still compile)
  channel?: string;
  parentId?: number | null;
  editedAt?: string | null;
  deleted?: boolean;
  pinned?: boolean;
  mentions?: string[];
  reactions?: { emoji: string; desks: string[] }[];
  files?: { id: number; name: string; mime: string; size: number }[];
  replyCount?: number;
};

export type TalkbackPresence = {
  role: DeskId;
  status: SeatStatus;
  lastSeen: string;
  wireStatus: SeatStatus | null;
  wireLastSeen: string | null;
};

export type TalkbackTask = {
  id: number;
  role: SeatId;
  title: string;
  detail: string;
  state: TaskState;
  updatedAt: string;
};

export type WireMeta = {
  desk: DeskId;
  prefix: string;
  lastUsed: string | null;
  createdAt: string;
};

const upsertTaskInput = z.object({
  id: z.number().int().positive().optional(),
  role: seatSchema,
  title: z.string().trim().min(1).max(200),
  detail: z.string().max(1000),
  state: taskStateSchema,
  // The version the person was shown (Assistant's yes). The write is refused if the task changed since.
  expectedUpdatedAt: z.string().optional(),
});

const taskIdInput = z.object({
  id: z.number().int().positive(),
  expectedUpdatedAt: z.string().optional(),
});

const wireDeskInput = z.object({
  desk: deskSchema,
  // null = "no key existed when shown"; a string = the key created at that time; missing = the screen's own button (no check).
  expectedCreatedAt: z.string().nullable().optional(),
});

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function asStatus(value: unknown): SeatStatus {
  if (value === "working" || value === "away" || value === "listening") {
    return value;
  }
  return "listening";
}

export const listMessages = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TalkbackMessage[]> => {
    return (await Store.listMessages(await getSql(), context.userId)) as unknown as TalkbackMessage[];
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => sendInput2.parse(input))
  .handler(async ({ context, data }): Promise<TalkbackMessage> => {
    const made = await Store.insertMessage(await getSql(), context.userId, {
      fromSeat: data.fromSeat, toSeat: data.toSeat, kind: data.kind, body: data.body, via: "ui",
      channel: data.channel ?? null, parentId: data.parentId ?? null,
    });
    return made as unknown as TalkbackMessage;
  });

export const heartbeat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => heartbeatInput.parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into talkback_presence (user_id, role, status, last_seen)
      values (${context.userId}, ${data.role}, ${data.status}, now())
      on conflict (user_id, role)
      do update set status = ${data.status}, last_seen = now()
    `;
    return { ok: true as const };
  });

export const listPresence = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TalkbackPresence[]> => {
    const sql = await getSql();
    const rows = await sql<{
      role: string;
      status: string;
      last_seen: unknown;
      wire_status: string | null;
      wire_last_seen: unknown;
    }>`
      select role, status, last_seen, wire_status, wire_last_seen
      from talkback_presence
      where user_id = ${context.userId}
    `;
    return rows.map((row) => ({
      role: row.role as DeskId,
      status: asStatus(row.status),
      lastSeen: asIso(row.last_seen),
      wireStatus: row.wire_status ? asStatus(row.wire_status) : null,
      wireLastSeen: row.wire_last_seen ? asIso(row.wire_last_seen) : null,
    }));
  });

export const ackMessages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ackInput.parse(input))
  .handler(async ({ context, data }) => {
    if (data.messageIds.length === 0) return { ok: true as const };
    const sql = await getSql();
    for (const id of data.messageIds) {
      await sql`
        insert into talkback_acks (user_id, message_id, desk, seen_at)
        values (${context.userId}, ${id}, ${data.desk}, now())
        on conflict (user_id, message_id, desk) do nothing
      `;
    }
    return { ok: true as const };
  });

export const listTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TalkbackTask[]> => {
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      role: string;
      title: string;
      detail: string;
      state: string;
      updated_at: unknown;
    }>`
      select id, role, title, detail, state, updated_at
      from talkback_tasks
      where user_id = ${context.userId}
      order by id desc
      limit 60
    `;
    return rows.map((row) => ({
      id: row.id,
      role: row.role as SeatId,
      title: row.title,
      detail: row.detail,
      state: (row.state as TaskState) || "open",
      updatedAt: asIso(row.updated_at),
    }));
  });

export const upsertTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => upsertTaskInput.parse(input))
  .handler(async ({ context, data }): Promise<TalkbackTask> => {
    const sql = await getSql();
    if (data.id) {
      const rows = await sql<{
        id: number;
        role: string;
        title: string;
        detail: string;
        state: string;
        updated_at: unknown;
      }>`
        update talkback_tasks
        set title = ${data.title},
            detail = ${data.detail},
            state = ${data.state},
            updated_at = now()
        where id = ${data.id} and user_id = ${context.userId}
          and (${data.expectedUpdatedAt ?? null}::timestamptz is null
               or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${data.expectedUpdatedAt ?? null}::timestamptz))
        returning id, role, title, detail, state, updated_at
      `;
      const row = rows[0];
      if (!row) throw new Error(data.expectedUpdatedAt ? "That task changed since it was shown. Nothing was changed." : "Task not found.");
      return {
        id: row.id,
        role: row.role as SeatId,
        title: row.title,
        detail: row.detail,
        state: (row.state as TaskState) || "open",
        updatedAt: asIso(row.updated_at),
      };
    }
    const rows = await sql<{
      id: number;
      role: string;
      title: string;
      detail: string;
      state: string;
      updated_at: unknown;
    }>`
      insert into talkback_tasks (user_id, role, title, detail, state)
      values (${context.userId}, ${data.role}, ${data.title}, ${data.detail}, ${data.state})
      returning id, role, title, detail, state, updated_at
    `;
    const row = rows[0];
    return {
      id: row.id,
      role: row.role as SeatId,
      title: row.title,
      detail: row.detail,
      state: (row.state as TaskState) || "open",
      updatedAt: asIso(row.updated_at),
    };
  });

export const closeTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => taskIdInput.parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{ id: number }>`
      update talkback_tasks
      set state = 'done', updated_at = now()
      where id = ${data.id} and user_id = ${context.userId}
        and (${data.expectedUpdatedAt ?? null}::timestamptz is null
             or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${data.expectedUpdatedAt ?? null}::timestamptz))
      returning id
    `;
    if (data.expectedUpdatedAt && rows.length === 0) throw new Error("That task changed since it was shown. Nothing was changed.");
    return { ok: true as const };
  });

export const listWires = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WireMeta[]> => {
    const sql = await getSql();
    const rows = await sql<{
      desk: string;
      token_prefix: string;
      last_used: unknown;
      created_at: unknown;
    }>`
      select desk, token_prefix, last_used, created_at
      from talkback_tokens
      where user_id = ${context.userId}
    `;
    return rows.map((row) => ({
      desk: row.desk as DeskId,
      prefix: row.token_prefix,
      lastUsed: row.last_used ? asIso(row.last_used) : null,
      createdAt: asIso(row.created_at),
    }));
  });

export const issueWireToken = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => wireDeskInput.parse(input))
  .handler(
    async ({
      context,
      data,
    }): Promise<{ desk: DeskId; token: string; prefix: string }> => {
      const { mintToken } = await import("./token.server");
      const minted = mintToken();
      const sql = await getSql();
      if (data.expectedCreatedAt !== undefined) {
        const cur = await sql<{ created_at: unknown }>`
          select created_at from talkback_tokens where user_id = ${context.userId} and desk = ${data.desk}
        `;
        const have = cur[0] ? asIso(cur[0].created_at) : null;
        const want = data.expectedCreatedAt;
        const same = want === null ? have === null : have !== null && Math.abs(Date.parse(have) - Date.parse(want)) < 2;
        if (!same) throw new Error("That wire key changed since it was shown. Nothing was changed.");
      }
      await sql`
        delete from talkback_tokens
        where user_id = ${context.userId} and desk = ${data.desk}
      `;
      await sql`
        insert into talkback_tokens (user_id, desk, token_hash, token_prefix)
        values (${context.userId}, ${data.desk}, ${minted.hash}, ${minted.prefix})
      `;
      return {
        desk: data.desk,
        token: minted.token,
        prefix: minted.prefix,
      };
    },
  );

export const revokeWireToken = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => wireDeskInput.parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
      if (data.expectedCreatedAt !== undefined) {
        const cur = await sql<{ created_at: unknown }>`
          select created_at from talkback_tokens where user_id = ${context.userId} and desk = ${data.desk}
        `;
        const have = cur[0] ? asIso(cur[0].created_at) : null;
        const want = data.expectedCreatedAt;
        const same = want === null ? have === null : have !== null && Math.abs(Date.parse(have) - Date.parse(want)) < 2;
        if (!same) throw new Error("That wire key changed since it was shown. Nothing was changed.");
      }
    await sql`
      delete from talkback_tokens
      where user_id = ${context.userId} and desk = ${data.desk}
    `;
    return { ok: true as const };
  });

// ---------- PARITY8E: channels, threads, edit/delete, pins, reactions, mentions, files, huddles, recap, workflows ----------
// Each is one thin door onto room-store.ts, keyed by the signed-in account. The screen's controls and Assistant's tools both come here.
export const listChannels = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => Store.listChannels(await getSql(), context.userId));

export const createChannel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => createChannelInput.parse(input))
  .handler(async ({ context, data }) => Store.createChannel(await getSql(), context.userId, data));

export const editMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => editInput.parse(input))
  .handler(async ({ context, data }) => Store.editMessage(await getSql(), context.userId, data));

export const deleteMessage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => deleteInput.parse(input))
  .handler(async ({ context, data }) => Store.deleteMessage(await getSql(), context.userId, data));

export const setPinned = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => pinInput.parse(input))
  .handler(async ({ context, data }) => Store.setPinned(await getSql(), context.userId, data));

export const listPins = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => Store.listPins(await getSql(), context.userId));

export const toggleReaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => reactInput.parse(input))
  .handler(async ({ context, data }) => Store.toggleReaction(await getSql(), context.userId, data));

export const listMentions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => mentionsInput.parse(input))
  .handler(async ({ context, data }) => Store.listMentions(await getSql(), context.userId, data.desk));

export const shareFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => shareFileInput.parse(input))
  .handler(async ({ context, data }) => Store.shareFile(await getSql(), context.userId, data));

export const getFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => fileIdInput.parse(input))
  .handler(async ({ context, data }) => Store.getFile(await getSql(), context.userId, data.id));

export const listHuddles = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => Store.listHuddles(await getSql(), context.userId));

// The room's existing authenticated owner is its company namespace. Never take it from a form.
export const huddleCallContext = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => huddleDeskInput.parse(data))
  .handler(async ({ context, data }) => {
    const huddle = (await Store.listHuddles(await getSql(), context.userId)).find(h => h.id === data.huddleId);
    if (!huddle?.members.some(m => m.desk === data.desk)) throw new Error('Join the huddle first.');
    return { company: context.userId, callId: String(huddle.id) };
  });

export const startHuddle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => huddleStartInput.parse(input))
  .handler(async ({ context, data }) => Store.startHuddle(await getSql(), context.userId, data));

export const joinHuddle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => huddleDeskInput.parse(input))
  .handler(async ({ context, data }) => Store.joinHuddle(await getSql(), context.userId, data));

export const leaveHuddle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => huddleDeskInput.parse(input))
  .handler(async ({ context, data }) => Store.leaveHuddle(await getSql(), context.userId, data));

export const endHuddle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => huddleDeskInput.parse(input))
  .handler(async ({ context, data }) => Store.endHuddle(await getSql(), context.userId, data));

export const setHuddleMute = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => huddleMuteInput.parse(input))
  .handler(async ({ context, data }) => Store.setHuddleMute(await getSql(), context.userId, data));

export const getRecap = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => recapInput.parse(input))
  .handler(async ({ context, data }) => Store.recap(await getSql(), context.userId, data));

export const listWorkflows = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => Store.listWorkflows(await getSql(), context.userId));

export const saveWorkflow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => workflowInput.parse(input))
  .handler(async ({ context, data }) => Store.saveWorkflow(await getSql(), context.userId, data));

export const deleteWorkflow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => workflowIdInput.parse(input))
  .handler(async ({ context, data }) => Store.deleteWorkflow(await getSql(), context.userId, data));
