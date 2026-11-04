import { fileToMemId } from "./derive";
import { CLEANUP, MEMORY_FILES, PRUNED_INDEX } from "./memory";
import type { CleanupItem, MemoryFile } from "./types";

export function cloneFiles(files: MemoryFile[] = MEMORY_FILES): MemoryFile[] {
  return files.map((f) => ({ ...f }));
}

function recount(file: MemoryFile): MemoryFile {
  return { ...file, lines: file.body.split("\n").length, stale: false };
}

function replaceFile(
  files: MemoryFile[],
  id: string,
  patch: (f: MemoryFile) => MemoryFile,
): MemoryFile[] {
  return files.map((f) => (f.id === id ? recount(patch(f)) : f));
}

export function autoAppliedCount(applied: Record<string, boolean>) {
  return CLEANUP.filter((c) => c.kind === "auto" && applied[c.id]).length;
}

export function applyCleanupIds(
  files: MemoryFile[],
  trash: MemoryFile[],
  ids: string[],
  extra: CleanupItem[] = [],
): { files: MemoryFile[]; trash: MemoryFile[] } {
  let next = cloneFiles(files);
  let bin = cloneFiles(trash);
  const set = new Set(ids);

  if (set.has("dates")) {
    next = next.map((f) =>
      f.id === "debug" || f.id === "stack"
        ? recount({
            ...f,
            body: f.body.replaceAll("last week", "2026-08-25"),
          })
        : f,
    );
  }

  if (set.has("merge")) {
    const dup = next.find((f) => f.id === "prefs-dup");
    if (dup) {
      bin = [...bin, { ...dup, stale: false }];
      next = next.filter((f) => f.id !== "prefs-dup");
      next = replaceFile(next, "prefs", (f) => ({
        ...f,
        body: `# User preferences

- Package manager: pnpm (do not use npm).
- Never commit .env files.
- Default HTTP style: REST.
- Dates in memory must be absolute.
- Never use moment.js, date-fns instead.
`,
      }));
    }
  }

  if (set.has("dead") || set.has("index-trim")) {
    next = replaceFile(next, "index", (f) => ({
      ...f,
      body: set.has("rest-gql")
        ? PRUNED_INDEX
        : `# Memory index

- [User preferences](user-preferences.md), pnpm only; never commit .env; date-fns not moment; absolute dates (2026-08-31)
- [Stack](stack.md), Vite, TanStack Start, Tailwind v4; shop catalog REST at /api/boats
- [Debugging](debugging.md), auth test flake on WrongPassword, 2026-08-25
- [Workflow](workflow.md), snapshot before writes; never rm; CLAUDE.md is human-owned
`,
    }));
  }

  if (set.has("rest-gql")) {
    next = replaceFile(next, "stack", (f) => ({
      ...f,
      hook: "Architecture and API choices. GraphQL catalog.",
      body: `# Stack

- Vite + TanStack Start + Tailwind v4.
- Shop catalog: GraphQL (was REST; confirmed 2026-08-28).
- Auth: Better Auth, email + password.
- Database: Postgres.

Last reviewed: 2026-08-28.
`,
    }));
    if (!set.has("dead") && !set.has("index-trim")) {
      next = replaceFile(next, "index", (f) => ({
        ...f,
        body: f.body
          .replace("REST for the shop API", "GraphQL for the shop catalog")
          .replace("REST endpoints under /api", "GraphQL catalog")
          .replace("REST at /api/boats", "GraphQL"),
      }));
    }
  }

  if (set.has("pnpm")) {
    next = replaceFile(next, "prefs", (f) => ({
      ...f,
      body: f.body.includes("Standing: always pnpm")
        ? f.body
        : `${f.body.trim()}\n- Standing: always pnpm, never npm.\n`,
    }));
  }

  if (set.has("moment")) {
    next = replaceFile(next, "prefs", (f) => ({
      ...f,
      body: f.body.includes("moment.js")
        ? f.body.replace(
            "Never use moment.js, date-fns instead.",
            "Never use moment.js, date-fns instead. Confirmed standing 2026-08-31.",
          )
        : `${f.body.trim()}\n- Never use moment.js, date-fns instead. Confirmed standing 2026-08-31.\n`,
    }));
  }

  for (const item of extra) {
    if (!set.has(item.id) || !item.lessonText) continue;
    const memId = fileToMemId(item.file);
    next = replaceFile(next, memId, (f) => {
      if (f.body.includes(item.lessonText!)) return f;
      const tag = item.unverified ? "[UNVERIFIED] " : "";
      return {
        ...f,
        body: `${f.body.trim()}\n- Standing: ${tag}${item.lessonText}\n`,
      };
    });
  }

  return { files: next, trash: bin };
}

export function idsToApply(
  items: CleanupItem[],
  applied: Record<string, boolean>,
  checked: Record<string, boolean>,
  includeAuto: boolean,
  signed: Record<string, boolean> = {},
  dualControl = false,
  proposedBy: Record<string, string> = {},
  signedBy: Record<string, string> = {},
  glass: Record<string, boolean> = {},
): string[] {
  return items.filter((item) => {
    if (item.kind === "protected") return false;
    if (applied[item.id]) return false;
    if (item.kind === "auto") return includeAuto;
    if (!checked[item.id]) return false;
    if (!dualControl) return true;
    if (glass[item.id]) return true;
    if (!signed[item.id]) return false;
    if (!proposedBy[item.id] || !signedBy[item.id]) return false;
    if (proposedBy[item.id] === signedBy[item.id]) return false;
    return true;
  }).map((item) => item.id);
}

export function buildReport(input: {
  at: string;
  kind: "full" | "apply";
  autoApplied: string[];
  judged: string[];
  waiting: string[];
  precision: number;
  recall: number;
  blocked?: string;
}): string {
  const title =
    input.kind === "full"
      ? `Dream report ${input.at}`
      : `Apply-fixes ${input.at}`;
  const waitingLines = input.waiting.length
    ? input.waiting.map((id) => {
        const item = CLEANUP.find((c) => c.id === id);
        return `- [ ] ${item?.title ?? id}`;
      })
    : ["- none"];
  const judgedLines = input.judged.length
    ? input.judged.map((id) => {
        const item = CLEANUP.find((c) => c.id === id);
        return `- [x] ${item?.title ?? id}`;
      })
    : ["- none"];
  return `# ${title}

Auto-applied: ${input.autoApplied.length}
Waiting on you: ${input.waiting.length}
Judgment applied this run: ${input.judged.length}
${input.blocked ? `\nBLOCKED: ${input.blocked}\n` : ""}
Gather precision ${Math.round(input.precision * 100)}% · recall ${Math.round(input.recall * 100)}%

## Auto-applied
${input.autoApplied.map((id) => `- ${CLEANUP.find((c) => c.id === id)?.title ?? id}`).join("\n") || "- none"}

## Waiting on you
${waitingLines.join("\n")}

## Applied last run (judgment)
${judgedLines.join("\n")}

CLAUDE.md was not rewritten.
`;
}
