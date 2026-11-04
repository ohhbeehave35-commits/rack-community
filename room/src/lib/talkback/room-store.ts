/**
 * PARITY8E: the room's database work for channels, threads, edit/delete, pins, mentions, reactions, files, huddles and workflows.
 * Every function takes the tagged-template `sql` (Neon or PGLite) and the signed-in account's id, and every query is keyed by that id,
 * so one account can never reach another's rows. api.ts, the wire and Assistant's tools all call these same functions.
 * Imports only relative paths so a plain node test can run it against an in-memory PGLite.
 */
import {
  EMOJI_KEYS, buildRecap, normalizeChannel, parseMentions, planWorkflowActions, validateWorkflow,
  type PlannedAction, type RecapMessage, type WorkflowRow,
} from "./room-logic.ts";

type Row = Record<string, any>;
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

export const MAX_FILE_BYTES = 1_572_864; // 1.5 MB
const MAX_CHANNELS = 30;
const MAX_WORKFLOWS = 20;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : new Date().toISOString());
const isoOrNull = (v: unknown): string | null => (v ? iso(v) : null);
const splitMentions = (v: unknown): string[] => (typeof v === "string" && v ? v.split(",") : []);

export type FileMeta = { id: number; name: string; mime: string; size: number };
export type Reaction = { emoji: string; desks: string[] };
export type RoomMessage = {
  id: number; fromSeat: string; toSeat: string | null; kind: string; body: string; createdAt: string; seenBy: string[]; via: string;
  channel: string; parentId: number | null; editedAt: string | null; deleted: boolean; pinned: boolean; mentions: string[];
  reactions: Reaction[]; files: FileMeta[]; replyCount: number;
};

function shape(r: Row, extra: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id: r.id, fromSeat: r.from_seat, toSeat: r.to_seat ?? null, kind: r.kind || "chat", body: r.body, createdAt: iso(r.created_at), seenBy: [],
    via: r.via === "wire" ? "wire" : r.via === "workflow" ? "workflow" : "ui", channel: r.channel || "general", parentId: r.parent_id ?? null,
    editedAt: isoOrNull(r.edited_at), deleted: !!r.deleted_at, pinned: !!r.pinned_at, mentions: splitMentions(r.mentions), reactions: [], files: [], replyCount: 0,
    ...extra,
  };
}

const none = (what: string, id: number) => new Error(`There is no ${what} ${id}.`);

async function getMessageRow(sql: Sql, userId: string, id: number): Promise<Row> {
  const rows = await sql`select * from talkback_messages where id = ${id} and user_id = ${userId}`;
  if (!rows[0]) throw new Error(`There is no message ${id}.`);
  return rows[0];
}

// ---------- channels ----------
export type ChannelInfo = { name: string; topic: string; messages: number; lastId: number };

export async function listChannels(sql: Sql, userId: string): Promise<ChannelInfo[]> {
  const made = await sql`select name, topic from talkback_channels where user_id = ${userId} order by created_at, name`;
  const counts = await sql`select channel, count(*)::int as n, max(id)::int as last from talkback_messages where user_id = ${userId} and deleted_at is null and kind = 'chat' group by channel`;
  const by = new Map(counts.map((c) => [c.channel as string, c]));
  const out: ChannelInfo[] = [{ name: "general", topic: "Everyone", messages: by.get("general")?.n ?? 0, lastId: by.get("general")?.last ?? 0 }];
  for (const c of made) out.push({ name: c.name, topic: c.topic, messages: by.get(c.name)?.n ?? 0, lastId: by.get(c.name)?.last ?? 0 });
  return out;
}

export async function createChannel(sql: Sql, userId: string, input: { name: string; topic: string }): Promise<ChannelInfo> {
  const name = normalizeChannel(input.name);
  const topic = input.topic.trim().slice(0, 120);
  const have = await listChannels(sql, userId);
  if (have.some((c) => c.name === name)) throw new Error(`There is already a channel #${name}.`);
  if (have.length >= MAX_CHANNELS) throw new Error(`A room can have at most ${MAX_CHANNELS} channels.`);
  await sql`insert into talkback_channels (user_id, name, topic) values (${userId}, ${name}, ${topic})`;
  return { name, topic, messages: 0, lastId: 0 };
}

// ---------- messages ----------
export type NewMessage = {
  fromSeat: string; toSeat: string | null; kind: string; body: string; via: "ui" | "wire" | "workflow";
  channel?: string | null; parentId?: number | null;
};

