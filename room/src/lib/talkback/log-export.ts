/**
 * The room's log as text (the Copy log button, and Assistant's "save the conversation" tool). One pure function builds it,
 * so the button and the tool can never drift apart. Moved out of room.tsx unchanged (WIRE1, 31 Oct 2026); the text is the same.
 */
import type { SeatStatus, TalkbackMessage, TalkbackPresence, WireMeta } from "./api.ts";
import { DESKS, type DeskId } from "./roles.ts";

export type PresenceMap = Partial<
  Record<DeskId, { status: SeatStatus; lastSeen: string; wireStatus: SeatStatus | null; wireLastSeen: string | null }>
>;

export function presenceMap(rows: TalkbackPresence[]): PresenceMap {
  const map: PresenceMap = {};
  for (const row of rows) {
    map[row.role] = { status: row.status, lastSeen: row.lastSeen, wireStatus: row.wireStatus, wireLastSeen: row.wireLastSeen };
  }
  return map;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatAgo(iso: string | null | undefined) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 8_000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return formatTime(iso);
}

export function buildLogText({ messages, wires, presence, now = new Date() }: { messages: TalkbackMessage[]; wires: WireMeta[]; presence: PresenceMap; now?: Date }) {
  const lines = messages.map((m) => {
    const dest = m.toSeat ? DESKS[m.toSeat].label : "Room";
    const seen = m.seenBy.length > 0 ? ` [${m.seenBy.map((d) => DESKS[d].label).join(", ")} looked]` : "";
    const via = m.via === "wire" ? ", wire" : "";
    const where = (m.channel && m.channel !== "general" ? `, #${m.channel}` : "") + (m.parentId ? `, reply to ${m.parentId}` : "");
    const words = m.deleted ? "(deleted)" : m.body + (m.editedAt ? " (edited)" : "");
    const files = (m.files ?? []).map((f) => `\n[file: ${f.name}]`).join("");
    return `${formatTime(m.createdAt)}  ${DESKS[m.fromSeat].label} → ${dest}  (${m.kind}${via}${where})${seen}\n${words}${files}`;
  });
  const wireLines = wires.map((w) => {
    const live = presence[w.desk];
    return `${DESKS[w.desk].label}  ${w.prefix}…  pulled ${formatAgo(w.lastUsed)}  browser ${live?.status ?? "dark"}  wire ${live?.wireStatus ?? "silent"}`;
  });
  return `Talkback log\n${now.toISOString()}\n\nWires\n${wireLines.join("\n") || "(none)"}\n\nTape\n${lines.join("\n\n")}\n`;
}

export function logFilename(now: Date = new Date()) {
  return `talkback-log-${now.toISOString().slice(0, 10)}.md`;
}
