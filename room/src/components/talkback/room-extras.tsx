// PARITY8E screens: channels, threads, reactions, mentions, files, huddle roll call, edit/delete, pins, recap and workflows.
// Every control here calls the same server function as Assistant's tool of the same name (assistant-tools.ts). Text is 17 px or larger.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Hash, Mic, MicOff, Paperclip, Pin, Reply, Smile, Sparkles, Workflow } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createHuddleVoice } from '@/lib/talkback/huddle-voice';
import {
  ackMessages, createChannel, deleteMessage, deleteWorkflow, editMessage, endHuddle, getFile, getRecap, huddleCallContext, joinHuddle, leaveHuddle,
  listChannels, listHuddles, listMentions, listPins, listWorkflows, saveWorkflow, sendMessage, setHuddleMute, setPinned, shareFile, startHuddle,
  toggleReaction, type TalkbackMessage,
} from "@/lib/talkback/api";
import { friendlyError } from "@/lib/talkback/errors";
import { formatTime } from "@/lib/talkback/log-export";
import { EMOJI_GLYPH, EMOJI_KEYS, EMOJI_LABEL, type EmojiKey } from "@/lib/talkback/room-logic";
import { DESKS, type DeskId, type UiDeskId } from "@/lib/talkback/roles";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const Btn = ({ className, ...p }: React.ComponentProps<typeof Button>) => <Button {...p} className={cn("text-[17px]", className)} />;
const T = "text-[17px] leading-snug";
const FIELD = "h-11 rounded-md border border-border bg-raised px-3 text-[17px] text-fg focus:border-border-strong focus:ring-2 focus:ring-ring focus:outline-none";
const CHIP = "inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[17px] font-medium whitespace-nowrap";

export function useRoomExtras(desk: UiDeskId) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const channels = useQuery({ queryKey: ["talkback-channels"], queryFn: () => listChannels(), refetchInterval: 4000 });
  const pins = useQuery({ queryKey: ["talkback-pins"], queryFn: () => listPins(), refetchInterval: 4000 });
  const mentions = useQuery({ queryKey: ["talkback-mentions", desk], queryFn: () => listMentions({ data: { desk } }), refetchInterval: 3000 });
  const huddles = useQuery({ queryKey: ["talkback-huddles"], queryFn: () => listHuddles(), refetchInterval: 3000 });
  const workflows = useQuery({ queryKey: ["talkback-workflows"], queryFn: () => listWorkflows(), refetchInterval: 6000 });
  /** Run one door, then refresh what it changes. A refusal is shown in plain words and nothing else happens. */
  async function run(fn: () => Promise<unknown>, refresh: string[] = ["talkback-messages"]): Promise<boolean> {
    try {
      await fn();
      setError(null);
      for (const k of refresh) void qc.invalidateQueries({ queryKey: [k] });
      return true;
    } catch (err) {
      setError(friendlyError(err, "That did not work. Nothing was changed."));
      return false;
    }
  }
  return { channels: channels.data ?? [], pins: pins.data ?? [], mentions: mentions.data ?? [], huddles: huddles.data ?? [], workflows: workflows.data ?? [], error, setError, run };
}
export type RoomExtras = ReturnType<typeof useRoomExtras>;

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className={cn(T, "flex items-center gap-2 font-medium")}>{icon}{title}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

