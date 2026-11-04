import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./test-db.ts";
import * as S from "./room-store.ts";

const A = "user-a";
const B = "user-b";
const say = (sql: S.Sql, who: string, o: Partial<Parameters<typeof S.insertMessage>[2]> & { body: string }) =>
  S.insertMessage(sql, who, { fromSeat: "lead", toSeat: null, kind: "chat", via: "ui", ...o });

test("channels: general always exists; a new one is made once; a message goes only to a channel that exists", async () => {
  const { sql, close } = await testDb();
  try {
    assert.deepEqual((await S.listChannels(sql, A)).map((c) => c.name), ["general"]);
    await S.createChannel(sql, A, { name: "Release Room", topic: "ship it" });
    await assert.rejects(() => S.createChannel(sql, A, { name: "release-room", topic: "" }), /already/);
    await assert.rejects(() => say(sql, A, { body: "hi", channel: "nowhere" }), /no channel #nowhere/);
    await say(sql, A, { body: "hi", channel: "release-room" });
    await say(sql, A, { body: "hello" });
    const ch = await S.listChannels(sql, A);
    assert.deepEqual(ch.map((c) => [c.name, c.messages]), [["general", 1], ["release-room", 1]]);
    assert.deepEqual((await S.listChannels(sql, B)).map((c) => c.name), ["general"]);
  } finally { await close(); }
});

test("threads: a reply hangs under its parent, a reply to a reply goes to the root, the channel follows the parent, another account's message is not reachable", async () => {
  const { sql, close } = await testDb();
  try {
    await S.createChannel(sql, A, { name: "dev", topic: "" });
    const root = await say(sql, A, { body: "root", channel: "dev" });
    const r1 = await say(sql, A, { body: "r1", parentId: root.id });
    const r2 = await say(sql, A, { body: "r2", parentId: r1.id, fromSeat: "builder" });
    assert.equal(r1.parentId, root.id);
    assert.equal(r2.parentId, root.id);
    assert.equal(r2.channel, "dev");
    const rows = await S.listMessages(sql, A);
    assert.equal(rows.find((m) => m.id === root.id)!.replyCount, 2);
    const other = await say(sql, B, { body: "b's" });
    await assert.rejects(() => say(sql, A, { body: "x", parentId: other.id }), /no message/);
  } finally { await close(); }
});

test("reactions: the same desk toggles on and off, counts show per message, an unknown key or message is refused", async () => {
  const { sql, close } = await testDb();
  try {
    const m = await say(sql, A, { body: "ship?" });
    assert.deepEqual(await S.toggleReaction(sql, A, { messageId: m.id, desk: "builder", emoji: "thumbsup" }), { on: true });
    await S.toggleReaction(sql, A, { messageId: m.id, desk: "lead", emoji: "thumbsup" });
    await S.toggleReaction(sql, A, { messageId: m.id, desk: "lead", emoji: "eyes" });
    let got = (await S.listMessages(sql, A)).find((x) => x.id === m.id)!;
    assert.deepEqual(got.reactions, [{ emoji: "thumbsup", desks: ["builder", "lead"] }, { emoji: "eyes", desks: ["lead"] }]);
    assert.deepEqual(await S.toggleReaction(sql, A, { messageId: m.id, desk: "builder", emoji: "thumbsup" }), { on: false });
    got = (await S.listMessages(sql, A)).find((x) => x.id === m.id)!;
    assert.deepEqual(got.reactions[0], { emoji: "thumbsup", desks: ["lead"] });
    await assert.rejects(() => S.toggleReaction(sql, A, { messageId: m.id, desk: "lead", emoji: "bogus" }), /reaction/);
    await assert.rejects(() => S.toggleReaction(sql, B, { messageId: m.id, desk: "lead", emoji: "eyes" }), /no message/);
  } finally { await close(); }
});

test("mentions: @desk is stored with the message, unread until that desk marks it, the author's own mention does not count", async () => {
  const { sql, close } = await testDb();
  try {
    const m = await say(sql, A, { body: "@builder please look, cc @lead" });
    assert.deepEqual(m.mentions, ["builder", "lead"]);
    const mine = await S.listMentions(sql, A, "builder");
    assert.deepEqual(mine.map((x) => [x.id, x.unread]), [[m.id, true]]);
    assert.deepEqual(await S.listMentions(sql, A, "lead"), []);
    await sql`insert into talkback_acks (user_id, message_id, desk) values (${A}, ${m.id}, ${"builder"})`;
    assert.equal((await S.listMentions(sql, A, "builder"))[0].unread, false);
    assert.deepEqual(await S.listMentions(sql, B, "builder"), []);
  } finally { await close(); }
});

test("files: shared with a message, listed without the bytes, fetched whole by id, size and name are bounded, another account cannot fetch", async () => {
  const { sql, close } = await testDb();
  try {
    const data = Buffer.from("plan: ship friday\n").toString("base64");
    const out = await S.shareFile(sql, A, { fromSeat: "lead", toSeat: null, channel: "general", name: "../my plan?.txt", mime: "text/plain", dataBase64: data, note: "here" });
    assert.equal(out.file.name, "my-plan.txt");
    assert.equal(out.file.size, 18);
    const list = await S.listMessages(sql, A);
    const msg = list.find((x) => x.id === out.message.id)!;
    assert.deepEqual(msg.files, [{ id: out.file.id, name: "my-plan.txt", mime: "text/plain", size: 18 }]);
    assert.equal(JSON.stringify(msg).includes(data), false);
    const got = await S.getFile(sql, A, out.file.id);
    assert.equal(Buffer.from(got.dataBase64, "base64").toString(), "plan: ship friday\n");
    await assert.rejects(() => S.getFile(sql, B, out.file.id), /no file/);
    const big = Buffer.alloc(S.MAX_FILE_BYTES + 1).toString("base64");
    await assert.rejects(() => S.shareFile(sql, A, { fromSeat: "lead", toSeat: null, channel: "general", name: "big.bin", mime: "application/octet-stream", dataBase64: big, note: "" }), /1.5 MB/);
    await assert.rejects(() => S.shareFile(sql, A, { fromSeat: "lead", toSeat: null, channel: "general", name: "x.txt", mime: "text/plain", dataBase64: "", note: "" }), /empty/);
  } finally { await close(); }
});

test("edit and delete: only the author edits; the author or the Floor deletes; a deleted message loses its words, files, reactions and pin", async () => {
  const { sql, close } = await testDb();
  try {
    const m = await say(sql, A, { body: "first @builder" });
    await assert.rejects(() => S.editMessage(sql, A, { id: m.id, desk: "builder", body: "hijack" }), /only edit your own/);
    const e = await S.editMessage(sql, A, { id: m.id, desk: "lead", body: "second @reviewer" });
    assert.equal(e.body, "second @reviewer");
    assert.deepEqual(e.mentions, ["reviewer"]);
    assert.ok(e.editedAt);
    await S.toggleReaction(sql, A, { messageId: m.id, desk: "lead", emoji: "fire" });
    await S.setPinned(sql, A, { id: m.id, desk: "lead", pinned: true });
    await S.shareFile(sql, A, { fromSeat: "lead", toSeat: null, channel: "general", name: "a.txt", mime: "text/plain", dataBase64: Buffer.from("x").toString("base64"), note: "" });
    await assert.rejects(() => S.deleteMessage(sql, A, { id: m.id, desk: "builder" }), /only delete your own/);
    await S.deleteMessage(sql, A, { id: m.id, desk: "floor" });
    const got = (await S.listMessages(sql, A)).find((x) => x.id === m.id)!;
    assert.equal(got.deleted, true);
    assert.equal(got.body, "");
    assert.deepEqual([got.reactions, got.pinned, got.mentions], [[], false, []]);
    await assert.rejects(() => S.editMessage(sql, A, { id: m.id, desk: "lead", body: "again" }), /deleted/);
    await assert.rejects(() => S.deleteMessage(sql, B, { id: m.id, desk: "floor" }), /no message/);
    assert.equal((await sql`select count(*)::int as n from talkback_reactions where message_id = ${m.id}`)[0].n, 0);
  } finally { await close(); }
});

test("pins: any desk pins and unpins; the pinned list shows newest first and skips deleted", async () => {
  const { sql, close } = await testDb();
  try {
    const a = await say(sql, A, { body: "one" });
    const b = await say(sql, A, { body: "two" });
    await S.setPinned(sql, A, { id: a.id, desk: "builder", pinned: true });
    await S.setPinned(sql, A, { id: b.id, desk: "lead", pinned: true });
    assert.deepEqual((await S.listPins(sql, A)).map((x) => x.id), [b.id, a.id]);
    await S.setPinned(sql, A, { id: b.id, desk: "lead", pinned: false });
    assert.deepEqual((await S.listPins(sql, A)).map((x) => x.id), [a.id]);
  } finally { await close(); }
});

test("huddles: one open huddle per channel; people join and leave; the last one out ends it; mute is per person", async () => {
  const { sql, close } = await testDb();
  try {
    const h = await S.startHuddle(sql, A, { desk: "lead", channel: "general" });
    await assert.rejects(() => S.startHuddle(sql, A, { desk: "builder", channel: "general" }), /already a huddle/);
    await S.joinHuddle(sql, A, { huddleId: h.id, desk: "builder" });
    await S.setHuddleMute(sql, A, { huddleId: h.id, desk: "builder", muted: true });
    let now = (await S.listHuddles(sql, A))[0];
    assert.deepEqual(now.members.map((m) => [m.desk, m.muted]), [["lead", false], ["builder", true]]);
    await S.leaveHuddle(sql, A, { huddleId: h.id, desk: "lead" });
    assert.equal((await S.listHuddles(sql, A)).length, 1);
    await S.leaveHuddle(sql, A, { huddleId: h.id, desk: "builder" });
    assert.deepEqual(await S.listHuddles(sql, A), []);
    await assert.rejects(() => S.joinHuddle(sql, A, { huddleId: h.id, desk: "lead" }), /already ended/);
    const again = await S.startHuddle(sql, A, { desk: "reviewer", channel: "general" });
    assert.notEqual(again.id, h.id);
    assert.deepEqual(await S.listHuddles(sql, B), []);
    now = (await S.listHuddles(sql, A))[0];
    await S.endHuddle(sql, A, { huddleId: now.id, desk: "floor" });
    assert.deepEqual(await S.listHuddles(sql, A), []);
  } finally { await close(); }
});

test("recap reads the room's own messages and open tasks for one account", async () => {
  const { sql, close } = await testDb();
  try {
    await say(sql, A, { body: "Who fixes login?" });
    await say(sql, B, { body: "other account words" });
    await sql`insert into talkback_tasks (user_id, role, title, detail, state) values (${A}, ${"builder"}, ${"Fix login"}, ${""}, ${"open"})`;
    const r = await S.recap(sql, A, { channel: null });
    assert.match(r.text, /Who fixes login\?/);
    assert.match(r.text, /Fix login/);
    assert.doesNotMatch(r.text, /other account/);
  } finally { await close(); }
});

test("workflows: saved, listed, switched off, deleted; a matching message gets a threaded reply and a task; the reply does not start another; other accounts are untouched", async () => {
  const { sql, close } = await testDb();
  try {
    const w1 = await S.saveWorkflow(sql, A, { name: "Red alert", triggerKind: "keyword", triggerValue: "red", actionKind: "reply", actionSeat: "assistant", actionText: "Seen in #{channel} from {from}" });
    const w2 = await S.saveWorkflow(sql, A, { name: "Red task", triggerKind: "keyword", triggerValue: "red", actionKind: "task", actionSeat: "builder", actionText: "Look: {body}" });
    await S.saveWorkflow(sql, A, { name: "Loop bait", triggerKind: "keyword", triggerValue: "seen", actionKind: "reply", actionSeat: "lead", actionText: "loop" });
    const m = await say(sql, A, { body: "build is red" });
    const rows = await S.listMessages(sql, A);
    const reply = rows.find((x) => x.parentId === m.id)!;
    assert.equal(reply.fromSeat, "assistant");
    assert.equal(reply.body, "Seen in #general from lead");
    assert.equal(rows.filter((x) => x.body === "loop").length, 0);
    assert.equal((await sql`select title from talkback_tasks where user_id = ${A}`)[0].title, "Look: build is red");
    assert.equal((await S.listWorkflows(sql, A)).find((w) => w.id === w1.id)!.runs, 1);
    await say(sql, B, { body: "other red" });
    assert.equal((await sql`select count(*)::int as n from talkback_tasks where user_id = ${B}`)[0].n, 0);
    await S.saveWorkflow(sql, A, { id: w2.id, name: "Red task", triggerKind: "keyword", triggerValue: "red", actionKind: "task", actionSeat: "builder", actionText: "Look: {body}", enabled: false });
    await say(sql, A, { body: "red again" });
    assert.equal((await sql`select count(*)::int as n from talkback_tasks where user_id = ${A}`)[0].n, 1);
    await assert.rejects(() => S.deleteWorkflow(sql, B, { id: w1.id }), /no workflow/);
    await S.deleteWorkflow(sql, A, { id: w1.id });
    assert.equal((await S.listWorkflows(sql, A)).some((w) => w.id === w1.id), false);
  } finally { await close(); }
});

test("existing messages still load exactly as before: channel general, no thread, nothing extra", async () => {
  const { sql, close } = await testDb();
  try {
    await sql`insert into talkback_messages (user_id, from_seat, to_seat, kind, body, via) values (${A}, ${"lead"}, ${"builder"}, ${"chat"}, ${"old row"}, ${"ui"})`;
    const m = (await S.listMessages(sql, A))[0];
    assert.deepEqual([m.channel, m.parentId, m.deleted, m.pinned, m.mentions, m.reactions, m.files, m.editedAt], ["general", null, false, false, [], [], [], null]);
  } finally { await close(); }
});
