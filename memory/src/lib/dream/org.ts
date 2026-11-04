import { CLEANUP } from "./memory";
import type {
  Actor,
  AuditEvent,
  Cadence,
  Job,
  Policy,
  Role,
} from "./types";

export const ORG = {
  name: "Northwind Marine",
  unit: "Platform",
  project: "Keel",
  classification: "Internal · memory governance",
};

export const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: "admin", label: "Admin", blurb: "Policy, freeze, rollback, break-glass." },
  { id: "operator", label: "Operator", blurb: "Arm the daemon. Propose judgment." },
  { id: "reviewer", label: "Reviewer", blurb: "Countersign. Cannot write memory." },
];

export const DEFAULT_POLICY: Policy = {
  dualControl: true,
  precisionFloor: 0.7,
  autoApply: true,
  deliverTo: "both",
  webhookUrl: "internal:sink",
  slaHours: 48,
};

export function can(role: Role, action: string): boolean {
  switch (action) {
    case "run":
    case "arm":
    case "propose":
      return role === "admin" || role === "operator";
    case "sign":
      return role === "admin" || role === "reviewer";
    case "policy":
    case "freeze":
    case "rollback":
    case "break-glass":
      return role === "admin";
    default:
      return false;
  }
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function actorLabel(actor: Actor) {
  if (actor === "daemon") return "daemon";
  return ROLES.find((s) => s.id === actor)?.label ?? actor;
}

/** Preview cadence compresses the SLA so the breach is visible in this tab. */
export function slaWindowMs(policy: Policy, cadence: Cadence) {
  return cadence === "preview" ? 90_000 : policy.slaHours * 3_600_000;
}

export function deliveryBackoffMs(attempts: number) {
  return Math.min(45_000, 5_000 * 3 ** Math.max(0, attempts - 1));
}

export function buildEvidence(input: {
  at: string;
  policy: Policy;
  frozen: boolean;
  jobs: Job[];
  audit: AuditEvent[];
  waiting: number;
}): string {
  return `# Somnus evidence pack
Generated: ${input.at}
Org: ${ORG.name} · ${ORG.unit} · ${ORG.project}
Classification: ${ORG.classification}
Writes: ${input.frozen ? "FROZEN" : "LIVE"}
Waiting judgment: ${input.waiting}

## Policy
- Dual control: ${input.policy.dualControl ? "on" : "off"}
- Precision floor: ${Math.round(input.policy.precisionFloor * 100)}%
- Auto-apply mechanical: ${input.policy.autoApply ? "on" : "off"}
- Deliver: ${input.policy.deliverTo}
- Webhook: ${input.policy.webhookUrl}
- Judgment SLA: ${input.policy.slaHours}h

## Jobs (latest)
${input.jobs
  .slice(0, 20)
  .map((j) => `- ${j.at} · ${j.kind} · ${j.status} · ${j.actor} · ${j.detail}`)
  .join("\n") || "- none"}

## Audit (latest)
${input.audit
  .slice(0, 40)
  .map((a) => `- ${a.at} · ${a.actor} · ${a.action} · ${a.target} · ${a.detail}`)
  .join("\n") || "- none"}

## Cleanup catalog
${CLEANUP.map((c) => `- ${c.kind} · ${c.id} · ${c.title}`).join("\n")}
`;
}
