import { catalog } from "./derive";
import { CLEANUP } from "./memory";
import { AUSTIN_BUCKETS } from "./patterns";
import type { CleanupItem, Lesson, MatchHit, SignalBucket, TranscriptLine } from "./types";

export interface Analysis {
  date: string;
  lessons: Lesson[];
  recurring: Lesson[];
  unverified: Lesson[];
  markdown: string;
  cleanupMarkdown: string;
  claudeProposal: string;
  alreadyTight: boolean;
}

function bucketFor(text: string): Exclude<SignalBucket, "noise"> | "noise" {
  const t = text.toLowerCase();
  for (const b of AUSTIN_BUCKETS) {
    if (b.words.some((w) => t.includes(w.toLowerCase()))) return b.id;
  }
  return "noise";
}

export function buildAnalysis(input: {
  date: string;
  corpus: TranscriptLine[];
  hits: MatchHit[];
  applied: Record<string, boolean>;
  autoApplied: string[];
  judged: string[];
  waiting: string[];
  extras?: CleanupItem[];
  blocked?: string;
}): Analysis {
  const byLine = new Map(input.corpus.map((l) => [l.id, l]));
  const grouped = new Map<string, Lesson>();

  for (const hit of input.hits) {
    const line = byLine.get(hit.lineId);
    if (!line) continue;
    const lessonText = line.text.replace(/\s+/g, " ").trim().slice(0, 240);
    const key = lessonText.toLowerCase();
    const existing = grouped.get(key);
    const bucket = (line.gold.find((g) => hit.start < g.end && hit.end > g.start)?.bucket ??
      bucketFor(line.text)) as Lesson["bucket"];
    if (existing) {
      if (!existing.sessions.includes(line.session)) existing.sessions.push(line.session);
      if (!existing.lineIds.includes(line.id)) existing.lineIds.push(line.id);
      existing.unverified = existing.unverified && (hit.unverified || !hit.truePositive);
    } else {
      grouped.set(key, {
        text: lessonText,
        bucket,
        sessions: [line.session],
        unverified: hit.unverified || !hit.truePositive,
        lineIds: [line.id],
        recurring: false,
      });
    }
  }

  const lessons = [...grouped.values()].map((l) => ({
    ...l,
    recurring: l.sessions.length >= 2,
  }));
  const recurring = lessons.filter((l) => l.recurring);
  const unverified = lessons.filter((l) => l.unverified);

  const alreadyTight =
    !input.blocked &&
    input.autoApplied.length === 0 &&
    input.judged.length === 0 &&
    input.waiting.length === 0 &&
    unverified.length === 0 &&
    CLEANUP.filter((c) => c.kind === "auto").every((c) => input.applied[c.id]);

  const section = (
    title: string,
    items: Lesson[],
    empty: string,
  ) =>
    `## ${title}\n${
      items.length
        ? items
            .map((l) => {
              const tag = l.unverified ? " UNVERIFIED" : "";
              const rec = l.recurring ? ` · ${l.sessions.length} sessions` : "";
              return `- (${l.bucket})${tag} “${l.text}”${rec}`;
            })
            .join("\n")
        : `- ${empty}`
    }`;

  const tightNote = alreadyTight
    ? `\nMechanical store is already applied. Nothing new to write.\n`
    : "";

  const markdown = `# Session analysis, ${input.date}
${input.blocked ? `\nBLOCKED: ${input.blocked}\n` : ""}${tightNote}
${section("Durable lessons", lessons.filter((l) => !l.unverified && l.bucket !== "noise"), "none")}

${section("Preference changes", lessons.filter((l) => l.bucket === "preference"), "none")}

${section("Repeated mistakes", recurring, "none, need the same stem in ≥2 sessions")}

## Candidates for new topic files
${
  unverified.length
    ? unverified
        .slice(0, 8)
        .map((l) => `- UNVERIFIED fold into existing files: “${l.text}”`)
        .join("\n")
    : "- none (fold into existing stack / preferences / workflow)"
}

${section("Ignore (noise / UNVERIFIED)", unverified, "none")}
`;

  const fromGather = lessons
    .filter((l) => l.bucket !== "noise")
    .map((l) => `- (${l.bucket}${l.unverified ? ", UNVERIFIED" : ""}) ${l.text}`)
    .join("\n");

  const items = catalog(input.extras ?? []);
  const cleanupMarkdown = `# Memory cleanup draft, ${input.date}

## From this gather
${fromGather || "- no new signal this window"}

## Auto-approved (mechanical)
${items
  .filter((c) => c.kind === "auto")
  .map((c) => `- [${input.applied[c.id] ? "x" : " "}] ${c.title}`)
  .join("\n")}

## Needs your judgment
${items
  .filter((c) => c.kind === "judgment")
  .map((c) => {
    const mark = input.applied[c.id] ? "x" : " ";
    const wait = input.waiting.includes(c.id) ? ", waiting" : "";
    const derived = c.derived ? ", from gather" : "";
    return `- [${mark}] ${c.title}${wait}${derived}`;
  })
  .join("\n")}

## Do not touch
- CLAUDE.md, human-owned. See the proposal file. Never silent rewrite.
`;

  const gqlPending = input.waiting.includes("rest-gql");
  const gqlDone = Boolean(input.applied["rest-gql"]);
  const claudeProposal = `# Proposed reconciliation, do not apply

CLAUDE.md is human-owned. Somnus will not write this file.

If you agree, paste the block below into CLAUDE.md yourself.

\`\`\`
## Memory reconciliation (${input.date})
- Package manager: pnpm (never npm)
- Never commit .env
- Shop catalog: ${gqlDone ? "GraphQL" : gqlPending ? "GraphQL (pending dual-sign, do not paste yet)" : "REST until judgment lands"}
- Dates in memory: absolute only
- Snapshot memory before writes; never rm; never rewrite this file from a skill
\`\`\`

Waiting judgment: ${input.waiting.join(", ") || "none"}
`;

  return {
    date: input.date,
    lessons,
    recurring,
    unverified,
    markdown,
    cleanupMarkdown,
    claudeProposal,
    alreadyTight,
  };
}
