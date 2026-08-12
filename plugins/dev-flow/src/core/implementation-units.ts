import { createHash, randomUUID } from "node:crypto";
import { checkpointsEnforcementRequired, reviewEnforcementRequired, traceEnforcementRequired } from "../policy/contract.js";
import { canonicalReviewValueJson } from "./review-store.js";
import type { ImplementationUnitNode, TraceabilityLedger } from "../policy/traceability.js";
import { implementationUnitForNode, reopenImplementationUnit, type ImplementationUnitState } from "../policy/rollback.js";
import { DevFlowError } from "./errors.js";
import { assertArtifactCurrent } from "./artifacts.js";
import { captureUnitBaseline } from "./checkpoints.js";
import { fingerprintGovernedRoots, snapshotGovernedRoots } from "./fingerprint.js";
import { assertReviewComplete } from "./review-jobs.js";
import { assertHostHealth } from "./host-health.js";
import { assertWorkspaceOwnershipComplete, mutate, readProjectConfig, type FeatureState } from "./state-store.js";
import { currentOpenStep } from "./step-order.js";
import { assertTraceGateCurrent } from "./traceability-gates.js";
import { confirmedApproval } from "./approval-basis.js";
import { readTraceability } from "./traceability-store.js";
import { parsePlanBlocks } from "./plan-graph.js";
import type { UserInteraction } from "./user-interactions.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export interface ImplementationUnitWriteBlock {
  code: "IMPLEMENTATION_UNIT_REQUIRED" | "IMPLEMENTATION_UNIT_OUT_OF_SCOPE";
  details: Record<string, unknown>;
}

/**
 * Cancel an active implementation unit without touching the workspace.
 *
 * The unit returns to `pending` so it can be re-begun after the trace basis is
 * repaired (e.g. re-registering the plan after a verification config change).
 * Workspace edits made during the cancelled incarnation stay on disk and are
 * absorbed by the re-begun unit's baseline; the cancellation is recorded as an
 * audit event with a required reason.
 */
export async function abandonImplementationUnit(
  root: string,
  id: string,
  expectedRevision: number,
  unitId: string,
  reason: string,
  host: "claude" | "codex",
): Promise<FeatureState> {
  const reasonText = reason.trim();
  if (!reasonText) {
    throw new DevFlowError("IMPLEMENTATION_UNIT_CANCEL_REASON_REQUIRED", "cancelling an implementation unit requires a reason", {
      recoveryHint: "说明为什么取消该单元（例如验证配置变更后需要重登记计划）",
    });
  }
  return mutate(root, id, expectedRevision, "implementation-unit-cancelled", async (state) => {
    await assertHostHealth(root, state.lastUpdatedBy.host, "implementation unit");
    const unit = (state.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
    if (!unit) throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "implementation unit has no runtime state", { unitId });
    if (unit.status !== "active") {
      throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_ACTIVE", "only an active implementation unit can be cancelled", { unitId, status: unit.status });
    }
    // Pending units never carry a begin-time fingerprint or nonce (see
    // validateImplementationUnits); begin re-mints both for the new incarnation.
    reopenImplementationUnit(unit);
  }, { unitId, reason: reasonText, host });
}

function currentImplementationNodes(ledger: TraceabilityLedger | undefined): ImplementationUnitNode[] {
  return Object.values(ledger?.nodes ?? {}).filter((node): node is ImplementationUnitNode => node.kind === "implementation-unit" && node.status === "current");
}

