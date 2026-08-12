import { createHash } from "node:crypto";
import type { TraceDelta, TraceNode, TraceabilityLedger } from "../policy/traceability.js";
import { routeDefinitionForFeature, traceEnforcementRequired } from "../policy/contract.js";
import { reopenImplementationUnit } from "../policy/rollback.js";
import { DevFlowError } from "./errors.js";
import { readArtifactText } from "./artifacts.js";
import { compilePlan } from "./plan-compiler.js";
import { parseTraceSourceBlocks } from "./traceability-anchors.js";
import { readProjectConfigSnapshot, readTraceabilityForArtifactReplacement } from "./traceability-store.js";
import { verificationCommandHashes } from "./project-config.js";
import { currentOpenStep } from "./step-order.js";
import { createInteraction, getInteraction, toPublicInteraction, type PublicInteraction, type UserInteraction } from "./user-interactions.js";
import { resolveInteractionDecision } from "./decision-workflow.js";
import { matchDecisionReply, pendingDecisionForState } from "./decision-interactions.js";
import { mutate, readState, type FeatureState } from "./state-store.js";
import { prepareReviewInvalidation } from "./review-store.js";

export interface PlanRevisionResult {
  state: FeatureState;
  interaction: PublicInteraction;
  interactionId: string;
}

/**
 * 实施中计划修订（ADR-0013 / issue 17）。
 *
 * 先暂停当前步骤并展示影响集：受影响的实现单元、将重做的已完成单元、
 * 有副作用风险的单元与失效的审查。用户确认后在同一 CAS mutation 中重
 * 登记计划并传播失效；未受影响且依据仍当前的 checkpoint 与单元保留。
 * 取消不改变计划、当前步骤或已完成工作。
 */
