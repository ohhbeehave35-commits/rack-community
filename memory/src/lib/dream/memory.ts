import type { CleanupItem, MemoryFile } from "./types";

export const PROJECT = {
  name: "Local memory",
  slug: "local-memory",
  lastDream: "2026-08-17",
  sessionsSince: 4,
};

export const HUMAN_FILE: MemoryFile = {
  id: "claude-md",
  name: "CLAUDE.md",
  hook: "Human-owned. Somnus never writes this file.",
  stale: true,
  lines: 10,
  body: `# CLAUDE.md

This file is human-owned. Skills must not rewrite it.

- Default HTTP: REST at /api
- Package manager: npm
- Dates: informal is fine

If memory disagrees, paste a reconciliation block yourself.
`,
};

export const MEMORY_FILES: MemoryFile[] = [
  {
    id: "index",
    name: "MEMORY.md",
    hook: "Index only, one line per topic, under 200 lines.",
    stale: true,
    lines: 12,
    body: `# Memory index

- [User preferences](user-preferences.md), pnpm, no .env in git, REST for the shop API, never moment.js
- [Stack](stack.md), Vite, TanStack, REST endpoints under /api, Postgres
- [Debugging](debugging.md), flaky auth tests last week, WrongPassword helper
- [Workflow](workflow.md), snapshot before memory writes; CLAUDE.md is human-owned
- [Deleted notes](deleted-file.md), leftover pointer
- [Preferences (dup)](preferences.md), overlapping with user-preferences.md
`,
  },
  {
    id: "prefs",
    name: "user-preferences.md",
    hook: "Standing taste and tooling locks.",
    stale: true,
    lines: 18,
    body: `# User preferences

- Package manager: pnpm (do not use npm).
- Never commit .env files.
- Default HTTP style: REST.
- Dates in memory may be relative ("last week", "next Friday").
- Never use moment.js, date-fns instead.
`,
  },
  {
    id: "prefs-dup",
    name: "preferences.md",
    hook: "Near-duplicate of user-preferences.md.",
    stale: true,
    lines: 8,
    body: `# Preferences

- Prefer pnpm.
- Don't check in secrets.
`,
  },
  {
    id: "stack",
    name: "stack.md",
    hook: "Architecture and API choices.",
    stale: true,
    lines: 14,
    body: `# Stack

- Vite + TanStack Start + Tailwind v4.
- Shop catalog: REST at /api/boats.
- Auth: Better Auth, email + password.
- Database: Postgres.

Last reviewed: last week.
`,
  },
  {
    id: "debug",
    name: "debugging.md",
    hook: "Recent failures and how they were fixed.",
    stale: true,
    lines: 11,
    body: `# Debugging

- Auth tests failed last week on WrongPassword copy.
- GraphQL spike left unused resolvers in src/gql, ignore for now.
`,
  },
  {
    id: "workflow",
    name: "workflow.md",
    hook: "How Somnus may touch this store.",
    stale: false,
    lines: 10,
    body: `# Workflow

- Snapshot memory before writes.
- Never rm topic files; move superseded ones to TRASH/.
- CLAUDE.md is human-owned. Propose reconciliation only.
`,
  },
];

export const CLEANUP: CleanupItem[] = [
  {
    id: "dates",
    kind: "auto",
    title: "Convert relative dates",
    detail: '"last week" in debugging.md and stack.md → 2026-08-25. Absolute dates only in the index.',
    file: "debugging.md",
  },
  {
    id: "merge",
    kind: "auto",
    title: "Merge near-duplicate preference files",
    detail: "preferences.md folds into user-preferences.md. Index keeps one pointer.",
    file: "preferences.md",
  },
  {
    id: "dead",
    kind: "auto",
    title: "Drop dead index link",
    detail: "MEMORY.md points at deleted-file.md, which is gone. Remove the line.",
    file: "MEMORY.md",
  },
  {
    id: "index-trim",
    kind: "auto",
    title: "Shorten MEMORY.md hooks",
    detail: "Move REST/GraphQL detail out of the index line for stack.md. Index stays ≤150 chars/line.",
    file: "MEMORY.md",
  },
  {
    id: "rest-gql",
    kind: "judgment",
    title: "Contradiction: REST vs GraphQL",
    detail: 'Memory says "use REST". Last 3 sessions used GraphQL and you said "that\'s wrong". Which is standing?',
    file: "stack.md",
  },
  {
    id: "moment",
    kind: "judgment",
    title: "Forget the old moment.js ban?",
    detail: "The rule is still in preferences, but date-fns is already the code. Confirm it stays as a standing never.",
    file: "user-preferences.md",
  },
  {
    id: "pnpm",
    kind: "judgment",
    title: "Promote pnpm to a standing preference?",
    detail: "You corrected npm → pnpm once and said \"from now on\". Promote, or leave as a one-off?",
    file: "user-preferences.md",
  },
  {
    id: "claude",
    kind: "protected",
    title: "Do not rewrite CLAUDE.md",
    detail: "Human-owned. Somnus may propose a reconciliation block if it drifts from memory. Never silent rewrite.",
    file: "CLAUDE.md",
  },
];

export const PRUNED_INDEX = `# Memory index

- [User preferences](user-preferences.md), pnpm only; never commit .env; date-fns not moment; absolute dates in memory (2026-08-31)
- [Stack](stack.md), Vite, TanStack Start, Tailwind v4; shop catalog GraphQL (was REST; confirmed 2026-08-28)
- [Debugging](debugging.md), auth test flake on WrongPassword, 2026-08-25
- [Workflow](workflow.md), snapshot before writes; never rm; CLAUDE.md is human-owned
`;
