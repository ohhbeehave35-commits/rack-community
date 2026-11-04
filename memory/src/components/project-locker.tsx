import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useDreamHydrated } from "@/lib/dream/hydrate";
import { lockToZipFiles } from "@/lib/dream/lock";
import { useDream } from "@/lib/dream/store";
import { stampShort } from "@/lib/dream/stamp";
import { downloadZip } from "@/lib/zip";

export function ProjectLocker() {
  const ready = useDreamHydrated();
  const {
    lockedProjects,
    lockProject,
    restoreProject,
    dropLocked,
    running,
    files,
    lastDream,
  } = useDream();
  const [name, setName] = useState("");
  const locks = lockedProjects ?? [];

  return (
    <Card id="locker" className="scroll-mt-28 border-primary/40">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Project locker</CardTitle>
          <Badge variant={locks.length ? "ok" : "outline"}>
            {!ready ? "loading…" : `${locks.length} saved`}
          </Badge>
        </div>
        <CardDescription>
          The assistant crashing does not have to wipe the work. Lock a copy here.
          Restore it after you reset him. Download a zip if you want a file that
          survives this browser too. This is not the assistant’s disk.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            lockProject(name, { kind: "named" });
            setName("");
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={lastDream ? `e.g. singer-forge ${lastDream.slice(0, 10)}` : "Name this project"}
            aria-label="Project name"
            className="sm:flex-1"
          />
          <Button className="w-full sm:w-auto" disabled={running} type="submit">
            Lock this project
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Holding {files.length} memory files right now
          {lastDream ? ` · last dream ${stampShort(lastDream)}` : " · no dream yet"}.
          Latest dream auto-locks after each gather, paste, and apply. Hiding
          this tab also auto-locks.
        </p>
        {!ready ? (
          <div className="rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground">
            Loading saved copies…
          </div>
        ) : locks.length === 0 ? (
          <div className="rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground">
            Nothing locked yet. Name the work and lock it before the next
            a reset. If the work only lived in the assistant’s window, Somnus
            never had it.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {locks.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <Badge variant={p.kind === "auto" ? "muted" : "ok"}>
                      {p.kind === "auto" ? "auto" : "named"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(p.at).toLocaleString()} · {p.files.length} files
                    {p.extraLines?.length ? ` · ${p.extraLines.length} pasted` : ""}
                    {p.lastDream ? ` · dream ${stampShort(p.lastDream)}` : ""}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="secondary"
                    className="w-full sm:h-11 sm:w-auto"
                    disabled={running}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Replace current memory with “${p.name}”? Unlocked work in this tab is overwritten. Other locked copies stay.`,
                        )
                      ) {
                        restoreProject(p.id);
                      }
                    }}
                  >
                    Restore
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full sm:h-11 sm:w-auto"
                    onClick={() => {
                      const stamp = p.at.slice(0, 19).replaceAll(":", "");
                      downloadZip(
                        `somnus-${p.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}-${stamp}.zip`,
                        lockToZipFiles(p),
                      );
                    }}
                  >
                    Zip
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full sm:h-11 sm:w-auto"
                    onClick={() => {
                      if (window.confirm(`Remove locked copy “${p.name}”?`)) {
                        dropLocked(p.id);
                      }
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
