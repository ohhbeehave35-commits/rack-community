/**
 * @rack-community/somnus-sdk: read, search and score a Somnus memory folder from your own code.
 *
 * Self-contained (no dependencies). It works on the memory files themselves (plain markdown), so it needs no account and sends
 * nothing anywhere. Writing memory stays with the Somnus dream, which shows a diff and waits for a yes; this package is read-only.
 */

export type MemoryDoc = { name: string; body: string; hook?: string };
export type SearchHit = { file: string; line: number; text: string; score: number };
export type SearchOptions = { limit?: number };
export type BenchCase = { q: string; expect: string };
export type BenchResult = { cases: number; recallAt1: number; recallAt3: number; recallAt5: number; mrr: number; misses: { q: string; expect: string; got: string[] }[]; ranks: (number | null)[] };

const STOP = new Set("a an the and or of to in on at for from by with is are was were be been do does did i we you my our your it this that these those what which who whom whose when where why how can could should would will shall may might me us any some there here as if so than then about into over under not no".split(" "));
// Words people use for the same thing. Expanded terms count for half.
const GROUPS: string[][] = [
  ["break", "broke", "broken", "fail", "failed", "failing", "failure", "flaky", "flake", "error", "bug"],
  ["login", "signin", "sign", "auth", "password", "authentication", "account"],
  ["edit", "rewrite", "change", "modify", "write", "touch"],
  ["database", "db", "postgres", "sql"],
  ["package", "pnpm", "npm", "yarn", "dependency"],
  ["api", "rest", "endpoint", "graphql"],
  ["old", "superseded", "stale", "outdated", "previous"],
  ["secret", "env", "credential", "key"],
  ["date", "time", "when", "day", "week"],
  ["css", "style", "styling", "tailwind", "framework", "vite", "tanstack", "frontend"],
  ["delete", "remove", "rm", "drop", "trash"],
];

const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w.length > 3 ? w.replace(/s$/, "") : w);
export function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem);
}
const GROUP_OF = new Map<string, string[]>();
for (const g of GROUPS) for (const w of g.map(stem)) GROUP_OF.set(w, g.map(stem));

type Chunk = { file: string; line: number; text: string; toks: string[] };

export function searchMemories(files: MemoryDoc[], query: string, opts: SearchOptions = {}): SearchHit[] {
  const q = tokens(query);
  if (!q.length) return [];
  const weights = new Map<string, number>();
  for (const t of q) {
    weights.set(t, 1);
    for (const x of GROUP_OF.get(t) ?? []) if (!weights.has(x)) weights.set(x, 0.5);
  }
  const chunks: Chunk[] = [];
  for (const f of files) {
    f.body.split(/\r?\n/).forEach((text, i) => {
      if (text.trim()) chunks.push({ file: f.name, line: i + 1, text: text.trim(), toks: tokens(text) });
    });
  }
  const N = chunks.length || 1;
  const avg = chunks.reduce((n, c) => n + c.toks.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const c of chunks) for (const t of new Set(c.toks)) df.set(t, (df.get(t) ?? 0) + 1);
  const meta = new Map(files.map((f) => [f.name, new Set(tokens(`${f.name} ${f.hook ?? ""}`))]));
  const hits: SearchHit[] = [];
  for (const c of chunks) {
    let score = 0;
    for (const [t, w] of weights) {
      const tf = c.toks.filter((x) => x === t).length;
      if (!tf) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += w * idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (c.toks.length / avg))));
    }
    if (!score) continue;
    for (const t of q) if (meta.get(c.file)?.has(t)) score += 0.4;
    if (c.text.startsWith("#")) score *= 0.6; // a heading names a topic; the line under it answers
    hits.push({ file: c.file, line: c.line, text: c.text, score: Math.round(score * 1000) / 1000 });
  }
  hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  return hits.slice(0, opts.limit ?? 5);
}

/** Recall at 1, 3 and 5 and mean reciprocal rank, by FILE: did the right file come back, and how high. The same method LoCoMo and LongMemEval-style runs report, on your own questions. */
export function runBenchmark(files: MemoryDoc[], cases: BenchCase[]): BenchResult {
  const ranks: (number | null)[] = [];
  const misses: BenchResult["misses"] = [];
  for (const c of cases) {
    const order: string[] = [];
    for (const h of searchMemories(files, c.q, { limit: 50 })) if (!order.includes(h.file)) order.push(h.file);
    const r = order.indexOf(c.expect);
    ranks.push(r < 0 ? null : r + 1);
    if (r < 0 || r >= 5) misses.push({ q: c.q, expect: c.expect, got: order.slice(0, 5) });
  }
  const n = cases.length || 1;
  const at = (k: number) => ranks.filter((r) => r !== null && r <= k).length / n;
  return { cases: cases.length, recallAt1: at(1), recallAt3: at(3), recallAt5: at(5), mrr: ranks.reduce<number>((s, r) => s + (r ? 1 / r : 0), 0) / n, misses, ranks };
}