/** 非 trace 普通路线的实现单元定义：直接从实施计划文档的任务图解析（无回撤语义）。 */
function planImplementationUnitDefs(planMarkdown: string): Array<{ id: `UNIT-${string}`; tasks: string[]; dependsOn: string[] }> {
  const blocks = parsePlanBlocks(planMarkdown);
  const defs: Array<{ id: `UNIT-${string}`; tasks: string[]; dependsOn: string[] }> = [];
  for (const [id, block] of blocks) {
    if (block.kind !== "implementation-unit" || !/^UNIT-[0-9]{3,}$/.test(id)) continue;
    const fields: Record<string, string[]> = {};
    for (const line of block.text.split("\n")) {
      const match = /^-\s+([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      const raw = match[2].trim();
      fields[match[1]] = raw.startsWith("[") && raw.endsWith("]")
        ? (raw.slice(1, -1).trim() ? raw.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean) : [])
        : raw ? [raw] : [];
    }
    defs.push({ id: id as `UNIT-${string}`, tasks: fields["tasks"] ?? [], dependsOn: fields["depends_on"] ?? [] });
  }
  return defs.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Prepare the first unit lazily for a protected implementation write. Host
 * hooks call this immediately before classifying a write, so a normal write
 * after the one execution approval does not fail merely because the model did
 * not issue the internal begin action first. The unit remains Core-owned and
 * dependencies are still enforced by beginImplementationUnit.
 */
export async function ensureActiveImplementationUnit(
  root: string,
  id: string,
  state: FeatureState,
): Promise<FeatureState> {
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls)
    || currentOpenStep(state) !== "implementation"
    || !confirmedApproval(state)
    || (state.implementationUnits ?? []).some((unit) => unit.status === "active")) return state;
  const ledger = await readTraceability(root, state);
  const nodes = currentImplementationNodes(ledger).sort((a, b) => a.id.localeCompare(b.id));
  const statusByUnit = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit.status]));
  const ready = nodes.find((node) =>
    statusByUnit.get(node.id) !== "checkpointed"
    && node.dependsOn.every((dependency) => statusByUnit.get(dependency) === "checkpointed"));
  if (!ready) return state;
  return beginImplementationUnit(root, id, state.revision, ready.id);
}

/**
 * Core basis for a unit lifecycle: the current trace pointer plus the
 * approval gate context, canonicalized. Callers never supply or choose it.
 */
export function implementationUnitBasisHash(state: FeatureState): string {
  return digest(canonicalReviewValueJson({
    traceability: state.traceability,
    approval: confirmedApproval(state)?.record ?? null,
  }));
}

/**
 * Pure write judgment shared by the Hook adapters and any direct Core caller.
 * Returns undefined when the write may proceed; a structured block otherwise.
 */
export function implementationUnitWriteBlock(
  state: FeatureState,
  ledger: TraceabilityLedger | undefined,
  _relativePath: string,
): ImplementationUnitWriteBlock | undefined {
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls)) return undefined;
  if (currentOpenStep(state) !== "implementation") return undefined;
  if (!confirmedApproval(state)) return undefined;
  const active = (state.implementationUnits ?? []).find((unit) => unit.status === "active");
  if (!active) {
    return {
      code: "IMPLEMENTATION_UNIT_REQUIRED",
      details: { recoveryHint: "写入 governed 文件前，先通过 dev_flow_begin_implementation_unit 开始下一个 implementation unit" },
    };
  }
  const node = currentImplementationNodes(ledger).find((candidate) => candidate.id === active.unitId);
  if (!node) {
    // Fail closed: an active unit without a current rollback definition can never legitimize a write.
    return {
      code: "IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
      details: { unitId: active.unitId, fileScope: [], path: _relativePath },
    };
  }
  // fileScope is anticipated scope, not a write-time allowlist. The actual
  // changed paths are audited at checkpoint time so ordinary equivalent
  // writes do not fail because a plan omitted a supplemental file.
  return undefined;
}

/**
 * Begin the next implementation unit during the implementation step. Lazily derives
 * the pending unit set from the current trace ledger; at a quiescent point
 * (no active unit) pending units merge with the ledger, so a re-registered
 * plan yields a fresh basis while checkpointed units keep their history.
 */