export async function revisePlanDuringImplementation(
  root: string,
  id: string,
  expectedRevision: number,
  traceDelta: TraceDelta,
  host: "claude" | "codex",
): Promise<PlanRevisionResult> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  if (initial.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can revise plans");
  if (!traceEnforcementRequired(initial.route, initial.classification.controls)) {
    throw new DevFlowError("TRACE_NOT_ENFORCED", "计划修订需要启用 Trace 的路线", { route: initial.route });
  }
  const currentStep = currentOpenStep(initial);
  if (currentStep !== "implementation" && currentStep !== "planning") {
    throw new DevFlowError("STEP_OUT_OF_ORDER", "计划修订只适用于 planning/implementation 阶段", { currentStep });
  }
  const artifact = initial.artifacts["implementation-plan"];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", "implementation-plan");
  const contents = await readArtifactText(root, id, artifact.path);
  const artifactSha256 = createHash("sha256").update(contents).digest("hex");
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
  const currentLedger = await readTraceabilityForArtifactReplacement(root, initial, "implementation-plan");
  // 预检：新计划必须先通过编译；失败直接返回诊断，不创建交互。
  const compile = compilePlan({
    route: initial.route,
    artifactKind: "implementation-plan",
    artifactSha256,
    sourceBlocks: parseTraceSourceBlocks(contents),
    currentLedger,
    traceDelta,
    projectConfigSha256,
    verificationCommandIds: config.verification.commands.map((command) => command.id),
    verificationCommandHashes: verificationCommandHashes(config),
    nextStateRevision: expectedRevision + 1,
    riskLabels: initial.classification.riskLabels,
  });
  if (!compile.ok) {
    throw new DevFlowError("PLAN_INVALID", "修订后的实施计划编译未通过。", {
      diagnostics: compile.diagnostics,
      recoveryHint: "按诊断修正计划内容后重新发起修订。",
      retryOriginal: true,
    });
  }
  const newLedger = compile.ledger!;
  const impact = computePlanRevisionImpact(currentLedger, newLedger);
  const affectedIds = new Set(impact.affectedIds);
  const { fallbackReason } = impact;
  // 有副作用风险的单元：以**修订前**图中 recovery 节点关联的单元判定
  // （spec §179）。修订删除某单元的 recovery 安排不改变其副作用属性——
  // 该单元仍可能包含删除/迁移/发布等操作，绝不自动重跑。stepRef 允许
  // UNIT 或 TASK 两种引用（traceability 校验与 plan-compiler 覆盖检查一致），
  // TASK 级引用按单元任务归属展开，避免漏保护。
  const recoveryNodes = Object.values(currentLedger.nodes)
    .filter((node): node is Extract<typeof node, { kind: "recovery" }> => node.kind === "recovery" && node.status === "current");
  const recoveryStepRefs = new Set(recoveryNodes.map((node) => node.stepRef));
  // 单元状态不携带任务归属；任务列表取自修订前 Trace 图中的 implementation-unit 节点。
  const unitTasks = new Map(
    Object.values(currentLedger.nodes)
      .filter((node): node is Extract<TraceNode, { kind: "implementation-unit" }> => node.kind === "implementation-unit" && node.status === "current")
      .map((node) => [node.id, node.tasks] as const),
  );
  const units = initial.implementationUnits ?? [];
  const checkpointedAffected = units.filter((unit) => affectedIds.has(unit.unitId) && unit.status === "checkpointed").map((unit) => unit.unitId);
  const sideEffectUnits = checkpointedAffected.filter((unitId) => {
    const tasks = unitTasks.get(unitId) ?? [];
    return recoveryStepRefs.has(unitId)
      || recoveryNodes.some((recovery) => recovery.stepRef.startsWith("TASK-") && tasks.includes(recovery.stepRef as `TASK-${string}`));
  });
  const reviewInvalidated = Boolean(initial.review) || Boolean(fallbackReason);
  const target = `plan-revision:${createHash("sha256").update(JSON.stringify(traceDelta)).digest("hex").slice(0, 16)}`;
  let interaction: UserInteraction | undefined;
  const state = await mutate(root, id, expectedRevision, "plan-revision-presented", (draft) => {
    const activeUnit = (draft.implementationUnits ?? []).find((unit) => unit.status === "active");
    const impactLines = [
      `- 受影响的实现单元：${[...affectedIds].sort().join("、") || "无"}`,
      `- 将重做的已完成单元：${checkpointedAffected.join("、") || "无"}`,
      ...(sideEffectUnits.length ? [`- ⚠ 以下已完成单元可能包含有副作用的操作（删除/迁移/发布等），重新执行前必须确认当前状态安全：${sideEffectUnits.join("、")}`] : []),
      `- 计划审查：${reviewInvalidated ? "失效，需要重新审查" : "未启用"}`,
      ...(activeUnit ? [`- 当前步骤暂停：${activeUnit.unitId}（${activeUnit.status}）将回到待执行`] : []),
      ...(fallbackReason ? [`- ${fallbackReason}`] : []),
    ];
    interaction = createInteraction(draft, {
      kind: "plan-revision",
      target,
      basisHash: createHash("sha256").update(`${id}\n${JSON.stringify(traceDelta)}`).digest("hex"),
      question: `修订实施计划将产生以下影响：\n${impactLines.join("\n")}\n确认修订吗？`,
      options: [
        { id: "confirm", label: "确认修订" },
        { id: "cancel", label: "取消" },
      ],
      planRevision: {
        affectedUnits: [...affectedIds].sort(),
        redoUnits: checkpointedAffected,
        sideEffectUnits,
        reviewInvalidated,
        ...(fallbackReason ? { fallbackReason } : {}),
      },
      planRevisionBasis: {
        artifactSha256,
        projectConfigSha256,
        traceabilitySha256: initial.traceability?.sha256 ?? "none",
      },
    });
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({ presentationEventId: interaction?.presentationEventId }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", target);
  return { state, interaction: toPublicInteraction(interaction), interactionId: interaction.id };
}

/** 修订落账：重登记计划并传播失效；未受影响且依据仍当前的单元与 checkpoint 保留。 */
function applyPlanRevision(draft: FeatureState, interaction: UserInteraction, host: "claude" | "codex"): void {
  const revision = interaction.planRevision;
  if (!revision) throw new DevFlowError("INTERACTION_INVALID", "plan-revision interaction is missing its revision content", { interactionId: interaction.id });
  const units = draft.implementationUnits ?? [];
  const affected = new Set(revision.affectedUnits);
  const sideEffects = new Set(revision.sideEffectUnits);
  for (const unit of units) {
    if (!affected.has(unit.unitId)) continue;
    // 有外部副作用的已完成单元绝不自动重跑（spec §179）：保持 checkpointed，
    // 由 side-effect-rerun 交互让用户显式决定是否重跑。
    if (sideEffects.has(unit.unitId)) continue;
    // 受影响单元回到待执行：清除 begin/checkpoint 痕迹，重新 begin 时重做。
    if (unit.status === "active" || unit.status === "pending") continue;
    reopenImplementationUnit(unit);
  }
  draft.implementationUnits = units;
  // 审查失效：指针必须保留（routed 状态下 review 控制的路线要求合法指针），
  // 旧批次由 resolvePlanRevisionDecision 在落账前通过 prepareReviewInvalidation
  // 标记 stale；未创建过批次时指针原样保留，后续 createReviewBatch 重建。
  delete draft.steps.planning;
  delete draft.steps.implementation;
  delete draft.steps.code_review;
  draft.currentStage = "planning";
  draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
}

async function resolvePlanRevisionDecision(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  host: "claude" | "codex",
  input: { source: "elicitation"; action: string; comment?: string } | { source: "text"; userReply: string },
): Promise<PlanRevisionResult> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const pending = getInteraction(initial, interactionId);
  const pendingDecision = pendingDecisionForState(initial);
  const confirms = input.source === "elicitation"
    ? input.action === "confirm"
    : pendingDecision !== undefined && matchDecisionReply(pendingDecision, input.userReply).option.id === "confirm";
  if (confirms) {
    const basis = pending.planRevisionBasis;
    const artifact = initial.artifacts["implementation-plan"];
    if (!basis || !artifact) throw new DevFlowError("PLAN_REVISION_STALE", "计划修订预览缺少当前依据，请重新生成。", { retryOriginal: true });
    const contents = await readArtifactText(root, id, artifact.path);
    const currentArtifactSha256 = createHash("sha256").update(contents).digest("hex");
    const currentConfigSha256 = (await readProjectConfigSnapshot(root)).sha256;
    const currentTraceabilitySha256 = initial.traceability?.sha256 ?? "none";
    if (currentArtifactSha256 !== basis.artifactSha256 || currentConfigSha256 !== basis.projectConfigSha256 || currentTraceabilitySha256 !== basis.traceabilitySha256) {
      throw new DevFlowError("PLAN_REVISION_STALE", "计划、项目配置或 Trace 已在预览后变化，请重新生成影响预览。", {
        retryOriginal: true,
        changed: [
          ...(currentArtifactSha256 !== basis.artifactSha256 ? ["implementation-plan"] : []),
          ...(currentConfigSha256 !== basis.projectConfigSha256 ? ["project-config"] : []),
          ...(currentTraceabilitySha256 !== basis.traceabilitySha256 ? ["traceability"] : []),
        ],
      });
    }
  }
  // 确认修订：先按当前 basis 准备审查失效指针（标记旧批次 stale，快照内容
  // 寻址保留）；applyPlanRevision 保留指针，避免 review 控制的路线丢失
  // 必需指针而违反状态 schema。仅在确认路径准备，取消不写任何快照。
  const reviewInvalidation = confirms && initial.review
    ? await prepareReviewInvalidation(root, initial, expectedRevision + 1)
    : undefined;
  const { state } = await resolveInteractionDecision(root, id, expectedRevision, interactionId, host, input, {
    kind: "plan-revision",
    notPendingMessage: "当前没有待处理的计划修订。",
    confirmReply: "确认修订",
    declineReply: "取消",
    confirmOperation: "plan-revised",
    declineOperation: "plan-revision-cancelled",
    apply: (draft, live, response, promptEventId) => {
      applyPlanRevision(draft, live, host);
      if (reviewInvalidation) draft.review = reviewInvalidation;
      // spec §179：有外部副作用的已完成单元在计划修订后绝不自动重跑，
      // 保持 checkpointed 并标为需要人工决定的恢复项，由新交互展示具体风险。
      const sideEffects = live.planRevision?.sideEffectUnits ?? [];
      if (sideEffects.length) {
        createInteraction(draft, {
          kind: "side-effect-rerun",
          target: `side-effect-rerun:${[...sideEffects].sort().join(",")}`,
          basisHash: createHash("sha256").update(`${id}\n${[...sideEffects].sort().join("\n")}`).digest("hex"),
          question: `以下已完成实现单元包含有副作用的操作（删除/迁移/发布等），计划修订后不会自动重跑：${[...sideEffects].sort().join("、")}。确认重跑这些单元吗？重跑前请确认当前状态安全。`,
          options: [
            { id: "confirm", label: "确认重跑" },
            { id: "keep", label: "不重跑，保留原结果" },
          ],
          sideEffectRerun: { units: [...sideEffects].sort() },
        });
      }
    },
  });
  return { state, interaction: toPublicInteraction(getInteraction(state, interactionId)), interactionId };
}

export async function resolvePlanRevisionAnswer(root: string, id: string, expectedRevision: number, interactionId: string, userReply: string, host: "claude" | "codex"): Promise<PlanRevisionResult> {
  return resolvePlanRevisionDecision(root, id, expectedRevision, interactionId, host, { source: "text", userReply });
}

export async function resolvePlanRevisionElicitation(root: string, id: string, expectedRevision: number, interactionId: string, action: string, comment: string | undefined, host: "claude" | "codex"): Promise<PlanRevisionResult> {
  return resolvePlanRevisionDecision(root, id, expectedRevision, interactionId, host, { source: "elicitation", action, comment });
}

export interface SideEffectRerunResult {
  state: FeatureState;
  interaction: PublicInteraction;
  interactionId: string;
}

/**
 * 副作用单元重跑确认（spec §179）：计划修订后，有外部副作用的已完成单元
 * 保持 checkpointed 且不会自动重跑；用户确认重跑才回 pending 重新执行，
 * 拒绝则保留原结果。
 */
async function resolveSideEffectRerunDecision(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  host: "claude" | "codex",
  input: { source: "elicitation"; action: string; comment?: string } | { source: "text"; userReply: string },
): Promise<SideEffectRerunResult> {
  const { state } = await resolveInteractionDecision(root, id, expectedRevision, interactionId, host, input, {
    kind: "side-effect-rerun",
    notPendingMessage: "当前没有待处理的副作用单元确认。",
    confirmReply: "确认重跑",
    declineReply: "不重跑，保留原结果",
    confirmOperation: "side-effect-rerun-confirmed",
    declineOperation: "side-effect-rerun-kept",
    apply: (draft, live, response, promptEventId) => {
      // 用户确认重跑：受影响副作用单元回 pending，重新 begin 时重做。
      const units = draft.implementationUnits ?? [];
      let reopened = false;
      for (const unit of units) {
        if (!live.sideEffectRerun?.units.includes(unit.unitId)) continue;
        if (unit.status !== "checkpointed") continue;
        reopenImplementationUnit(unit);
        reopened = true;
      }
      if (reopened) {
        delete draft.steps.implementation;
        draft.logicComplete = false;
        delete draft.steps.finalize;
        const definition = routeDefinitionForFeature(draft.route, draft.classification.controls);
        draft.currentStage = definition.orderedSteps.find((step) => draft.steps[step]?.status !== "satisfied")
          ?? definition.orderedSteps[0];
      }
    },
  });
  return { state, interaction: toPublicInteraction(getInteraction(state, interactionId)), interactionId };
}

export async function resolveSideEffectRerunAnswer(root: string, id: string, expectedRevision: number, interactionId: string, userReply: string, host: "claude" | "codex"): Promise<SideEffectRerunResult> {
  return resolveSideEffectRerunDecision(root, id, expectedRevision, interactionId, host, { source: "text", userReply });
}

export async function resolveSideEffectRerunElicitation(root: string, id: string, expectedRevision: number, interactionId: string, action: string, comment: string | undefined, host: "claude" | "codex"): Promise<SideEffectRerunResult> {
  return resolveSideEffectRerunDecision(root, id, expectedRevision, interactionId, host, { source: "elicitation", action, comment });
}

export interface PlanRevisionImpact {
  affectedIds: string[];
  fallbackReason?: string;
}

function semanticKey(node: TraceNode): string {
  switch (node.kind) {
    case "requirement": return JSON.stringify({ kind: node.kind, id: node.id });
    case "acceptance-criterion": return JSON.stringify({ kind: node.kind, id: node.id, parentRequirement: node.parentRequirement, verificationDisposition: node.verificationDisposition });
    case "task": return JSON.stringify({ kind: node.kind, id: node.id, covers: [...node.covers].sort(), implementationUnit: node.implementationUnit, tdd: node.tdd });
    case "test": return JSON.stringify({ kind: node.kind, id: node.id, verifies: [...node.verifies].sort() });
    case "rollback": return JSON.stringify({ kind: node.kind, id: node.id, tasks: [...node.tasks].sort(), dependsOn: [...node.dependsOn].sort(), fileScope: [...node.fileScope].sort(), covers: [...node.covers].sort(), forwardVerification: node.forwardVerification, rollbackVerification: node.rollbackVerification });
    case "implementation-unit": return JSON.stringify({ kind: node.kind, id: node.id, tasks: [...node.tasks].sort(), dependsOn: [...node.dependsOn].sort(), fileScope: [...node.fileScope].sort(), covers: [...node.covers].sort(), forwardVerification: node.forwardVerification });
    case "recovery": return JSON.stringify({ kind: node.kind, id: node.id, stepRef: node.stepRef, recoveryKind: node.recoveryKind, method: node.method, riskRef: node.riskRef });
  }
}

/**
 * 计划修订的影响集（ADR-0013 / issue 17）：按节点的领域语义比较旧图与新图。
 * 不能只比较任务/文件范围；验证处置、TEST.verifies、前向验证和 recovery 变更
 * 同样会改变后续证据。已映射种类：task/acceptance-criterion/test/recovery/
 * implementation-unit。
 *
 * 完整重审兜底（spec §180 / issue 17 验收 6）：未落入任何单元切片的节点种类
 * （requirement 增删改名、rollback 等）无法局部定位影响，此时全部实现单元重做、
 * 审查全部失效，并返回可诊断的 fallbackReason；绝不静默跳过未映射的语义变化。
 */
export function computePlanRevisionImpact(currentLedger: TraceabilityLedger, newLedger: TraceabilityLedger): PlanRevisionImpact {
  const oldUnits = Object.values(currentLedger.nodes).filter((node): node is Extract<TraceNode, { kind: "implementation-unit" }> => node.kind === "implementation-unit" && node.status === "current");
  const newUnits = Object.values(newLedger.nodes).filter((node): node is Extract<TraceNode, { kind: "implementation-unit" }> => node.kind === "implementation-unit" && node.status === "current");
  const oldCurrent = Object.values(currentLedger.nodes).filter((node) => node.status === "current");
  const newCurrent = Object.values(newLedger.nodes).filter((node) => node.status === "current");
  const oldById = new Map(oldCurrent.map((node) => [node.id, node]));
  const newById = new Map(newCurrent.map((node) => [node.id, node]));
  const changedNodeIds = new Set<TraceNode["id"]>();
  for (const node of oldCurrent) {
    const next = newById.get(node.id);
    if (!next || semanticKey(node) !== semanticKey(next)) changedNodeIds.add(node.id);
  }
  for (const node of newCurrent) if (!oldById.has(node.id)) changedNodeIds.add(node.id);
  const newByKey = new Map(newUnits.map((node) => [node.id, node]));
  const affectedIds = new Set<string>();
  for (const node of oldUnits) {
    const next = newByKey.get(node.id);
    if (!next || changedNodeIds.has(node.id)) affectedIds.add(node.id);
  }
  for (const node of newUnits) {
    if (!oldUnits.some((old) => old.id === node.id) || changedNodeIds.has(node.id)) affectedIds.add(node.id);
  }
  // 将 AC、任务、测试和恢复安排的语义变化投影到受影响实现单元。
  for (const unit of [...oldUnits, ...newUnits]) {
    const touches = [...changedNodeIds].some((id) => {
      const node = newById.get(id) ?? oldById.get(id);
      if (!node) return false;
      if (node.kind === "task") return unit.tasks.includes(node.id);
      if (node.kind === "acceptance-criterion" || node.kind === "test") {
        const criteria = node.kind === "test" ? node.verifies : [node.id];
        return criteria.some((criterion) => unit.covers.includes(criterion));
      }
      if (node.kind === "recovery") return node.stepRef === unit.id || unit.tasks.some((taskId) => taskId === node.stepRef);
      return false;
    });
    if (touches) affectedIds.add(unit.id);
  }
  const unmappedChanged = [...changedNodeIds].filter((id) => {
    const node = newById.get(id) ?? oldById.get(id);
    return node
      && node.kind !== "task" && node.kind !== "acceptance-criterion"
      && node.kind !== "test" && node.kind !== "recovery"
      && node.kind !== "implementation-unit";
  });
  const fallbackReason = unmappedChanged.length
    ? `无法局部定位变化影响：变化的节点种类不在实现单元切片内（${[...new Set(unmappedChanged.map((id) => (newById.get(id) ?? oldById.get(id))!.kind))].sort().join("、")}：${[...unmappedChanged].sort().join("、")}）。按完整重审处理：全部实现单元重新执行，计划审查全部失效。`
    : undefined;
  if (fallbackReason) {
    for (const unit of oldUnits) affectedIds.add(unit.id);
    for (const unit of newUnits) affectedIds.add(unit.id);
  }
  return { affectedIds: [...affectedIds].sort(), fallbackReason };
}
