/**
 * Somnus memory as an MCP server (stdio). Read-only: search, list and read the memory folder you point it at.
 *   SOMNUS_MEMORY_DIR=/path/to/memory node src/mcp.ts
 * Writing memory is not offered here on purpose: changes go through the Somnus dream (diff, then a yes).
 */
import { SomnusMemory } from "./index.ts";

type Req = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: any };
type Res = { jsonrpc: "2.0"; id: number | string | null; result?: unknown; error?: { code: number; message: string } };

const TOOLS = [
  { name: "somnus_search_memory", description: "Search the memory files with a plain-English question. Returns the best lines with file and line number.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"], additionalProperties: false } },
  { name: "somnus_list_memory", description: "List the memory files and their line counts.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "somnus_read_memory", description: "Read one memory file by name.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false } },
];

const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], isError });

export function createMcpHandler(memory: SomnusMemory) {
  return (req: Req): Res | null => {
    const id = req.id ?? null;
    if (req.method === "notifications/initialized" || req.id === undefined) return null;
    if (req.method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: req.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "somnus-memory", version: "1.0.0" } } };
    if (req.method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (req.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    if (req.method === "tools/call") {
      const name = req.params?.name as string;
      const a = (req.params?.arguments ?? {}) as Record<string, unknown>;
      if (name === "somnus_search_memory") {
        if (typeof a.query !== "string" || !a.query.trim()) return { jsonrpc: "2.0", id, result: text("Give a question to search for.", true) };
        const limit = typeof a.limit === "number" ? Math.max(1, Math.min(20, Math.floor(a.limit))) : 5;
        const hits = memory.search(a.query, { limit });
        return { jsonrpc: "2.0", id, result: text(hits.length ? hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n") : "No memory line matches that.") };
      }
      if (name === "somnus_list_memory") return { jsonrpc: "2.0", id, result: text(memory.list().map((f) => `${f.name} (${f.lines} lines)`).join("\n")) };
      if (name === "somnus_read_memory") {
        const body = typeof a.name === "string" ? memory.read(a.name) : null;
        return { jsonrpc: "2.0", id, result: body === null ? text("No memory file with that name.", true) : text(body) };
      }
      return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool ${name}` } };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  };
}

export function serveStdio(dir: string) {
  const handle = createMcpHandler(SomnusMemory.fromDirectory(dir));
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let res: Res | null;
      try { res = handle(JSON.parse(line)); } catch { res = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }; }
      if (res) process.stdout.write(JSON.stringify(res) + "\n");
    }
  });
}