export async function insertMessage(sql: Sql, userId: string, m: NewMessage): Promise<RoomMessage> {
  const body = m.body.trim();
  if (m.kind === "chat" && !body) throw new Error("Say something first.");
  let channel = "general";
  let parentId: number | null = null;
  if (m.parentId) {
    const parent = await getMessageRow(sql, userId, m.parentId);
    parentId = parent.parent_id ?? parent.id; // one level of thread: a reply to a reply hangs under the root
    channel = parent.channel || "general";
  } else if (m.channel) {
    channel = normalizeChannel(m.channel);
    if (channel !== "general") {
      const ok = await sql`select 1 as x from talkback_channels where user_id = ${userId} and name = ${channel}`;
      if (!ok[0]) throw new Error(`There is no channel #${channel}. Make it first.`);
    }
  }
  const mentions = parseMentions(body);
  const rows = await sql`
    insert into talkback_messages (user_id, from_seat, to_seat, kind, body, via, channel, parent_id, mentions)
    values (${userId}, ${m.fromSeat}, ${m.toSeat}, ${m.kind}, ${body}, ${m.via}, ${channel}, ${parentId}, ${mentions.join(",")})
    returning *`;
  const made = shape(rows[0], { seenBy: [m.fromSeat] });
  if (m.via !== "workflow" && m.kind === "chat") await runWorkflows(sql, userId, made);
  return made;
}

async function runWorkflows(sql: Sql, userId: string, msg: RoomMessage): Promise<void> {
  const wfs = await listWorkflows(sql, userId);
  if (!wfs.some((w) => w.enabled)) return;
  const plan: PlannedAction[] = planWorkflowActions(wfs, { id: msg.id, fromSeat: msg.fromSeat, toSeat: msg.toSeat, kind: msg.kind, body: msg.body, channel: msg.channel, mentions: msg.mentions, via: msg.via });
  for (const a of plan) {
    if (a.type === "message") await insertMessage(sql, userId, { fromSeat: a.fromSeat, toSeat: null, kind: "chat", body: a.body, via: "workflow", channel: a.channel, parentId: a.parentId });
    else await sql`insert into talkback_tasks (user_id, role, title, detail, state) values (${userId}, ${a.role}, ${a.title}, ${"Made by a workflow."}, ${"open"})`;
    await sql`update talkback_workflows set runs = runs + 1 where id = ${a.workflowId} and user_id = ${userId}`;
  }
}

export async function listMessages(sql: Sql, userId: string): Promise<RoomMessage[]> {
  const rows = (await sql`select * from talkback_messages where user_id = ${userId} order by id desc limit 300`).reverse();
  if (!rows.length) return [];
  const minId = rows[0].id as number;
  const acks = await sql`select message_id, desk from talkback_acks where user_id = ${userId}`;
  const reacts = await sql`select message_id, desk, emoji from talkback_reactions where user_id = ${userId} and message_id >= ${minId} order by created_at, seq`;
  const files = await sql`select id, message_id, name, mime, size from talkback_files where user_id = ${userId} and message_id >= ${minId} order by id`;
  const kids = await sql`select parent_id, count(*)::int as n from talkback_messages where user_id = ${userId} and parent_id is not null and deleted_at is null group by parent_id`;
  const seen = new Map<number, string[]>();
  for (const a of acks) seen.set(a.message_id, [...(seen.get(a.message_id) ?? []), a.desk]);
  const reactBy = new Map<number, Reaction[]>();
  for (const r of reacts) {
    const list = reactBy.get(r.message_id) ?? [];
    const hit = list.find((x) => x.emoji === r.emoji);
    if (hit) hit.desks.push(r.desk);
    else list.push({ emoji: r.emoji, desks: [r.desk] });
    reactBy.set(r.message_id, list);
  }
  const fileBy = new Map<number, FileMeta[]>();
  for (const f of files) fileBy.set(f.message_id, [...(fileBy.get(f.message_id) ?? []), { id: f.id, name: f.name, mime: f.mime, size: f.size }]);
  const kidBy = new Map<number, number>(kids.map((k) => [k.parent_id as number, k.n as number]));
  return rows.map((r) => shape(r, { seenBy: seen.get(r.id) ?? [], reactions: reactBy.get(r.id) ?? [], files: fileBy.get(r.id) ?? [], replyCount: kidBy.get(r.id) ?? 0 }));
}

