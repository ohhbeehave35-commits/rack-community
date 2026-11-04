import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDreamHydrated } from "@/lib/dream/hydrate";
import { captureLock, lockerZipFiles, lockToZipFiles } from "@/lib/dream/lock";
import { machineKitFiles } from "@/lib/dream/machine";
import { buildSummonPack } from "@/lib/dream/summon";
import { isHandheld } from "@/lib/dream/platform";
import { useDream } from "@/lib/dream/store";
import { copyOrSave, shareOrCopy } from "@/lib/utils";
import { downloadZip } from "@/lib/zip";

export function CrashKit() {
  const ready = useDreamHydrated();
  const [copied, setCopied] = useState<"copied" | "saved" | "shared" | false>(false);
  const [restored, setRestored] = useState(false);
  const s = useDream();
  const {
    lastDream,
    files,
    extraCleanup,
    applied,
    analysisMd,
    claudeProposal,
    extraLines,
    jobs,
    frozen,
    running,
    markSummon,
    lastSummonAt,
    lockedProjects,
    restoreProject,
  } = s;

  const locks = lockedProjects ?? [];
  const latest = locks[0];
  const lastJob = jobs[0];
  const pack = buildSummonPack({
    at: new Date().toISOString(),
    lastDream,
    files,
    extras: extraCleanup,
    applied,
    analysisMd,
    claudeProposal,
    pastedLines: extraLines.length,
    lastJob: lastJob ? `${lastJob.kind} · ${lastJob.status} · ${lastJob.detail}` : null,
    frozen,
    locks: locks.map((l) => ({ name: l.name, at: l.at, files: l.files.length })),
  });

  const snapshot = () =>
    captureLock(s, { id: "current", name: "current-workspace", kind: "named" });

  return (
    <Card id="crash" className="scroll-mt-28 border-primary">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Your session just died?</CardTitle>
          <Badge variant={ready && locks.length ? "ok" : "warn"}>
            {!ready
              ? "loading copies…"
              : locks.length === 1
                ? "1 copy held"
                : locks.length
                  ? `${locks.length} copies held`
                  : "nothing locked yet"}
          </Badge>
        </div>
        <CardDescription>
          Copy, restore, save to disk. Somnus cannot see unsaved files that
          only lived in the assistant’s window.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol className="flex flex-col gap-2">
          <li>
            <Button
              size="lg"
              className="h-12 w-full sm:w-auto"
              onClick={() => {
                markSummon();
                const stamp = new Date()
                  .toISOString()
                  .slice(0, 19)
                  .replaceAll(":", "");
                const send = isHandheld()
                  ? shareOrCopy("Somnus summon", `summon-${stamp}.md`, pack)
                  : copyOrSave(`summon-${stamp}.md`, pack);
                void send.then((how) => {
                  setCopied(how);
                  window.setTimeout(() => setCopied(false), 1800);
                });
              }}
            >
              {copied === "saved"
                ? "Saved summon file"
                : copied === "shared"
                  ? "Shared. Paste into a new session"
                  : copied === "copied"
                  ? "Copied. Paste into a new session"
                  : "1. Copy summon pack"}
            </Button>
          </li>
          <li className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              size="lg"
              variant="secondary"
              className="h-12 w-full sm:w-auto"
              disabled={running || !latest}
              onClick={() => {
                if (!latest) return;
                restoreProject(latest.id);
                setRestored(true);
                window.setTimeout(() => setRestored(false), 2200);
              }}
            >
              {restored
                ? "Restored"
                : latest
                  ? `2. Restore ${latest.name}`
                  : "2. No lock to restore"}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 w-full sm:w-auto"
              onClick={() => {
                const stamp = new Date()
                  .toISOString()
                  .slice(0, 19)
                  .replaceAll(":", "");
                downloadZip(
                  `somnus-locker-${stamp}.zip`,
                  lockerZipFiles(locks, snapshot()),
                );
              }}
            >
              3. Download locker zip
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 w-full sm:w-auto"
              onClick={() =>
                downloadZip(
                  "somnus-machine-kit.zip",
                  machineKitFiles(lockToZipFiles(snapshot())),
                )
              }
            >
              4. Machine kit (disk watch)
            </Button>
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          {lastSummonAt
            ? `Last copied ${new Date(lastSummonAt).toLocaleTimeString()}. `
            : null}
          {latest
            ? `Newest lock ${new Date(latest.at).toLocaleString()} · ${latest.files.length} files${
                latest.extraLines?.length
                  ? ` · ${latest.extraLines.length} pasted lines`
                  : ""
              }.`
            : "If you never locked and never gathered here, this tab has nothing to give back."}{" "}
          Unzip the machine kit. Windows: double-click INSTALL-WINDOWS.bat, then
          START-SIDECAR.bat. Mac/Linux: run install-watch. Paste the assistant fragment
          yourself.{" "}
          <Link to="/claude" className="underline underline-offset-2">
            Assistant desk
          </Link>
          {" · "}
          <Link to="/program" className="underline underline-offset-2">
            Jobs
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}