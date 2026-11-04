import { getSql } from "@/lib/db";
import { hashToken } from "./token.server";
import { isRecipientId, type DeskId } from "./roles";
import { visibleOnWire } from "./room-logic";
import { insertMessage } from "./room-store";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export function wirePreflight() {
  return new Response(null, { status: 204, headers: CORS });
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

type WireAuth = { userId: string; desk: DeskId; tokenId: number };

async function resolveAuth(request: Request): Promise<WireAuth | Response> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)/i.exec(header);
  if (!match) return json({ error: "Missing bearer token." }, 401);
  const token = match[1];
  if (!token.startsWith("tb_")) return json({ error: "Invalid token." }, 401);
  const sql = await getSql();
  const rows = await sql<{ id: number; user_id: string; desk: string }>`
    select id, user_id, desk
    from talkback_tokens
    where token_hash = ${hashToken(token)}
    limit 1
  `;
  const row = rows[0];
  if (!row) return json({ error: "Invalid token." }, 401);
  await sql`
    update talkback_tokens set last_used = now() where id = ${row.id}
  `;
  return {
    userId: row.user_id,
    desk: row.desk as DeskId,
    tokenId: row.id,
  };
}

function asVia(value: unknown) {
  return value === "wire" ? "wire" : "ui";
}

async function loadMessages(userId: string, desk: DeskId, since: number) {
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    from_seat: string;
    to_seat: string | null;
    kind: string;
    body: string;
    created_at: unknown;
    via: string | null;
    channel: string | null;
    parent_id: number | null;
    mentions: string | null;
    deleted_at: unknown;
  }>`
    select id, from_seat, to_seat, kind, body, created_at, via, channel, parent_id, mentions, deleted_at
    from talkback_messages
    where user_id = ${userId} and id > ${since}
    order by id asc
    limit 80
  `;
  const mapped = rows.map((row) => ({
    id: row.id,
    from: row.from_seat,
    to: row.to_seat,
    kind: row.kind,
    body: row.body,
    via: asVia(row.via),
    at: asIso(row.created_at),
    channel: row.channel || "general",
    parent: row.parent_id ?? null,
    mentions: row.mentions ? row.mentions.split(",") : [],
    deleted: !!row.deleted_at,
  }));
  return mapped.filter((m) => visibleOnWire(m, desk));
}

async function loadTasks(userId: string, desk: DeskId) {
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    role: string;
    title: string;
    detail: string;
    state: string;
  }>`
    select id, role, title, detail, state
    from talkback_tasks
    where user_id = ${userId} and state <> 'done'
    order by id desc
    limit 40
  `;
  const mapped = rows.map((row) => ({
    id: row.id,
    role: row.role,
    title: row.title,
    detail: row.detail,
    state: row.state,
  }));
  if (desk === "floor") return mapped;
  return mapped.filter((t) => t.role === desk);
}