// ---------- channels ----------
export function ChannelBar({ x, current, onPick, showPins, onTogglePins }: { x: RoomExtras; current: string; onPick: (c: string) => void; showPins: boolean; onTogglePins: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  return (
    <div className="min-w-0 border-b border-border p-3">
      <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap">
        {x.channels.map((c) => (
          <button key={c.name} type="button" onClick={() => onPick(c.name)} className={cn(CHIP, !showPins && current === c.name ? "bg-fg text-bg" : "bg-raised text-muted hover:text-fg")}>
            <Hash className="size-4" />{c.name}
            {c.messages > 0 ? <span className="tabular-nums opacity-70">{c.messages}</span> : null}
          </button>
        ))}
        <button type="button" onClick={onTogglePins} className={cn(CHIP, showPins ? "bg-fg text-bg" : "bg-raised text-muted hover:text-fg")}>
          <Pin className="size-4" />Pinned {x.pins.length}
        </button>
        <button type="button" onClick={() => setAdding((v) => !v)} className={cn(CHIP, "bg-raised text-muted hover:text-fg")}>+ New channel</button>
      </div>
      {adding ? (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await x.run(() => createChannel({ data: { name, topic: "" } }), ["talkback-channels"])) { onPick(name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")); setName(""); setAdding(false); }
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Channel name, like release" maxLength={40} className={cn(FIELD, "min-w-56 flex-1")} />
          <Btn type="submit" disabled={!name.trim()}>Make channel</Btn>
        </form>
      ) : null}
      {x.error ? <p role="alert" className={cn(T, "mt-2 text-warn")}>{x.error}</p> : null}
    </div>
  );
}

// ---------- message body with @mentions marked ----------
export function Body({ text }: { text: string }) {
  const parts = text.split(/((?:^|(?<=[^A-Za-z0-9_.]))@(?:floor|lead|builder|reviewer|grok|assistant|all|everyone)(?![A-Za-z0-9_]))/gi);
  return (
    <>
      {parts.map((p, i) => (/^@/.test(p) ? <mark key={i} className="rounded bg-raised px-1 font-medium text-fg underline decoration-live underline-offset-4">{p}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

// ---------- everything under one message ----------
export function MessageExtras({ m, desk, x, replies, onCopyNothing }: { m: TalkbackMessage; desk: UiDeskId; x: RoomExtras; replies: TalkbackMessage[]; onCopyNothing?: () => void }) {
  void onCopyNothing;
  const [picking, setPicking] = useState(false);
  const [thread, setThread] = useState(false);
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [deleting, setDeleting] = useState(false);
  const [word, setWord] = useState("");
  const mine = m.fromSeat === desk;
  const canDelete = mine || desk === "floor";
  if (m.deleted) return null;
  return (
    <div className="mt-3 space-y-3">
      {(m.files ?? []).map((f) => (
        <button
          key={f.id}
          type="button"
          className={cn(CHIP, "bg-raised text-fg hover:bg-border")}
          onClick={async () => {
            try {
              const file = await getFile({ data: { id: f.id } });
              const bytes = Uint8Array.from(atob(file.dataBase64), (c) => c.charCodeAt(0));
              const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
              const a = document.createElement("a");
              a.href = url; a.download = file.name; a.click();
              URL.revokeObjectURL(url);
            } catch (err) { x.setError(friendlyError(err, "Could not open that file.")); }
          }}
        >
          <Paperclip className="size-4" />{f.name}<span className="opacity-70">{Math.max(1, Math.round(f.size / 1024))} KB</span>
        </button>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {(m.reactions ?? []).map((r) => (
          <button
            key={r.emoji}
            type="button"
            title={`${EMOJI_LABEL[r.emoji as EmojiKey] ?? r.emoji}: ${r.desks.map((d) => DESKS[d as DeskId]?.label ?? d).join(", ")}`}
            onClick={() => void x.run(() => toggleReaction({ data: { messageId: m.id, desk, emoji: r.emoji } }))}
            className={cn(CHIP, "h-10", r.desks.includes(desk) ? "bg-fg text-bg" : "bg-raised text-fg")}
          >
            <span aria-hidden="true">{EMOJI_GLYPH[r.emoji as EmojiKey] ?? r.emoji}</span><span className="tabular-nums">{r.desks.length}</span>
          </button>
        ))}
        <button type="button" onClick={() => setPicking((v) => !v)} className={cn(CHIP, "h-10 bg-raised text-muted hover:text-fg")} aria-label="Add a reaction"><Smile className="size-4" />React</button>
        <button type="button" onClick={() => setThread((v) => !v)} className={cn(CHIP, "h-10 bg-raised text-muted hover:text-fg")}><Reply className="size-4" />{(m.replyCount ?? 0) > 0 ? `${m.replyCount} ${m.replyCount === 1 ? "reply" : "replies"}` : "Reply"}</button>
        <button type="button" onClick={() => void x.run(() => setPinned({ data: { id: m.id, desk, pinned: !m.pinned } }), ["talkback-messages", "talkback-pins"])} className={cn(CHIP, "h-10", m.pinned ? "bg-fg text-bg" : "bg-raised text-muted hover:text-fg")}><Pin className="size-4" />{m.pinned ? "Unpin" : "Pin"}</button>
        {mine ? <button type="button" onClick={() => { setDraft(m.body); setEditing(true); }} className={cn(CHIP, "h-10 bg-raised text-muted hover:text-fg")}>Edit</button> : null}
        {canDelete ? <button type="button" onClick={() => setDeleting((v) => !v)} className={cn(CHIP, "h-10 bg-raised text-muted hover:text-fg")}>Delete</button> : null}
      </div>
      {picking ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pick a reaction">
          {EMOJI_KEYS.map((k) => (
            <button key={k} type="button" title={EMOJI_LABEL[k]} onClick={() => { setPicking(false); void x.run(() => toggleReaction({ data: { messageId: m.id, desk, emoji: k } })); }} className="grid size-11 place-items-center rounded-full bg-raised text-2xl hover:bg-border">{EMOJI_GLYPH[k]}</button>
          ))}
        </div>
      ) : null}
      {editing ? (
        <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await x.run(() => editMessage({ data: { id: m.id, desk, body: draft } }))) setEditing(false); }}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={2000} className={cn(FIELD, "h-auto w-full py-2")} />
          <div className="flex gap-2"><Btn type="submit" disabled={!draft.trim()}>Save the change</Btn><Btn type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Btn></div>
        </form>
      ) : null}
      {deleting ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (word.trim().toLowerCase() === "delete" && (await x.run(() => deleteMessage({ data: { id: m.id, desk } }), ["talkback-messages", "talkback-pins"]))) { setDeleting(false); setWord(""); } }}>
          <label className={cn(T, "text-muted")} htmlFor={`del-${m.id}`}>Type the word delete to remove this message for good</label>
          <input id={`del-${m.id}`} value={word} onChange={(e) => setWord(e.target.value)} className={cn(FIELD, "w-40")} autoComplete="off" />
          <Btn type="submit" variant="secondary" disabled={word.trim().toLowerCase() !== "delete"}>Delete it</Btn>
        </form>
      ) : null}
      {thread ? (
        <div className="space-y-2 border-l-2 border-border pl-4">
          {replies.map((r) => (
            <div key={r.id} className={T}>
              <span className="font-medium">{DESKS[r.fromSeat].label}</span> <span className="text-muted">{formatTime(r.createdAt)}</span>
              <p>{r.deleted ? <em className="text-muted">Message deleted</em> : <Body text={r.body} />}</p>
            </div>
          ))}
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (reply.trim() && (await x.run(() => sendMessage({ data: { fromSeat: desk, toSeat: null, kind: "chat", body: reply, parentId: m.id } })))) setReply(""); }}>
            <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply in this thread" maxLength={2000} className={cn(FIELD, "min-w-0 flex-1")} />
            <Btn type="submit" disabled={!reply.trim()}>Reply</Btn>
          </form>
        </div>
      ) : null}
    </div>
  );
}

// ---------- composer additions: attach a file, tag a desk ----------
export function ComposerExtras({ desk, channel, to, x, onTag }: { desk: UiDeskId; channel: string; to: string; x: RoomExtras; onTag: (tag: string) => void }) {
  return (
    <div className="mb-3 flex min-w-0 items-center gap-2 overflow-x-auto sm:flex-wrap">
      {["lead", "builder", "reviewer", "grok", "assistant"].filter((d) => d !== desk).map((d) => (
        <button key={d} type="button" onClick={() => onTag(`@${d} `)} className={cn(CHIP, "h-10 bg-raised text-muted hover:text-fg")}><AtSign className="size-4" />{DESKS[d as DeskId].label}</button>
      ))}
      <label className={cn(CHIP, "h-10 cursor-pointer bg-raised text-muted hover:text-fg")}>
        <Paperclip className="size-4" />Attach a file
        <input
          type="file"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (f.size > 1_572_864) { x.setError("A file can be at most 1.5 MB."); return; }
            const buf = new Uint8Array(await f.arrayBuffer());
            let bin = "";
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
            await x.run(() => shareFile({ data: { fromSeat: desk, toSeat: to === "all" ? null : (to as never), channel, name: f.name, mime: f.type || "application/octet-stream", dataBase64: btoa(bin), note: "" } }), ["talkback-messages"]);
          }}
        />
      </label>
    </div>
  );
}

