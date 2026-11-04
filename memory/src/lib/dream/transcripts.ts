import type { TranscriptLine } from "./types";

function gold(
  text: string,
  needle: string,
  bucket: TranscriptLine["gold"][number]["bucket"],
): TranscriptLine["gold"] {
  const start = text.indexOf(needle);
  if (start < 0) return [];
  return [{ start, end: start + needle.length, bucket }];
}

export const TRANSCRIPTS: TranscriptLine[] = [
  {
    id: "s1-u1",
    session: "keel-auth",
    date: "2026-08-18",
    kind: "user",
    text: "no, use pnpm. npm keeps drifting the lockfile.",
    gold: gold("no, use pnpm. npm keeps drifting the lockfile.", "no, use pnpm", "correction"),
  },
  {
    id: "s1-a1",
    session: "keel-auth",
    date: "2026-08-18",
    kind: "assistant",
    text: "Got it, I'll always check the lockfile and default to pnpm.",
    gold: [],
  },
  {
    id: "s1-u2",
    session: "keel-auth",
    date: "2026-08-18",
    kind: "user",
    text: "remember this: never commit .env. We inject DATABASE_URL on deploy.",
    gold: gold(
      "remember this: never commit .env. We inject DATABASE_URL on deploy.",
      "remember this",
      "preference",
    ),
  },
  {
    id: "s1-u3",
    session: "keel-auth",
    date: "2026-08-18",
    kind: "user",
    text: "no problem, continue with the login form.",
    gold: [],
  },
  {
    id: "s1-u4",
    session: "keel-auth",
    date: "2026-08-18",
    kind: "user",
    text: "you used npm again. Stop doing that.",
    gold: [
      { start: 13, end: 18, bucket: "recurring" },
      { start: 20, end: 36, bucket: "correction" },
    ],
  },
  {
    id: "s2-t1",
    session: "keel-api",
    date: "2026-08-22",
    kind: "tool_result",
    text: 'export class WrongPassword extends Error { constructor() { super("wrong credentials") } } // copyright Harbor Keel 2026',
    gold: [],
  },
  {
    id: "s2-u1",
    session: "keel-api",
    date: "2026-08-22",
    kind: "user",
    text: "that's wrong. We're not on REST anymore, last three reviews used GraphQL.",
    gold: gold(
      "that's wrong. We're not on REST anymore, last three reviews used GraphQL.",
      "that's wrong",
      "correction",
    ),
  },
  {
    id: "s2-u2",
    session: "keel-api",
    date: "2026-08-22",
    kind: "user",
    text: "let's go with GraphQL for the shop catalog. I decided last Friday.",
    gold: [
      ...gold(
        "let's go with GraphQL for the shop catalog. I decided last Friday.",
        "let's go with GraphQL",
        "decision",
      ),
    ],
  },
  {
    id: "s2-a1",
    session: "keel-api",
    date: "2026-08-22",
    kind: "assistant",
    text: "I'll always try REST first unless you say otherwise. Memory still says REST.",
    gold: [],
  },
  {
    id: "s3-u1",
    session: "keel-graphql",
    date: "2026-08-28",
    kind: "user",
    text: "from now on always use GraphQL. Stop doing REST scaffolding.",
    gold: [
      { start: 0, end: "from now on always use GraphQL".length, bucket: "preference" },
      {
        start: "from now on always use GraphQL. ".length,
        end: "from now on always use GraphQL. Stop doing REST scaffolding.".length,
        bucket: "correction",
      },
    ],
  },
  {
    id: "s3-u2",
    session: "keel-graphql",
    date: "2026-08-28",
    kind: "user",
    text: "I don't remember the old resolver names. Look them up.",
    gold: [],
  },
  {
    id: "s3-u3",
    session: "keel-graphql",
    date: "2026-08-28",
    kind: "user",
    text: "again you used REST. Every time we start a session you forget.",
    gold: [
      { start: 0, end: 5, bucket: "recurring" },
      { start: 21, end: 31, bucket: "recurring" },
    ],
  },
  {
    id: "s3-t1",
    session: "keel-graphql",
    date: "2026-08-28",
    kind: "tool_result",
    text:
      "PASS src/auth.test.ts\n".repeat(40) +
      "Expected: always\nReceived: wrong\n" +
      "at Object.<anonymous> (src/lib/WrongPassword.ts:12:5)\n" +
      "x".repeat(1800),
    gold: [],
  },
  {
    id: "s4-u1",
    session: "keel-dates",
    date: "2026-08-31",
    kind: "user",
    text: "never use moment. We switched to date-fns last week.",
    gold: gold(
      "never use moment. We switched to date-fns last week.",
      "never use moment",
      "preference",
    ),
  },
  {
    id: "s4-u2",
    session: "keel-dates",
    date: "2026-08-31",
    kind: "user",
    text: "actually, going forward default to absolute dates in MEMORY.md. No more 'last week'.",
    gold: [
      { start: 0, end: 8, bucket: "correction" },
      { start: 10, end: 23, bucket: "preference" },
    ],
  },
  {
    id: "s4-u3",
    session: "keel-dates",
    date: "2026-08-31",
    kind: "user",
    text: "we agreed: snapshot memory before any write. Never rm. Never rewrite CLAUDE.md.",
    gold: gold(
      "we agreed: snapshot memory before any write. Never rm. Never rewrite CLAUDE.md.",
      "we agreed",
      "decision",
    ),
  },
  {
    id: "s4-a1",
    session: "keel-dates",
    date: "2026-08-31",
    kind: "assistant",
    text: "Noted. I'll always remember to snapshot first.",
    gold: [],
  },
];

export const LONG_NOISE = TRANSCRIPTS.find((l) => l.id === "s3-t1")!;
