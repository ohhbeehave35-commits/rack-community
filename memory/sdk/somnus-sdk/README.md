# @rack-community/somnus-sdk

Read, search and score a Somnus memory folder from your own code. No account, no network, no dependencies. Read-only: changes to memory go through the Somnus dream, which shows a diff and waits for a yes.

```ts
import { SomnusMemory } from "@rack-community/somnus-sdk";

const memory = SomnusMemory.fromDirectory("/path/to/memory");   // every .md file in the folder
memory.list();                                                   // [{ name, lines }]
memory.read("stack.md");                                         // the file text, or null
memory.search("which package manager do I use?");                // [{ file, line, text, score }]
memory.benchmark([{ q: "what database", expect: "stack.md" }]);  // { recallAt1, recallAt3, recallAt5, mrr, misses }
```

Search is plain-English and runs on your machine: it ranks lines (BM25) with a small list of everyday synonyms, so "why did the login tests break" finds the line about the failed auth tests.

`benchmark` scores search on your own questions: for each, did the right file come back first, in the top 3, in the top 5, and the mean reciprocal rank. It is the same method long-memory benchmarks report; it is not the public LoCoMo or LongMemEval data.

## MCP server (stdio, read-only)

```
SOMNUS_MEMORY_DIR=/path/to/memory node --experimental-strip-types src/bin.ts
```

Tools: `somnus_search_memory`, `somnus_list_memory`, `somnus_read_memory`. Add it to an AI tool's MCP settings as a command. There is deliberately no write tool.

## Tests

`npm test` inside this folder (Node 22.6 or newer). 6 tests: search, benchmark, folder reading, the MCP messages, and the MCP server over a real pipe.