export async function beginImplementationUnit(
  root: string,
  id: string,
  expectedRevision: number,
  unitId: string,
): Promise<FeatureState> {
  return mutate(root, id, expectedRevision, "implementation-unit-begun", async (state) => {
    await assertHostHealth(root, state.lastUpdatedBy.host, "implementation unit");
    await assertWorkspaceOwnershipComplete(root, state, await readProjectConfig(root), "implementation unit");
    if (!checkpointsEnforcementRequired(state.route, state.classification.controls)
      && state.classification.controls.plan !== "formal") {
      throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "当前动态路线未启用 unit-chain checkpoint 控制。");
    }
    if (currentOpenStep(state) !== "implementation") {
      throw new DevFlowError("STEP_OUT_OF_ORDER", "begin requires the implementation step", { expected: currentOpenStep(state) });
    }
    const approvalObligation = (state.obligations ?? []).find((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied");
    if (approvalObligation && !confirmedApproval(state)) {
      throw new DevFlowError("DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED", "implementation approval must be confirmed before beginning a unit");
    }
    // spec §179：计划修订后，有外部副作用的已完成单元保持 checkpointed，
    // 必须先经用户确认重跑（side-effect-rerun 交互）才能重新 begin。
    const pendingSideEffect = Object.values(state.interactions ?? {}).find((value) => {
      const candidate = value as UserInteraction;
      return candidate.kind === "side-effect-rerun"
        && candidate.status === "pending"
        && candidate.sideEffectRerun?.units.includes(unitId);
    }) as UserInteraction | undefined;
    if (pendingSideEffect) {
      throw new DevFlowError("SIDE_EFFECT_UNIT_PENDING_CONFIRMATION", "该实现单元包含有副作用的操作，计划修订后需用户确认才能重跑。", {
        unitId,
        recoveryHint: "回答当前待决问题（确认重跑该单元，或不重跑保留原结果）后再重试 begin。",
      });
    }
    const traceEnforced = traceEnforcementRequired(state.route, state.classification.controls);
    let nodes: Array<{ id: string; tasks: string[]; dependsOn: string[]; fileScope?: string[]; forwardVerification?: unknown[] }>;
    if (traceEnforced) {
      const ledger = await assertTraceGateCurrent(root, state, "implementation");
      // "Basis current" also means every registered trace artifact still matches
      // its recorded SHA-256; the ledger alone only tracks semantic staleness.
      // Coverage and rollback projections are derived from the implementation
      // plan trace delta; only editable source artifacts need an integrity check.
      for (const kind of ["requirements", "implementation-plan"]) {
        await assertArtifactCurrent(root, id, state, kind);
      }
      if (reviewEnforcementRequired(state.route, state.classification.controls)) {
        await assertReviewComplete(root, state);
      }
      nodes = currentImplementationNodes(ledger);
    } else {
      // 普通路线（formal 计划、无 trace）：实现单元直接来自实施计划文档的
      // 任务图声明（工作范围 + 依赖），不携带回撤语义。
      const plan = state.artifacts["implementation-plan"];
      if (!plan) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", "implementation-plan");
      const contents = await assertArtifactCurrent(root, id, state, "implementation-plan");
      nodes = planImplementationUnitDefs(contents);
    }
    const node = nodes.find((candidate) => candidate.id === unitId);
    if (!node) {
      throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "implementation unit is not part of the current execution graph", { unitId });
    }
    if ((state.implementationUnits ?? []).some((unit) => unit.status === "active")) {
      const active = state.implementationUnits!.find((unit) => unit.status === "active")!;
      throw new DevFlowError("IMPLEMENTATION_UNIT_ALREADY_ACTIVE", "another implementation unit is already active", { activeUnitId: active.unitId });
    }
    const basisHash = implementationUnitBasisHash(state);
    const byId = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit]));
    const merged: ImplementationUnitState[] = [];
    for (const candidate of nodes) {
      const unitIdValue = candidate.id as `UNIT-${string}`;
      const existing = byId.get(unitIdValue);
      if (existing && existing.status !== "pending") {
        merged.push(existing);
      } else {
        merged.push({
          unitId: unitIdValue,
          status: "pending",
          basisHash,
          ...(candidate.tasks.length ? { tasks: [...candidate.tasks] } : {}),
          ...(candidate.dependsOn.length ? { dependsOn: [...candidate.dependsOn] } : {}),
        });
      }
    }
    for (const dependency of node.dependsOn) {
      const unit = merged.find((candidate) => candidate.unitId === dependency);
      if (unit?.status !== "checkpointed") {
        throw new DevFlowError("IMPLEMENTATION_UNIT_DEPENDENCY_INCOMPLETE", "implementation unit dependencies must be checkpointed first", {
          unitId,
          dependency,
          status: unit?.status ?? "unknown",
        });
      }
    }
    const target = merged.find((unit) => unit.unitId === unitId)!;
    if (target.status !== "pending" && target.status !== "rolled_back") {
      throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_PENDING", "implementation unit cannot begin from its current status", { unitId, status: target.status });
    }
    const project = await readProjectConfig(root);
    // Preserve begin-time bytes: rollback needs them long after the unit's edits.
    const snapshot = await snapshotGovernedRoots(root, project);
    await captureUnitBaseline(root, id, unitId, snapshot);
    // A rolled_back unit re-begins as a new incarnation: the historical
    // checkpoint reference and nonce are dropped so its old manifest can never
    // be mistaken for this attempt's orphaned manifest.
    delete target.checkpointId;
    target.basisHash = basisHash;
    target.beginNonce = randomUUID();
    target.status = "active";
    target.startedFingerprint = await fingerprintGovernedRoots(root, project);
    state.implementationUnits = merged;
  }, { unitId });
}