async function loadPresence(userId: string) {
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
    where user_id = ${userId}
  `;
  return rows.map((row) => ({
    desk: row.role,
    status: row.status,
    lastSeen: asIso(row.last_seen),
    wireStatus: row.wire_status,
    wireLastSeen: row.wire_last_seen ? asIso(row.wire_last_seen) : null,
  }));
}

async function inbox(auth: WireAuth, url: URL) {
  const since = Number(url.searchParams.get("since") ?? "0");
  const cursorSince = Number.isFinite(since) && since >= 0 ? Math.floor(since) : 0;
  const messages = await loadMessages(auth.userId, auth.desk, cursorSince);
  const tasks = await loadTasks(auth.userId, auth.desk);
  const presence = await loadPresence(auth.userId);
  const cursor = messages.length > 0 ? messages[messages.length - 1].id : cursorSince;
  return json({
    desk: auth.desk,
    cursor,
    messages,
    tasks,
    presence,
  });
}

async function snapshot(auth: WireAuth) {
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    from_seat: string;
    to_seat: string | null;
    kind: string;
    body: string;
    created_at: unknown;
    via: string | null;
    channel: string | null;
    parent_id: number | null;
  }>`
    select id, from_seat, to_seat, kind, body, created_at, via, channel, parent_id
    from talkback_messages
    where user_id = ${auth.userId}
    order by id desc
    limit 80
  `;
  const tape = rows
    .slice()
    .reverse()
    .map((row) => ({
      id: row.id,
      from: row.from_seat,
      to: row.to_seat,
      kind: row.kind,
      body: row.body,
      via: asVia(row.via),
      at: asIso(row.created_at),
      channel: row.channel || "general",
      parent: row.parent_id ?? null,
    }));
  const wires = await sql<{
    desk: string;
    token_prefix: string;
    last_used: unknown;
  }>`
    select desk, token_prefix, last_used
    from talkback_tokens
    where user_id = ${auth.userId}
  `;
  return json({
    desk: auth.desk,
    tape,
    tasks: await loadTasks(auth.userId, auth.desk),
    presence: await loadPresence(auth.userId),
    wires: wires.map((row) => ({
      desk: row.desk,
      prefix: row.token_prefix,
      lastUsed: row.last_used ? asIso(row.last_used) : null,
    })),
  });
}

async function send(auth: WireAuth, request: Request) {
  if (auth.desk === "floor") {
    return json({ error: "Floor watches. It does not speak as a desk." }, 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected JSON." }, 400);
  }
  const rec = body as { to?: unknown; kind?: unknown; body?: unknown; channel?: unknown; parent?: unknown };
  const kind = rec.kind === "nudge" ? "nudge" : rec.kind === "chat" ? "chat" : null;
  if (!kind) return json({ error: "kind must be chat or nudge." }, 400);
  const text = typeof rec.body === "string" ? rec.body.trim() : "";
  if (kind === "chat" && !text) return json({ error: "Say something first." }, 400);
  if (text.length > 2000) return json({ error: "Message too long." }, 400);
  let toSeat: string | null = null;
  if (rec.to === "all" || rec.to === null || rec.to === undefined) {
    toSeat = null;
  } else if (typeof rec.to === "string" && isRecipientId(rec.to)) {
    toSeat = rec.to;
  } else {
    return json({ error: "to must be lead, builder, reviewer, grok, assistant, or all." }, 400);
  }
  const sql = await getSql();
  const payload =
    kind === "nudge" && !text ? `${auth.desk} needs you on the line.` : text;
  const channel = typeof rec.channel === "string" && rec.channel.trim() ? rec.channel : null;
  const parentId = typeof rec.parent === "number" && Number.isInteger(rec.parent) && rec.parent > 0 ? rec.parent : null;
  let made;
  try {
    made = await insertMessage(sql, auth.userId, { fromSeat: auth.desk, toSeat, kind, body: payload, via: "wire", channel, parentId });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Could not send." }, 400);
  }
  return json({
    id: made.id,
    from: made.fromSeat,
    to: made.toSeat,
    kind: made.kind,
    body: made.body,
    via: asVia(made.via),
    at: made.createdAt,
    channel: made.channel,
    parent: made.parentId,
    mentions: made.mentions,
  });
}

async function beat(auth: WireAuth, request: Request) {
  let status = "listening";
  try {
    const body = (await request.json()) as { status?: unknown };
    if (
      body.status === "working" ||
      body.status === "listening" ||
      body.status === "away"
    ) {
      status = body.status;
    }
  } catch {
    /* empty body is listening */
  }
  const sql = await getSql();
  await sql`
    insert into talkback_presence (user_id, role, status, last_seen, wire_status, wire_last_seen)
    values (${auth.userId}, ${auth.desk}, ${status}, now(), ${status}, now())
    on conflict (user_id, role)
    do update set wire_status = ${status}, wire_last_seen = now()
  `;
  return json({ ok: true, desk: auth.desk, status, via: "wire" });
}

export async function handleWire(request: Request, op: string) {
  if (!op || !["inbox", "send", "heartbeat", "snapshot"].includes(op)) {
    return json({ error: "Unknown wire op." }, 404);
  }
  const auth = await resolveAuth(request);
  if (auth instanceof Response) return auth;
  const url = new URL(request.url);
  if (request.method === "GET" && op === "inbox") return inbox(auth, url);
  if (request.method === "GET" && op === "snapshot") return snapshot(auth);
  if (request.method === "POST" && op === "send") return send(auth, request);
  if (request.method === "POST" && op === "heartbeat") return beat(auth, request);
  return json({ error: "Method not allowed." }, 405);
}