// ---------- the pinned list ----------
export function PinsList({ x, desk }: { x: RoomExtras; desk: UiDeskId }) {
  if (x.pins.length === 0) return <p className={cn(T, "p-4 text-muted")}>Nothing is pinned yet. Pin a message to keep it here.</p>;
  return (
    <div className="space-y-3 p-4">
      {x.pins.map((p) => (
        <article key={p.id} className="rounded-md bg-raised px-4 py-3">
          <p className={cn(T, "font-medium text-muted")}>{DESKS[p.fromSeat as DeskId]?.label ?? p.fromSeat} in #{p.channel} · {formatTime(p.createdAt)}</p>
          <p className={cn(T, "mt-1")}><Body text={p.body} /></p>
          <button type="button" className={cn(T, "mt-2 text-muted hover:text-fg")} onClick={() => void x.run(() => setPinned({ data: { id: p.id, desk, pinned: false } }), ["talkback-messages", "talkback-pins"])}>Unpin</button>
        </article>
      ))}
    </div>
  );
}

// ---------- side cards ----------
export function MentionsCard({ x, desk }: { x: RoomExtras; desk: UiDeskId }) {
  const unread = x.mentions.filter((m) => m.unread);
  return (
    <Card title={`Called by name${unread.length ? ` (${unread.length} new)` : ""}`} icon={<AtSign className="size-5" />}>
      {x.mentions.length === 0 ? <p className={cn(T, "text-muted")}>Nobody has named this desk with @ yet.</p> : null}
      {x.mentions.slice(0, 4).map((m) => (
        <div key={m.id} className={cn(T, m.unread ? "text-fg" : "text-muted")}>
          <p><span className="font-medium">{DESKS[m.fromSeat as DeskId]?.label ?? m.fromSeat}</span> in #{m.channel}</p>
          <p className="line-clamp-2"><Body text={m.body} /></p>
          {m.unread ? <button type="button" className="mt-1 underline underline-offset-4" onClick={() => void x.run(() => ackMessages({ data: { desk, messageIds: [m.id] } }), ["talkback-mentions", "talkback-messages"])}>Mark seen</button> : null}
        </div>
      ))}
    </Card>
  );
}

