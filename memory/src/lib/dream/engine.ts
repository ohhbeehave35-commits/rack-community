import { MODE_META } from "./patterns";
import { TRANSCRIPTS, LONG_NOISE } from "./transcripts";
import { isUserJsonl } from "./jsonl";
import type {
  EngineId,
  MatchHit,
  ModeReport,
  PatternMode,
  Support,
  TranscriptLine,
} from "./types";

function goldKeys(corpus: TranscriptLine[]) {
  return new Set(
    corpus.flatMap((line) =>
      line.gold.map((g) => `${line.id}:${g.start}:${g.end}`),
    ),
  );
}

function overlapsGold(line: TranscriptLine, start: number, end: number) {
  return line.gold.some((g) => start < g.end && end > g.start);
}

export function isUserSignalLine(line: TranscriptLine) {
  return isUserJsonl(line);
}

const MATCH_BUDGET_MS = 80;
const MAX_HITS = 400;
const MAX_LINE = 4096;

function collectHits(lines: TranscriptLine[], re: RegExp): MatchHit[] {
  const hits: MatchHit[] = [];
  const t0 = performance.now();
  for (const line of lines) {
    if (performance.now() - t0 > MATCH_BUDGET_MS) break;
    if (hits.length >= MAX_HITS) break;
    const text =
      line.text.length > MAX_LINE ? line.text.slice(0, MAX_LINE) : line.text;
    const copy = new RegExp(
      re.source,
      re.flags.includes("g") ? re.flags : `${re.flags}g`,
    );
    try {
      for (const m of text.matchAll(copy)) {
        const start = m.index ?? 0;
        const matched = m[0] ?? "";
        if (!matched) break;
        const end = start + matched.length;
        hits.push({
          lineId: line.id,
          start,
          end,
          text: matched.slice(0, 200),
          truePositive: overlapsGold(line, start, end),
          unverified: line.gold.length === 0,
        });
        if (hits.length >= MAX_HITS) break;
      }
    } catch {
      continue;
    }
  }
  return hits;
}

export function runMode(
  mode: PatternMode,
  source: string = MODE_META[mode].pattern,
  corpus: TranscriptLine[] = TRANSCRIPTS,
): ModeReport {
  const keys = goldKeys(corpus);
  const danger = classifyLookahead(source);
  if (danger.nestedStar) {
    return {
      mode,
      pattern: source,
      hits: [],
      precision: 0,
      recall: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: keys.size,
      elapsedMs: 0,
      error:
        "Refusing nested quantifiers. That pattern can explode on a long tool dump.",
    };
  }
  const lines = mode === "twopass" ? corpus.filter(isUserSignalLine) : corpus;
  const t0 = performance.now();
  try {
    const re = new RegExp(source, "gi");
    const hits = collectHits(lines, re);
    const elapsedMs = performance.now() - t0;
    const labeled = new Set(
      corpus.filter((l) => l.gold.length > 0).map((l) => l.id),
    );
    const scored = hits.filter((h) => labeled.has(h.lineId));
    const tp = scored.filter((h) => h.truePositive).length;
    const fp = scored.length - tp;
    const covered = new Set(
      scored.filter((h) => h.truePositive).map((h) => {
        const line = corpus.find((l) => l.id === h.lineId);
        const g = line?.gold.find((s) => h.start < s.end && h.end > s.start);
        return g ? `${h.lineId}:${g.start}:${g.end}` : "";
      }),
    );
    covered.delete("");
    const fn = [...keys].filter((k) => !covered.has(k)).length;
    const precision = scored.length ? tp / scored.length : 1;
    const recall = keys.size ? covered.size / keys.size : 1;
    return {
      mode,
      pattern: source,
      hits,
      precision,
      recall,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      elapsedMs,
    };
  } catch (err) {
    return {
      mode,
      pattern: source,
      hits: [],
      precision: 0,
      recall: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: goldKeys(corpus).size,
      elapsedMs: performance.now() - t0,
      error: err instanceof Error ? err.message : "Invalid pattern",
    };
  }
}

export function highlight(
  text: string,
  hits: { start: number; end: number; truePositive: boolean; unverified?: boolean }[],
) {
  const sorted = [...hits].sort((a, b) => a.start - b.start);
  const bits: { text: string; kind: "plain" | "tp" | "fp" | "uv" }[] = [];
  let cursor = 0;
  for (const h of sorted) {
    if (h.start < cursor) continue;
    if (h.start > cursor) {
      bits.push({ text: text.slice(cursor, h.start), kind: "plain" });
    }
    bits.push({
      text: text.slice(h.start, h.end),
      kind: h.unverified ? "uv" : h.truePositive ? "tp" : "fp",
    });
    cursor = h.end;
  }
  if (cursor < text.length) bits.push({ text: text.slice(cursor), kind: "plain" });
  return bits;
}

export interface LookbehindReport {
  bodies: string[];
  variable: boolean;
  unbounded: boolean;
  mixedAlt: boolean;
  maxLen: number | null;
  jsCompiles: boolean;
  jsError?: string;
  engines: Record<EngineId, Support>;
  note: string;
}

