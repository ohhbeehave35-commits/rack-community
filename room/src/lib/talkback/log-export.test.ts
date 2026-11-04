import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLogText, logFilename, presenceMap } from "./log-export.ts";

const messages = [
  { id: 1, fromSeat: "lead", toSeat: "builder", kind: "chat", body: "Ship it.", createdAt: "2026-10-31T14:05:00.000Z", seenBy: ["builder", "floor"], via: "wire" },
  { id: 2, fromSeat: "builder", toSeat: null, kind: "nudge", body: "Done.\nSecond line.", createdAt: "2026-10-31T14:06:00.000Z", seenBy: [], via: "ui" },
] as never;
const wires = [{ desk: "grok", prefix: "tb_ab", lastUsed: null, createdAt: "2026-10-30T10:00:00.000Z" }] as never;
const presence = presenceMap([{ role: "grok", status: "listening", lastSeen: "2026-10-31T14:00:00.000Z", wireStatus: "working", wireLastSeen: null }] as never);
const NOW = new Date("2026-10-31T15:00:00.000Z");

test("the log text is the exact text the Copy log button always made", () => {
  const t = buildLogText({ messages, wires, presence, now: NOW });
  assert.ok(t.startsWith("Talkback log\n2026-10-31T15:00:00.000Z\n\nWires\n"));
  assert.match(t, /Wire desk/);
  assert.match(t, /tb_ab… {2}pulled never {2}browser listening {2}wire working/);
  assert.match(t, /Lead → Builder {2}\(chat, wire\) \[Builder, Floor looked\]\nShip it\./);
  assert.match(t, /Builder → Room {2}\(nudge\)\nDone\.\nSecond line\.\n$/);
  assert.match(t, /\n\nTape\n/);
});

test("PARITY8E: the log marks channel, thread, edits, deletes and files, and leaves old messages exactly as they were", () => {
  const rows = [
    { id: 5, fromSeat: "lead", toSeat: null, kind: "chat", body: "Release notes", createdAt: "2026-10-31T14:07:00.000Z", seenBy: [], via: "ui", channel: "release", parentId: null, editedAt: "2026-10-31T14:08:00.000Z", deleted: false, files: [{ id: 1, name: "notes.md", mime: "text/markdown", size: 12 }] },
    { id: 6, fromSeat: "builder", toSeat: null, kind: "chat", body: "", createdAt: "2026-10-31T14:09:00.000Z", seenBy: [], via: "ui", channel: "release", parentId: 5, editedAt: null, deleted: true, files: [] },
    { id: 7, fromSeat: "lead", toSeat: null, kind: "chat", body: "Plain", createdAt: "2026-10-31T14:10:00.000Z", seenBy: [], via: "ui", channel: "general", parentId: null, editedAt: null, deleted: false, files: [] },
  ] as never;
  const t = buildLogText({ messages: rows, wires: [], presence: {}, now: NOW });
  assert.match(t, /Lead → Room {2}\(chat, #release\)\nRelease notes \(edited\)\n\[file: notes\.md\]/);
  assert.match(t, /Builder → Room {2}\(chat, #release, reply to 5\)\n\(deleted\)/);
  assert.match(t, /Lead → Room {2}\(chat\)\nPlain\n$/);
});

test("an empty room still gives a file with (none) for the wires", () => {
  const t = buildLogText({ messages: [], wires: [], presence: {}, now: NOW });
  assert.equal(t, "Talkback log\n2026-10-31T15:00:00.000Z\n\nWires\n(none)\n\nTape\n\n");
});

test("the file name carries the date", () => {
  assert.equal(logFilename(NOW), "talkback-log-2026-10-31.md");
});

test("the screen button builds its text through this one function, not its own copy", () => {
  const room = readFileSync(new URL("../../components/talkback/room.tsx", import.meta.url), "utf8");
  assert.match(room, /buildLogText\(/);
  assert.equal(room.includes("Talkback log\n"), false);
});
