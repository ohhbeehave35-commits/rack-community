/* eslint-disable @typescript-eslint/ban-ts-comment -- see the note below */
// @ts-nocheck
//
// KNOWN DEBT, measured 2026-09-02: removing this exposes 74 type errors in
// this file. Most are implicit-any on callback parameters, but a few are
// real: `Delivery.channel` is inferred as `string` where the type says
// `"file" | "webhook"`, so an invalid channel can reach the store without
// complaint. Fixing it is a self-contained job on this file alone and does
// not touch the rest of the app. It was left alone deliberately rather than
// half-done during the mobile build.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { buildAnalysis } from "./analyze";
import {
  bumpControlSession,
  deliverWebhook,
  loadControl,
  pulseControl,
  saveControl,
} from "./control-fns";
import { catalog, deriveCleanup } from "./derive";
import { runMode } from "./engine";
import { parseJsonl } from "./jsonl";
import { captureLock, MAX_LOCKS } from "./lock";
import { parseMachineSnap } from "./machine-status";
import { CLEANUP } from "./memory";
import { applyCleanupIds, autoAppliedCount, buildReport, cloneFiles } from "./mutate";
import { MODE_META } from "./patterns";
import { TRANSCRIPTS } from "./transcripts";
import {
  can,
  DEFAULT_POLICY,
  deliveryBackoffMs,
  newId,
  slaWindowMs,
} from "./org";
import { resetRamHistory } from "./ram";
import type {
  AuditEvent,
  CleanupItem,
  Delivery,
  DreamLog,
  DreamReport,
  Job,
  LockedProject,
  MachineSnap,
  MemoryFile,
  PatternMode,
  Role,
  Snapshot,
  TranscriptLine,
} from "./types";

export type DreamState = {
  lockedProjects: LockedProject[];
  jobs: Job[];
  extraLines: TranscriptLine[];
  extraCleanup: CleanupItem[];
  files: MemoryFile[];
  deliveries: Delivery[];
  hooks: { id: string; at: string; body: string }[];
  audit: AuditEvent[];
  snapshots: Snapshot[];
  reports: DreamReport[];
  logs: DreamLog[];
  trash: MemoryFile[];
  artifacts: MemoryFile[];
  machineSnap: MachineSnap | null;
  setMachineSnap: (snap: MachineSnap | null) => void;
  mode: PatternMode;
  applied: Record<string, boolean>;
  analysisMd: string | null;
  claudeProposal: string | null;
  lastDream: string | null;
  checked: Record<string, boolean>;
  signed: Record<string, boolean>;
  proposedBy: Record<string, Role | "">;
  signedBy: Record<string, Role | "">;
  glass: Record<string, boolean>;
  cleanupMd: string | null;
} & Record<string, any>;

export const PHASES = [
	{
		id: "orient",
		title: "Orient",
		body: "List the memory directory, read MEMORY.md, skim topic files so we update instead of duplicating."
	},
	{
		id: "gather",
		title: "Gather",
		body: "Grep sessions since last dream. Signal only, corrections, preferences, decisions, recurring themes."
	},
	{
		id: "draft",
		title: "Draft",
		body: "Write the cleanup overview. Mechanical fixes vs judgment calls. Do not write memory yet."
	},
	{
		id: "apply",
		title: "Apply (gated)",
		body: "Snapshot first. Apply auto-approved items plus dual-signed judgment. Never rm. Never touch CLAUDE.md."
	},
	{
		id: "prune",
		title: "Prune & index",
		body: "Rebuild MEMORY.md under 200 lines. One hook per topic, ~150 chars, absolute dates only."
	},
	{
		id: "deliver",
		title: "Deliver",
		body: "Post the report to file and webhook. Record status. Never skip the audit line."
	}
];
export const CADENCE_MS = {
	off: {
		full: 0,
		apply: 0,
		label: "Manual only"
	},
	preview: {
		full: 45e3,
		apply: 15e3,
		label: "Preview (45s full / 15s apply)"
	},
	weekly: {
		full: 6048e5,
		apply: 864e5,
		label: "Weekly dream / daily apply"
	}
};
function isoStamp() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function pushLog(logs, entry) {
	return [entry, ...logs].slice(0, 24);
}
function pushJob(jobs, job) {
	return [job, ...jobs].slice(0, 30);
}
function pushAudit(audit, event) {
	return [event, ...audit].slice(0, 200);
}
const emptyApplied = () => Object.fromEntries(CLEANUP.map((c) => [c.id, false]));
const emptyChecked = () => Object.fromEntries(CLEANUP.filter((c) => c.kind === "judgment").map((c) => [c.id, false]));

