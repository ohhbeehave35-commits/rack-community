/**
 * PARITY8E: the room's new behaviour as plain functions with no database and no screen (channels, mentions, reactions, recap, workflows).
 * The same functions serve the screen, the wire and Assistant's tools, so they cannot drift apart. The recap is built from the room's own
 * words by rules; it calls no model and costs nothing.
 */

export const ADDRESSABLE = ["lead", "builder", "reviewer", "grok", "assistant"] as const;
const MENTIONABLE = ["floor", ...ADDRESSABLE] as const;

/** @lead, @builder ... in a message. `@all` / `@everyone` names every desk but the Floor. Not inside a word or an e-mail address. */
export function parseMentions(body: string): string[] {
  const out: string[] = [];
  const re = /(^|[^A-Za-z0-9_.])@(floor|lead|builder|reviewer|grok|assistant|all|everyone)(?![A-Za-z0-9_])(?![.][A-Za-z0-9])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const name = m[2].toLowerCase();
    const names = name === "all" || name === "everyone" ? [...ADDRESSABLE] : [name];
    for (const n of names) if (!out.includes(n)) out.push(n);
  }
  return out;
}
export const isMentionable = (v: string) => (MENTIONABLE as readonly string[]).includes(v);

/** "Ship It Now" becomes ship-it-now. Two to 30 letters, digits or dashes. */
export function normalizeChannel(raw: string): string {
  const name = raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (name.length < 2) throw new Error("Give the channel a name of at least two letters or digits.");
  if (name.length > 30) throw new Error("A channel name can be at most 30 letters or digits.");
  return name;
}

export const EMOJI_KEYS = ["thumbsup", "thumbsdown", "check", "question", "party", "eyes", "heart", "fire"] as const;
export type EmojiKey = (typeof EMOJI_KEYS)[number];
export const EMOJI_GLYPH: Record<EmojiKey, string> = {
  thumbsup: "\u{1F44D}", thumbsdown: "\u{1F44E}", check: "✅", question: "❓", party: "\u{1F389}", eyes: "\u{1F440}", heart: "❤️", fire: "\u{1F525}",
};
export const EMOJI_LABEL: Record<EmojiKey, string> = {
  thumbsup: "Thumbs up", thumbsdown: "Thumbs down", check: "Done", question: "Question", party: "Celebrate", eyes: "Looking", heart: "Love", fire: "Hot",
};

// ---------- recap (no model) ----------
export type RecapMessage = {
  id: number; fromSeat: string; toSeat: string | null; kind: string; body: string; createdAt: string;
  channel: string; mentions: string[]; pinned: boolean; deleted: boolean;
};
export type RecapTask = { id: number; role: string; title: string; state: string };

const clip = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export function buildRecap(input: { messages: RecapMessage[]; tasks: RecapTask[] }): { text: string; stats: { messages: number; bySpeaker: Record<string, number>; byChannel: Record<string, number>; openQuestions: number; pinned: number; openTasks: number } } {
  const live = input.messages.filter((m) => !m.deleted && m.kind === "chat" && m.body.trim());
  const bySpeaker: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  for (const m of live) {
    bySpeaker[m.fromSeat] = (bySpeaker[m.fromSeat] ?? 0) + 1;
    byChannel[m.channel] = (byChannel[m.channel] ?? 0) + 1;
  }
  const questions = live.filter((m) => m.body.trim().endsWith("?"));
  const pinned = live.filter((m) => m.pinned);
  const openTasks = input.tasks.filter((t) => t.state !== "done");
  const stats = { messages: live.length, bySpeaker, byChannel, openQuestions: questions.length, pinned: pinned.length, openTasks: openTasks.length };
  if (live.length === 0 && openTasks.length === 0) return { text: "Nothing has been said yet, so there is nothing to recap.", stats };
  const L: string[] = [];
  if (live.length) {
    const first = live[0].createdAt;
    const last = live[live.length - 1].createdAt;
    L.push(`${live.length} messages from ${first.slice(0, 16).replace("T", " ")} to ${last.slice(0, 16).replace("T", " ")} (UTC).`);
    L.push("Who spoke: " + Object.entries(bySpeaker).map(([k, v]) => `${k} ${v}`).join(", ") + ".");
    L.push("Where: " + Object.entries(byChannel).map(([k, v]) => `#${k} ${v}`).join(", ") + ".");
    const mentioned: Record<string, number> = {};
    for (const m of live) for (const d of m.mentions) mentioned[d] = (mentioned[d] ?? 0) + 1;
    if (Object.keys(mentioned).length) L.push("Called by name: " + Object.entries(mentioned).map(([k, v]) => `${k} ${v}`).join(", ") + ".");
    if (questions.length) L.push("Questions still open:\n" + questions.slice(-5).map((m) => `- ${m.fromSeat}: ${clip(m.body)}`).join("\n"));
    if (pinned.length) L.push("Pinned:\n" + pinned.slice(-5).map((m) => `- ${m.fromSeat}: ${clip(m.body)}`).join("\n"));
  }
  if (openTasks.length) L.push("Open tasks:\n" + openTasks.slice(0, 8).map((t) => `- #${t.id} ${t.title} (${t.role}, ${t.state})`).join("\n"));
  if (live.length) L.push("Latest:\n" + live.slice(-3).map((m) => `- ${m.fromSeat}: ${clip(m.body, 100)}`).join("\n"));
  return { text: L.join("\n"), stats };
}

