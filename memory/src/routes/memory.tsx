import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { lineDiff } from "@/lib/dream/diff";
import { searchMemories } from "../../sdk/somnus-sdk/src/search.ts";
import { HUMAN_FILE, PROJECT } from "@/lib/dream/memory";
import { can } from "@/lib/dream/org";
import { useDream } from "@/lib/dream/store";
import { cn, downloadText } from "@/lib/utils";

export const Route = createFileRoute("/memory")({ component: MemoryPage });

function MemoryPage() {
  const { files, trash, snapshots, rollback, role, frozen, artifacts } = useDream();
  const [tab, setTab] = useState<"live" | "human" | "snap" | "trash" | "dream">(
    "live",
  );
  const [active, setActive] = useState(files[0]?.id ?? "index");
  const [snapAt, setSnapAt] = useState(snapshots[0]?.at ?? "");
  const [showDiff, setShowDiff] = useState(false);
  // PARITY9A: ask the memory a question in plain English; the answer is the best lines with their file and line number.
  const [ask, setAsk] = useState("");
  const hits = useMemo(
    () => (ask.trim() ? searchMemories(files.map((f) => ({ name: f.name, body: f.body, hook: f.hook })), ask, { limit: 5 }) : []),
    [ask, files],
  );

  // The snapshot the Snapshots tab is pointing at, the newest one until the
  // reader picks another. Both the snapshot listing and "Diff vs snapshot" read
  // from this. They used to disagree: the diff was hardwired to `snapshots[0]`,
  // so after a second pass it compared the live files against the state they
  // were already in and rendered an all-unchanged diff, whatever was selected.
  const selectedSnap = snapshots.find((s) => s.at === snapAt) ?? snapshots[0];

  const list =
    tab === "live"
      ? files
      : tab === "trash"
        ? trash
        : tab === "dream"
          ? artifacts
          : tab === "human"
            ? [HUMAN_FILE]
            : (selectedSnap?.files ?? []);
  const file = list.find((f) => f.id === active) ?? list[0];
  const liveTwin = files.find((f) => f.id === file?.id);
  const snapTwin = selectedSnap?.files.find((f) => f.id === file?.id);
  const diff = useMemo(() => {
    if (!showDiff || !file || !snapTwin) return [];
    return lineDiff(snapTwin.body, liveTwin?.body ?? file.body);
  }, [showDiff, file, snapTwin, liveTwin]);

  return (
    <div className="flex flex-col gap-8">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {PROJECT.slug}/memory
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Memory</h1>
        <p className="mt-3 text-muted-foreground">
          The assistant memory file lives beside the store, not in it. Snapshots
          before every write. Nothing is rm’d.
        </p>
      </header>

      <section aria-label="Ask your memory" className="max-w-2xl">
        <label htmlFor="memory-ask" className="text-sm font-medium">
          Ask your memory
        </label>
        <input
          id="memory-ask"
          type="search"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="Which package manager do I use?"
          className="mt-2 h-11 w-full rounded-md border border-border bg-transparent px-3 text-sm"
        />
        {ask.trim() ? (
          hits.length ? (
            <ul className="mt-3 flex flex-col gap-2">
              {hits.map((h) => (
                <li key={`${h.file}:${h.line}`}>
                  <button
                    type="button"
                    className="w-full rounded-md border border-border p-3 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      const f = files.find((x) => x.name === h.file);
                      if (f) {
                        setTab("live");
                        setActive(f.id);
                      }
                    }}
                  >
                    <span className="block font-mono text-xs text-muted-foreground">
                      {h.file} · line {h.line}
                    </span>
                    <span className="mt-1 block">{h.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Nothing in the memory matches that. Try other words.</p>
          )
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["live", "Live"],
            ["human", "Config"],
            ["dream", `Dream files (${artifacts.length})`],
            ["snap", `Snapshots (${snapshots.length})`],
            ["trash", `Trash (${trash.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              if (id === "snap") setSnapAt(snapshots[0]?.at ?? "");
              if (id === "human") setActive(HUMAN_FILE.id);
            }}
            className={cn(
              "h-9 rounded-md px-3 text-sm",
              tab === id ? "bg-accent text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "snap" && snapshots.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {snapshots.map((s) => (
            <button
              key={s.at}
              type="button"
              onClick={() => setSnapAt(s.at)}
              className={cn(
                "h-8 rounded-sm px-2 font-mono text-xs",
                snapAt === s.at
                  ? "bg-primary text-primary-foreground"
                  : "border border-border",
              )}
            >
              {s.at}
            </button>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={!can(role, "rollback") || frozen || !snapAt}
            onClick={() => {
              if (
                window.confirm(
                  `Restore snapshot ${snapAt}? Live files are replaced. The snapshot is kept.`,
                )
              ) {
                rollback(snapAt);
              }
            }}
          >
            Restore this snapshot
          </Button>
        </div>
      ) : null}

      {list.length === 0 || !file ? (
        <p className="text-sm text-muted-foreground">
          {tab === "trash"
            ? "Trash is empty until a merge or delete lands."
            : tab === "snap"
              ? "No snapshots yet. Run a dream."
              : tab === "dream"
                ? "No dream files yet. Run a dream."
                : "No files."}
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <ul className="flex flex-row gap-2 overflow-x-auto lg:flex-col">
            {list.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setActive(f.id)}
                  className={cn(
                    "flex w-full min-w-44 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm",
                    active === f.id
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="truncate font-mono text-xs">{f.name}</span>
                  {f.stale ? <Badge variant="warn">stale</Badge> : null}
                </button>
              </li>
            ))}
          </ul>

          <Card className="min-w-0">
            <CardContent className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-mono text-sm">{file.name}</h2>
                <Badge variant="outline">{file.lines} lines</Badge>
                {tab === "human" ? <Badge variant="danger">never write</Badge> : null}
                <div className="ml-auto flex flex-wrap gap-2">
                  <CopyButton text={file.body} />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => downloadText(file.name.replaceAll("/", "-"), file.body)}
                  >
                    Save
                  </Button>
                  {tab === "live" && snapshots.length > 0 ? (
                    <Button
                      size="sm"
                      variant={showDiff ? "default" : "outline"}
                      onClick={() => setShowDiff((v) => !v)}
                    >
                      {showDiff ? "Hide diff" : "Diff vs snapshot"}
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{file.hook}</p>
              {showDiff && tab === "live" && diff.length > 0 ? (
                <pre className="mt-5 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
                  {diff.map((d, i) => (
                    <span
                      key={`${d.kind}-${i}`}
                      className={
                        d.kind === "add"
                          ? "block bg-ok/15 text-ok"
                          : d.kind === "del"
                            ? "block bg-destructive/15 text-destructive"
                            : "block"
                      }
                    >
                      {d.kind === "add" ? "+ " : d.kind === "del" ? "− " : "  "}
                      {d.text}
                    </span>
                  ))}
                </pre>
              ) : (
                <pre className="mt-5 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90">
                  {file.body}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
