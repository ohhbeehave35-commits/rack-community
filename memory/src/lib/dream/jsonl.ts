import type { LineKind, TranscriptLine } from "./types";

export function toJsonl(line: TranscriptLine): string {
  if (line.kind === "tool_result") {
    return JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", content: line.text }] },
    });
  }
  return JSON.stringify({
    type: line.kind,
    message: { content: line.text },
  });
}

function flattenContent(content: unknown): { kind: LineKind; text: string } {
  if (typeof content === "string") return { kind: "user", text: content };
  if (Array.isArray(content)) {
    const texts = content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && (p as { type?: string }).type === "tool_result") {
          return "";
        }
        if (p && typeof p === "object" && "text" in p) {
          return String((p as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean);
    if (texts.length) return { kind: "user", text: texts.join("\n") };
    const tool = content.find(
      (p) => p && typeof p === "object" && (p as { type?: string }).type === "tool_result",
    );
    if (tool && typeof tool === "object") {
      const c = (tool as { content?: unknown }).content;
      return { kind: "tool_result", text: typeof c === "string" ? c : JSON.stringify(c) };
    }
    return { kind: "user", text: "" };
  }
  return { kind: "user", text: String(content ?? "") };
}

const MAX_RAW = 80_000;

export function parseJsonl(raw: string): TranscriptLine[] {
  const clipped = raw.length > MAX_RAW ? raw.slice(0, MAX_RAW) : raw;
  const out: TranscriptLine[] = [];
  const lines = clipped.split(/\r?\n/);
  const batch = `paste-${Date.now().toString(36)}`;
  let n = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    n += 1;
    const id = `${batch}-${n}`;
    try {
      const obj = JSON.parse(trimmed) as {
        type?: string;
        sessionId?: string;
        session?: string;
        message?: { content?: unknown };
        content?: unknown;
      };
      const type = obj.type ?? "user";
      const session =
        (typeof obj.sessionId === "string" && obj.sessionId) ||
        (typeof obj.session === "string" && obj.session) ||
        batch;
      const date = new Date().toISOString().slice(0, 10);
      if (type === "assistant") {
        const { text } = flattenContent(obj.message?.content ?? obj.content ?? "");
        out.push({
          id,
          session,
          date,
          kind: "assistant",
          text: text.slice(0, 4000),
          gold: [],
        });
        continue;
      }
      const flat = flattenContent(obj.message?.content ?? obj.content ?? trimmed);
      out.push({
        id,
        session,
        date,
        kind: flat.kind,
        text: flat.text.slice(0, 4000),
        gold: [],
      });
    } catch {
      out.push({
        id,
        session: batch,
        date: new Date().toISOString().slice(0, 10),
        kind: "user",
        text: trimmed.slice(0, 4000),
        gold: [],
      });
    }
  }
  return out;
}

export function isUserJsonl(line: TranscriptLine) {
  return line.kind === "user";
}
