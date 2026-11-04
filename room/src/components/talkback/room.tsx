import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  Check,
  Copy,
  Download,
  KeyRound,
  Radio,
  Send,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { UserButton } from "@/lib/auth/gates";
import {
  ackMessages,
  closeTask,
  heartbeat,
  issueWireToken,
  listMessages,
  listPresence,
  listTasks,
  listWires,
  revokeWireToken,
  sendMessage,
  upsertTask,
  type SeatStatus,
  type TalkbackMessage,
  type TalkbackTask,
  type TaskState,
  type WireMeta,
} from "@/lib/talkback/api";
import { friendlyError } from "@/lib/talkback/errors";
import { buildDeskPack, packFilename } from "@/lib/talkback/pack";
import { buildLogText, formatAgo, formatTime, presenceMap, type PresenceMap } from "@/lib/talkback/log-export";
import {
  CUE_STORAGE_KEY,
  DESK_IDS,
  DESKS,
  HEARD_STORAGE_KEY,
  deskPrompt,
  isDeskId,
  isSeatId,
  isUiDeskId,
  radioLine,
  RECIPIENT_IDS,
  SEAT_IDS,
  SEAT_STORAGE_KEY,
  type DeskId,
  type RecipientId,
  type SeatId,
  type UiDeskId,
} from "@/lib/talkback/roles";
import {
  fireDesktopAlert,
  playCue,
  requestDesktopAlerts,
  unlockAudio,
} from "@/lib/talkback/sound";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Body, ChannelBar, ComposerExtras, HuddleCard, MentionsCard, MessageExtras, PinsList, RecapCard, WorkflowCard, useRoomExtras } from "@/components/talkback/room-extras";

const LIVE_MS = 22_000;

function readDesk(): DeskId | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SEAT_STORAGE_KEY);
  // A wire-only desk (Bot, Assistant) is never a role for a person.
  return raw && isDeskId(raw) && isUiDeskId(raw) ? raw : null;
}

function readHeard(): number {
  if (typeof window === "undefined") return 0;
  const raw = Number(window.localStorage.getItem(HEARD_STORAGE_KEY) ?? "0");
  return Number.isFinite(raw) ? raw : 0;
}

function isLive(lastSeen: string | null | undefined) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < LIVE_MS;
}

function involvesSeat(m: TalkbackMessage, role: RecipientId) {
  return m.fromSeat === role || m.toSeat === role || m.toSeat === null;
}

function shouldCue(desk: DeskId, m: TalkbackMessage) {
  if (m.kind === "status") return false;
  if (m.fromSeat === desk) return false;
  if (desk === "floor") return true;
  return m.toSeat === null || m.toSeat === desk || (m.mentions ?? []).includes(desk);
}

function downloadMarkdown(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function TalkbackRoom() {
  const [desk, setDesk] = useState<DeskId | null>(readDesk);
  const [cueOn, setCueOn] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(CUE_STORAGE_KEY) !== "off";
  });
  const [notifyState, setNotifyState] = useState<
    "unknown" | "granted" | "denied" | "unsupported"
  >("unknown");
  const [cuedSeat, setCuedSeat] = useState<RecipientId | "all" | null>(null);
  const [copiedId, setCopiedId] = useState<number | "prompt" | "export" | "token" | null>(
    null,
  );
  const heardRef = useRef(readHeard());
  const primedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotifyState("unsupported");
      return;
    }
    setNotifyState(
      Notification.permission === "granted"
        ? "granted"
        : Notification.permission === "denied"
          ? "denied"
          : "unknown",
    );
  }, []);

  const claimDesk = useCallback(async (next: DeskId) => {
    window.localStorage.setItem(SEAT_STORAGE_KEY, next);
    setDesk(next);
    await unlockAudio();
    primedRef.current = true;
  }, []);

  if (!desk) {
    return (
      <DeskPicker
        onPick={(id) => {
          void claimDesk(id);
        }}
      />
    );
  }

  return (
    <RoomLive
      desk={desk}
      cueOn={cueOn}
      setCueOn={setCueOn}
      notifyState={notifyState}
      setNotifyState={setNotifyState}
      cuedSeat={cuedSeat}
      setCuedSeat={setCuedSeat}
      copiedId={copiedId}
      setCopiedId={setCopiedId}
      heardRef={heardRef}
      primedRef={primedRef}
      onSwitchDesk={(id) => {
        void claimDesk(id);
      }}
      onLeave={() => {
        window.localStorage.removeItem(SEAT_STORAGE_KEY);
        setDesk(null);
      }}
    />
  );
}

