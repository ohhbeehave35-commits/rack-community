import test from "node:test";
import assert from "node:assert/strict";
import { parseMentions, normalizeChannel, EMOJI_KEYS, buildRecap, matchesWorkflow, planWorkflowActions, validateWorkflow } from "./room-logic.ts";

test("mentions: @desk names are found once each, any case, not inside words or emails", () => {
  assert.deepEqual(parseMentions("hey @Builder and @lead, then @builder again"), ["builder", "lead"]);
  assert.deepEqual(parseMentions("mail me@leadership.example or foo@builder.example"), []);
  assert.deepEqual(parseMentions("@all stand up"), ["lead", "builder", "reviewer", "grok", "assistant"]);
  assert.deepEqual(parseMentions("nobody here"), []);
  assert.deepEqual(parseMentions("the handle @builder.io is taken"), []);
  assert.deepEqual(parseMentions("ping @builder. Thanks"), ["builder"]);
});

test("channel names: lower case, dashes, 2 to 30 letters or digits, never empty", () => {
  assert.equal(normalizeChannel("  Ship It Now "), "ship-it-now");
  assert.equal(normalizeChannel("#Release_2"), "release2");
  assert.throws(() => normalizeChannel("!"), /Give the channel a name/);
  assert.throws(() => normalizeChannel("a".repeat(31)), /30 letters/);
});

test("reactions come from a fixed plain list", () => {
  assert.deepEqual([...EMOJI_KEYS], ["thumbsup", "thumbsdown", "check", "question", "party", "eyes", "heart", "fire"]);
});

const T = (m: number) => new Date(Date.UTC(2026, 9, 31, 12, m)).toISOString();
test("recap: counts, who spoke, open questions, pins, mentions and open tasks come from the room's own words (no model)", () => {
  const r = buildRecap({
    messages: [
      { id: 1, fromSeat: "lead", toSeat: null, kind: "chat", body: "Who owns the login fix?", createdAt: T(0), channel: "general", mentions: [], pinned: false, deleted: false },
      { id: 2, fromSeat: "builder", toSeat: null, kind: "chat", body: "I do. @lead ship it by noon.", createdAt: T(5), channel: "general", mentions: ["lead"], pinned: true, deleted: false },
      { id: 3, fromSeat: "builder", toSeat: null, kind: "chat", body: "removed words", createdAt: T(6), channel: "general", mentions: [], pinned: false, deleted: true },
      { id: 4, fromSeat: "reviewer", toSeat: null, kind: "chat", body: "Where is the test?", createdAt: T(9), channel: "release", mentions: [], pinned: false, deleted: false },
    ],
    tasks: [{ id: 7, role: "builder", title: "Fix login", state: "blocked" }, { id: 8, role: "lead", title: "Old", state: "done" }],
  });
  assert.equal(r.stats.messages, 3);
  assert.deepEqual(r.stats.bySpeaker, { lead: 1, builder: 1, reviewer: 1 });
  assert.match(r.text, /3 messages/);
  assert.match(r.text, /Questions still open:[\s\S]*Who owns the login fix\?[\s\S]*Where is the test\?/);
  assert.match(r.text, /Pinned:[\s\S]*I do\./);
  assert.match(r.text, /Fix login/);
  assert.doesNotMatch(r.text, /Old/);
  assert.doesNotMatch(r.text, /removed words/);
  assert.match(buildRecap({ messages: [], tasks: [] }).text, /Nothing has been said yet/);
});