function altLengths(body: string): number[] | null {
  if (!body.includes("|") || /[()[\]*+?{]/.test(body)) return null;
  return body.split("|").map((p) => p.length);
}

function lookbehindBodies(pattern: string): string[] {
  const out: string[] = [];
  const re = /\(\?<[=!]([\s\S]*?)\)/g;
  for (const m of pattern.matchAll(re)) {
    if (m[1] != null) out.push(m[1]);
  }
  return out;
}

export function inspectLookbehind(pattern: string): LookbehindReport {
  const bodies = lookbehindBodies(pattern);
  let variable = false;
  let unbounded = false;
  let mixedAlt = false;
  let maxLen: number | null = 0;
  for (const body of bodies) {
    if (/[*+?]|\{\d+,/.test(body)) variable = true;
    if (/[*+]|\{\d*,\}/.test(body) && !/\{\d+,\d+\}/.test(body)) unbounded = true;
    const lens = altLengths(body);
    if (lens && new Set(lens).size > 1) mixedAlt = true;
    const bounded = body.match(/\{(\d+),(\d+)\}/);
    if (bounded) {
      const hi = Number(bounded[2]);
      maxLen = Math.max(maxLen ?? 0, hi);
    } else if (!variable) {
      maxLen = Math.max(maxLen ?? 0, body.length);
    }
  }
  if (bodies.length === 0) maxLen = null;

  let jsCompiles = true;
  let jsError: string | undefined;
  try {
    void new RegExp(pattern);
  } catch (err) {
    jsCompiles = false;
    jsError = err instanceof Error ? err.message : "compile failed";
  }

  const engines: Record<EngineId, Support> = {
    js: jsCompiles ? "yes" : "no",
    rg: "no",
    "grep-e": "no",
    "grep-p": unbounded || variable ? "no" : mixedAlt ? "no" : "fixed",
    pcre2: unbounded ? "no" : variable ? "bounded" : "yes",
    python: unbounded || variable ? "no" : mixedAlt ? "yes" : "fixed",
    java: unbounded ? "no" : "bounded",
    dotnet: "yes",
  };

  let note = "No lookbehind in this pattern.";
  if (bodies.length) {
    if (unbounded) {
      note =
        "Unbounded lookbehind ( * or + ). Only .NET and modern JS accept this. PCRE2 refuses patterns with no max length.";
    } else if (variable && (maxLen ?? 0) > 255) {
      note = `Variable lookbehind max ${maxLen} > PCRE2’s default 255. Shorten the bound or use \\K / two-pass grep.`;
    } else if (variable) {
      note =
        "Variable-length lookbehind. JS and PCRE2 (≤255) allow it; Python, PCRE1, and default ripgrep do not.";
    } else if (mixedAlt) {
      note =
        "Alternation of different fixed lengths. Python allows it; PCRE1 often rejects it. Split into two assertions.";
    } else {
      note =
        "Fixed-width lookbehind. Compiles anywhere lookbehind exists, still illegal in default ripgrep.";
    }
  }

  return {
    bodies,
    variable,
    unbounded,
    mixedAlt,
    maxLen,
    jsCompiles,
    jsError,
    engines,
    note,
  };
}

export function classifyLookahead(pattern: string) {
  const has = /\(\?=|\(\?!/.test(pattern);
  const nestedStar =
    /\([^)]*[+*][^)]*\)[+*]/.test(pattern) ||
    /\([^)]*[+*][^)]*\)\{\d*,/.test(pattern) ||
    /\(\?=.*\.\*.*\.\*\)/.test(pattern);
  const leadingScan = /\(\?[=!][^)]*\.\*/.test(pattern);
  const anded = (pattern.match(/\(\?[=!]/g) ?? []).length >= 2;
  let cost: "O(n)" | "O(n²)" | "O(k·n²)" | "exponential" = "O(n)";
  let blurb =
    "No lookahead. One left-to-right scan; cost tracks line length.";
  if (nestedStar) {
    cost = "exponential";
    blurb =
      "Nested quantifiers. On a long tool_result line this can run away. Never ship this in session-analysis.";
  } else if (anded && leadingScan) {
    cost = "O(k·n²)";
    blurb =
      "Several (?=.*X) peeks from the same cursor. Each rescan of the line multiplies. Put the cheap fail-fast peek first.";
  } else if (leadingScan) {
    cost = "O(n²)";
    blurb =
      "(?=.*token) from every position is a nested scan. Fine on a 200-byte prompt; miserable on a 20 KB dump.";
  } else if (has) {
    cost = "O(n)";
    blurb =
      "Fixed or short lookahead. Extra constant work per position, the right tool for no, and always use.";
  }
  return { has, nestedStar, leadingScan, anded, cost, blurb };
}

export function bench() {
  const hay = (LONG_NOISE.text + "\n").repeat(2).slice(0, 16_000);
  const sizes = [1500, 6000, hay.length];
  return sizes.map((n) => {
    const slice = hay.slice(0, n);
    const run = (source: string) => {
      const re = new RegExp(source, "g");
      const t0 = performance.now();
      for (let i = 0; i < 24; i++) {
        re.lastIndex = 0;
        let c = 0;
        while (re.exec(slice)) {
          c += 1;
          if (c > 200) break;
          if (performance.now() - t0 > 40) break;
        }
      }
      return Number((performance.now() - t0).toFixed(2));
    };
    return {
      n,
      bounded: run(String.raw`\bwrong\b`),
      scan: run(String.raw`(?=.*wrong)`),
      anded: run(String.raw`(?=.*wrong)(?=.*always)(?=.*REST)`),
    };
  });
}

export const ENGINE_LABEL: Record<EngineId, string> = {
  js: "JavaScript",
  rg: "ripgrep default",
  "grep-e": "grep -E",
  "grep-p": "grep -P (PCRE1)",
  pcre2: "PCRE2 / rg --pcre2",
  python: "Python re",
  java: "Java",
  dotnet: ".NET",
};