function DeskPicker({ onPick }: { onPick: (id: DeskId) => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center px-5 py-12 sm:px-8">
      <p className="text-xs font-medium tracking-[0.22em] text-muted uppercase">
        This computer
      </p>
      <h1 className="font-display mt-3 max-w-2xl text-4xl font-medium tracking-tight sm:text-5xl">
        Who sits here?
      </h1>
      <p className="mt-4 max-w-xl text-base text-muted">
        Open this same program on every machine, signed into the same account.
        One computer is the Floor — you see everything. The others are desks.
        Issue a wire on each desk so Claude talks itself. When a desk is called,
        that machine rings so someone looks now.
      </p>

      <button
        type="button"
        onClick={() => onPick("floor")}
        className="mt-10 rounded-xl border border-border-strong bg-surface p-6 text-left transition-colors hover:bg-raised"
      >
        <span className="text-xs font-medium tracking-[0.18em] text-muted uppercase">
          Recommended
        </span>
        <span className="font-display mt-2 block text-3xl font-medium">
          Floor
        </span>
        <span className="mt-2 block max-w-lg text-sm leading-relaxed text-muted">
          {DESKS.floor.hint}
        </span>
      </button>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {SEAT_IDS.map((id) => {
          const s = DESKS[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              className="rounded-lg border border-border bg-surface p-5 text-left transition-colors hover:border-border-strong hover:bg-raised"
            >
              <span className="font-display text-2xl font-medium">{s.label}</span>
              <span className="mt-1 block text-sm text-muted">{s.desk}</span>
              <span className="mt-3 block text-sm leading-relaxed text-subtle">
                {s.hint}
              </span>
            </button>
          );
        })}
      </div>
    </main>
  );
}