// ---------- workflows ----------
export type WorkflowRow = {
  id: number; name: string; enabled: boolean;
  triggerKind: "keyword" | "mention" | "channel"; triggerValue: string;
  actionKind: "reply" | "task"; actionSeat: string; actionText: string;
};
export type TriggerMessage = { id: number; fromSeat: string; toSeat: string | null; kind: string; body: string; channel: string; mentions: string[]; via: string };

export const TRIGGER_KINDS = ["keyword", "mention", "channel"] as const;
export const ACTION_KINDS = ["reply", "task"] as const;
const ROLES = ["lead", "builder", "reviewer"];
const REPLY_DESKS = ["lead", "builder", "reviewer", "assistant"];

export function validateWorkflow(w: Record<string, unknown>): Omit<WorkflowRow, "id" | "enabled"> {
  const s = (k: string) => (typeof w[k] === "string" ? (w[k] as string).trim() : "");
  const name = s("name");
  if (!name || name.length > 60) throw new Error("Give the workflow a name of up to 60 characters.");
  const triggerKind = s("triggerKind");
  if (!(TRIGGER_KINDS as readonly string[]).includes(triggerKind)) throw new Error("The trigger must be keyword, mention or channel.");
  let triggerValue = s("triggerValue");
  if (triggerKind === "mention") {
    triggerValue = triggerValue.replace(/^@/, "").toLowerCase();
    if (!isMentionable(triggerValue)) throw new Error("A mention trigger needs a desk name: lead, builder, reviewer, grok or assistant.");
  } else if (triggerKind === "channel") triggerValue = normalizeChannel(triggerValue);
  else if (!triggerValue || triggerValue.length > 60) throw new Error("A keyword trigger needs a word or phrase of up to 60 characters.");
  const actionKind = s("actionKind");
  if (!(ACTION_KINDS as readonly string[]).includes(actionKind)) throw new Error("The action must be reply or task.");
  const actionSeat = s("actionSeat");
  if (actionKind === "task" && !ROLES.includes(actionSeat)) throw new Error("A task goes to lead, builder or reviewer.");
  if (actionKind === "reply" && !REPLY_DESKS.includes(actionSeat)) throw new Error("A reply is posted as lead, builder, reviewer or assistant.");
  const actionText = s("actionText");
  if (!actionText || actionText.length > 500) throw new Error("Give the action text (up to 500 characters).");
  return { name, triggerKind: triggerKind as WorkflowRow["triggerKind"], triggerValue, actionKind: actionKind as WorkflowRow["actionKind"], actionSeat, actionText };
}

export function matchesWorkflow(w: Omit<WorkflowRow, "id"> & { id?: number }, m: TriggerMessage): boolean {
  if (!w.enabled) return false;
  if (m.via === "workflow") return false; // a workflow's own post never starts another one
  if (m.kind !== "chat") return false;
  if (w.triggerKind === "keyword") return m.body.toLowerCase().includes(w.triggerValue.toLowerCase());
  if (w.triggerKind === "mention") return m.mentions.includes(w.triggerValue);
  return m.channel === w.triggerValue;
}

export type PlannedAction =
  | { type: "message"; workflowId: number; fromSeat: string; channel: string; parentId: number; body: string }
  | { type: "task"; workflowId: number; role: string; title: string };

export function planWorkflowActions(workflows: WorkflowRow[], m: TriggerMessage): PlannedAction[] {
  const fill = (t: string) => t.replace(/\{from\}/g, m.fromSeat).replace(/\{channel\}/g, m.channel).replace(/\{body\}/g, clip(m.body, 150));
  const out: PlannedAction[] = [];
  for (const w of workflows) {
    if (out.length >= 5) break;
    if (!matchesWorkflow(w, m)) continue;
    if (w.actionKind === "reply") out.push({ type: "message", workflowId: w.id, fromSeat: w.actionSeat, channel: m.channel, parentId: m.id, body: fill(w.actionText).slice(0, 2000) });
    else out.push({ type: "task", workflowId: w.id, role: w.actionSeat, title: fill(w.actionText).slice(0, 200) });
  }
  return out;
}

/** Which messages a desk gets on the wire. The Floor sees everything; a desk never gets its own words, status lamps or deleted messages. */
export function visibleOnWire(m: { from: string; to: string | null; kind: string; mentions: string[]; deleted: boolean }, desk: string): boolean {
  if (desk === "floor") return true;
  if (m.deleted || m.from === desk || m.kind === "status") return false;
  return m.to === null || m.to === desk || m.mentions.includes(desk);
}
