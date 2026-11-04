export const SEAT_IDS = ["lead", "builder", "reviewer"] as const;
export type SeatId = (typeof SEAT_IDS)[number];

// "grok" is a wire-only desk (Bot): addressable, has presence + its own
// token, shown on the board — but NOT a human-pickable role. It sits after the
// roles in the desk roster. "assistant" is the same shape for Assistant: she
// reads, answers and keeps her lamp lit on her own key, and every send she
// makes goes through a confirm step (tools/assistant-wire.mjs).
export const WIRE_ONLY_IDS = ["grok", "assistant"] as const;
export const DESK_IDS = ["floor", ...SEAT_IDS, ...WIRE_ONLY_IDS] as const;
export type DeskId = (typeof DESK_IDS)[number];

// Desks a PERSON can sit at in the browser. Wire-only desks (Bot,
// Assistant) speak only on their own key, so the browser can never send,
// heartbeat or mark "looked" in their name.
export const UI_DESK_IDS = ["floor", ...SEAT_IDS] as const;
export type UiDeskId = (typeof UI_DESK_IDS)[number];
export function isUiDeskId(value: string): value is UiDeskId {
  return (UI_DESK_IDS as readonly string[]).includes(value);
}

// Who a message can be addressed TO: the human roles plus Bot (never the
// Floor, which only watches).
export const RECIPIENT_IDS = [...SEAT_IDS, ...WIRE_ONLY_IDS] as const;
export type RecipientId = (typeof RECIPIENT_IDS)[number];
export function isRecipientId(value: string): value is RecipientId {
  return (RECIPIENT_IDS as readonly string[]).includes(value);
}

export const DESKS: Record<
  DeskId,
  { id: DeskId; label: string; desk: string; hint: string }
> = {
  floor: {
    id: "floor",
    label: "Floor",
    desk: "Operator",
    hint: "You. See every desk, every ping, every wire pull. This computer stays the control room.",
  },
  lead: {
    id: "lead",
    label: "Lead",
    desk: "Architect",
    hint: "Plans and assigns. Max 20x #1 on the ProArt, Claude Code on the wire beside this tab.",
  },
  builder: {
    id: "builder",
    label: "Builder",
    desk: "Implementer",
    hint: "Writes and ships. Max 20x #2, own worktree, this tab rings when called.",
  },
  reviewer: {
    id: "reviewer",
    label: "Reviewer",
    desk: "Review",
    hint: "Reads and signs off. Pro login — the Mac is enough if it only has to ring.",
  },
  grok: {
    id: "grok",
    label: "Bot",
    desk: "Bot",
    hint: "Bot on the wire. Not a human role — it rings and answers on its own token.",
  },
  assistant: {
    id: "assistant",
    label: "Assistant",
    desk: "Assistant",
    hint: "Assistant on the wire. Not a human role — she reads the room, answers on her own key, and asks you to confirm before she sends.",
  },
};

export const ROLES = {
  lead: DESKS.lead,
  builder: DESKS.builder,
  reviewer: DESKS.reviewer,
};

export function isSeatId(value: string): value is SeatId {
  return (SEAT_IDS as readonly string[]).includes(value);
}

export function isDeskId(value: string): value is DeskId {
  return (DESK_IDS as readonly string[]).includes(value);
}

export const SEAT_STORAGE_KEY = "talkback.role";
export const CUE_STORAGE_KEY = "talkback.cue";
export const HEARD_STORAGE_KEY = "talkback.heard";

export function radioLine(from: DeskId, to: RecipientId | null, body: string) {
  const dest = to ? DESKS[to].label : "All";
  return `RADIO ${DESKS[from].label} → ${dest}: ${body}`;
}

export function deskPrompt(desk: DeskId) {
  if (desk === "floor") {
    return `You are the human on the Floor of a three-desk team (Lead, Builder, Reviewer). You watch Talkback. Desks speak on the wire themselves — do not invent a desk's words. If a machine has no wire yet, ferry RADIO lines into that Claude Code session and paste the reply back.`;
  }
  const s = DESKS[desk];
  return `You are the ${s.label} role (${s.desk}) on a three-desk team.

Preferred: this computer has a Talkback wire pack (talkback-${desk}.md). Pull the inbox, send on the wire, heartbeat while you work. Do not wait for a human to paste.

Fallback: if I paste a line that starts with RADIO, that is a teammate. Answer in 1–8 sentences. I will paste your reply back.

If you only have chat, start with:
RADIO to Lead:
RADIO to Builder:
RADIO to Reviewer:
RADIO to All:

Do not wait quietly. If you are blocked, send a nudge (or RADIO the blocker) and say what you need.`;
}
