import { createHash } from "node:crypto";
import type {
  ClassificationBasis,
  ClassificationObligation,
  GovernanceControls,
  RiskLabel,
  RouteId,
  VerificationKind,
} from "./types.js";

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

/** A deterministic hash used to make repeated decisions idempotent. */
export function decisionBasisHash(decision: unknown): string {
  return createHash("sha256").update(stable(decision)).digest("hex");
}

const riskRules: Record<RiskLabel, {
  kinds: Array<ClassificationObligation["kind"]>;
  verification: VerificationKind[];
  roles: string[];
}> = {
  security: { kinds: ["review", "verification", "approval"], verification: ["behavior"], roles: ["security"] },
  data: { kinds: ["review", "verification"], verification: ["behavior", "integration"], roles: ["data-integrity"] },
  money: { kinds: ["review", "verification", "approval"], verification: ["behavior", "integration"], roles: ["money-safety"] },
  external: { kinds: ["review", "verification"], verification: ["integration"], roles: ["contract-failure"] },
  availability: { kinds: ["review", "verification"], verification: ["integration"], roles: ["recovery-observability"] },
  critical_correctness: { kinds: ["review", "verification", "approval"], verification: ["full"], roles: ["critical-correctness"] },
  irreversible_consequence: { kinds: ["review", "verification", "rollback", "approval", "checkpoint"], verification: ["full"], roles: ["irreversibility"] },
};

function add(
  output: Map<string, ClassificationObligation>,
  kind: ClassificationObligation["kind"],
  source: ClassificationObligation["source"],
  reason: string,
  basis: unknown,
  roles: string[] = [],
  verificationKinds: VerificationKind[] = [],
): void {
  const basisHash = decisionBasisHash({ kind, source, reason, basis });
  const id = `${kind}:${basisHash.slice(0, 16)}`;
  if (output.has(id)) return;
  output.set(id, { id, kind, source, basisHash, status: "pending", reason, ...(roles.length ? { roles: [...new Set(roles)].sort() } : {}), ...(verificationKinds.length ? { verificationKinds: [...new Set(verificationKinds)].sort() } : {}) });
}

/**
 * Derive additive obligations from facts. This is intentionally pure: it does
 * not know business examples, hosts, commands, or project files.
 */
export function deriveObligations(
  route: RouteId,
  classificationBasis: ClassificationBasis,
  controls?: GovernanceControls,
): ClassificationObligation[] {
  const output = new Map<string, ClassificationObligation>();
  const labels = Object.keys(classificationBasis.riskFactRefs) as RiskLabel[];

  if (controls?.executionApproval) {
    add(output, "approval", "route", "该路线需要一次合并的执行确认", { route }, ["execution"]);
  }
  if (controls?.planReview) {
    add(output, "review", "route", "动态控制要求独立计划审查", { route, roles: controls.reviewRoles }, controls.reviewRoles);
  }
  if (controls?.recovery.some((kind) => kind !== "delivery-reverse")) {
    add(output, "rollback", "route", "动态控制要求可操作的恢复策略", { route, recovery: controls.recovery }, ["rollback-operability"]);
  }
  // Every routed feature receives a Core-owned recovery baseline. Route size
  // controls how many boundaries are captured, not whether the safety net is
  // visible as another user step.
  if (controls?.checkpoints) {
    add(output, "checkpoint", "route", "实现边界自动保存可恢复检查点", { route }, ["checkpoint"]);
  }

  for (const label of labels) {
    const rule = riskRules[label];
    if (!rule) continue;
    for (const kind of rule.kinds) {
      add(output, kind, "risk", `风险事实要求 ${kind} 义务`, { label, factRefs: classificationBasis.riskFactRefs[label] }, rule.roles, rule.verification);
    }
  }

  // Same decision basis must produce one obligation even when several labels
  // request the same control; merge roles and verification kinds by identity.
  const merged = new Map<string, ClassificationObligation>();
  for (const obligation of output.values()) {
    const key = `${obligation.kind}:${obligation.source}:${obligation.basisHash}`;
    const prior = merged.get(key);
    if (!prior) merged.set(key, obligation);
    else merged.set(key, {
      ...prior,
      roles: [...new Set([...(prior.roles ?? []), ...(obligation.roles ?? [])])].sort(),
      verificationKinds: [...new Set([...(prior.verificationKinds ?? []), ...(obligation.verificationKinds ?? [])])].sort(),
    });
  }
  // A route obligation and a risk overlay may ask for the same control. They
  // are different reasons, but must still be one user-facing obligation (and
  // therefore one approval/review gate). Consolidate by kind after retaining
  // all reasons, roles, and verification requirements.
  const consolidated = new Map<ClassificationObligation["kind"], ClassificationObligation>();
  for (const obligation of merged.values()) {
    const prior = consolidated.get(obligation.kind);
    if (!prior) {
      consolidated.set(obligation.kind, obligation);
      continue;
    }
    const basisHash = decisionBasisHash({
      kind: obligation.kind,
      bases: [prior.basisHash, obligation.basisHash].sort(),
    });
    consolidated.set(obligation.kind, {
      ...prior,
      id: `${obligation.kind}:${basisHash.slice(0, 16)}`,
      basisHash,
      reason: `${prior.reason}；${obligation.reason}`,
      roles: [...new Set([...(prior.roles ?? []), ...(obligation.roles ?? [])])].sort(),
      verificationKinds: [...new Set([...(prior.verificationKinds ?? []), ...(obligation.verificationKinds ?? [])])].sort(),
    });
  }
  return [...consolidated.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Return a new obligation list with the completed kinds marked satisfied. */
export function satisfyObligations(
  obligations: ClassificationObligation[] | undefined,
  kinds: ClassificationObligation["kind"][],
): ClassificationObligation[] | undefined {
  if (!obligations) return undefined;
  const completed = new Set(kinds);
  return obligations.map((obligation) => completed.has(obligation.kind) && obligation.status === "pending"
    ? { ...obligation, status: "satisfied" }
    : obligation);
}

/** Re-open obligations whose evidence basis changed without deleting history. */
export function reopenObligations(
  obligations: ClassificationObligation[] | undefined,
  kinds: ClassificationObligation["kind"][],
): ClassificationObligation[] | undefined {
  if (!obligations) return undefined;
  const selected = new Set(kinds);
  return obligations.map((obligation) => selected.has(obligation.kind) && obligation.status !== "pending"
    ? { ...obligation, status: "pending" }
    : obligation);
}