const MSG = { fromSeat: "lead", toSeat: null, kind: "chat", body: "Deploy is red, please look", channel: "general", mentions: ["builder"], via: "ui", id: 9 };
test("workflow triggers: keyword, mention, channel; a workflow's own posts never trigger another (no loops); disabled never fires", () => {
  const base = { id: 1, name: "n", enabled: true, actionKind: "reply" as const, actionSeat: "assistant", actionText: "ok" };
  assert.equal(matchesWorkflow({ ...base, triggerKind: "keyword", triggerValue: "RED" }, MSG), true);
  assert.equal(matchesWorkflow({ ...base, triggerKind: "keyword", triggerValue: "green" }, MSG), false);
  assert.equal(matchesWorkflow({ ...base, triggerKind: "mention", triggerValue: "builder" }, MSG), true);
  assert.equal(matchesWorkflow({ ...base, triggerKind: "channel", triggerValue: "general" }, MSG), true);
  assert.equal(matchesWorkflow({ ...base, triggerKind: "channel", triggerValue: "release" }, MSG), false);
  assert.equal(matchesWorkflow({ ...base, triggerKind: "keyword", triggerValue: "red" }, { ...MSG, via: "workflow" }), false);
  assert.equal(matchesWorkflow({ ...base, enabled: false, triggerKind: "keyword", triggerValue: "red" }, MSG), false);
  assert.equal(matchesWorkflow({ ...base, triggerKind: "keyword", triggerValue: "red" }, { ...MSG, kind: "status" }), false);
});

test("workflow plan: reply is threaded under the trigger in its channel; task fills the template; at most 5 actions", () => {
  const wfs = [
    { id: 1, name: "a", enabled: true, triggerKind: "keyword" as const, triggerValue: "red", actionKind: "reply" as const, actionSeat: "assistant", actionText: "Seen {from}'s note in #{channel}" },
    { id: 2, name: "b", enabled: true, triggerKind: "keyword" as const, triggerValue: "red", actionKind: "task" as const, actionSeat: "builder", actionText: "Look at: {body}" },
  ];
  const plan = planWorkflowActions(wfs, MSG);
  assert.deepEqual(plan, [
    { type: "message", workflowId: 1, fromSeat: "assistant", channel: "general", parentId: 9, body: "Seen lead's note in #general" },
    { type: "task", workflowId: 2, role: "builder", title: "Look at: Deploy is red, please look" },
  ]);
  const many = Array.from({ length: 9 }, (_, i) => ({ ...wfs[0], id: i + 10 }));
  assert.equal(planWorkflowActions(many, MSG).length, 5);
});

test("workflow input is checked: plain triggers and actions only", () => {
  const ok = { name: "Red alert", triggerKind: "keyword", triggerValue: "red", actionKind: "reply", actionSeat: "assistant", actionText: "On it" };
  assert.equal(validateWorkflow(ok).name, "Red alert");
  assert.throws(() => validateWorkflow({ ...ok, triggerKind: "cron" }), /trigger/);
  assert.throws(() => validateWorkflow({ ...ok, actionKind: "task", actionSeat: "assistant" }), /task.*lead, builder or reviewer/);
  assert.throws(() => validateWorkflow({ ...ok, actionText: "" }), /text/);
  assert.throws(() => validateWorkflow({ ...ok, triggerKind: "mention", triggerValue: "bob" }), /desk/);
});

import { visibleOnWire } from "./room-logic.ts";
test("wire delivery: a desk gets what is for it or for everyone, and now also any message that names it with @; never its own, never status, never deleted; the Floor sees all", () => {
  const m = (o: Record<string, unknown>) => ({ from: "lead", to: null as string | null, kind: "chat", mentions: [] as string[], deleted: false, ...o });
  assert.equal(visibleOnWire(m({}), "builder"), true);
  assert.equal(visibleOnWire(m({ to: "reviewer" }), "builder"), false);
  assert.equal(visibleOnWire(m({ to: "reviewer", mentions: ["builder"] }), "builder"), true);
  assert.equal(visibleOnWire(m({ from: "builder" }), "builder"), false);
  assert.equal(visibleOnWire(m({ kind: "status" }), "builder"), false);
  assert.equal(visibleOnWire(m({ deleted: true }), "builder"), false);
  assert.equal(visibleOnWire(m({ to: "reviewer", kind: "status", deleted: true }), "floor"), true);
});
