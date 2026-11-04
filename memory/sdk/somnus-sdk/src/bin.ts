#!/usr/bin/env node
// Start the read-only Somnus memory MCP server:  SOMNUS_MEMORY_DIR=/path/to/memory node src/bin.ts
import { serveStdio } from "./mcp.ts";

const dir = process.env.SOMNUS_MEMORY_DIR;
if (!dir) {
  process.stderr.write("Set SOMNUS_MEMORY_DIR to the memory folder.\n");
  process.exit(2);
}
serveStdio(dir);
