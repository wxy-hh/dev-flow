import { routeDefinition } from "./contract.js";
import type { DeriveState, NextAction } from "./types.js";

export function deriveNext(state: DeriveState): NextAction {
  if (Number(state.schemaVersion) !== 4 && Number(state.schemaVersion) !== 5) throw new Error("UNSUPPORTED_STATE_SCHEMA");
  if (state.lifecycle === "finalized") return { kind: "done" };
  if (state.repair?.status === "waiting-user" || state.repair?.status === "stalled") {
    return {
      kind: "waiting-user",
      reason: state.repair.recoveryAction?.reason ?? "自动修复需要用户决策",
      recoveryAction: state.repair.recoveryAction ?? { kind: "ask-user", reason: "自动修复已暂停", facts: [], impact: "当前单元未完成", recommendation: "请确认修订、回滚或调整计划" },
    };
  }
  if (state.classificationViolatesTopology) return { kind: "stop", reason: "reclassification-required" };
  if (state.blockingFindings?.some((finding) => finding.blocking)) return { kind: "stop", reason: "resolve-blocking-findings" };

  const definition = routeDefinition(state.route);
  const orderedSteps = state.orderedSteps ?? definition.orderedSteps;
  // Approval is a dynamic obligation, never a fixed route stage. Present it
  // only when all route work before implementation is complete; this keeps
  // artifact scaffolding and plan review ahead of the user decision.
  const approval = state.obligations?.find((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied");
  const implementationIndex = orderedSteps.indexOf("implementation");
  const implementationReady = implementationIndex >= 0
    && orderedSteps.slice(0, implementationIndex).every((step) => state.steps[step]?.status === "satisfied");
  if (approval && implementationReady) {
    return { kind: "present-human-gate", step: approval.id };
  }

  for (const step of orderedSteps) {
    const snapshot = state.steps[step];
    if (snapshot?.status === "satisfied") continue;
    if (snapshot && snapshot.artifactReady === false) return { kind: "scaffold-artifact", step };
    return { kind: "run-step", step };
  }

  if (!state.logicComplete) return { kind: "finalize" };
  return { kind: "done" };
}