export async function editMessage(sql: Sql, userId: string, input: { id: number; desk: string; body: string }): Promise<RoomMessage> {
  const row = await getMessageRow(sql, userId, input.id);
  if (row.deleted_at) throw new Error("That message was deleted, so it cannot be edited.");
  if (row.from_seat !== input.desk) throw new Error("You can only edit your own messages.");
  const body = input.body.trim();
  if (!body) throw new Error("Say something first.");
  if (body.length > 2000) throw new Error("A message can be at most 2000 characters.");
  const rows = await sql`update talkback_messages set body = ${body}, mentions = ${parseMentions(body).join(",")}, edited_at = now() where id = ${input.id} and user_id = ${userId} returning *`;
  return shape(rows[0]);
}

export async function deleteMessage(sql: Sql, userId: string, input: { id: number; desk: string }): Promise<{ ok: true }> {
  const row = await getMessageRow(sql, userId, input.id);
  if (row.deleted_at) return { ok: true };
  if (row.from_seat !== input.desk && input.desk !== "floor") throw new Error("You can only delete your own messages (the Floor can delete any).");
  await sql`update talkback_messages set body = '', mentions = '', deleted_at = now(), pinned_at = null where id = ${input.id} and user_id = ${userId}`;
  await sql`delete from talkback_reactions where user_id = ${userId} and message_id = ${input.id}`;
  await sql`delete from talkback_files where user_id = ${userId} and message_id = ${input.id}`;
  return { ok: true };
}

export async function setPinned(sql: Sql, userId: string, input: { id: number; desk: string; pinned: boolean }): Promise<{ ok: true; pinned: boolean }> {
  const row = await getMessageRow(sql, userId, input.id);
  if (row.deleted_at) throw new Error("That message was deleted, so it cannot be pinned.");
  if (input.pinned) await sql`update talkback_messages set pinned_at = now() where id = ${input.id} and user_id = ${userId}`;
  else await sql`update talkback_messages set pinned_at = null where id = ${input.id} and user_id = ${userId}`;
  return { ok: true, pinned: input.pinned };
}

export async function listPins(sql: Sql, userId: string): Promise<RoomMessage[]> {
  const rows = await sql`select * from talkback_messages where user_id = ${userId} and pinned_at is not null and deleted_at is null order by pinned_at desc, id desc limit 50`;
  return rows.map((r) => shape(r));
}

// ---------- reactions ----------
export async function toggleReaction(sql: Sql, userId: string, input: { messageId: number; desk: string; emoji: string }): Promise<{ on: boolean }> {
  if (!(EMOJI_KEYS as readonly string[]).includes(input.emoji)) throw new Error(`That reaction is not on the list: ${EMOJI_KEYS.join(", ")}.`);
  const row = await getMessageRow(sql, userId, input.messageId);
  if (row.deleted_at) throw new Error(`There is no message ${input.messageId}.`);
  const had = await sql`delete from talkback_reactions where user_id = ${userId} and message_id = ${input.messageId} and desk = ${input.desk} and emoji = ${input.emoji} returning 1 as x`;
  if (had[0]) return { on: false };
  await sql`insert into talkback_reactions (user_id, message_id, desk, emoji) values (${userId}, ${input.messageId}, ${input.desk}, ${input.emoji})`;
  return { on: true };
}

// ---------- mentions ----------
export type MentionRow = { id: number; fromSeat: string; body: string; channel: string; createdAt: string; unread: boolean };
export async function listMentions(sql: Sql, userId: string, desk: string): Promise<MentionRow[]> {
  const pattern = `%,${desk},%`;
  const rows = await sql`
    select m.id, m.from_seat, m.body, m.channel, m.created_at, (a.desk is null) as unread
    from talkback_messages m
    left join talkback_acks a on a.user_id = m.user_id and a.message_id = m.id and a.desk = ${desk}
    where m.user_id = ${userId} and m.deleted_at is null and m.from_seat <> ${desk} and (',' || m.mentions || ',') like ${pattern}
    order by m.id desc limit 50`;
  return rows.map((r) => ({ id: r.id, fromSeat: r.from_seat, body: r.body, channel: r.channel, createdAt: iso(r.created_at), unread: !!r.unread }));
}

// ---------- files ----------
function cleanName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const n = base.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "").replace(/^\.+/, "").slice(0, 80);
  return n || "file";
}

