import { cloneFiles } from "./mutate";
import { buildSummonPack } from "./summon";
import type {
  CleanupItem,
  LockedProject,
  MemoryFile,
  Role,
  TranscriptLine,
} from "./types";

export const MAX_LOCKS = 8;
export const MAX_LOCK_LINES = 40;

type LockSource = {
  files: MemoryFile[];
  trash: MemoryFile[];
  applied: Record<string, boolean>;
  extraCleanup: CleanupItem[];
  analysisMd: string | null;
  claudeProposal: string | null;
  lastDream: string | null;
  extraLines: TranscriptLine[];
  checked: Record<string, boolean>;
  signed: Record<string, boolean>;
  proposedBy: Record<string, Role | "">;
  signedBy: Record<string, Role | "">;
  glass: Record<string, boolean>;
  cleanupMd: string | null;
};

function cloneLines(lines: TranscriptLine[]): TranscriptLine[] {
  return lines.slice(0, MAX_LOCK_LINES).map((l) => ({
    ...l,
    gold: (l.gold ?? []).map((g) => ({ ...g })),
  }));
}

export function captureLock(
  s: LockSource,
  input: { id: string; name: string; kind: "auto" | "named" },
): LockedProject {
  return {
    id: input.id,
    name: input.name,
    at: new Date().toISOString(),
    kind: input.kind,
    files: cloneFiles(s.files),
    trash: cloneFiles(s.trash),
    applied: { ...s.applied },
    extraCleanup: s.extraCleanup.map((e) => ({ ...e })),
    analysisMd: s.analysisMd,
    claudeProposal: s.claudeProposal,
    lastDream: s.lastDream,
    extraLines: cloneLines(s.extraLines),
    checked: { ...s.checked },
    signed: { ...s.signed },
    proposedBy: { ...s.proposedBy },
    signedBy: { ...s.signedBy },
    glass: { ...s.glass },
    cleanupMd: s.cleanupMd,
  };
}

function slug(name: string, id: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "lock"}-${id.slice(-6)}`;
}

export function lockToZipFiles(lock: LockedProject): { path: string; body: string }[] {
  const out: { path: string; body: string }[] = lock.files.map((f) => ({
    path: f.name,
    body: f.body,
  }));
  out.push({
    path: "SOMNUS-LOCK.md",
    body: `# ${lock.name}

Locked: ${lock.at}
Kind: ${lock.kind ?? "named"}
Last dream: ${lock.lastDream ?? "never"}
Files: ${lock.files.length}
Pasted lines held: ${lock.extraLines?.length ?? 0}

This zip is the copy Somnus held in the browser. It is not the assistant's disk.
Paste SUMMON.md into a fresh session. Restore the lock in Somnus if you still have this browser.
`,
  });
  out.push({
    path: "SUMMON.md",
    body: buildSummonPack({
      at: lock.at,
      lastDream: lock.lastDream,
      files: lock.files,
      extras: lock.extraCleanup,
      applied: lock.applied,
      analysisMd: lock.analysisMd,
      claudeProposal: lock.claudeProposal,
      pastedLines: lock.extraLines?.length ?? 0,
      lastJob: null,
      frozen: false,
      locks: [{ name: lock.name, at: lock.at, files: lock.files.length }],
    }),
  });
  if (lock.analysisMd) out.push({ path: "dream/ANALYSIS.md", body: lock.analysisMd });
  if (lock.cleanupMd) out.push({ path: "dream/CLEANUP.md", body: lock.cleanupMd });
  if (lock.claudeProposal) {
    out.push({ path: "CLAUDE-proposal.md", body: lock.claudeProposal });
  }
  if (lock.extraLines?.length) {
    out.push({
      path: "pasted-sessions.jsonl",
      body: lock.extraLines
        .map((l) =>
          JSON.stringify({
            session: l.session,
            date: l.date,
            kind: l.kind,
            text: l.text,
          }),
        )
        .join("\n"),
    });
  }
  return out;
}

export function lockerZipFiles(
  locks: LockedProject[],
  current?: LockedProject,
): { path: string; body: string }[] {
  const files: { path: string; body: string }[] = [];
  if (current) {
    for (const f of lockToZipFiles(current)) {
      files.push({ path: `current/${f.path}`, body: f.body });
    }
  }
  for (const lock of locks) {
    const dir = slug(lock.name, lock.id);
    for (const f of lockToZipFiles(lock)) {
      files.push({ path: `${dir}/${f.path}`, body: f.body });
    }
  }
  return files;
}
