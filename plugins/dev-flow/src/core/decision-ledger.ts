import { createHash } from "node:crypto";
import type { DecisionRecord } from "../policy/types.js";
import { DevFlowError } from "./errors.js";

function idFor(question: string, refs: string[] = []): string {
  return `DEC-${createHash("sha256").update(`${question}\n${[...refs].sort().join("\n")}`).digest("hex").slice(0, 16)}`;
}

export function createDecision(question: string, factRefs: string[] = []): DecisionRecord {
  if (!question.trim()) throw new DevFlowError("DECISION_QUESTION_REQUIRED", "decision question cannot be empty");
  return { id: idFor(question, factRefs), question: question.trim(), status: "open", ...(factRefs.length ? { factRefs: [...new Set(factRefs)].sort() } : {}) };
}

export function resolveDecision(decision: DecisionRecord, evidence: string, conclusion: string): DecisionRecord {
  if (decision.status !== "open") throw new DevFlowError("DECISION_NOT_OPEN", "only open decisions can be resolved");
  if (!evidence.trim() || !conclusion.trim()) throw new DevFlowError("DECISION_EVIDENCE_REQUIRED", "resolved decisions require evidence and a conclusion");
  return { ...decision, status: "resolved", evidence: evidence.trim(), conclusion: conclusion.trim() };
}

export function mergeDecision(decision: DecisionRecord, into: DecisionRecord): DecisionRecord {
  if (decision.status !== "open") throw new DevFlowError("DECISION_NOT_OPEN", "only open decisions can be merged");
  if (into.status !== "open") throw new DevFlowError("DECISION_MERGE_TARGET_INVALID", "decision merge target must remain open");
  return { ...decision, status: "merged", mergedInto: into.id };
}

export function dismissDecision(decision: DecisionRecord, reason: string, affectsClassification: boolean): DecisionRecord {
  if (affectsClassification) throw new DevFlowError("DECISION_DISMISS_FORBIDDEN", "a classification-affecting decision cannot be dismissed without user evidence");
  if (!reason.trim()) throw new DevFlowError("DECISION_DISMISS_REASON_REQUIRED", "dismissed decisions require a reason");
  return { ...decision, status: "dismissed", dismissedReason: reason.trim() };
}

export function hasOpenImpactingDecision(decisions: DecisionRecord[], impactingIds: string[]): boolean {
  const ids = new Set(impactingIds);
  return decisions.some((decision) => decision.status === "open" && ids.has(decision.id));
}