function RoomLive({
  desk,
  cueOn,
  setCueOn,
  notifyState,
  setNotifyState,
  cuedSeat,
  setCuedSeat,
  copiedId,
  setCopiedId,
  heardRef,
  primedRef,
  onSwitchDesk,
  onLeave,
}: {
  desk: DeskId;
  cueOn: boolean;
  setCueOn: (v: boolean) => void;
  notifyState: "unknown" | "granted" | "denied" | "unsupported";
  setNotifyState: (v: "unknown" | "granted" | "denied" | "unsupported") => void;
  cuedSeat: RecipientId | "all" | null;
  setCuedSeat: (v: RecipientId | "all" | null) => void;
  copiedId: number | "prompt" | "export" | "token" | null;
  setCopiedId: (v: number | "prompt" | "export" | "token" | null) => void;
  heardRef: React.MutableRefObject<number>;
  primedRef: React.MutableRefObject<boolean>;
  onSwitchDesk: (id: DeskId) => void;
  onLeave: () => void;
}) {
  const queryClient = useQueryClient();
  const scroller = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [to, setTo] = useState<RecipientId | "all">("all");
  const [status, setStatus] = useState<SeatStatus>("listening");
  const [focus, setFocus] = useState<RecipientId | "all">("all");
  const [panel, setPanel] = useState<"line" | "desk">("line");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskSeat, setTaskSeat] = useState<SeatId>(
    isSeatId(desk) ? desk : "lead",
  );
  const x = useRoomExtras(desk as UiDeskId);
  const [channel, setChannel] = useState("general");
  const [showPins, setShowPins] = useState(false);
  const skipCueRef = useRef(true);
  const lastStatus = useRef(status);

  const messagesQuery = useQuery({
    queryKey: ["talkback-messages"],
    queryFn: () => listMessages(),
    refetchInterval: 1500,
  });
  const presenceQuery = useQuery({
    queryKey: ["talkback-presence"],
    queryFn: () => listPresence(),
    refetchInterval: 4000,
  });
  const tasksQuery = useQuery({
    queryKey: ["talkback-tasks"],
    queryFn: () => listTasks(),
    refetchInterval: 4000,
  });
  const wiresQuery = useQuery({
    queryKey: ["talkback-wires"],
    queryFn: () => listWires(),
    refetchInterval: 4000,
  });

  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const tasks = tasksQuery.data ?? [];
  const wires = wiresQuery.data ?? [];
  const presence = useMemo(() => presenceMap(presenceQuery.data ?? []), [presenceQuery.data]);

  const wireByDesk = useMemo(() => {
    const map: Partial<Record<DeskId, WireMeta>> = {};
    for (const row of wires) map[row.desk] = row;
    return map;
  }, [wires]);

  const inChannel = useMemo(
    () => messages.filter((m) => (m.channel ?? "general") === channel && !m.parentId),
    [messages, channel],
  );
  const repliesOf = useMemo(() => {
    const map = new Map<number, TalkbackMessage[]>();
    for (const m of messages) if (m.parentId) map.set(m.parentId, [...(map.get(m.parentId) ?? []), m]);
    return map;
  }, [messages]);
  const visible = useMemo(() => {
    if (focus === "all") return inChannel;
    return inChannel.filter((m) => involvesSeat(m, focus));
  }, [inChannel, focus]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void heartbeat({ data: { role: desk, status } });
    }, 5000);
    void heartbeat({ data: { role: desk, status } });
    return () => window.clearInterval(id);
  }, [desk, status]);

  useEffect(() => {
    if (lastStatus.current === status) return;
    lastStatus.current = status;
    void sendMessage({
      data: {
        fromSeat: desk,
        toSeat: null,
        kind: "status",
        body: `${DESKS[desk].label} is ${status}.`,
      },
    }).then((msg) => {
      queryClient.setQueryData<TalkbackMessage[]>(
        ["talkback-messages"],
        (old) => [...(old ?? []), msg],
      );
    });
  }, [status, desk, queryClient]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) {
      if (messagesQuery.isSuccess) skipCueRef.current = false;
      return;
    }
    if (skipCueRef.current) {
      skipCueRef.current = false;
      heardRef.current = Math.max(heardRef.current, last.id);
      window.localStorage.setItem(HEARD_STORAGE_KEY, String(heardRef.current));
      return;
    }
    if (last.id <= heardRef.current) return;

    const incoming = messages.filter((m) => m.id > heardRef.current);
    heardRef.current = last.id;
    window.localStorage.setItem(HEARD_STORAGE_KEY, String(last.id));

    const forMe = incoming.filter((m) => shouldCue(desk, m));
    if (!forMe.length) return;

    const latest = forMe[forMe.length - 1];
    setCuedSeat(latest.toSeat ?? "all");
    window.setTimeout(() => setCuedSeat(null), 2400);

    if (cueOn && primedRef.current) {
      void playCue();
      const who = DESKS[latest.fromSeat].label;
      const dest =
        latest.toSeat === null ? "the room" : DESKS[latest.toSeat].label;
      const line =
        latest.kind === "nudge"
          ? `${who} is calling ${dest}`
          : latest.body.slice(0, 140);
      fireDesktopAlert(`Talkback · ${who}`, line);
    }
  }, [
    messages,
    cueOn,
    desk,
    heardRef,
    primedRef,
    setCuedSeat,
    messagesQuery.isSuccess,
  ]);

  useEffect(() => {
    if (typeof document === "undefined" || document.hidden) return;
    const mine = messages.filter((m) => {
      if (m.fromSeat === desk) return false;
      if (m.seenBy.includes(desk)) return false;
      if (desk === "floor") return true;
      return m.toSeat === null || m.toSeat === desk;
    });
    if (!mine.length) return;
    const ids = mine.map((m) => m.id);
    void ackMessages({
      data: { desk, messageIds: ids },
    }).then(() => {
      queryClient.setQueryData<TalkbackMessage[]>(
        ["talkback-messages"],
        (old) =>
          (old ?? []).map((m) =>
            ids.includes(m.id) && !m.seenBy.includes(desk)
              ? { ...m, seenBy: [...m.seenBy, desk] }
              : m,
          ),
      );
    });
  }, [messages, desk, queryClient]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  const send = useMutation({
    mutationFn: (input: {
      kind: "chat" | "nudge";
      body: string;
      toSeat: RecipientId | null;
    }) =>
      sendMessage({
        data: {
          fromSeat: desk,
          toSeat: input.toSeat,
          kind: input.kind,
          body: input.body,
          channel,
        },
      }),
    onSuccess: (msg) => {
      queryClient.setQueryData<TalkbackMessage[]>(
        ["talkback-messages"],
        (old) => [...(old ?? []), msg],
      );
    },
  });

  const [taskError, setTaskError] = useState<string | null>(null);

  const saveTask = useMutation({
    mutationFn: (input: {
      role: SeatId;
      title: string;
      state: TaskState;
    }) =>
      upsertTask({
        data: {
          role: input.role,
          title: input.title,
          detail: "",
          state: input.state,
        },
      }),
    onSuccess: () => {
      setTaskTitle("");
      setTaskError(null);
      queryClient.invalidateQueries({ queryKey: ["talkback-tasks"] });
    },
    onError: (err) => setTaskError(friendlyError(err, "Could not save the slip.")),
  });

  async function onSend(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || send.isPending) return;
    primedRef.current = true;
    await unlockAudio();
    send.mutate(
      { kind: "chat", body, toSeat: to === "all" ? null : to },
      { onSuccess: () => setDraft("") },
    );
  }

  async function onNudge() {
    primedRef.current = true;
    await unlockAudio();
    send.mutate({
      kind: "nudge",
      body: `${DESKS[desk].label} needs you on the line.`,
      toSeat: to === "all" ? null : to,
    });
  }

  async function enableAlerts() {
    await unlockAudio();
    primedRef.current = true;
    const result = await requestDesktopAlerts();
    setNotifyState(result);
    setCueOn(true);
    window.localStorage.setItem(CUE_STORAGE_KEY, "on");
    await playCue();
  }

  function toggleCue() {
    const next = !cueOn;
    setCueOn(next);
    window.localStorage.setItem(CUE_STORAGE_KEY, next ? "on" : "off");
    if (next) {
      primedRef.current = true;
      void unlockAudio();
    }
  }

  async function copyText(
    key: number | "prompt" | "export" | "token",
    text: string,
  ) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      window.setTimeout(() => setCopiedId(null), 1400);
    } catch {
      /* ignore */
    }
  }

  function exportLog() {
    const text = buildLogText({ messages, wires, presence });
    void copyText("export", text);
  }

  const sendError = send.error ? friendlyError(send.error, "Could not send.") : null;
  const offline = messagesQuery.isError;
  const roomHost = typeof window === "undefined" ? "" : window.location.host;

  const openTasks = tasks.filter((t) => t.state !== "done");
  const isFloor = desk === "floor";

  return (
    <div className="flex min-h-dvh flex-col bg-bg max-lg:h-dvh">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="font-display text-xl font-medium tracking-tight">
            Talkback
          </p>
          <p className="truncate text-xs tracking-[0.16em] text-subtle uppercase">
            {DESKS[desk].label} · {messagesQuery.isError ? "offline" : "live"}
          </p>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={exportLog}
            className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface hover:text-fg"
            aria-label="Copy log"
            title="Copy the full log"
          >
            {copiedId === "export" ? (
              <Check className="size-4" />
            ) : (
              <Download className="size-4" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleCue}
            className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface hover:text-fg"
            aria-label={cueOn ? "Mute cue" : "Unmute cue"}
          >
            {cueOn ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          </button>
          <div className="hidden sm:block">
            <UserButton />
          </div>
        </div>
      </header>

      {offline ? (
        <div
          role="alert"
          className="sticky top-0 z-20 border-b border-border bg-raised px-4 py-3 text-sm text-warn sm:px-6"
        >
          Can&apos;t reach the room{roomHost ? ` at ${roomHost}` : ""}. Nothing
          you send will go through until it is back. Trying again every few
          seconds — the messages below are the last ones this computer saw.
        </div>
      ) : null}

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 lg:py-6">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {DESK_IDS.map((id) => {
            const row = presence[id];
            const live =
              id === desk || isLive(row?.lastSeen) || isLive(row?.wireLastSeen);
            const wireLive = isLive(row?.wireLastSeen);
            const cued =
              (id !== "floor" &&
                (cuedSeat === id || (cuedSeat === "all" && id !== desk))) ||
              (id === "floor" && cuedSeat !== null && isFloor);
            const selected = isFloor
              ? id === "floor"
                ? focus === "all"
                : focus === id
              : id === desk;
            const statusLine =
              id === desk
                ? "This computer"
                : wireLive
                  ? `${row?.wireStatus ?? "listening"} · wire`
                  : live
                    ? (row?.status ?? "listening")
                    : "dark";
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (isFloor) {
                    setFocus(id === "floor" ? "all" : id);
                    if (id !== "floor") setTo(id);
                    return;
                  }
                  // Bot and Assistant are not roles: clicking them
                  // addresses them instead of taking their desk.
                  if (!isUiDeskId(id)) {
                    setTo(id);
                    return;
                  }
                  onSwitchDesk(id);
                }}
                className={cn(
                  "min-w-36 flex-1 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors sm:min-w-40",
                  selected && "border-border-strong",
                  cued && "role-cued",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-lg font-medium">
                    {DESKS[id].label}
                  </span>
                  <Lamp on={live} cued={Boolean(cued)} />
                </span>
                <span className="mt-1 block text-xs text-muted">{statusLine}</span>
              </button>
            );
          })}
        </div>

        {isFloor ? (
          <BoardStrip
            tasks={openTasks}
            messages={messages}
            presence={presence}
            wires={wireByDesk}
            cuedSeat={cuedSeat}
            desk={desk}
          />
        ) : null}

        <div className="flex gap-2 lg:hidden">
          <ToChip
            label="Line"
            active={panel === "line"}
            onClick={() => setPanel("line")}
          />
          <ToChip
            label="Desk"
            active={panel === "desk"}
            onClick={() => setPanel("desk")}
          />
        </div>

        <div className="grid min-h-0 flex-1 gap-4 max-lg:grid-cols-[minmax(0,1fr)] max-lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_300px]">
          <section
            className={cn(
              "flex min-h-0 flex-col rounded-xl border border-border bg-surface lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)]",
              panel !== "line" && "hidden lg:flex",
            )}
          >
            <ChannelBar
              x={x}
              current={channel}
              onPick={(c) => {
                setChannel(c);
                setShowPins(false);
              }}
              showPins={showPins}
              onTogglePins={() => setShowPins((v) => !v)}
            />
            <div
              ref={scroller}
              className="min-h-40 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5 lg:min-h-72"
            >
              {showPins ? (
                <PinsList x={x} desk={desk as UiDeskId} />
              ) : visible.length === 0 ? (
                <EmptyLine isFloor={isFloor} />
              ) : (
                visible.map((m) => (
                  <MessageRow
                    key={m.id}
                    message={m}
                    mine={m.fromSeat === desk}
                    copied={copiedId === m.id}
                    onCopy={() =>
                      copyText(m.id, radioLine(m.fromSeat, m.toSeat, m.body))
                    }
                    extras={
                      <MessageExtras
                        m={m}
                        desk={desk as UiDeskId}
                        x={x}
                        replies={repliesOf.get(m.id) ?? []}
                      />
                    }
                  />
                ))
              )}
            </div>

            <form
              onSubmit={onSend}
              className="border-t border-border p-3 sm:p-4"
            >
              <ComposerExtras
                desk={desk as UiDeskId}
                channel={channel}
                to={to}
                x={x}
                onTag={(t) => setDraft((d) => d + t)}
              />
              <div className="mb-3 flex flex-wrap gap-1.5">
                <ToChip
                  label="Room"
                  active={to === "all"}
                  onClick={() => setTo("all")}
                />
                {RECIPIENT_IDS.filter((id) => id !== desk).map((id) => (
                  <ToChip
                    key={id}
                    label={DESKS[id].label}
                    active={to === id}
                    onClick={() => setTo(id)}
                  />
                ))}
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={`Talk to ${to === "all" ? "the room" : DESKS[to].label} in #${channel}…`}
                  rows={2}
                  maxLength={2000}
                  className="min-h-12 w-full resize-none rounded-md border border-border bg-raised px-3 py-2.5 text-sm text-fg placeholder:text-subtle focus:border-border-strong focus:ring-2 focus:ring-ring focus:outline-none"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!draft.trim() || send.isPending}
                  aria-label="Send"
                >
                  <Send className="size-4" />
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void onNudge()}
                  disabled={send.isPending}
                >
                  <Radio className="size-3.5" />
                  Call {to === "all" ? "the room" : DESKS[to].label}
                </Button>
                <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                  <span className="hidden sm:inline">Status</span>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as SeatStatus)}
                    className="h-9 rounded-sm border border-border bg-raised px-2 text-xs text-fg"
                  >
                    <option value="listening">Listening</option>
                    <option value="working">Working</option>
                    <option value="away">Away</option>
                  </select>
                </label>
              </div>
              {sendError ? (
                <p className="mt-2 text-xs text-warn">{sendError}</p>
              ) : null}
            </form>
          </section>

          <aside
            className={cn(
              "flex flex-col gap-3 pb-8 max-lg:min-h-0 max-lg:overflow-y-auto lg:pb-0",
              panel !== "desk" && "hidden lg:flex",
            )}
          >
            {notifyState !== "granted" ? (
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-sm font-medium">Turn the cue on</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  This computer beeps and pops a notice the moment someone
                  calls {isFloor ? "any desk" : "this desk"} — even if Claude
                  Code is in front.
                </p>
                <Button
                  className="mt-4 w-full"
                  variant="cue"
                  onClick={() => void enableAlerts()}
                >
                  Enable alerts
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-sm font-medium">Cue is live</p>
                <p className="mt-1 text-sm text-muted">
                  Lamp, tone, desktop notice. Keep this tab open.
                </p>
              </div>
            )}

            <MentionsCard x={x} desk={desk as UiDeskId} />
            <HuddleCard x={x} desk={desk as UiDeskId} channel={channel} />
            <RecapCard x={x} channel={channel} />
            <WorkflowCard x={x} channel={channel} />

            <WirePanel
              currentDesk={desk}
              wires={wireByDesk}
              copiedToken={copiedId === "token"}
              onCopyToken={(text) => void copyText("token", text)}
            />

            <TaskPanel
              desk={desk}
              taskSeat={taskSeat}
              setTaskSeat={setTaskSeat}
              taskTitle={taskTitle}
              setTaskTitle={setTaskTitle}
              tasks={openTasks}
              onAdd={() => {
                const title = taskTitle.trim();
                if (!title) return;
                saveTask.mutate({
                  role: taskSeat,
                  title,
                  state: "open",
                });
              }}
              onState={(task, state) => {
                void upsertTask({
                  data: {
                    id: task.id,
                    role: task.role,
                    title: task.title,
                    detail: task.detail,
                    state,
                  },
                }).then(
                  () => {
                    setTaskError(null);
                    queryClient.invalidateQueries({
                      queryKey: ["talkback-tasks"],
                    });
                  },
                  (err) => setTaskError(friendlyError(err, "Could not update the slip.")),
                );
              }}
              onDone={(id) => {
                void closeTask({ data: { id } }).then(
                  () => {
                    setTaskError(null);
                    queryClient.invalidateQueries({
                      queryKey: ["talkback-tasks"],
                    });
                  },
                  (err) => setTaskError(friendlyError(err, "Could not close the slip.")),
                );
              }}
              error={taskError}
            />

            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-sm font-medium">Paste fallback</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Only if this machine cannot use the wire. Copy RADIO still
                works.
              </p>
              <pre className="mt-3 max-h-28 overflow-auto rounded-md bg-raised p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap text-muted">
                {deskPrompt(desk)}
              </pre>
              <Button
                className="mt-3 w-full"
                variant="secondary"
                size="sm"
                onClick={() => void copyText("prompt", deskPrompt(desk))}
              >
                <Copy className="size-3.5" />
                {copiedId === "prompt" ? "Copied" : "Copy prompt"}
              </Button>
            </div>

            <HowItWorks />

            <button
              type="button"
              onClick={onLeave}
              className="h-11 rounded-md text-sm text-muted hover:text-fg"
            >
              Change this computer
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function BoardStrip({
  tasks,
  messages,
  presence,
  wires,
  cuedSeat,
  desk,
}: {
  tasks: TalkbackTask[];
  messages: TalkbackMessage[];
  presence: PresenceMap;
  wires: Partial<Record<DeskId, WireMeta>>;
  cuedSeat: RecipientId | "all" | null;
  desk: DeskId;
}) {
  return (
    <div className="hidden gap-3 md:grid md:grid-cols-3">
      {SEAT_IDS.map((id) => {
        const row = presence[id];
        const live =
          id === desk || isLive(row?.lastSeen) || isLive(row?.wireLastSeen);
        // A status line ("Builder is working.") is not something said to
        // this desk; show the last real message instead.
        const last = [...messages]
          .reverse()
          .find((m) => m.kind !== "status" && involvesSeat(m, id));
        const task = tasks.find((t) => t.role === id);
        const wire = wires[id];
        const cued = cuedSeat === id || (cuedSeat === "all" && id !== desk);
        const wireLive = isLive(row?.wireLastSeen);
        return (
          <div
            key={id}
            className={cn(
              "rounded-lg border border-border bg-surface p-4",
              cued && "role-cued",
            )}
          >
            <div className="flex items-center justify-between">
              <p className="font-display text-lg font-medium">
                {DESKS[id].label}
              </p>
              <Lamp on={live} cued={cued} />
            </div>
            <p className="mt-2 text-xs font-medium tracking-wide text-muted uppercase">
              {task ? `${task.state} · ${task.title}` : "No slip"}
            </p>
            <p className="mt-1 text-xs text-subtle">
              {wire
                ? `${wire.prefix}… · pulled ${formatAgo(wire.lastUsed)}${
                    wireLive ? ` · ${row?.wireStatus ?? "listening"}` : ""
                  }`
                : "No wire"}
            </p>
            <p className="mt-2 line-clamp-2 text-sm text-fg">
              {last
                ? `${DESKS[last.fromSeat].label}${last.via === "wire" ? " · wire" : ""}: ${last.body || "Look up."}`
                : "Silent."}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function WirePanel({
  currentDesk,
  wires,
  copiedToken,
  onCopyToken,
}: {
  currentDesk: DeskId;
  wires: Partial<Record<DeskId, WireMeta>>;
  copiedToken: boolean;
  onCopyToken: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<{ desk: DeskId; token: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<DeskId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const desks = currentDesk === "floor" ? [...DESK_IDS] : [currentDesk];

  async function issue(desk: DeskId) {
    setBusy(desk);
    setError(null);
    try {
      const result = await issueWireToken({ data: { desk } });
      setSecret({ desk: result.desk, token: result.token });
      await queryClient.invalidateQueries({ queryKey: ["talkback-wires"] });
    } catch (err) {
      setError(friendlyError(err, "Could not issue a key."));
    } finally {
      setBusy(null);
    }
  }

  async function cut(desk: DeskId) {
    setBusy(desk);
    setError(null);
    try {
      await revokeWireToken({ data: { desk } });
      if (secret?.desk === desk) setSecret(null);
      await queryClient.invalidateQueries({ queryKey: ["talkback-wires"] });
    } catch (err) {
      setError(friendlyError(err, "Could not cut the wire."));
    } finally {
      setBusy(null);
    }
  }

  function savePack(desk: DeskId, token: string) {
    downloadMarkdown(
      packFilename(desk),
      buildDeskPack({ origin: window.location.origin, desk, token }),
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="size-3.5 text-muted" />
        Wire
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {currentDesk === "floor"
          ? "Issue a key per desk. Drop the pack into that machine’s Claude Code. Claude then pulls and sends — you watch."
          : "Issue a key for this desk, download the pack, drop it into Claude Code on this computer. Then stop pasting."}
      </p>

      <div className="mt-3 space-y-2">
        {desks.map((id) => {
          const wire = wires[id];
          const issuing = busy === id;
          return (
            <div
              key={id}
              className="rounded-md border border-border bg-raised px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-fg">{DESKS[id].label}</p>
                  <p className="mt-0.5 truncate text-xs text-subtle">
                    {wire
                      ? `${wire.prefix}… · pulled ${formatAgo(wire.lastUsed)}`
                      : "No key"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={issuing}
                    onClick={() => void issue(id)}
                    className="h-8 rounded-full bg-surface px-2.5 text-xs text-muted hover:text-fg disabled:opacity-40"
                  >
                    {issuing ? "…" : wire ? "New key" : "Issue"}
                  </button>
                  {wire ? (
                    <button
                      type="button"
                      disabled={issuing}
                      onClick={() => void cut(id)}
                      className="h-8 rounded-full px-2.5 text-xs text-subtle hover:text-fg disabled:opacity-40"
                    >
                      Cut
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {secret ? (
        <div className="mt-3 rounded-md border border-border-strong bg-raised p-3">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            {DESKS[secret.desk].label} key — shown once
          </p>
          <p className="mt-2 break-all font-sans text-xs leading-relaxed text-fg">
            {secret.token}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            Download the pack now and drop {packFilename(secret.desk)} into that
            Claude Code session (or CLAUDE.md). A new key kills the old one.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              className="flex-1"
              variant="secondary"
              size="sm"
              onClick={() => onCopyToken(secret.token)}
            >
              <Copy className="size-3.5" />
              {copiedToken ? "Copied" : "Copy key"}
            </Button>
            <Button
              className="flex-1"
              variant="cue"
              size="sm"
              onClick={() => savePack(secret.desk, secret.token)}
            >
              <Download className="size-3.5" />
              Pack
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-warn">{error}</p> : null}
    </div>
  );
}

function TaskPanel({
  desk,
  taskSeat,
  setTaskSeat,
  taskTitle,
  setTaskTitle,
  tasks,
  onAdd,
  onState,
  onDone,
  error,
}: {
  desk: DeskId;
  taskSeat: SeatId;
  setTaskSeat: (s: SeatId) => void;
  taskTitle: string;
  setTaskTitle: (s: string) => void;
  tasks: TalkbackTask[];
  onAdd: () => void;
  onState: (task: TalkbackTask, state: TaskState) => void;
  onDone: (id: number) => void;
  error: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium">Slips</p>
      <p className="mt-1 text-sm text-muted">
        What each desk is holding. Everyone on this account sees the same
        board.
      </p>
      <div className="mt-3 space-y-2">
        {tasks.length === 0 ? (
          <p className="text-sm text-subtle">Nothing on the board.</p>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className="rounded-md border border-border bg-raised px-3 py-2"
            >
              <p className="text-xs text-muted">
                {DESKS[task.role].label}
                <span className="text-subtle"> · {task.state}</span>
              </p>
              <p className="mt-0.5 text-sm text-fg">{task.title}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(["doing", "blocked", "done"] as TaskState[]).map((state) => (
                  <button
                    key={state}
                    type="button"
                    onClick={() =>
                      state === "done" ? onDone(task.id) : onState(task, state)
                    }
                    className="h-8 rounded-full bg-surface px-2.5 text-xs text-muted hover:text-fg"
                  >
                    {state}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {desk === "floor" ? (
          <select
            value={taskSeat}
            onChange={(e) => setTaskSeat(e.target.value as SeatId)}
            className="h-9 rounded-sm border border-border bg-raised px-2 text-xs text-fg"
          >
            {SEAT_IDS.map((id) => (
              <option key={id} value={id}>
                {DESKS[id].label}
              </option>
            ))}
          </select>
        ) : null}
        <div className="flex gap-2">
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAdd();
              }
            }}
            placeholder="New slip…"
            maxLength={200}
            className="h-11 min-w-0 flex-1 rounded-md border border-border bg-raised px-3 text-sm text-fg placeholder:text-subtle focus:border-border-strong focus:ring-2 focus:ring-ring focus:outline-none"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-11"
            onClick={onAdd}
            disabled={!taskTitle.trim()}
          >
            Add
          </Button>
        </div>
        {error ? <p className="text-xs text-warn">{error}</p> : null}
      </div>
    </div>
  );
}

function Lamp({ on, cued }: { on: boolean; cued: boolean }) {
  return (
    <span
      className={cn(
        "inline-block size-2.5 rounded-full",
        cued ? "cue-lamp bg-fg" : on ? "bg-live" : "bg-subtle/40",
      )}
      aria-hidden="true"
    />
  );
}

function ToChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 rounded-full px-3 text-xs font-medium",
        active ? "bg-fg text-bg" : "bg-raised text-muted hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

function MessageRow({
  message,
  mine,
  copied,
  onCopy,
  extras,
}: {
  message: TalkbackMessage;
  mine: boolean;
  copied: boolean;
  onCopy: () => void;
  extras?: ReactNode;
}) {
  const dest = message.toSeat === null ? "Room" : DESKS[message.toSeat].label;
  const looked = message.seenBy.filter((d) => d !== message.fromSeat);
  if (message.kind === "status") {
    return (
      <p className="px-1 text-center text-xs text-subtle">
        {message.body}
        <span className="tabular-nums"> · {formatTime(message.createdAt)}</span>
      </p>
    );
  }
  return (
    <article
      className={cn("rounded-md px-3 py-2.5", mine ? "bg-raised" : "bg-bg")}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-muted">
          {DESKS[message.fromSeat].label}
          <span className="text-subtle"> → {dest}</span>
          {message.kind === "nudge" ? (
            <span className="text-warn"> · call</span>
          ) : null}
          {message.via === "wire" ? (
            <span className="text-subtle"> · wire</span>
          ) : null}
        </p>
        <time className="text-xs text-subtle tabular-nums">
          {formatTime(message.createdAt)}
        </time>
      </div>
      <p className="mt-1 text-[17px] leading-relaxed text-fg">
        {message.deleted ? (
          <em className="text-muted">Message deleted</em>
        ) : (
          <Body text={message.body || "Look up."} />
        )}
        {message.editedAt && !message.deleted ? (
          <span className="text-sm text-subtle"> (edited)</span>
        ) : null}
      </p>
      {extras}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-xs text-subtle hover:text-fg"
        >
          <Copy className="size-3" />
          {copied ? "Copied for Claude" : "Copy RADIO line"}
        </button>
        {looked.length > 0 ? (
          <span className="text-xs text-subtle">
            {looked.map((d) => DESKS[d].label).join(", ")} looked
          </span>
        ) : (
          <span className="text-xs text-subtle">waiting</span>
        )}
      </div>
    </article>
  );
}

function EmptyLine({ isFloor }: { isFloor: boolean }) {
  return (
    <div className="grid h-full min-h-56 place-items-center px-6 text-center">
      <div>
        <p className="font-display text-2xl font-medium">Line is open</p>
        <p className="mt-2 text-sm text-muted">
          {isFloor
            ? "Issue a wire on each desk, put a slip on the board, or call someone. Every word — browser or wire — lands here."
            : "Issue a wire so Claude talks itself, or send the first note. They get a cue the moment it lands."}
        </p>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="rounded-lg border border-border bg-raised p-4 text-sm leading-relaxed text-muted">
      <p className="font-medium text-fg">How to run it</p>
      <ol className="mt-2 list-decimal space-y-2 pl-4">
        <li>Open this same program on every machine. Same account.</li>
        <li>
          Floor on the computer you sit at. Lead and Builder on the ProArt.
          Reviewer on the Mac — even if that machine only has to ring.
        </li>
        <li>Enable alerts on every desk. Pin the tab. Leave it open.</li>
        <li>
          On Floor (or on the desk itself): Wire → Issue → download the pack.
          Drop that file into that machine’s Claude Code. Claude then pulls and
          sends. You stop pasting.
        </li>
        <li>
          Call is the doorbell. Slips are the work. A line marked wire came from
          Claude. Pulled … ago is the last time that desk reached the room.
        </li>
        <li>
          If a machine cannot run Claude Code, keep Copy RADIO as the fallback.
        </li>
      </ol>
    </div>
  );
}