function idsToApply(
  items,
  applied,
  checked,
  includeAuto,
  signed,
  dualControl,
  proposedBy,
  signedBy,
  glass,
) {
  return items
    .filter((c) => {
      if (applied[c.id]) return false;
      if (c.kind === "protected") return false;
      if (c.kind === "auto") return includeAuto;
      if (!checked[c.id]) return false;
      if (glass?.[c.id]) return true;
      if (!dualControl) return true;
      return Boolean(
        signed[c.id] &&
          proposedBy[c.id] &&
          signedBy[c.id] &&
          proposedBy[c.id] !== signedBy[c.id],
      );
    })
    .map((c) => c.id);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let retryLock = false;
let persistHydrated = false;
export function isDreamPersistHydrated() {
	return persistHydrated;
}
export function markDreamHydrated() {
	persistHydrated = true;
}
function soonest(a, b) {
	if (a == null) return b;
	if (b == null) return a;
	return Math.min(a, b);
}
function hooksFrom(deliveries) {
	return deliveries.filter((d) => d.channel === "webhook" && d.status === 200).map((d) => ({
		id: d.id,
		at: d.at,
		body: d.body.slice(0, 2e3)
	}));
}
function snapshotDaemon(s) {
	saveControl({ data: {
		jobs: s.jobs,
		audit: s.audit,
		deliveries: s.deliveries,
		daemon: {
			armed: s.armed,
			cadence: s.cadence,
			frozen: s.frozen,
			sessions: s.sessionsSince,
			nextFullAt: s.nextFullAt,
			nextApplyAt: s.nextApplyAt,
			lastPulse: s.lastPulse,
			policy: s.policy
		}
	} }).catch(() => {});
}
async function sendDeliveries(policy, markdown) {
	const at = isoStamp();
	const out = [];
	if (policy.deliverTo === "file" || policy.deliverTo === "both") out.push({
		id: newId("dlv"),
		at,
		channel: "file",
		status: 200,
		target: "memory/dream/REPORT.md",
		body: markdown,
		attempts: 1,
		nextRetry: null
	});
	if (policy.deliverTo === "webhook" || policy.deliverTo === "both") {
		const id = newId("dlv");
		try {
			const hook = await deliverWebhook({ data: {
				url: policy.webhookUrl,
				markdown,
				id,
				at
			} });
			out.push({
				id,
				at,
				channel: "webhook",
				status: hook.status,
				target: hook.target,
				body: markdown.slice(0, 280),
				attempts: 1,
				nextRetry: hook.status === 200 ? null : Date.now() + deliveryBackoffMs(1)
			});
		} catch {
			out.push({
				id,
				at,
				channel: "webhook",
				status: 0,
				target: policy.webhookUrl,
				body: markdown.slice(0, 280),
				attempts: 1,
				nextRetry: Date.now() + deliveryBackoffMs(1)
			});
		}
	}
	return out;
}
export const useDream = create<DreamState>()(persist((set, get) => ({
	phase: "idle",
	running: false,
	lastDream: null,
	lastDreamAt: null,
	checked: emptyChecked(),
	signed: emptyChecked(),
	applied: emptyApplied(),
	appliedCount: 0,
	waitingCount: CLEANUP.filter((c) => c.kind === "judgment").length,
	gatherPrecision: 0,
	gatherRecall: 0,
	mode: "twopass",
	armed: true,
	cadence: "preview",
	nextFullAt: Date.now() + 45e3,
	nextApplyAt: Date.now() + 15e3,
	sessionsSince: 6,
	files: cloneFiles(),
	trash: [],
	snapshots: [],
	reports: [],
	logs: [],
	role: "operator",
	env: "production",
	frozen: false,
	policy: { ...DEFAULT_POLICY },
	jobs: [],
	audit: [],
	deliveries: [],
	extraLines: [],
	seenLineIds: [],
	gatherPattern: null,
	alreadyTight: false,
	analysisMd: null,
	cleanupMd: null,
	claudeProposal: null,
	artifacts: [],
	extraCleanup: [],
	proposedBy: {},
	signedBy: {},
	glass: {},
	floorBlocked: false,
	lastPulse: null,
	planeOk: false,
	hooks: [],
	slaNagged: false,
	lastSummonAt: null,
	lockedProjects: [],
	machineSnap: null,
	setMode: (mode) => {
		set({ mode });
		const s = get();
		set({ audit: pushAudit(s.audit, {
			id: newId("aud"),
			at: isoStamp(),
			actor: s.role,
			action: "mode",
			target: mode,
			detail: `Gather mode set to ${mode}`
		}) });
	},
	setSeat: (role) => set({ role }),
	setEnv: (env) => {
		const s = get();
		set({
			env,
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: "env",
				target: env,
				detail: `Environment ${env}`
			})
		});
	},
	setPolicy: (patch) => {
		const s = get();
		if (!can(s.role, "policy")) return;
		set({
			policy: {
				...s.policy,
				...patch
			},
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: "policy",
				target: Object.keys(patch).join(","),
				detail: JSON.stringify(patch)
			})
		});
		snapshotDaemon(get());
	},
	setFrozen: (frozen) => {
		const s = get();
		if (!can(s.role, "freeze")) return;
		set({
			frozen,
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: frozen ? "freeze" : "unfreeze",
				target: "memory",
				detail: frozen ? "Write freeze engaged" : "Write freeze lifted"
			})
		});
		snapshotDaemon(get());
	},
	toggleCheck: (id) => {
		const s = get();
		if (!can(s.role, "propose")) return;
		const next = !s.checked[id];
		set({
			checked: {
				...s.checked,
				[id]: next
			},
			signed: next ? s.signed : {
				...s.signed,
				[id]: false
			},
			proposedBy: {
				...s.proposedBy,
				[id]: next ? s.role : ""
			},
			signedBy: next ? s.signedBy : {
				...s.signedBy,
				[id]: ""
			},
			glass: next ? s.glass : {
				...s.glass,
				[id]: false
			},
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: next ? "propose" : "unpropose",
				target: id,
				detail: next ? `${s.role} proposed judgment item` : "Proposal withdrawn"
			})
		});
	},
	countersign: (id) => {
		const s = get();
		if (!can(s.role, "sign")) return;
		if (!s.checked[id]) return;
		if (s.policy.dualControl && s.proposedBy[id] === s.role) return;
		const next = !s.signed[id];
		set({
			signed: {
				...s.signed,
				[id]: next
			},
			signedBy: {
				...s.signedBy,
				[id]: next ? s.role : ""
			},
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: next ? "sign" : "unsign",
				target: id,
				detail: next ? `${s.role} countersigned (proposer ${s.proposedBy[id] || "n/a"})` : "Signature withdrawn"
			})
		});
	},
	breakGlass: (id) => {
		const s = get();
		if (!can(s.role, "break-glass")) return;
		if (s.frozen) return;
		set({
			checked: {
				...s.checked,
				[id]: true
			},
			signed: {
				...s.signed,
				[id]: true
			},
			proposedBy: {
				...s.proposedBy,
				[id]: s.role
			},
			signedBy: {
				...s.signedBy,
				[id]: s.role
			},
			glass: {
				...s.glass,
				[id]: true
			},
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: "break-glass",
				target: id,
				detail: "Admin signed both sides. This is on the evidence pack."
			})
		});
	},
	arm: (armed) => {
		const s = get();
		if (!can(s.role, "arm")) return;
		const cadence = s.cadence;
		const now = Date.now();
		const ms = CADENCE_MS[cadence];
		set({
			armed,
			nextFullAt: armed && cadence !== "off" ? now + ms.full : null,
			nextApplyAt: armed && cadence !== "off" ? now + ms.apply : null,
			logs: pushLog(s.logs, {
				at: isoStamp(),
				kind: "skip",
				text: armed ? `Daemon armed · ${ms.label}` : "Daemon idle. Mechanical work waits for a button."
			}),
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: armed ? "arm" : "disarm",
				target: "daemon",
				detail: ms.label
			})
		});
		snapshotDaemon(get());
	},
	setCadence: (cadence) => {
		const s = get();
		if (!can(s.role, "arm")) return;
		const now = Date.now();
		const ms = CADENCE_MS[cadence];
		set({
			cadence,
			nextFullAt: s.armed && cadence !== "off" ? now + ms.full : null,
			nextApplyAt: s.armed && cadence !== "off" ? now + ms.apply : null
		});
		snapshotDaemon(get());
	},
	bumpSession: () => {
		set((s) => ({ sessionsSince: s.sessionsSince + 1 }));
		bumpControlSession({ data: {} }).then((r) => {
			if (typeof r.sessions === "number") set({ sessionsSince: r.sessions });
			snapshotDaemon(get());
		}).catch(() => snapshotDaemon(get()));
	},
	pasteJsonl: (raw) => {
		const parsed = parseJsonl(raw).slice(0, 40);
		if (parsed.length === 0) return;
		const s = get();
		set({
			extraLines: [...parsed, ...s.extraLines].slice(0, 40),
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: "paste-jsonl",
				target: "corpus",
				detail: `${parsed.length} line${parsed.length === 1 ? "" : "s"} added. UNVERIFIED until gold-labeled.`
			})
		});
		snapshotDaemon(get());
		get().lockProject("Latest dream", {
			silent: true,
			kind: "auto"
		});
	},
	clearPasted: () => set({ extraLines: [] }),
	setGatherPattern: (pattern) => {
		const s = get();
		if (pattern && !can(s.role, "run")) return;
		set({
			gatherPattern: pattern,
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: "gather-pattern",
				target: pattern ? "override" : "clear",
				detail: pattern ? pattern.slice(0, 80) : "cleared"
			})
		});
	},
	runDream: (actor) => {
		const s0 = get();
		const who = actor ?? s0.role;
		if (s0.running) return;
		if (who !== "daemon" && !can(s0.role, "run")) return;
		const jobId = newId("job");
		const started = isoStamp();
		if (s0.frozen) {
			const ms = CADENCE_MS[s0.cadence];
			set({
				jobs: pushJob(s0.jobs, {
					id: jobId,
					kind: "full",
					status: "blocked",
					actor: who,
					at: started,
					endedAt: started,
					detail: "Write freeze is on. Admin must lift it."
				}),
				logs: pushLog(s0.logs, {
					at: started,
					kind: "skip",
					text: "Full dream blocked · freeze"
				}),
				nextFullAt: s0.armed && s0.cadence !== "off" ? Date.now() + ms.full : s0.nextFullAt
			});
			return;
		}
		(async () => {
			set({
				running: true,
				phase: "orient",
				jobs: pushJob(get().jobs, {
					id: jobId,
					kind: "full",
					status: "running",
					actor: who,
					at: started,
					detail: "Full dream in flight"
				})
			});
			const allLines = [...TRANSCRIPTS, ...get().extraLines];
			const seen = new Set(get().seenLineIds);
			const unseen = allLines.filter((l) => !seen.has(l.id));
			const noNew = unseen.length === 0;
			const report = noNew ? {
				...runMode(get().mode, get().gatherPattern ?? MODE_META[get().mode].pattern, []),
				precision: 1,
				recall: 1,
				hits: [],
				truePositives: 0,
				falsePositives: 0,
				falseNegatives: 0
			} : runMode(get().mode, get().gatherPattern ?? MODE_META[get().mode].pattern, unseen);
			for (const step of PHASES) {
				set({ phase: step.id });
				await sleep(step.id === "gather" ? 420 : 220);
			}
			const s = get();
			const hasGold = unseen.some((l) => l.gold.length > 0);
			const belowFloor = !noNew && hasGold && report.precision < s.policy.precisionFloor;
			const includeAuto = s.policy.autoApply && !belowFloor && !noNew;
			const items = catalog(s.extraCleanup);
			const ids = idsToApply(items, s.applied, s.checked, includeAuto, s.signed, s.policy.dualControl, s.proposedBy, s.signedBy, s.glass);
			const writeIds = belowFloor ? [] : ids;
			const snapAt = isoStamp();
			const snapshots = [{
				at: snapAt,
				files: cloneFiles(s.files),
				trash: cloneFiles(s.trash),
				applied: { ...s.applied }
			}, ...s.snapshots].slice(0, 8);
			const mutated = writeIds.length ? applyCleanupIds(s.files, s.trash, writeIds, s.extraCleanup) : {
				files: s.files,
				trash: s.trash
			};
			const applied = { ...s.applied };
			for (const id of writeIds) applied[id] = true;
			const autoApplied = writeIds.filter((id) => items.find((c) => c.id === id)?.kind === "auto");
			const judged = writeIds.filter((id) => items.find((c) => c.id === id)?.kind === "judgment");
			const blocked = belowFloor ? `Gather precision ${Math.round(report.precision * 100)}% below floor ${Math.round(s.policy.precisionFloor * 100)}%` : void 0;
			const at = isoStamp();
			const draftAnalysis = buildAnalysis({
				date: snapAt,
				corpus: noNew ? allLines : unseen,
				hits: report.hits,
				applied,
				autoApplied,
				judged,
				waiting: catalog(s.extraCleanup).filter((c) => c.kind === "judgment" && !applied[c.id]).map((c) => c.id),
				extras: s.extraCleanup,
				blocked
			});
			const minted = belowFloor ? [] : deriveCleanup(draftAnalysis.lessons, s.extraCleanup);
			const extraCleanup = [...s.extraCleanup.filter((e) => applied[e.id] || s.checked[e.id] || minted.some((m) => m.id === e.id)), ...minted.filter((m) => !s.extraCleanup.some((e) => e.id === m.id))].slice(0, 16);
			const waiting = catalog(extraCleanup).filter((c) => c.kind === "judgment" && !applied[c.id]);
			const markdown = buildReport({
				at: snapAt,
				kind: "full",
				autoApplied,
				judged,
				waiting: waiting.map((w) => w.id),
				precision: report.precision,
				recall: report.recall,
				blocked
			});
			const analysis = buildAnalysis({
				date: snapAt,
				corpus: noNew ? allLines : unseen,
				hits: report.hits,
				applied,
				autoApplied,
				judged,
				waiting: waiting.map((w) => w.id),
				extras: extraCleanup,
				blocked
			});
			const reportBody = markdown;
			const artifacts = [
				{
					id: "analysis",
					name: `dream/analysis-${snapAt}.md`,
					hook: "Session analysis. Signal only.",
					stale: false,
					body: analysis.markdown,
					lines: analysis.markdown.split("\n").length
				},
				{
					id: "cleanup-draft",
					name: `dream/cleanup-${snapAt}.md`,
					hook: "Draft only. Gate still applies.",
					stale: false,
					body: analysis.cleanupMarkdown,
					lines: analysis.cleanupMarkdown.split("\n").length
				},
				{
					id: "report-file",
					name: "dream/REPORT.md",
					hook: "send-results output.",
					stale: false,
					body: reportBody,
					lines: reportBody.split("\n").length
				},
				{
					id: "last-dream",
					name: "dream/.last-dream",
					hook: "Timestamp gate for sessions since.",
					stale: false,
					body: snapAt,
					lines: 1
				},
				{
					id: "claude-proposal",
					name: "CLAUDE.md.proposal",
					hook: "Human-owned. Never auto-applied.",
					stale: false,
					body: analysis.claudeProposal,
					lines: analysis.claudeProposal.split("\n").length
				}
			];
			const ms = CADENCE_MS[s.cadence];
			const deliveries = await sendDeliveries(s.policy, reportBody);
			const jobs = get().jobs.map((j) => j.id === jobId ? {
				...j,
				status: blocked ? "blocked" : "ok",
				endedAt: at,
				detail: blocked ?? (analysis.alreadyTight ? "already tight" : `auto ${autoApplied.length} · waiting ${waiting.length}`)
			} : j);
			const newHooks = hooksFrom(deliveries);
			set({
				phase: "done",
				running: false,
				lastDream: snapAt,
				lastDreamAt: Date.now(),
				applied,
				appliedCount: autoAppliedCount(applied),
				waitingCount: waiting.length,
				gatherPrecision: report.precision,
				gatherRecall: report.recall,
				files: mutated.files,
				trash: mutated.trash,
				snapshots,
				reports: [{
					at,
					kind: "full",
					markdown: reportBody
				}, ...s.reports].slice(0, 12),
				logs: pushLog(s.logs, {
					at,
					kind: "full",
					text: blocked ? `Full dream blocked · ${blocked}` : analysis.alreadyTight ? "Full dream · already tight" : `Full dream · auto ${autoApplied.length} · waiting ${waiting.length}`
				}),
				jobs,
				deliveries: [...deliveries, ...s.deliveries].slice(0, 24),
				audit: pushAudit(s.audit, {
					id: newId("aud"),
					at,
					actor: who,
					action: blocked ? "dream-blocked" : "dream",
					target: jobId,
					detail: blocked ?? (analysis.alreadyTight ? "already tight" : "ok")
				}),
				nextFullAt: s.armed && s.cadence !== "off" ? Date.now() + ms.full : s.nextFullAt,
				nextApplyAt: s.armed && s.cadence !== "off" ? Date.now() + ms.apply : s.nextApplyAt,
				sessionsSince: blocked ? s.sessionsSince : 0,
				alreadyTight: analysis.alreadyTight,
				analysisMd: analysis.markdown,
				cleanupMd: analysis.cleanupMarkdown,
				claudeProposal: analysis.claudeProposal,
				artifacts,
				extraCleanup,
				floorBlocked: Boolean(belowFloor),
				seenLineIds: belowFloor ? s.seenLineIds : allLines.map((l) => l.id),
				hooks: [...newHooks, ...get().hooks].slice(0, 24),
				slaNagged: waiting.length === 0 ? false : get().slaNagged
			});
			get().lockProject("Latest dream", {
				silent: true,
				kind: "auto"
			});
			snapshotDaemon(get());
			loadControl().then((p) => {
				if (p.hooks.length) set({
					hooks: p.hooks,
					planeOk: true
				});
			}).catch(() => {});
		})();
	},
	applyChecked: (actor, mechanical = false) => {
		const s = get();
		const who = actor ?? s.role;
		if (s.running) return;
		if (who !== "daemon" && !can(s.role, "run")) return;
		const jobId = newId("job");
		const started = isoStamp();
		if (s.frozen) {
			const ms = CADENCE_MS[s.cadence];
			const already = s.jobs.find((j) => j.kind === "apply" && j.status === "blocked");
			if (who === "daemon" && already?.detail.includes("freeze")) {
				set({ nextApplyAt: s.armed && s.cadence !== "off" ? Date.now() + ms.apply : s.nextApplyAt });
				return;
			}
			set({
				jobs: pushJob(s.jobs, {
					id: jobId,
					kind: "apply",
					status: "blocked",
					actor: who,
					at: started,
					endedAt: started,
					detail: "Write freeze is on."
				}),
				nextApplyAt: s.armed && s.cadence !== "off" ? Date.now() + ms.apply : s.nextApplyAt
			});
			return;
		}
		if (s.floorBlocked) {
			set({ jobs: pushJob(s.jobs, {
				id: jobId,
				kind: "apply",
				status: "blocked",
				actor: who,
				at: started,
				endedAt: started,
				detail: "Gather is below the precision floor. Clear the lab override and run gather again."
			}) });
			return;
		}
		const items = catalog(s.extraCleanup);
		const includeAuto = mechanical || s.policy.autoApply;
		const ids = idsToApply(items, s.applied, s.checked, includeAuto, s.signed, s.policy.dualControl, s.proposedBy, s.signedBy, s.glass);
		const ms = CADENCE_MS[s.cadence];
		if (ids.length === 0) {
			set({
				logs: pushLog(s.logs, {
					at: started,
					kind: "skip",
					text: s.policy.dualControl ? "Apply-fixes: nothing dual-signed since last run." : "Apply-fixes: nothing checked since last run."
				}),
				jobs: who === "daemon" ? s.jobs : pushJob(s.jobs, {
					id: jobId,
					kind: "apply",
					status: "ok",
					actor: who,
					at: started,
					endedAt: started,
					detail: "No signed items"
				}),
				nextApplyAt: s.armed && s.cadence !== "off" ? Date.now() + ms.apply : s.nextApplyAt
			});
			return;
		}
		const snapAt = isoStamp();
		const snapshots = [{
			at: snapAt,
			files: cloneFiles(s.files),
			trash: cloneFiles(s.trash),
			applied: { ...s.applied }
		}, ...s.snapshots].slice(0, 8);
		const mutated = applyCleanupIds(s.files, s.trash, ids, s.extraCleanup);
		const applied = { ...s.applied };
		for (const id of ids) applied[id] = true;
		const waiting = items.filter((c) => c.kind === "judgment" && !applied[c.id]);
		const autoApplied = ids.filter((id) => items.find((c) => c.id === id)?.kind === "auto");
		const judged = ids.filter((id) => items.find((c) => c.id === id)?.kind === "judgment");
		const at = isoStamp();
		const markdown = buildReport({
			at: snapAt,
			kind: "apply",
			autoApplied,
			judged,
			waiting: waiting.map((w) => w.id),
			precision: s.gatherPrecision,
			recall: s.gatherRecall
		});
		const deliveries = [];
		const mutatedFiles = mutated.files;
		const mutatedTrash = mutated.trash;
		set({
			applied,
			appliedCount: autoAppliedCount(applied),
			waitingCount: waiting.length,
			lastDream: s.lastDream ?? snapAt,
			files: mutatedFiles,
			trash: mutatedTrash,
			snapshots,
			reports: [{
				at,
				kind: "apply",
				markdown
			}, ...s.reports].slice(0, 12),
			logs: pushLog(s.logs, {
				at,
				kind: "apply",
				text: `Apply-fixes · ${ids.length} item${ids.length === 1 ? "" : "s"}${s.policy.dualControl ? " (dual-signed)" : ""}`
			}),
			jobs: pushJob(s.jobs, {
				id: jobId,
				kind: "apply",
				status: "ok",
				actor: who,
				at: started,
				endedAt: at,
				detail: `${ids.length} item${ids.length === 1 ? "" : "s"}`
			}),
			deliveries,
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at,
				actor: who,
				action: "apply",
				target: ids.join(","),
				detail: markdown.split("\n")[0] ?? "apply"
			}),
			nextApplyAt: s.armed && s.cadence !== "off" ? Date.now() + ms.apply : s.nextApplyAt
		});
		snapshotDaemon(get());
		get().lockProject("Latest dream", {
			silent: true,
			kind: "auto"
		});
		sendDeliveries(s.policy, markdown).then((d) => {
			const newHooks = hooksFrom(d);
			set({
				deliveries: [...d, ...get().deliveries].slice(0, 24),
				hooks: [...newHooks, ...get().hooks].slice(0, 24)
			});
			snapshotDaemon(get());
		});
	},
	rollback: (at) => {
		const s = get();
		if (!can(s.role, "rollback")) return;
		if (s.frozen) return;
		const snap = s.snapshots.find((x) => x.at === at);
		if (!snap) return;
		const ended = isoStamp();
		set({
			files: cloneFiles(snap.files),
			trash: snap.trash ? cloneFiles(snap.trash) : s.trash,
			applied: { ...snap.applied },
			appliedCount: autoAppliedCount(snap.applied),
			waitingCount: CLEANUP.filter((c) => c.kind === "judgment" && !snap.applied[c.id]).length,
			jobs: pushJob(s.jobs, {
				id: newId("job"),
				kind: "rollback",
				status: "ok",
				actor: s.role,
				at: ended,
				endedAt: ended,
				detail: `Restored snapshot ${at}`
			}),
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: ended,
				actor: s.role,
				action: "rollback",
				target: at,
				detail: "Memory restored from snapshot. Snapshot itself kept."
			})
		});
		snapshotDaemon(get());
		get().lockProject("Latest dream", {
			silent: true,
			kind: "auto"
		});
	},
	tick: () => {
		if (!persistHydrated) return;
		const s = get();
		const now = Date.now();
		if (!s.lastPulse || now - s.lastPulse > 4e3) pulseControl({ data: {} }).then((r) => set({
			lastPulse: r.lastPulse,
			planeOk: true
		})).catch(() => set({ planeOk: false }));
		const dueHooks = s.deliveries.filter((d) => d.channel === "webhook" && d.status !== 200 && (d.attempts ?? 1) < 3 && (d.nextRetry == null || d.nextRetry <= now));
		if (dueHooks.length && !retryLock) {
			retryLock = true;
			(async () => {
				try {
					const policy = get().policy;
					const next = [...get().deliveries];
					const landed = [];
					for (const d of dueHooks) {
						const attempts = (d.attempts ?? 1) + 1;
						let updated;
						try {
							const hook = await deliverWebhook({ data: {
								url: policy.webhookUrl,
								markdown: d.body,
								id: d.id,
								at: isoStamp()
							} });
							updated = {
								...d,
								status: hook.status,
								attempts,
								nextRetry: hook.status === 200 ? null : attempts >= 3 ? null : Date.now() + deliveryBackoffMs(attempts)
							};
						} catch {
							updated = {
								...d,
								status: 0,
								attempts,
								nextRetry: attempts >= 3 ? null : Date.now() + deliveryBackoffMs(attempts)
							};
						}
						const idx = next.findIndex((x) => x.id === d.id);
						if (idx >= 0) next[idx] = updated;
						landed.push(updated);
					}
					set({
						deliveries: next,
						hooks: [...hooksFrom(landed), ...get().hooks].slice(0, 24),
						audit: pushAudit(get().audit, {
							id: newId("aud"),
							at: isoStamp(),
							actor: "daemon",
							action: "retry-webhook",
							target: String(dueHooks.length),
							detail: landed.map((d) => `${d.status}/${d.attempts ?? 1}`).join(", ")
						})
					});
					snapshotDaemon(get());
				} finally {
					retryLock = false;
				}
			})();
		}
		const live = get();
		if (live.waitingCount > 0 && live.lastDreamAt != null && now - live.lastDreamAt > slaWindowMs(live.policy, live.cadence) && !live.slaNagged) {
			set({ slaNagged: true });
			const windowLabel = live.cadence === "preview" ? "90s preview SLA" : `${live.policy.slaHours}h SLA`;
			const md = `# SLA breach\n${live.waitingCount} judgment item(s) past ${windowLabel}.`;
			sendDeliveries(live.policy, md).then((d) => {
				const newHooks = hooksFrom(d);
				set({
					deliveries: [...d, ...get().deliveries].slice(0, 24),
					hooks: [...newHooks, ...get().hooks].slice(0, 24),
					audit: pushAudit(get().audit, {
						id: newId("aud"),
						at: isoStamp(),
						actor: "daemon",
						action: "sla-breach",
						target: "gate",
						detail: md.split("\n")[1] ?? "sla"
					})
				});
				snapshotDaemon(get());
			});
		} else if (live.waitingCount === 0 && live.slaNagged) set({ slaNagged: false });
		if (!s.armed || s.cadence === "off") return;
		if (s.running) {
			const stuck = s.jobs.find((j) => j.status === "running");
			const startedAt = stuck ? Date.parse(stuck.at) : 0;
			if (stuck && Number.isFinite(startedAt) && now - startedAt > 15e3) {
				set({
					running: false,
					phase: "idle",
					jobs: s.jobs.map((j) => j.id === stuck.id ? {
						...j,
						status: "failed",
						endedAt: isoStamp(),
						detail: "Watchdog: job exceeded 15s"
					} : j),
					audit: pushAudit(s.audit, {
						id: newId("aud"),
						at: isoStamp(),
						actor: "daemon",
						action: "watchdog",
						target: stuck.id,
						detail: "Cleared stuck running job"
					})
				});
				snapshotDaemon(get());
			}
			return;
		}
		const ms = CADENCE_MS[s.cadence];
		if (s.frozen) {
			const patch = {};
			if (s.nextFullAt && now >= s.nextFullAt) patch.nextFullAt = now + ms.full;
			if (s.nextApplyAt && now >= s.nextApplyAt) patch.nextApplyAt = now + ms.apply;
			if (Object.keys(patch).length) set({
				...patch,
				logs: pushLog(s.logs, {
					at: isoStamp(),
					kind: "skip",
					text: "Daemon tick skipped · write freeze"
				})
			});
			return;
		}
		if (s.nextFullAt && now >= s.nextFullAt) {
			if (s.cadence === "weekly" && s.sessionsSince < 5) {
				set({
					nextFullAt: now + 6e4,
					logs: pushLog(s.logs, {
						at: isoStamp(),
						kind: "skip",
						text: `Weekly gate: ${s.sessionsSince}/5 sessions since last dream. Waiting.`
					})
				});
				return;
			}
			const unseenExtra = s.extraLines.some((l) => !s.seenLineIds.includes(l.id));
			if (s.lastDream && !s.floorBlocked && !unseenExtra) {
				set({
					nextFullAt: now + ms.full,
					logs: pushLog(s.logs, {
						at: isoStamp(),
						kind: "skip",
						text: "Daemon · no new sessions since last dream"
					})
				});
				snapshotDaemon(get());
				return;
			}
			get().runDream("daemon");
			return;
		}
		if (s.nextApplyAt && now >= s.nextApplyAt) get().applyChecked("daemon");
	},
	hydrateControl: (plane) => {
		const cur = get();
		let nextFullAt = soonest(plane.daemon.nextFullAt, cur.nextFullAt);
		const nextApplyAt = soonest(plane.daemon.nextApplyAt, cur.nextApplyAt);
		const armed = plane.daemon.armed;
		const cadence = plane.daemon.cadence;
		const frozen = plane.daemon.frozen;
		if (armed && cadence !== "off" && !frozen && !cur.lastDream) nextFullAt = Date.now();
		set({
			jobs: plane.jobs.length ? plane.jobs : cur.jobs,
			audit: plane.audit.length ? plane.audit : cur.audit,
			deliveries: plane.deliveries.length ? plane.deliveries : cur.deliveries,
			hooks: plane.hooks.length ? plane.hooks : cur.hooks,
			armed,
			cadence,
			frozen,
			sessionsSince: plane.daemon.sessions,
			policy: {
				...cur.policy,
				...plane.daemon.policy
			},
			nextFullAt,
			nextApplyAt,
			lastPulse: plane.daemon.lastPulse,
			planeOk: true
		});
	},
	reset: () => {
		const s = get();
		set({
			phase: "idle",
			running: false,
			lastDream: null,
			lastDreamAt: null,
			checked: emptyChecked(),
			signed: emptyChecked(),
			applied: emptyApplied(),
			appliedCount: 0,
			waitingCount: CLEANUP.filter((c) => c.kind === "judgment").length,
			gatherPrecision: 0,
			gatherRecall: 0,
			armed: true,
			nextFullAt: Date.now() + 45e3,
			nextApplyAt: Date.now() + 15e3,
			sessionsSince: 6,
			files: cloneFiles(),
			trash: [],
			snapshots: [],
			reports: [],
			logs: [],
			frozen: false,
			jobs: [],
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: "reset",
				target: "workspace",
				detail: "Demo state wiped. Audit kept."
			}),
			deliveries: [],
			policy: { ...DEFAULT_POLICY },
			extraLines: [],
			seenLineIds: [],
			gatherPattern: null,
			alreadyTight: false,
			analysisMd: null,
			cleanupMd: null,
			claudeProposal: null,
			artifacts: [],
			extraCleanup: [],
			proposedBy: {},
			signedBy: {},
			glass: {},
			floorBlocked: false,
			role: "operator",
			slaNagged: false,
			hooks: [],
			lastSummonAt: null,
			lockedProjects: s.lockedProjects,
			machineSnap: s.machineSnap
		});
		loadControl().then((p) => {
			get().hydrateControl(p);
			get().tick();
		}).catch(() => {
			get().tick();
		});
	},
	markSummon: () => {
		const s = get();
		const at = isoStamp();
		set({
			lastSummonAt: Date.now(),
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at,
				actor: s.role,
				action: "summon",
				target: "claude",
				detail: "Revive pack copied. Fresh session should read it, not the whole transcript."
			})
		});
		snapshotDaemon(get());
	},
	lockProject: (name, opts) => {
		const s = get();
		const label = name.trim().slice(0, 80) || "untitled";
		const locked = captureLock(s, {
			id: opts?.kind === "auto" ? (s.lockedProjects ?? []).find((p) => p.kind === "auto" || p.name === label)?.id ?? newId("lock") : newId("lock"),
			name: label,
			kind: opts?.kind ?? "named"
		});
		set({
			lockedProjects: [locked, ...(s.lockedProjects ?? []).filter((p) => opts?.kind === "auto" ? p.kind !== "auto" && p.name !== label : p.id !== locked.id)].slice(0, 8),
			audit: opts?.silent ? s.audit : pushAudit(s.audit, {
				id: newId("aud"),
				at: locked.at,
				actor: s.role,
				action: "lock-project",
				target: locked.id,
				detail: label
			})
		});
		void import("./sync").then(m => m.pushItem("lockedProject", locked.id, locked));
	},
	restoreProject: (id) => {
		const s = get();
		if (s.running) return;
		if (s.frozen || !can(s.role, "run")) return;
		const locked = (s.lockedProjects ?? []).find((p) => p.id === id);
		if (!locked) return;
		const applied = { ...locked.applied };
		const waiting = catalog(locked.extraCleanup).filter((c) => c.kind === "judgment" && !applied[c.id]).length;
		set({
			files: cloneFiles(locked.files),
			trash: cloneFiles(locked.trash),
			applied,
			appliedCount: autoAppliedCount(applied),
			waitingCount: waiting,
			extraCleanup: locked.extraCleanup.map((e) => ({ ...e })),
			analysisMd: locked.analysisMd,
			claudeProposal: locked.claudeProposal,
			lastDream: locked.lastDream,
			extraLines: (locked.extraLines ?? []).map((l) => ({
				...l,
				gold: (l.gold ?? []).map((g) => ({ ...g }))
			})),
			checked: locked.checked ? { ...locked.checked } : s.checked,
			signed: locked.signed ? { ...locked.signed } : s.signed,
			proposedBy: locked.proposedBy ? { ...locked.proposedBy } : s.proposedBy,
			signedBy: locked.signedBy ? { ...locked.signedBy } : s.signedBy,
			glass: locked.glass ? { ...locked.glass } : s.glass,
			cleanupMd: locked.cleanupMd ?? s.cleanupMd,
			alreadyTight: false,
			phase: locked.lastDream ? "done" : "idle",
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: "restore-project",
				target: id,
				detail: locked.name
			})
		});
	},
	dropLocked: (id) => {
		set({ lockedProjects: (get().lockedProjects ?? []).filter((p) => p.id !== id) });
		void import("./sync").then(m => m.removeItem("lockedProject", id));
	},
	dropWeight: () => {
		get().lockProject("Latest dream", {
			silent: true,
			kind: "auto"
		});
		const s = get();
		set({
			extraLines: [],
			snapshots: s.snapshots.slice(0, 2),
			reports: s.reports.slice(0, 2),
			logs: s.logs.slice(0, 6),
			artifacts: [],
			deliveries: s.deliveries.slice(0, 8),
			jobs: s.jobs.slice(0, 8),
			hooks: s.hooks.slice(0, 8),
			audit: pushAudit(s.audit, {
				id: newId("aud"),
				at: isoStamp(),
				actor: s.role,
				action: "drop-weight",
				target: "heap",
				detail: "Pasted dumps and extra snapshots dropped. Locked projects kept."
			})
		});
		resetRamHistory();
	},
	setMachineSnap: (snap) => set({ machineSnap: snap })
}), {
	name: "somnus-dream-v8",
	skipHydration: true,
	storage: createJSONStorage(() => {
		if (typeof window === "undefined") return {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {}
		};
		return {
			getItem: (name) => window.localStorage.getItem(name),
			setItem: (name, value) => {
				if (!persistHydrated) return;
				try {
					window.localStorage.setItem(name, value);
				} catch {
					// Quota exceeded or storage blocked; the tab keeps working in memory.
				}
			},
			removeItem: (name) => window.localStorage.removeItem(name)
		};
	}),
	onRehydrateStorage: () => () => {
		persistHydrated = true;
	},
	partialize: (s) => ({
		...s,
		running: false,
		phase: s.phase === "done" ? "done" : "idle",
		extraLines: s.extraLines.slice(0, 40),
		snapshots: s.snapshots.slice(0, 6),
		reports: s.reports.slice(0, 6),
		logs: s.logs.slice(0, 12),
		deliveries: s.deliveries.slice(0, 16),
		jobs: s.jobs.slice(0, 16),
		artifacts: s.artifacts.slice(0, 8),
		lockedProjects: (s.lockedProjects ?? []).slice(0, MAX_LOCKS)
	}),
	merge: (persisted, current) => {
		const p = persisted && typeof persisted === "object" ? persisted : {};
		return {
			...current,
			...p,
			lockedProjects: Array.isArray(p.lockedProjects) ? p.lockedProjects : [],
			lastSummonAt: typeof p.lastSummonAt === "number" ? p.lastSummonAt : null,
			machineSnap: p.machineSnap && typeof p.machineSnap === "object"
            ? parseMachineSnap(JSON.stringify(p.machineSnap), "file")
            : null,
			running: false
		};
	}
}));
