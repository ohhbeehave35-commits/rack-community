import { z } from "zod";
import { RECIPIENT_IDS, UI_DESK_IDS } from "./roles.ts";

// What the browser may send to the room's server functions (api.ts). Kept in
// their own file so a plain node test can check them without the server.
// The browser speaks only as a desk a person can sit at; Bot and
// Assistant speak on their own wire key (wire-http.ts), never through here.
export const uiDeskSchema = z.enum(UI_DESK_IDS);
// A message can be addressed to a role, Bot or Assistant (never the Floor).
export const recipientSchema = z.enum(RECIPIENT_IDS);
export const kindSchema = z.enum(["chat", "nudge", "status"]);
export const statusSchema = z.enum(["listening", "working", "away"]);

export const sendInput = z.object({
  fromSeat: uiDeskSchema,
  toSeat: recipientSchema.nullable(),
  kind: kindSchema,
  body: z.string().max(2000),
});

export const heartbeatInput = z.object({
  role: uiDeskSchema,
  status: statusSchema,
});

export const ackInput = z.object({
  desk: uiDeskSchema,
  messageIds: z.array(z.number().int().positive()).max(80),
});

// ---------- PARITY8E: what the browser may send for channels, threads, edits, pins, reactions, files, huddles, recap and workflows ----------
const idSchema = z.number().int().positive();
const channelField = z.string().trim().min(1).max(40);
export const sendInput2 = sendInput.extend({
  channel: channelField.nullable().optional(),
  parentId: idSchema.optional(),
});
export const createChannelInput = z.object({ name: z.string().max(40), topic: z.string().max(120) });
export const editInput = z.object({ id: idSchema, desk: uiDeskSchema, body: z.string().trim().min(1).max(2000) });
export const deleteInput = z.object({ id: idSchema, desk: uiDeskSchema });
export const pinInput = z.object({ id: idSchema, desk: uiDeskSchema, pinned: z.boolean() });
export const reactInput = z.object({ messageId: idSchema, desk: uiDeskSchema, emoji: z.string().max(20) });
export const mentionsInput = z.object({ desk: uiDeskSchema });
export const shareFileInput = z.object({
  fromSeat: uiDeskSchema,
  toSeat: recipientSchema.nullable(),
  channel: channelField.nullable(),
  name: z.string().min(1).max(120),
  mime: z.string().max(100),
  // base64 text: 1.5 MB of bytes is about 2.1 MB of text; the store checks the real size.
  dataBase64: z.string().min(1).max(2_200_000),
  note: z.string().max(2000),
});
export const fileIdInput = z.object({ id: idSchema });
export const huddleStartInput = z.object({ desk: uiDeskSchema, channel: z.string().max(40) });
export const huddleDeskInput = z.object({ huddleId: idSchema, desk: uiDeskSchema });
export const huddleMuteInput = huddleDeskInput.extend({ muted: z.boolean() });
export const recapInput = z.object({ channel: z.string().max(40).nullable() });
export const workflowInput = z.object({
  id: idSchema.optional(),
  name: z.string().max(60),
  triggerKind: z.enum(["keyword", "mention", "channel"]),
  triggerValue: z.string().max(60),
  actionKind: z.enum(["reply", "task"]),
  actionSeat: z.string().max(20),
  actionText: z.string().max(500),
  enabled: z.boolean(),
});
export const workflowIdInput = z.object({ id: idSchema });
