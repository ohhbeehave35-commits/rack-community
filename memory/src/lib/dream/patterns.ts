import type { PatternMode } from "./types";

export const MODE_META: Record<
  PatternMode,
  { label: string; blurb: string; pattern: string }
> = {
  raw: {
    label: "Unanchored",
    blurb: "Austin’s paste: substring search. High recall, noisy on tool dumps and assistant talk.",
    pattern:
      "actually|no,|wrong|incorrect|stop|don't|never do|remember this|from now on|always|save that|let's go with|again|every time",
  },
  bounded: {
    label: "Word-bounded",
    blurb: "\\\\b on every singleton. Kills WrongPassword and copyright; still hits assistant “I’ll always…”.",
    pattern:
      "\\b(actually|wrong|incorrect|stop|don't|never do|remember this|from now on|always|save that|let's go with|again|every time)\\b|\\bno,",
  },
  lookahead: {
    label: "Lookahead",
    blurb: "Peek right-context. no only with punctuation; always only before use/do; remember only before this|that.",
    pattern:
      "\\bno(?=\\s*[,.!?])|\\bactually\\b|\\bremember(?=\\s+(this|that)\\b)|\\bfrom now on\\b|\\balways(?=\\s+(use|do)\\b)|\\bstop(?=\\s+doing\\b)|\\bagain\\b(?!\\s+I'll\\b)|\\bevery time\\b|\\blet's go with\\b|\\bwe agreed\\b|\\bthat's not\\b|\\bthat's wrong\\b|\\bnever (do|use)\\b",
  },
  lookbehind: {
    label: "Lookbehind",
    blurb: "Pin left-context. this only after remember; do only after never/don't. Illegal in default ripgrep.",
    pattern:
      "(?<=remember )(this|that)|(?<=never )(do|use)|(?<=don't )do|(?<=\\bno),|(?<![\\w.])\\bwrong\\b",
  },
  twopass: {
    label: "Two-pass",
    blurb: "Filter ^type:user and drop tool_result, then word-bounded phrases. The skill’s production shape.",
    pattern:
      "\\bno(?=\\s*[,.!?])|\\bactually\\b|\\bremember this\\b|\\bfrom now on\\b|\\balways use\\b|\\bstop doing\\b|\\bagain\\b|\\bevery time\\b|\\blet's go with\\b|\\bwe agreed\\b|\\bthat's wrong\\b|\\bnever use\\b|\\bgoing forward\\b|\\bI decided\\b",
  },
};

export const AUSTIN_BUCKETS = [
  {
    id: "correction" as const,
    title: "Corrections",
    hint: "Highest priority. You told the agent it was wrong.",
    words: ["wrong", "no,", "actually", "stop", "don't", "never do", "that's not"],
  },
  {
    id: "preference" as const,
    title: "Explicit memory",
    hint: "Standing rules, not one-off answers.",
    words: ["remember this", "from now on", "always", "save that", "going forward"],
  },
  {
    id: "decision" as const,
    title: "Decisions",
    hint: "Architecture / tooling / workflow commitments.",
    words: ["let's go with", "I decided", "we're using", "we agreed"],
  },
  {
    id: "recurring" as const,
    title: "Recurring themes",
    hint: "The same friction across sessions.",
    words: ["again", "every time", "keep forgetting", "as usual"],
  },
];
