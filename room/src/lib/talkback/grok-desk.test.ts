import test from "node:test";
import assert from "node:assert/strict";
import {
  DESK_IDS,
  SEAT_IDS,
  RECIPIENT_IDS,
  DESKS,
  ROLES,
  isDeskId,
  isSeatId,
  isRecipientId,
} from "./roles.ts";

test("grok is an addressable wire desk (a message to grok lands)", () => {
  // Rule 64: "grok" is a valid desk + recipient, so the wire accepts a message
  // to it and it can hold presence / its own token.
  assert.ok(DESK_IDS.includes("grok"), "grok must be a desk");
  assert.ok(RECIPIENT_IDS.includes("grok"), "grok must be a valid recipient");
  assert.equal(isDeskId("grok"), true);
  assert.equal(isRecipientId("grok"), true);
  assert.equal(DESKS.grok.label, "Bot");
});

test("grok cannot be picked as a human role (bite)", () => {
  assert.equal((SEAT_IDS as readonly string[]).includes("grok"), false, "grok must not be a role");
  assert.equal(isSeatId("grok"), false);
  // The role picker renders ROLES; grok must be absent from it.
  assert.equal(Object.prototype.hasOwnProperty.call(ROLES, "grok"), false);
});

test("the human roles are unchanged", () => {
  assert.deepEqual([...SEAT_IDS], ["lead", "builder", "reviewer"]);
});