export function HuddleCard({ x, desk, channel }: { x: RoomExtras; desk: UiDeskId; channel: string }) {
  const h = x.huddles.find((v) => v.channel === channel);
  const me = h?.members.find((m) => m.desk === desk);
  const refresh = ["talkback-huddles", "talkback-messages"];
  const voice = useRef<ReturnType<typeof createHuddleVoice> | null>(null);
  if (!voice.current) voice.current = createHuddleVoice();
  const relayUrl = import.meta.env.VITE_TALKBACK_RELAY_URL as string | undefined;
  useEffect(() => () => voice.current?.stop(), [desk, channel]);
  useEffect(() => {
    if (!me) voice.current?.stop();
    else voice.current?.mute(me.muted);
  }, [h?.id, !!me, me?.muted]);
  async function connectVoice(huddleId: number) {
    if (!relayUrl) return;
    const context = await huddleCallContext({ data: { huddleId, desk } });
    await voice.current!.start(relayUrl, context.company, context.callId, desk,
      error => x.setError(friendlyError(error, 'That did not work. Nothing was changed.')));
  }
  return (
    <Card title={`Huddle in #${channel}`} icon={<Mic className="size-5" />}>
      {h ? (
        <>
          <ul className="space-y-2">
            {h.members.map((m) => (
              <li key={m.desk} className={cn(T, "flex items-center justify-between")}>
                <span className="flex items-center gap-2"><span className="inline-block size-3 rounded-full bg-live" aria-hidden="true" />{DESKS[m.desk as DeskId]?.label ?? m.desk}</span>
                <span className="flex items-center gap-1 text-muted">{m.muted ? <><MicOff className="size-4" />muted</> : <><Mic className="size-4" />open</>}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {me ? (
              <>
                <Btn variant="secondary" onClick={() => void x.run(async () => { await setHuddleMute({ data: { huddleId: h.id, desk, muted: !me.muted } }); voice.current?.mute(!me.muted); }, refresh)}>{me.muted ? "Unmute me" : "Mute me"}</Btn>
                <Btn variant="secondary" onClick={() => { voice.current?.stop(); void x.run(() => leaveHuddle({ data: { huddleId: h.id, desk } }), refresh); }}>Leave</Btn>
              </>
            ) : <Btn onClick={() => void x.run(async () => { await joinHuddle({ data: { huddleId: h.id, desk } }); await connectVoice(h.id); }, refresh)}>Join the huddle</Btn>}
            <Btn variant="secondary" onClick={() => void x.run(async () => { await endHuddle({ data: { huddleId: h.id, desk } }); voice.current?.stop(); }, refresh)}>End for everyone</Btn>
          </div>
        </>
      ) : (
        <Btn className="w-full" onClick={() => void x.run(async () => { const started = await startHuddle({ data: { desk, channel } }); await connectVoice(started.id); }, refresh)}>Start a huddle</Btn>
      )}
      <p className={cn(T, "text-muted")}>A huddle is the roll call: who is on the line and who is muted. The voice itself stays on your own call app for now.</p>
    </Card>
  );
}

export function RecapCard({ x, channel }: { x: RoomExtras; channel: string }) {
  const [text, setText] = useState<string | null>(null);
  const ask = async (ch: string | null) => { try { const r = await getRecap({ data: { channel: ch } }); setText(r.text); x.setError(null); } catch (err) { x.setError(friendlyError(err, "Could not make the recap.")); } };
  return (
    <Card title="Recap" icon={<Sparkles className="size-5" />}>
      <div className="flex flex-wrap gap-2">
        <Btn variant="secondary" onClick={() => void ask(channel)}>Recap #{channel}</Btn>
        <Btn variant="secondary" onClick={() => void ask(null)}>Recap everything</Btn>
      </div>
      {text ? <pre className={cn(T, "max-h-72 overflow-auto rounded-md bg-raised p-3 font-sans whitespace-pre-wrap text-fg")}>{text}</pre> : <p className={cn(T, "text-muted")}>One click for who spoke, questions still open, pins and open tasks. Built from the room&apos;s own words, no outside service.</p>}
    </Card>
  );
}

const SEATS3 = ["lead", "builder", "reviewer"] as const;
export function WorkflowCard({ x, channel }: { x: RoomExtras; channel: string }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"keyword" | "mention" | "channel">("keyword");
  const [value, setValue] = useState("");
  const [action, setAction] = useState<"reply" | "task">("reply");
  const [role, setSeat] = useState("assistant");
  const [text, setText] = useState("");
  const [delId, setDelId] = useState<number | null>(null);
  const [word, setWord] = useState("");
  const refresh = ["talkback-workflows"];
  const say = (w: { triggerKind: string; triggerValue: string; actionKind: string; actionSeat: string; actionText: string }) =>
    `When a message ${w.triggerKind === "keyword" ? `has "${w.triggerValue}"` : w.triggerKind === "mention" ? `names @${w.triggerValue}` : `is in #${w.triggerValue}`}, ${w.actionKind === "reply" ? `reply as ${w.actionSeat}` : `add a task for ${w.actionSeat}`}: "${w.actionText}"`;
  return (
    <Card title="Workflows" icon={<Workflow className="size-5" />}>
      {x.workflows.length === 0 ? <p className={cn(T, "text-muted")}>No workflows yet. A workflow answers a message for you, the same way every time.</p> : null}
      {x.workflows.map((w) => (
        <div key={w.id} className={cn(T, "rounded-md bg-raised p-3")}>
          <p className="font-medium">{w.name} <span className="font-normal text-muted">· ran {w.runs}×{w.enabled ? "" : " · off"}</span></p>
          <p className="text-muted">{say(w)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn variant="secondary" onClick={() => void x.run(() => saveWorkflow({ data: { id: w.id, name: w.name, triggerKind: w.triggerKind, triggerValue: w.triggerValue, actionKind: w.actionKind, actionSeat: w.actionSeat, actionText: w.actionText, enabled: !w.enabled } }), refresh)}>{w.enabled ? "Switch off" : "Switch on"}</Btn>
            <Btn variant="secondary" onClick={() => { setDelId(delId === w.id ? null : w.id); setWord(""); }}>Delete</Btn>
          </div>
          {delId === w.id ? (
            <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (word.trim().toLowerCase() === "delete" && (await x.run(() => deleteWorkflow({ data: { id: w.id } }), refresh))) setDelId(null); }}>
              <label htmlFor={`wd-${w.id}`} className="text-muted">Type the word delete</label>
              <input id={`wd-${w.id}`} value={word} onChange={(e) => setWord(e.target.value)} className={cn(FIELD, "w-36")} autoComplete="off" />
              <Btn type="submit" variant="secondary" disabled={word.trim().toLowerCase() !== "delete"}>Delete it</Btn>
            </form>
          ) : null}
        </div>
      ))}
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await x.run(() => saveWorkflow({ data: { name, triggerKind: kind, triggerValue: value, actionKind: action, actionSeat: role, actionText: text, enabled: true } }), refresh)) { setName(""); setValue(""); setText(""); }
        }}
      >
        <p className={cn(T, "font-medium")}>Add a workflow</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, like Red alert" maxLength={60} className={cn(FIELD, "w-full")} />
        <div className="flex flex-wrap gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={FIELD} aria-label="When"><option value="keyword">a message has the word</option><option value="mention">a message names @</option><option value="channel">a message is in channel</option></select>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "keyword" ? "red" : kind === "mention" ? "builder" : channel} maxLength={60} className={cn(FIELD, "min-w-32 flex-1")} />
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={action} onChange={(e) => { const a = e.target.value as typeof action; setAction(a); setSeat(a === "task" ? "builder" : "assistant"); }} className={FIELD} aria-label="Then"><option value="reply">reply as</option><option value="task">add a task for</option></select>
          <select value={role} onChange={(e) => setSeat(e.target.value)} className={FIELD} aria-label="Who">
            {(action === "task" ? SEATS3 : [...SEATS3, "assistant"]).map((s) => <option key={s} value={s}>{DESKS[s as DeskId].label}</option>)}
          </select>
        </div>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What to say or the task, like On it." maxLength={500} className={cn(FIELD, "w-full")} />
        <Btn type="submit" className="w-full" disabled={!name.trim() || !value.trim() || !text.trim()}>Save the workflow</Btn>
      </form>
    </Card>
  );
}
