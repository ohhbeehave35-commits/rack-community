import { useEffect, useRef, useState } from "react";
import { Fan } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { machineKitFiles, fanKitFiles } from "@/lib/dream/machine";
import {
  COMMANDS,
  MACHINE_SIDECAR_CLEAR_URL,
  MACHINE_SIDECAR_FAN_URL,
  commandsFor,
  fanCommand,
  machineTone,
  parseMachineSnap,
} from "@/lib/dream/machine-status";
import { clientLabel, detectClient, isHandheld } from "@/lib/dream/platform";
import { useDream } from "@/lib/dream/store";
import type { FanMode, MachineSnap } from "@/lib/dream/types";
import { fmtMb, useRam } from "@/lib/dream/ram";
import { copyOrSave } from "@/lib/utils";
import { downloadZip } from "@/lib/zip";
import { useSidecarStatus } from "@/lib/dream/use-sidecar-status";

function pctAvail(used: number | null, total: number | null) {
  if (used == null || !total) return null;
  return Math.round((used / total) * 100);
}

function presetPct(mode: FanMode | null | undefined, fallback: number | null) {
  if (fallback != null) return fallback;
  if (mode === "quiet") return 30;
  if (mode === "balanced") return 55;
  if (mode === "full") return 100;
  return 0;
}

