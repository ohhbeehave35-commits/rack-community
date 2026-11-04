export type LineKind = "user" | "assistant" | "tool_result";

export type SignalBucket =
  | "correction"
  | "preference"
  | "decision"
  | "recurring"
  | "noise";

export interface GoldSpan {
  start: number;
  end: number;
  bucket: Exclude<SignalBucket, "noise">;
}

export interface TranscriptLine {
  id: string;
  session: string;
  date: string;
  kind: LineKind;
  text: string;
  gold: GoldSpan[];
}

export type PatternMode =
  | "raw"
  | "bounded"
  | "lookahead"
  | "lookbehind"
  | "twopass";

export type EngineId =
  | "js"
  | "rg"
  | "grep-e"
  | "grep-p"
  | "pcre2"
  | "python"
  | "java"
  | "dotnet";

export type Support = "yes" | "no" | "bounded" | "fixed";

export interface Lesson {
  text: string;
  bucket: Exclude<SignalBucket, "noise"> | "noise";
  sessions: string[];
  unverified: boolean;
  lineIds: string[];
  recurring: boolean;
}

export interface CleanupItem {
  id: string;
  kind: "auto" | "judgment" | "protected";
  title: string;
  detail: string;
  file?: string;
  derived?: boolean;
  unverified?: boolean;
  lessonText?: string;
  bucket?: SignalBucket;
}

export interface MemoryFile {
  id: string;
  name: string;
  hook: string;
  stale: boolean;
  body: string;
  lines: number;
}

export interface MatchHit {
  lineId: string;
  start: number;
  end: number;
  text: string;
  truePositive: boolean;
  unverified: boolean;
}

export interface ModeReport {
  mode: PatternMode;
  pattern: string;
  hits: MatchHit[];
  precision: number;
  recall: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  elapsedMs: number;
  error?: string;
}

export type PhaseId =
  | "idle"
  | "orient"
  | "gather"
  | "draft"
  | "apply"
  | "prune"
  | "deliver"
  | "done";

export type Cadence = "off" | "preview" | "weekly";

export type Role = "admin" | "operator" | "reviewer";
export type Actor = Role | "daemon";
export type EnvId = "production" | "staging";
export type JobKind = "full" | "apply" | "rollback" | "deliver";
export type JobStatus = "queued" | "running" | "ok" | "blocked" | "failed";

export interface MachineSnap {
  at: string;
  os: string;
  totalMb: number | null;
  usedMb: number | null;
  availMb: number | null;
  pressure: "ok" | "warn" | "danger" | "unknown";
  tempC: number | null;
  fanRpm: number | null;
  fanPct: number | null;
  fanMode: FanMode;
  fanCount: number | null;
  fanLocked: boolean;
  fanNeedsAdmin: boolean;
  fanHolding: boolean;
  note: string;
  source: "sidecar" | "paste" | "file";
}

export type FanMode =
  | "auto"
  | "quiet"
  | "balanced"
  | "full"
  | "manual"
  | "hidden";

export interface DreamLog {
  at: string;
  kind: "full" | "apply" | "skip";
  text: string;
}

export interface DreamReport {
  at: string;
  kind: "full" | "apply";
  markdown: string;
}

export interface Snapshot {
  at: string;
  files: MemoryFile[];
  trash: MemoryFile[];
  applied: Record<string, boolean>;
}

export interface Policy {
  dualControl: boolean;
  precisionFloor: number;
  autoApply: boolean;
  deliverTo: "file" | "webhook" | "both";
  webhookUrl: string;
  slaHours: number;
}

export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  actor: Actor;
  at: string;
  endedAt?: string;
  detail: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: Actor;
  action: string;
  target: string;
  detail: string;
}

export interface Delivery {
  id: string;
  at: string;
  channel: "file" | "webhook";
  status: number;
  target: string;
  body: string;
  attempts?: number;
  nextRetry?: number | null;
}

export interface LockedProject {
  id: string;
  name: string;
  at: string;
  kind?: "auto" | "named";
  files: MemoryFile[];
  trash: MemoryFile[];
  applied: Record<string, boolean>;
  extraCleanup: CleanupItem[];
  analysisMd: string | null;
  claudeProposal: string | null;
  lastDream: string | null;
  extraLines?: TranscriptLine[];
  checked?: Record<string, boolean>;
  signed?: Record<string, boolean>;
  proposedBy?: Record<string, Role | "">;
  signedBy?: Record<string, Role | "">;
  glass?: Record<string, boolean>;
  cleanupMd?: string | null;
}
