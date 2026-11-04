export interface SkillFile {
  path: string;
  title: string;
  body: string;
}

export const SKILL_FILES: SkillFile[] = [
  {
    path: "session-analysis/SKILL.md",
    title: "session-analysis",
    body: `# session-analysis

Trigger: "analyze sessions", /session-analysis

Mine transcripts for durable lessons. Do not write memory.

## Locate

- Transcripts: \`~/.claude/projects/<slug>/*.jsonl\` and \`sessions/\` if present
- Only files newer than \`.last-dream\`
- Never read whole JSONL. Grep narrowly, then read ±2 lines around a hit.

## Two-pass gather (required)

Default ripgrep has no lookahead or lookbehind. Do not use \`(?<=…)\`.

Do this **line-level**. Do not use \`rg -l\` (that keeps or drops whole files). Claude JSONL keys are unordered, \`type\` is not always first.

1. User turns, drop tool dumps:

\`\`\`bash
# files newer than last dream (all files if .last-dream is missing)
files=$(find ~/.claude/projects/<slug> -name '*.jsonl' \\
  \\( -newer memory/dream/.last-dream -o ! -e memory/dream/.last-dream \\) )

# keep lines whose JSON type is user; drop lines that are tool_result payloads
rg -n --glob '*.jsonl' '"type"[[:space:]]*:[[:space:]]*"user"' $files \\
  | rg -v '"type"[[:space:]]*:[[:space:]]*"tool_result"'
\`\`\`

2. Phrase-grep those lines (consume the continuation, do not peek):

\`\`\`bash
rg -n -i 'no,|that.?s wrong|actually|stop doing|don.?t do|never (do|use)|remember (this|that)|from now on|going forward|always use|let.?s go with|we agreed|I decided|again|every time'
\`\`\`

If \`rg --pcre2\` is available, you may tighten tails:

- \`\\bno(?=\\s*[,.!?])\`
- \`\\balways(?=\\s+(use|do)\\b)\`
- \`\\bremember(?=\\s+(this|that)\\b)\`

Do not scan \`(x+)+y\` or \`(?=.*token)\` from every position on long tool_result lines.

## Recurrence

A single "again" is noise. The same stem in ≥2 sessions since last dream is a lesson.

## Write

Save \`memory/dream/analysis-YYYY-MM-DD.md\`:

\`\`\`
# Session analysis, YYYY-MM-DD
## Durable lessons
## Preference changes
## Repeated mistakes
## Candidates for new topic files
## Ignore (noise)
\`\`\`

Label anything without a transcript hit UNVERIFIED. Do not copy project-shared knowledge into personal memory.
`,
  },
  {
    path: "improve-memory/SKILL.md",
    title: "improve-memory",
    body: `# improve-memory

Input: memory dir + the latest analysis file.
Output: \`memory/dream/cleanup-YYYY-MM-DD.md\`, draft only. Do not write topic files.

## Split

Auto-approved (no interpretation):

- relative → absolute dates
- merge near-duplicate files
- prune dead index links
- demote verbose MEMORY.md lines into topic files
- delete facts disproved by the current codebase

Needs judgment (leave unchecked):

- contradictions
- "should this be forgotten?"
- promoting a one-off into a standing rule
- anything that would change how Claude behaves

Do not touch:

- CLAUDE.md (propose a reconciliation block only)
- UNVERIFIED items

## Format

\`\`\`
# Memory cleanup draft, YYYY-MM-DD
## Auto-approved (mechanical)
- [ ] …
## Needs your judgment
- [ ] …
## Do not touch
- CLAUDE.md
\`\`\`
`,
  },
  {
    path: "send-results/SKILL.md",
    title: "send-results",
    body: `# send-results

Dumb delivery. No analysis. No memory writes.

Read \`~/.claude/skills/dream/config.md\`:

\`\`\`
DELIVER_TO=file
REPORT_PATH=~/.claude/projects/<slug>/memory/dream/REPORT.md
# DELIVER_TO=slack  WEBHOOK=https://hooks.slack.com/...
\`\`\`

Post:

\`\`\`
Dream report YYYY-MM-DD
Auto-applied: N
Waiting on you: N
Applied last run: …
\`\`\`

If DELIVER_TO=file, write REPORT_PATH. If slack/discord, POST the markdown to the webhook. If nothing changed, still send a short "already tight" note.
`,
  },
  {
    path: "dream/SKILL.md",
    title: "dream",
    body: `# dream

Orchestrator. Trigger: /dream

ORIENT → GATHER (session-analysis)
      → DRAFT (improve-memory)
      → APPLY only auto-approved + previously checked judgment items
      → PRUNE & INDEX MEMORY.md
      → DELIVER (send-results)

## Hard rules

- Snapshot first: \`cp -R memory memory/.snapshots/YYYY-MM-DD\`
- Never rm. Move superseded files to memory/TRASH/
- Never rewrite CLAUDE.md
- Grep transcripts, do not read them whole
- Rebuild MEMORY.md under 200 lines / ~25KB, one hook per topic, ~150 chars, absolute dates
- Write \`.last-dream\` when done
- If nothing changed, say so and still deliver

## Apply (gated)

Apply auto-approved items now.
Leave judgment items unchecked unless the user already ticked them in a prior cleanup-*.md.
That is the whole gate. Do not "helpfully" resolve REST vs GraphQL.

## apply-fixes (fast pass)

If invoked as apply-fixes: read the latest cleanup-*.md, apply only boxes checked since last run, send a short confirmation. Do not start a new analysis.
`,
  },
  {
    path: "dream/config.md",
    title: "config",
    body: `DELIVER_TO=file
REPORT_PATH=./memory/dream/REPORT.md
`,
  },
  {
    path: "dream/ROUTINES.md",
    title: "routines",
    body: `# Two routines (Claude Code v2.1.80+ /schedule or /routines)

This is what makes it a program instead of a button.

## Full dream, weekly

Prompt:

\`\`\`
Run /dream. Do not apply judgment items. Report to my channel.
\`\`\`

Cadence: weekly (nightly if you have volume).

## Apply-fixes, daily

Prompt:

\`\`\`
Read memory/dream/cleanup-*.md. Apply only items I checked since last run. Send a short confirmation. Do not start a new analysis.
\`\`\`

Cadence: daily or every couple of days. Approvals do not wait a week.

## No cloud routines: Stop hook

On session end, if 24h since .last-dream and 5+ sessions, write \`~/.claude/.dream-pending\`.

On session start, CLAUDE.md says: if that flag exists, run /dream as a background subagent, then delete the flag.

Native AutoDream (if /memory shows Auto-dream: on) already gates on 24h + 5 sessions and writes memory directly. Keep this pack on top if you want the approval split and a delivery channel.
`,
  },
];