function FanDeck({
  snap,
  kind,
  handheld,
  sidecarLive,
  onSnap,
  onCopy,
  onListen,
}: {
  snap: MachineSnap | null;
  kind: ReturnType<typeof detectClient>;
  handheld: boolean;
  sidecarLive: boolean;
  onSnap: (snap: MachineSnap) => void;
  onCopy: (label: string) => void;
  onListen: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dragPct, setDragPct] = useState<number | null>(null);
  const liveSendTimer = useRef<number | null>(null);
  const pendingPct = useRef<number | null>(null);
  const mode = snap?.fanMode ?? "hidden";
  const pct = dragPct ?? presetPct(mode, snap?.fanPct ?? null);
  const rpm = snap?.fanRpm;
  const spinning = (rpm != null && rpm > 0) || (pct > 0 && mode !== "hidden" && mode !== "auto");
  const duration = Math.max(0.28, 2.1 - (pct / 100) * 1.7);
  const cmds = commandsFor(kind === "unknown" ? "mac" : kind);
  const liveRoot = sidecarLive && !snap?.fanNeedsAdmin;
  const needsGrant = !handheld && (!sidecarLive || snap?.fanNeedsAdmin);

  const grant = () => {
    onListen();
    downloadZip("somnus-magician-sidecar.zip", fanKitFiles());
    const copiedCmd = kind === "windows" ? cmds.sidecar : cmds.grant;
    void copyOrSave("somnus-sidecar.txt", copiedCmd).then((how) => {
      onCopy(how === "copied" ? "Copied grant command" : "Saved grant command");
      setMsg(
        kind === "windows"
          ? "Unzip. Double-click sidecar.bat. Leave that window open. This tab listens, then RAM, Magician-clear, and fans work on this Windows PC. Python is not required."
          : kind === "mac" || kind === "unknown"
            ? "Unzip. Right-click sidecar.command → Open. Password like Magician. Leave that window open. This tab listens, then Auto and the fan speed slider write the fans."
            : "Run the copied command as admin, leave it running. This tab listens.",
      );
    });
  };

  const apply = async (next: FanMode | "manual", nextPct?: number) => {
    setBusy(true);
    setMsg(null);
    const body =
      next === "manual"
        ? { mode: "manual", pct: nextPct ?? pct }
        : { mode: next, pct: nextPct ?? undefined };
    if (sidecarLive && !handheld) {
      try {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 20000);
        const res = await fetch(MACHINE_SIDECAR_FAN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        window.clearTimeout(timer);
        const text = await res.text();
        const parsed = parseMachineSnap(text, "sidecar");
        if (parsed) {
          onSnap({
            ...snap,
            ...parsed,
            fanMode:
              parsed.fanMode === "hidden" && next !== "manual"
                ? next
                : parsed.fanMode === "hidden"
                  ? "manual"
                  : parsed.fanMode,
            fanPct: parsed.fanPct ?? nextPct ?? snap?.fanPct ?? null,
            source: "sidecar",
          });
          if (parsed.fanNeedsAdmin) {
            setMsg("Sidecar is running without the Magician password. Quit it, double-click sidecar.command, enter the password, leave it open.");
          } else if (parsed.note?.includes("unlocking")) {
            setMsg("Unlocking fans (3–6 seconds, same as Magician on M3/M4). Leave the sidecar window open.");
          } else if (parsed.fanLocked) {
            setMsg("This Mac blocked the write even as admin. Sleep/wake once, then Full again.");
          } else {
            setMsg(
              next === "auto"
                ? "Auto. macOS is driving the fan."
                : parsed.fanHolding
                  ? "Holding. Sidecar re-applies after sleep, like Magician."
                  : "Fan order sent to this computer.",
            );
          }
        } else {
          setMsg("Sidecar answered, but not with status JSON. Use fan.command.");
        }
      } catch {
        setMsg("Sidecar did not take the fan order. Grant fan control, then leave the sidecar window open.");
      }
      setBusy(false);
      return;
    }
    if (kind === "mac" || kind === "unknown") {
      grant();
      setBusy(false);
      return;
    }
    if (kind === "windows") {
      grant();
      setBusy(false);
      return;
    }
    const cmd = fanCommand(kind, next === "manual" ? "manual" : next, nextPct);
    void copyOrSave("somnus-fan.txt", cmd).then((how) => {
      onCopy(how === "copied" ? "Copied fan command" : "Saved fan command");
      setMsg(
        handheld
          ? "Run that on the Windows or Mac that has the fans, not on this phone."
          : "Run the fan command on this computer, or Grant then Listen.",
      );
      if (snap) {
        onSnap({
          ...snap,
          fanMode: next === "manual" ? "manual" : next,
          fanPct: nextPct ?? snap.fanPct,
        });
      }
      setBusy(false);
    });
  };

  return (
    <div id="fan" className="scroll-mt-28 rounded-xl border border-primary/40 bg-muted/30 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="grid size-12 place-items-center rounded-full border border-border bg-background text-primary"
            style={
              spinning
                ? { animation: `somnus-fan-spin ${duration}s linear infinite` }
                : undefined
            }
            aria-hidden
          >
            <Fan className="size-6" strokeWidth={1.6} />
          </span>
          <div>
            <p className="font-display text-lg tracking-tight">Fan speed</p>
            <p className="text-xs text-muted-foreground">
              {handheld
                ? "This device has no user fan. Control the PC or Mac that runs the assistant."
                : liveRoot
                  ? snap?.fanHolding
                    ? "Holding like Magician. Sleep/wake is re-applied from the sidecar window."
                    : "Live with Magician password. Auto and the fan speed slider write the fans."
                  : kind === "windows"
                    ? sidecarLive
                      ? "Sidecar live on this Windows PC. Auto and the fan speed slider send orders here."
                      : "Windows: Grant starts sidecar.bat (no Python). Leave that window open, then these buttons write fans if NBFC / Win32 allows it."
                    : "Same as Magician: password once, helper stays open, then these buttons. Grant downloads the sidecar."}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl tabular-nums">
            {rpm != null ? `${rpm}` : "n/a"}
            <span className="ml-1 text-sm text-muted-foreground">rpm</span>
          </p>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {mode === "hidden" ? "no reading yet" : mode}
            {snap?.fanHolding ? " · holding" : ""}
            {snap?.fanCount ? ` · ${snap.fanCount} fan${snap.fanCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          size="lg"
          variant={mode === "auto" ? "default" : "outline"}
          className="h-12 flex-1"
          disabled={busy}
          onClick={() => void apply("auto")}
        >
          Auto (let the computer decide)
        </Button>
        {!handheld ? (
          <Button
            size="lg"
            variant={needsGrant || !sidecarLive ? "default" : "outline"}
            className="h-12 flex-1"
            disabled={busy}
            onClick={grant}
          >
            Turn on fan control
            {kind === "windows" ? " · sidecar.bat" : ""}
          </Button>
        ) : null}
      </div>
      <label className="mt-4 flex flex-col gap-2">
        <span className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
          <span>Drag to set fan speed, {pct}%</span>
          <span className="hidden sm:inline">Bottom = low, top = max</span>
        </span>
        <input
          type="range"
          min={10}
          max={100}
          step={1}
          value={Math.max(10, pct || 10)}
          disabled={busy || handheld}
          aria-label="Fan speed, low to max"
          className="fan-slider h-3 w-full cursor-pointer accent-primary disabled:opacity-40"
          onChange={(e) => {
            const v = Number(e.target.value);
            setDragPct(v);
            // Follow the drag live instead of waiting for release: send at most
            // once per 120ms while moving, so the fan changes as the slider
            // moves instead of only after the finger/mouse lifts. The final
            // value always lands via onPointerUp below, even if a throttled
            // tick was skipped.
            pendingPct.current = v;
            if (liveSendTimer.current == null) {
              liveSendTimer.current = window.setTimeout(() => {
                liveSendTimer.current = null;
                if (pendingPct.current != null) void apply("manual", pendingPct.current);
              }, 120);
            }
          }}
          onPointerUp={() => {
            const v = dragPct ?? pct;
            setDragPct(null);
            if (liveSendTimer.current != null) {
              window.clearTimeout(liveSendTimer.current);
              liveSendTimer.current = null;
            }
            pendingPct.current = null;
            void apply("manual", v);
          }}
          suppressHydrationWarning
        />
      </label>
      {msg ? <p className="mt-3 text-sm text-muted-foreground">{msg}</p> : null}
    </div>
  );
}

export function MachineMeter() {
  const { machineSnap, setMachineSnap } = useDream();
  const { sample } = useRam();
  const [kind, setKind] = useState<ReturnType<typeof detectClient>>("unknown");
  const [paste, setPaste] = useState("");
  const [copied, setCopied] = useState<string | false>(false);
  const [pasteErr, setPasteErr] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setKind(detectClient()), []);
  const handheld = isHandheld(kind);
  const cmds = commandsFor(kind);
  const tone = machineTone(machineSnap);
  const fill = pctAvail(machineSnap?.usedMb ?? null, machineSnap?.totalMb ?? null);
  const { wantSidecar, setWantSidecar, sidecarLive, sidecarTried } = useSidecarStatus(
    handheld,
    setMachineSnap,
  );

  const mark = (label: string) => {
    setCopied(label);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const applyPaste = (raw: string) => {
    const snap = parseMachineSnap(raw, "paste");
    if (snap) {
      setMachineSnap(snap);
      setPaste("");
      setPasteErr(false);
      return true;
    }
    if (raw.trim()) setPasteErr(true);
    return false;
  };

  const magicianClear = async () => {
    if (sidecarLive && !handheld) {
      try {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 25000);
        const res = await fetch(MACHINE_SIDECAR_CLEAR_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: ctrl.signal,
        });
        window.clearTimeout(timer);
        const text = await res.text();
        const parsed = parseMachineSnap(text, "sidecar");
        if (parsed) setMachineSnap(parsed);
        mark("Cleared inactive RAM");
      } catch {
        mark("Sidecar did not clear");
      }
      return;
    }
    void copyOrSave("somnus-clear.txt", cmds.clear).then((how) =>
      mark(how === "copied" ? "Copied clear command" : "Saved clear command"),
    );
  };

  const sidecarLabel = wantSidecar
    ? sidecarLive
      ? "Stop · live"
      : sidecarTried
        ? "Stop · sidecar missing"
        : "Listening…"
    : "Listen on this computer";

  return (
    <Card id="machine" className="scroll-mt-28 border-primary/40">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{handheld ? "This device" : "This computer"}</CardTitle>
          <Badge variant={sidecarLive ? "ok" : tone === "muted" ? "outline" : tone}>
            {sidecarLive
              ? "live on this machine"
              : wantSidecar && sidecarTried
                ? "sidecar not found"
                : clientLabel(kind)}
          </Badge>
        </div>
        <CardDescription>
          {handheld
            ? "Phone and tablet hold locks and the summon pack. They cannot Magician-clear themselves or see the assistant’s RAM. Run the kit on the Windows or Mac that actually runs the assistant."
            : kind === "windows"
              ? "Windows: Download the kit, double-click INSTALL-WINDOWS.bat, then START-SIDECAR.bat and leave it open. Listen. Magician-clear trims working sets. Python is not required."
              : kind === "mac"
                ? "Mac: Grant fan control downloads the Magician sidecar. Right-click sidecar.command → Open, password once, leave it open. Intel and Apple Silicon (Ftst hold after sleep)."
                : "Run status.sh, clear.sh, fan.sh auto|quiet|balanced|full. PWM write often needs root. sudo python3 sidecar.py then Listen."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ol className="rounded-lg border border-border bg-background px-4 py-3 text-sm leading-relaxed">
          <li>
            <span className="font-medium">On a Windows PC:</span> download the
            kit. Double-click INSTALL-WINDOWS.bat. Double-click START-SIDECAR.bat
            and leave it open. Press Listen. Then Magician-clear.
          </li>
          <li className="mt-1 text-muted-foreground">
            Python is not required. Phone and iPad keep locks; they cannot clear
            the PC. Fans need NBFC or Win32. The assistant is never killed.
          </li>
        </ol>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Used", fmtMb(machineSnap?.usedMb ?? null)],
            ["Total", fmtMb(machineSnap?.totalMb ?? null)],
            [
              handheld ? "Device hint" : "Freeable",
              handheld
                ? sample?.deviceGb != null
                  ? `~${sample.deviceGb} GB`
                  : "hidden"
                : fmtMb(machineSnap?.availMb ?? null),
            ],
            [
              "Temp",
              machineSnap?.tempC != null ? `${Math.round(machineSnap.tempC)}°C` : "hidden",
            ],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="mt-1 font-display text-2xl tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {fill != null && !handheld ? (
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={
                tone === "danger"
                  ? "h-full bg-destructive"
                  : tone === "warn"
                    ? "h-full bg-warn"
                    : "h-full bg-ok"
              }
              style={{ width: `${Math.min(100, fill)}%` }}
            />
          </div>
        ) : null}
        <FanDeck
          snap={machineSnap}
          kind={kind}
          handheld={handheld}
          sidecarLive={sidecarLive}
          onSnap={setMachineSnap}
          onCopy={mark}
          onListen={() => setWantSidecar(true)}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {handheld ? (
            <>
              <Button
                size="lg"
                className="h-12 w-full sm:w-auto"
                onClick={() => downloadZip("somnus-machine-kit.zip", machineKitFiles())}
              >
                Download kit for the PC / Mac
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-12 w-full sm:w-auto"
                onClick={() => {
                  void copyOrSave("somnus-windows-status.txt", COMMANDS.windows.status).then(
                    (how) => mark(how === "copied" ? "Copied Windows command" : "Saved Windows command"),
                  );
                }}
              >
                {copied && copied.includes("Windows") ? copied : "Copy Windows status"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full sm:w-auto"
                onClick={() => {
                  void copyOrSave("somnus-mac-status.txt", COMMANDS.mac.status).then((how) =>
                    mark(how === "copied" ? "Copied Mac command" : "Saved Mac command"),
                  );
                }}
              >
                {copied && copied.includes("Mac") ? copied : "Copy Mac status"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full sm:w-auto"
                onClick={() => {
                  void copyOrSave("somnus-windows-fan.txt", fanCommand("windows", "balanced")).then(
                    (how) => mark(how === "copied" ? "Copied Windows fan" : "Saved Windows fan"),
                  );
                }}
              >
                {copied && copied.includes("Windows fan") ? copied : "Copy Windows fan"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full sm:w-auto"
                onClick={() => {
                  void copyOrSave("somnus-mac-fan.txt", fanCommand("mac", "balanced")).then((how) =>
                    mark(how === "copied" ? "Copied Mac fan" : "Saved Mac fan"),
                  );
                }}
              >
                {copied && copied.includes("Mac fan") ? copied : "Copy Mac fan"}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="lg"
                className="h-12 w-full sm:w-auto"
                onClick={() => downloadZip("somnus-machine-kit.zip", machineKitFiles())}
              >
                {kind === "windows" ? "Download Windows kit" : "Download machine kit"}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-12 w-full sm:w-auto"
                onClick={() => void magicianClear()}
              >
                {copied && copied.toLowerCase().includes("clear")
                  ? copied
                  : sidecarLive
                    ? "Magician-clear this PC"
                    : kind === "windows"
                      ? "Copy Magician-clear (clear.bat)"
                      : "Copy Magician-clear command"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full sm:w-auto"
                onClick={() => setWantSidecar((v) => !v)}
              >
                {sidecarLabel}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full sm:w-auto"
                onClick={() => {
                  void copyOrSave("somnus-status.txt", cmds.status).then((how) =>
                    mark(how === "copied" ? "Copied status command" : "Saved status command"),
                  );
                }}
              >
                {copied && copied.includes("status") ? copied : "Copy RAM status command"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full sm:w-auto"
                onClick={() => {
                  void copyOrSave("somnus-sidecar.txt", cmds.sidecar).then((how) =>
                    mark(how === "copied" ? "Copied sidecar command" : "Saved sidecar command"),
                  );
                }}
              >
                {copied && copied.includes("sidecar")
                  ? copied
                  : kind === "windows"
                    ? "Copy sidecar.bat command"
                    : "Copy sidecar command"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full sm:w-auto"
                onClick={() => {
                  void copyOrSave("somnus-fan.txt", fanCommand(kind, "balanced")).then((how) =>
                    mark(how === "copied" ? "Copied fan command" : "Saved fan command"),
                  );
                }}
              >
                {copied && copied.includes("fan") ? copied : "Copy fan command"}
              </Button>
            </>
          )}
        </div>
        {wantSidecar && sidecarTried && !sidecarLive ? (
          <p className="text-sm text-warn">
            {kind === "windows"
              ? "Nothing answered on this PC. Double-click sidecar.bat, leave it open, then Listen again. Python is not required."
              : "Nothing answered on this computer. Copy the sidecar command, run it next to the assistant, then Listen again."}
          </p>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Paste status JSON from the PC or Mac
          </span>
          <textarea
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              setPasteErr(false);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (applyPaste(text)) e.preventDefault();
            }}
            onBlur={() => applyPaste(paste)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) {
                void file.text().then((t) => applyPaste(t));
                return;
              }
              applyPaste(e.dataTransfer.getData("text"));
            }}
            rows={3}
            spellCheck={false}
            placeholder="SOMNUS_MACHINE={...} or drop the status file"
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            suppressHydrationWarning
          />
        </label>
        {pasteErr ? (
          <p className="text-sm text-destructive">
            That wasn’t status JSON. Run status.bat / status.command and paste
            the whole line.
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            className="h-11 w-full sm:w-auto"
            disabled={!paste.trim()}
            onClick={() => applyPaste(paste)}
          >
            Read pasted status
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt,.md,.log,text/plain,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void file.text().then((t) => applyPaste(t));
            }}
            suppressHydrationWarning
          />
          <Button
            variant="outline"
            className="h-11 w-full sm:w-auto"
            onClick={() => fileRef.current?.click()}
          >
            Open status file
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {handheld
            ? "Add Somnus to the Home Screen if you want. the assistant’s night watchman still lives on the computer."
            : kind === "windows"
              ? "After unzip: double-click INSTALL-WINDOWS.bat, then START-SIDECAR.bat and leave it open. Listen. Magician-clear this PC."
              : "After unzip: double-click the .command files, or sh install-watch.sh."}
          {machineSnap?.note ? ` · ${machineSnap.note}` : ""}
        </p>
      </CardContent>
    </Card>
  );
}