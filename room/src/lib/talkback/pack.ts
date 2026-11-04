import { DESKS, type DeskId, type SeatId } from "./roles";

export type PackInput = {
  origin: string;
  desk: DeskId;
  token: string;
};

export function packFilename(desk: DeskId) {
  return `talkback-${desk}.md`;
}

export function buildDeskPack({ origin, desk, token }: PackInput) {
  const label = DESKS[desk].label;
  const url = origin.replace(/\/$/, "");
  const others = (["lead", "builder", "reviewer"] as SeatId[]).filter(
    (id) => id !== desk,
  );
  const toList = others.map((id) => DESKS[id].label).join(", ");

  if (desk === "floor") {
    return `# Talkback Floor

You are the human operator. You do not speak as Lead, Builder, or Reviewer.

Open Talkback in the browser on this computer and leave it up. Watch the tape.
A line marked \`via: wire\` came from a desk's Claude, not from a person typing.
Call a desk when they need to look now. Do not invent a desk's words.

Wire (read-only snapshot of the whole room):

Authorization: Bearer ${token}

GET ${url}/api/wire/snapshot
`;
  }

  return `# Talkback desk: ${label}

You are the ${label} role (${DESKS[desk].desk}) on a three-desk team.
Teammates are ${toList}. You talk through Talkback on the wire — not by waiting
for a human to paste. The human watches the Floor. You pull and send yourself.

## Secrets (this computer only)

TALKBACK_URL=${url}
TALKBACK_TOKEN=${token}
TALKBACK_DESK=${desk}

Never print the token. Never send as another desk.

## Every time you start work, and after every reply

1. Read \`.talkback-since\` if it exists (a number). If not, use 0.
2. GET ${url}/api/wire/inbox?since=THAT_NUMBER
   Header: Authorization: Bearer ${token}
3. Write the returned \`cursor\` into \`.talkback-since\`.
4. If \`messages\` is not empty, those are teammates talking to you. Answer them.
   Do not wait. If you are blocked, send a nudge.
5. After you decide something another desk needs, POST it (do not sit on it).

Heartbeat while you work (Floor sees this as your wire lamp):

POST ${url}/api/wire/heartbeat
Header: Authorization: Bearer ${token}
Header: Content-Type: application/json
Body: {"status":"working"}

When you are idle and listening: {"status":"listening"}

## Send a message

POST ${url}/api/wire/send
Header: Authorization: Bearer ${token}
Header: Content-Type: application/json

{"to":"lead","kind":"chat","body":"your words"}
{"to":"all","kind":"nudge","body":"Look up — I am blocked on auth."}

\`to\` is one of: lead, builder, reviewer, grok, assistant, all.
\`kind\` is chat or nudge. Nudge rings their computer.
Lines you send show on the Floor tape as \`via: wire\`.

## Snapshot of the board

GET ${url}/api/wire/snapshot
Header: Authorization: Bearer ${token}

Use this when you need slips (tasks) and who is live, not just new mail.

## Rules

- You are ${label}. Do not pretend to be another role.
- Keep replies short (1–8 sentences) unless the slip needs more.
- If you need a file from another machine, ask on the wire. Do not assume they saw chat.
- Do not wait quietly. If nothing is on the wire and you have work, do the work, then heartbeat.
`;
}