export const INSTALL_MD = `# Somnus gated dream, install

This zip is the program that lives next to the assistant. The browser tab cannot write your home directory.

## 1. Skills

Copy the skill folders into \`~/.claude/skills/\` (user) or \`.claude/skills/\` (project):

\`\`\`
session-analysis/SKILL.md
improve-memory/SKILL.md
send-results/SKILL.md
dream/SKILL.md
dream/config.md
dream/ROUTINES.md
\`\`\`

Or run \`machine/install-watch.sh\` (Mac/Linux) or double-click \`machine/install-watch.bat\` (Windows).

## 2. Disk watch (the night watchman)

\`machine/somnus-watch.sh\` copies memory and a few recent session files into \`~/Somnus/locks\` every 15 minutes, and when a session ends.

Mac/Linux: \`sh machine/install-watch.sh\`
Windows: double-click \`machine/install-watch.bat\` (no Python, bypasses PowerShell policy). Then double-click \`machine/sidecar.bat\` and leave it open.

Read \`machine/MACHINE.md\` and \`machine/WINDOWS.md\`.

## 2b. Magician-style RAM (the computer that runs the assistant)

The downloaded kit **can** write on that computer.

- **Mac:** unzip, right-click \`machine/sidecar.command\` → Open (password like Magician, leave it open). Somnus auto-listens. Or \`fan.command\` / \`clear.command\`.
- **Windows:** double-click \`machine/install-watch.bat\`, then \`machine/sidecar.bat\` (leave it open). Then Listen in Somnus. \`clear.bat\` is Magician-clear. Python is not required.
- **Linux:** \`sh machine/status.sh\`, \`sudo sh machine/clear.sh\`, \`sh machine/fan.sh auto|quiet|balanced|full\`.
- **iPhone / iPad / Android:** locker + summon pack only. They cannot Magician-clear the phone or see the assistant. Download the kit, run it on Windows or Mac.

Status writes \`~/Somnus/watch/machine.json\`. Clear does **not** kill the assistant. Quit it to drop its live heap.

## 3. You still paste CLAUDE.md

- \`machine/CLAUDE-FRAGMENT.md\` → project CLAUDE.md (human-owned)
- SessionEnd hook: Windows installer merges via merge-hooks.ps1 (no Python). Mac/Linux merges if python3 is there. Otherwise merge \`machine/hooks-fragment.json\` or \`machine/hooks-fragment-win.json\` into \`~/.claude/settings.json\` yourself. Do not replace the whole file.

Then in the assistant session:

1. /dream once in draft-only mode. Review cleanup-*.md. Check judgment boxes.
2. Add the two routines in ROUTINES.md.
3. Confirm DELIVER_TO in dream/config.md.

Do not enable "apply all judgment automatically." That collapses the gate.

The preview daemon in this app is a simulator. These files plus the watch script are the real program on disk.
`;

export function packMarkdown(): string {
  return [
    INSTALL_MD,
    ...SKILL_FILES.map((f) => `---\n\n# ${f.path}\n\n${f.body}`),
  ].join("\n\n");
}
