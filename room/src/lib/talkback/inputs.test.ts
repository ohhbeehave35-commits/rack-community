import test from "node:test";
import assert from "node:assert/strict";
import { sendInput2, editInput, reactInput, shareFileInput, huddleStartInput, workflowInput, pinInput } from "./inputs.ts";

test("PARITY8E inputs: the browser may only send plain, bounded things", () => {
  assert.ok(sendInput2.safeParse({ fromSeat: "lead", toSeat: null, kind: "chat", body: "hi", channel: "dev", parentId: 4 }).success);
  assert.ok(sendInput2.safeParse({ fromSeat: "lead", toSeat: null, kind: "chat", body: "hi" }).success, "old callers still work");
  assert.equal(sendInput2.safeParse({ fromSeat: "grok", toSeat: null, kind: "chat", body: "hi" }).success, false, "the browser never speaks as Bot");
  assert.equal(editInput.safeParse({ id: 1, desk: "lead", body: "   " }).success, false);
  assert.equal(editInput.safeParse({ id: 0, desk: "lead", body: "x" }).success, false);
  assert.equal(pinInput.safeParse({ id: 1, desk: "assistant", pinned: true }).success, false);
  assert.ok(reactInput.safeParse({ messageId: 3, desk: "floor", emoji: "fire" }).success);
  assert.equal(shareFileInput.safeParse({ fromSeat: "lead", toSeat: null, channel: null, name: "a", mime: "text/plain", dataBase64: "", note: "" }).success, false);
  assert.equal(huddleStartInput.safeParse({ desk: "reviewer", channel: "x".repeat(41) }).success, false);
  assert.equal(workflowInput.safeParse({ name: "n", triggerKind: "cron", triggerValue: "v", actionKind: "reply", actionSeat: "lead", actionText: "t", enabled: true }).success, false);
});