export async function shareFile(sql: Sql, userId: string, input: { fromSeat: string; toSeat: string | null; channel: string | null; name: string; mime: string; dataBase64: string; note: string }): Promise<{ message: RoomMessage; file: FileMeta }> {
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.length === 0) throw new Error("That file is empty.");
  if (bytes.length > MAX_FILE_BYTES) throw new Error("A file can be at most 1.5 MB.");
  const name = cleanName(input.name);
  const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(input.mime) ? input.mime.toLowerCase() : "application/octet-stream";
  const message = await insertMessage(sql, userId, { fromSeat: input.fromSeat, toSeat: input.toSeat, kind: "chat", body: input.note.trim() || `Shared ${name}`, via: "ui", channel: input.channel });
  const rows = await sql`insert into talkback_files (user_id, message_id, name, mime, size, data, uploaded_by) values (${userId}, ${message.id}, ${name}, ${mime}, ${bytes.length}, ${bytes.toString("base64")}, ${input.fromSeat}) returning id`;
  const file = { id: rows[0].id as number, name, mime, size: bytes.length };
  message.files = [file];
  return { message, file };
}

export async function getFile(sql: Sql, userId: string, id: number): Promise<FileMeta & { dataBase64: string }> {
  const rows = await sql`select id, name, mime, size, data from talkback_files where id = ${id} and user_id = ${userId}`;
  if (!rows[0]) throw new Error(`There is no file ${id}.`);
  return { id: rows[0].id, name: rows[0].name, mime: rows[0].mime, size: rows[0].size, dataBase64: rows[0].data };
}

// ---------- huddles ----------
export type HuddleInfo = { id: number; channel: string; startedBy: string; startedAt: string; members: { desk: string; muted: boolean }[] };

export async function listHuddles(sql: Sql, userId: string): Promise<HuddleInfo[]> {
  const hs = await sql`select id, channel, started_by, started_at from talkback_huddles where user_id = ${userId} and ended_at is null order by id`;
  const ms = await sql`select huddle_id, desk, muted from talkback_huddle_members where user_id = ${userId} and left_at is null order by joined_at, desk`;
  return hs.map((h) => ({ id: h.id, channel: h.channel, startedBy: h.started_by, startedAt: iso(h.started_at), members: ms.filter((m) => m.huddle_id === h.id).map((m) => ({ desk: m.desk, muted: !!m.muted })) }));
}

async function openHuddle(sql: Sql, userId: string, id: number): Promise<Row> {
  const rows = await sql`select * from talkback_huddles where id = ${id} and user_id = ${userId}`;
  if (!rows[0]) throw new Error(`There is no huddle ${id}.`);
  if (rows[0].ended_at) throw new Error("That huddle already ended.");
  return rows[0];
}

export async function startHuddle(sql: Sql, userId: string, input: { desk: string; channel: string }): Promise<HuddleInfo> {
  const channel = normalizeChannel(input.channel || "general");
  if (channel !== "general") {
    const ok = await sql`select 1 as x from talkback_channels where user_id = ${userId} and name = ${channel}`;
    if (!ok[0]) throw new Error(`There is no channel #${channel}. Make it first.`);
  }
  const open = await sql`select id from talkback_huddles where user_id = ${userId} and channel = ${channel} and ended_at is null`;
  if (open[0]) throw new Error(`There is already a huddle in #${channel}. Join it instead.`);
  const rows = await sql`insert into talkback_huddles (user_id, channel, started_by) values (${userId}, ${channel}, ${input.desk}) returning id`;
  await sql`insert into talkback_huddle_members (huddle_id, user_id, desk) values (${rows[0].id}, ${userId}, ${input.desk})`;
  await insertMessage(sql, userId, { fromSeat: input.desk, toSeat: null, kind: "status", body: `${input.desk} started a huddle in #${channel}.`, via: "ui", channel });
  return (await listHuddles(sql, userId)).find((h) => h.id === rows[0].id)!;
}

export async function joinHuddle(sql: Sql, userId: string, input: { huddleId: number; desk: string }): Promise<{ ok: true }> {
  await openHuddle(sql, userId, input.huddleId);
  await sql`insert into talkback_huddle_members (huddle_id, user_id, desk) values (${input.huddleId}, ${userId}, ${input.desk})
    on conflict (huddle_id, desk) do update set left_at = null, muted = false, joined_at = now()`;
  return { ok: true };
}

async function endNow(sql: Sql, userId: string, h: Row, desk: string): Promise<void> {
  await sql`update talkback_huddles set ended_at = now() where id = ${h.id} and user_id = ${userId}`;
  await sql`update talkback_huddle_members set left_at = now() where huddle_id = ${h.id} and user_id = ${userId} and left_at is null`;
  await insertMessage(sql, userId, { fromSeat: desk, toSeat: null, kind: "status", body: `The huddle in #${h.channel} ended.`, via: "ui", channel: h.channel });
}

