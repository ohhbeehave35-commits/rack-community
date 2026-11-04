import { catalog } from "./derive";
import type { CleanupItem, MemoryFile } from "./types";

export function buildSummonPack(input: {
  at: string;
  lastDream: string | null;
  files: MemoryFile[];
  extras: CleanupItem[];
  applied: Record<string, boolean>;
  analysisMd: string | null;
  claudeProposal: string | null;
  pastedLines: number;
  lastJob: string | null;
  frozen: boolean;
  locks?: { name: string; at: string; files: number }[];
}): string {
  const items = catalog(input.extras);
  const waiting = items.filter((c) => c.kind === "judgment" && !input.applied[c.id]);
  const applied = items.filter((c) => input.applied[c.id]);
  const hooks = input.files
    .filter((f) => !f.name.startsWith("dream/") && f.id !== "claude-md")
    .map((f) => `- ${f.name}, ${f.hook}`)
    .join("\n");
  const snippets = input.files
    .filter((f) => ["index", "prefs", "stack", "debug", "flow"].includes(f.id))
    .map((f) => `### ${f.name}\n${f.body.trim().split("\n").slice(0, 16).join("\n")}`)
    .join("\n\n");

  return `# Summon pack
Generated: ${input.at}

The assistant died, crashed, or the session is gone.
Do not replay the whole transcript. Read this, then continue the work.

## What this is
Somnus held the memory while the assistant was dead. Paste this into a fresh session.

## Last dream
${input.lastDream ?? "never, there is no snapshot yet. Run one gather before the next crash if you can."}
Last job: ${input.lastJob ?? "none"}
Writes: ${input.frozen ? "FROZEN" : "live"}
Pasted JSONL in this browser: ${input.pastedLines} line${input.pastedLines === 1 ? "" : "s"} (not uploaded).

## Locked copies Somnus still holds
${
  input.locks?.length
    ? input.locks
        .map((l) => `- ${l.name} · ${l.at} · ${l.files} files`)
        .join("\n")
    : "- none in this browser, if the work only lived in the assistant's window, it is gone"
}

## Memory hooks
${hooks || "- none yet"}

## Already applied (do not redo)
${applied.map((c) => `- ${c.id}, ${c.title}`).join("\n") || "- nothing applied yet"}

## Waiting on a human
${waiting.map((c) => `- ${c.id}, ${c.title}`).join("\n") || "- nothing waiting"}

## Standing files (trimmed)
${snippets || "- no topic files"}

## Last analysis
${input.analysisMd ? input.analysisMd.split("\n").slice(0, 40).join("\n") : "- no analysis yet"}

## CLAUDE.md proposal (human-owned, paste yourself if you agree)
${input.claudeProposal ? input.claudeProposal.trim() : "- none"}

## How to start the new session
1. Paste this pack into a new session. Do not load every JSONL.
2. Ask: what was in progress, what is already decided, what is waiting.
3. Continue. Do not redo applied cleanup.
4. If memory disagrees with CLAUDE.md, stop and ask the human.
`;
}
