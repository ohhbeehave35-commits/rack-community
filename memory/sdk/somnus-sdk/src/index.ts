/**
 * @rack-community/somnus-sdk: read, search and score a Somnus memory folder from your own code. See ../README.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { searchMemories, runBenchmark, type BenchCase, type BenchResult, type MemoryDoc, type SearchHit, type SearchOptions } from "./search.ts";

export { searchMemories, runBenchmark, tokens } from "./search.ts";
export type { BenchCase, BenchResult, MemoryDoc, SearchHit, SearchOptions } from "./search.ts";

export class SomnusMemory {
  private readonly files: MemoryDoc[];
  constructor(files: MemoryDoc[]) { this.files = files; }
  /** Reads every .md file directly inside the folder (no sub-folders, nothing outside it). */
  static fromDirectory(dir: string): SomnusMemory {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => ({ name: e.name, body: readFileSync(join(dir, e.name), "utf8") }));
    return new SomnusMemory(files);
  }
  list(): { name: string; lines: number }[] { return this.files.map((f) => ({ name: f.name, lines: f.body.split(/\r?\n/).length })); }
  read(name: string): string | null { return this.files.find((f) => f.name === name)?.body ?? null; }
  search(query: string, opts?: SearchOptions): SearchHit[] { return searchMemories(this.files, query, opts); }
  benchmark(cases: BenchCase[]): BenchResult { return runBenchmark(this.files, cases); }
}