export async function leaveHuddle(sql: Sql, userId: string, input: { huddleId: number; desk: string }): Promise<{ ok: true; ended: boolean }> {
  const h = await openHuddle(sql, userId, input.huddleId);
  await sql`update talkback_huddle_members set left_at = now() where huddle_id = ${input.huddleId} and user_id = ${userId} and desk = ${input.desk} and left_at is null`;
  const left = await sql`select count(*)::int as n from talkback_huddle_members where huddle_id = ${input.huddleId} and user_id = ${userId} and left_at is null`;
  if (left[0].n === 0) { await endNow(sql, userId, h, input.desk); return { ok: true, ended: true }; }
  return { ok: true, ended: false };
}

export async function endHuddle(sql: Sql, userId: string, input: { huddleId: number; desk: string }): Promise<{ ok: true }> {
  const h = await openHuddle(sql, userId, input.huddleId);
  await endNow(sql, userId, h, input.desk);
  return { ok: true };
}

export async function setHuddleMute(sql: Sql, userId: string, input: { huddleId: number; desk: string; muted: boolean }): Promise<{ ok: true }> {
  await openHuddle(sql, userId, input.huddleId);
  const r = await sql`update talkback_huddle_members set muted = ${input.muted} where huddle_id = ${input.huddleId} and user_id = ${userId} and desk = ${input.desk} and left_at is null returning 1 as x`;
  if (!r[0]) throw new Error("Join the huddle first.");
  return { ok: true };
}

// ---------- recap ----------
export async function recap(sql: Sql, userId: string, input: { channel: string | null }) {
  const channel = input.channel ? normalizeChannel(input.channel) : null;
  const rows = (await sql`select * from talkback_messages where user_id = ${userId} and (${channel}::text is null or channel = ${channel}) order by id desc limit 200`).reverse();
  const tasks = await sql`select id, role, title, state from talkback_tasks where user_id = ${userId} order by id desc limit 60`;
  const messages: RecapMessage[] = rows.map((r) => ({ id: r.id, fromSeat: r.from_seat, toSeat: r.to_seat ?? null, kind: r.kind, body: r.body, createdAt: iso(r.created_at), channel: r.channel || "general", mentions: splitMentions(r.mentions), pinned: !!r.pinned_at, deleted: !!r.deleted_at }));
  return buildRecap({ messages, tasks: tasks.map((t) => ({ id: t.id, role: t.role, title: t.title, state: t.state })) });
}

// ---------- workflows ----------
export type WorkflowInfo = WorkflowRow & { runs: number };
const shapeWf = (r: Row): WorkflowInfo => ({ id: r.id, name: r.name, enabled: !!r.enabled, triggerKind: r.trigger_kind, triggerValue: r.trigger_value, actionKind: r.action_kind, actionSeat: r.action_seat, actionText: r.action_text, runs: r.runs });

export async function listWorkflows(sql: Sql, userId: string): Promise<WorkflowInfo[]> {
  return (await sql`select * from talkback_workflows where user_id = ${userId} order by id`).map(shapeWf);
}

export async function saveWorkflow(sql: Sql, userId: string, input: Record<string, unknown> & { id?: number; enabled?: boolean }): Promise<WorkflowInfo> {
  const w = validateWorkflow(input);
  const enabled = input.enabled !== false;
  if (input.id) {
    const rows = await sql`update talkback_workflows set name = ${w.name}, trigger_kind = ${w.triggerKind}, trigger_value = ${w.triggerValue}, action_kind = ${w.actionKind}, action_seat = ${w.actionSeat}, action_text = ${w.actionText}, enabled = ${enabled} where id = ${input.id} and user_id = ${userId} returning *`;
    if (!rows[0]) throw none("workflow", input.id);
    return shapeWf(rows[0]);
  }
  const count = await sql`select count(*)::int as n from talkback_workflows where user_id = ${userId}`;
  if (count[0].n >= MAX_WORKFLOWS) throw new Error(`A room can have at most ${MAX_WORKFLOWS} workflows.`);
  const rows = await sql`insert into talkback_workflows (user_id, name, trigger_kind, trigger_value, action_kind, action_seat, action_text, enabled) values (${userId}, ${w.name}, ${w.triggerKind}, ${w.triggerValue}, ${w.actionKind}, ${w.actionSeat}, ${w.actionText}, ${enabled}) returning *`;
  return shapeWf(rows[0]);
}

export async function deleteWorkflow(sql: Sql, userId: string, input: { id: number }): Promise<{ ok: true }> {
  const rows = await sql`delete from talkback_workflows where id = ${input.id} and user_id = ${userId} returning 1 as x`;
  if (!rows[0]) throw none("workflow", input.id);
  return { ok: true };
}
