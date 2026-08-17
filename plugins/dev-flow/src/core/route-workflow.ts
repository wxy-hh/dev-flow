import { createHash, randomUUID } from "node:crypto";
import { normalizeWorkflowCapabilities, reviewLedgerRequired, routeDefinitionForFeature, traceEnforcementRequired } from "../policy/contract.js";
import { assertBoundaryAuditComplete, selectBaseRoute, selectRoute, validateBasis, type BoundaryResolutionIndex } from "../policy/route.js";
import { SUPPORTED_WORKFLOW_CAPABILITIES, type Classification, type ClassificationFacts, type ClassificationInput } from "../policy/types.js";
import { DevFlowError } from "./errors.js";
import { assertRepositoryFactCurrent } from "./repository-facts.js";
import { fingerprintGovernedRoots } from "./fingerprint.js";
import { missingVerificationGuarantees } from "./project-config.js";
import { emptyTraceabilityLedger } from "./traceability.js";
import { readProjectConfigSnapshot, writeTraceSnapshot } from "./traceability-store.js";
import { emptyReviewLedger, prepareReviewInvalidation, writeReviewSnapshot } from "./review-store.js";
import { deriveCurrency } from "./basis-state.js";
import { createInteraction, resolveResponseForAnswer } from "./user-interactions.js";
import { matchDecisionReply, pendingDecisionForState } from "./decision-interactions.js";
import { mutatePrepared, readFeatureEvents, readProjectConfig, readState, type FeatureState, type PreparedFeatureMutation } from "./state-store.js";
import type { AnswerResolveContext, AnswerResolveResult } from "./interaction-answer.js";

export async function lockClassification(
  root: string,
  id: string,
  expectedRevision: number,
  facts: ClassificationFacts,
  boundaryAudit: unknown,
): Promise<FeatureState> {
  // 入口先走合同校验：旧形状（v4 scopeFacts 等）或畸形输入必须得到可操作的
  // CLASSIFICATION_BASIS_INVALID，而不是下方展开 undefined 产生的裸 TypeError
  // （经 MCP 边界会退化为 INTERNAL_ERROR）。第二个参数传空：形状校验不依赖
  // riskLabels，按标签的 RISK_BASIS_REQUIRED 检查保留给 selectBaseRoute，
  // 以免改变 INVALID_RISK_LABEL 等既有错误的优先级。
  validateBasis(facts, []);
  const initial = await readState(root, id);
  const repositoryFacts = initial.governance?.repositoryFacts ?? [];
  const items = (boundaryAudit as { items?: Array<{ disposition?: unknown; factRef?: unknown }> }).items ?? [];
  const auditFactRefs = items
    .filter((item) => item.disposition === "repository-fact" && typeof item.factRef === "string")
    .map((item) => item.factRef as string);
  const basisFactRefs = [
    ...facts.scopeFactRefs,
    ...facts.topologyFactRefs,
    ...facts.uncertaintyFactRefs,
    ...Object.values(facts.riskFactRefs).flatMap((refs) => refs ?? []),
  ];
  const factRefs = [...new Set([...auditFactRefs, ...basisFactRefs])];
  const registeredIds = [
    ...repositoryFacts.map((record) => record.recordId),
    ...(initial.governance?.decisions ?? []).map((record) => record.recordId),
  ];
  const unresolvedFactRefs = factRefs.filter((ref) => !repositoryFacts.some((record) => record.recordId === ref));
  if (unresolvedFactRefs.length) {
    throw new DevFlowError("BOUNDARY_AUDIT_UNRESOLVED", "classification references a repository fact that is not in the governance ledger", {
      factRef: unresolvedFactRefs[0],
      unresolvedRefs: unresolvedFactRefs,
      registeredIds,
    });
  }
  for (const ref of factRefs) {
    const fact = repositoryFacts.find((record) => record.recordId === ref)!;
    await assertRepositoryFactCurrent(root, fact);
  }
  const configForBasis = await readProjectConfig(root);
  const currentFingerprint = await fingerprintGovernedRoots(root, configForBasis);
  const eventIds = new Set((await readFeatureEvents(root, id)).map((event) => String((event.data as { eventId?: unknown } | undefined)?.eventId ?? "")));
  const decisionRecords = (initial.governance?.decisions ?? []).map((decision) => ({
    recordId: decision.recordId,
    supersededBy: decision.supersededBy,
    currency: deriveCurrency(decision, { contentFingerprint: currentFingerprint, eventIds }),
  }));
  const factRecords = repositoryFacts.map((fact) => ({ recordId: fact.recordId, currency: factRefs.includes(fact.recordId) ? "current" as const : "unconfirmed" as const }));
  const auditMissingFromBasis = auditFactRefs.filter((auditRef) => !basisFactRefs.includes(auditRef));
  if (auditMissingFromBasis.length) {
    const basisFields = auditMissingFromBasis.map((factRef) => {
      const riskEntry = Object.entries(facts.riskFactRefs).find(([, refs]) => (refs ?? []).includes(factRef));
      const field = facts.scopeFactRefs.includes(factRef) ? "scopeFactRefs"
        : facts.topologyFactRefs.includes(factRef) ? "topologyFactRefs"
          : facts.uncertaintyFactRefs.includes(factRef) ? "uncertaintyFactRefs"
            : riskEntry ? `riskFactRefs.${riskEntry[0]}`
              : "classificationBasis 中的任一事实引用字段";
      return { factRef, field };
    });
    throw new DevFlowError("BOUNDARY_AUDIT_UNRESOLVED", "boundary audit fact must be included in classification basis", {
      factRef: auditMissingFromBasis[0],
      unresolvedRefs: auditMissingFromBasis,
      registeredIds,
      basisFields,
      recoveryHint: "把上述 factRef 加入 classificationBasis 对应字段后重新 classify（级别不变），再锁定分类。",
    });
  }
  const boundaryIndex: BoundaryResolutionIndex = { decisionRefs: [...facts.decisionRefs], decisions: decisionRecords, repositoryFacts: factRecords };
  assertBoundaryAuditComplete(boundaryAudit, boundaryIndex);
  const unresolvedDecisionRefs = facts.decisionRefs.filter((decisionRef) => !decisionRecords.some((record) => record.recordId === decisionRef));
  if (unresolvedDecisionRefs.length) {
    throw new DevFlowError("BOUNDARY_AUDIT_UNRESOLVED", "classification references a decision that is not in the governance ledger", {
      decisionRef: unresolvedDecisionRefs[0],
      unresolvedRefs: unresolvedDecisionRefs,
      registeredIds,
    });
  }
  for (const decisionRef of facts.decisionRefs) {
    const decision = decisionRecords.find((record) => record.recordId === decisionRef)!;
    if (decision.supersededBy) throw new DevFlowError("BOUNDARY_DECISION_SUPERSEDED", "classification references a superseded decision", { decisionRef, successorId: decision.supersededBy });
    if (decision.currency !== "current") throw new DevFlowError("BOUNDARY_DECISION_NOT_CURRENT", "classification references a decision whose basis is not current", { decisionRef, currency: decision.currency });
  }
  const selected = selectBaseRoute(facts);
  const current = await readState(root, id);
  if (current.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: current.revision });
  if (current.mode !== "intake") throw new DevFlowError("CLASSIFICATION_ALREADY_LOCKED", "classification is already locked");
  const pending = pendingDecisionForState(current);
  if (pending && pending.kind !== "workspace-ownership") {
    throw new DevFlowError("OPEN_CLASSIFICATION_DECISIONS", "classification-affecting decisions remain open", { recoveryHint: "先回答当前待决问题，再重试锁定路线。" });
  }
  const project = await readProjectConfig(root);
  const missingGuarantees = missingVerificationGuarantees(project, selected.classification.controls.verification);
  if (missingGuarantees.length) {
    throw new DevFlowError("VERIFICATION_GUARANTEE_UNCONFIGURED", "项目验证配置不能覆盖当前路线的最终保证集。", {
      missingGuarantees,
      route: selected.route,
      userMessage: "当前路线需要的验证保证尚未配置。",
      cause: `当前路线需要 ${missingGuarantees.join("、")} guarantee，但非 preflight 验证命令没有提供这些保证。`,
      impact: "路线不会锁定，也不会创建 Trace、review 或路线确认状态。",
      recoveryKind: "repair",
      recoveryInstruction: "通过项目配置更新入口补齐非 preflight 验证命令后重试路线锁定。",
      retryOriginal: true,
    });
  }
  if (selected.classification.routeConfirmationRequired) {
    let presentationEventId: string | undefined;
    return mutatePrepared(root, id, expectedRevision, "route-confirmation-presented", async () => ({ mutate: (draft) => {
      const basisHash = confirmationBasisHash(facts, selected);
      presentationEventId = randomUUID();
      draft.routeConfirmation = { facts, basisHash };
      createInteraction(draft, {
        kind: "route-confirmation",
        target: "route-confirmation",
        basisHash,
        question: `请确认 Dev Flow 路线：${selected.classification.orderedRoute.join(" → ")}`,
        options: [
          { id: "confirm", label: "确认这条路线" },
          { id: "correct", label: "修正分类事实", requiresComment: true },
        ],
        presentationEventId,
      });
    }, eventData: () => ({
      level: selected.classification.level,
      controls: selected.classification.controls,
      orderedRoute: selected.classification.orderedRoute,
      ...(presentationEventId ? { presentationEventId } : {}),
    }) }));
  }
  return mutatePrepared(root, id, expectedRevision, "classification-locked", applyLock({ root, facts, basisHash: confirmationBasisHash(facts, selected) }));
}

export async function assertRouteExecutable(root: string, selected: { classification: Classification }): Promise<void> {
  const project = await readProjectConfig(root);
  const missingGuarantees = missingVerificationGuarantees(project, selected.classification.controls.verification);
  if (missingGuarantees.length) {
    throw new DevFlowError("VERIFICATION_GUARANTEE_UNCONFIGURED", "当前路线需要的验证保证已缺失。", {
      missingGuarantees,
      userMessage: "当前路线需要的验证保证尚未配置；已确认的路线内容保持不变。",
      cause: `当前路线需要 ${missingGuarantees.join("、")} guarantee，但项目配置中的非 preflight 验证命令不再提供这些保证。`,
      impact: "路线不会锁定，也不会删除或重问仍然当前的路线决定。",
      recoveryKind: "repair",
      recoveryInstruction: "通过项目配置更新入口补齐非 preflight 验证命令后，重新确认这条路线。",
      retryOriginal: true,
    });
  }
}

/**
 * 确认依据只覆盖事实、可见路线与 controls（ADR-0015）；呈现、重呈现与
 * applyLock 重算共用同一公式，保证确认身份与锁定写入一致。
 */
function confirmationBasisHash(facts: ClassificationFacts, selected: ReturnType<typeof selectBaseRoute>): string {
  return createHash("sha256").update(JSON.stringify({
    facts,
    route: selected.classification.orderedRoute,
    controls: selected.classification.controls,
  })).digest("hex");
}

/**
 * 重分类转换的快照准备（保留已满足步骤、作废审查）：首次锁定不经过这里，
 * 直锁与路线确认都只走 applyLock。重分类（含已 routed 的重呈现确认）共用。
 */
async function prepareRouteTransitionPointers(
  root: string,
  featureId: string,
  selected: ReturnType<typeof selectBaseRoute>,
  current: Readonly<FeatureState>,
  nextRevision: number,
): Promise<{
  preparedTraceability?: NonNullable<FeatureState["traceability"]>;
  preparedReview?: NonNullable<FeatureState["review"]>;
  reviewInvalidation?: NonNullable<FeatureState["review"]>;
}> {
  const preparedTraceability = traceEnforcementRequired(selected.route, selected.classification.controls) && !current.traceability
    ? await writeTraceSnapshot(root, emptyTraceabilityLedger(featureId, nextRevision, (await readProjectConfigSnapshot(root)).sha256)) : undefined;
  const preparedReview = reviewLedgerRequired(selected.route, selected.classification.controls) && !current.review
    ? await writeReviewSnapshot(root, emptyReviewLedger(featureId, nextRevision)) : undefined;
  const reviewInvalidation = current.review && (selected.route !== current.route || JSON.stringify(selected.classification) !== JSON.stringify(current.classification))
    ? await prepareReviewInvalidation(root, current, nextRevision) : undefined;
  return { preparedTraceability, preparedReview, reviewInvalidation };
}

/**
 * 首次锁定的唯一写入 seam（ADR-0020）。
 *
 * 不自己开 CAS：返回调用方已有 mutatePrepared 的 prepare 身体，调用方决定
 * operation 并交给自己的那一笔事务。输入是已审计的分类事实与确认依据 hash；
 * 写入时再 select、再算 hash，对不上则依据过期。无门禁直锁与路线确认的
 * kind.apply 都只走这一处字段赋值。
 */
export function applyLock(
  input: { root: string; facts: ClassificationFacts; basisHash: string },
): (current: Readonly<FeatureState>, nextRevision: number) => Promise<PreparedFeatureMutation> {
  const { root, facts, basisHash } = input;
  return async (current, nextRevision) => {
    if (current.mode !== "intake") throw new DevFlowError("CLASSIFICATION_ALREADY_LOCKED", "classification is already locked");
    const selected = selectBaseRoute(facts);
    if (confirmationBasisHash(facts, selected) !== basisHash) {
      throw new DevFlowError("ROUTE_CONFIRMATION_STALE", "路线确认依据已变化。", {
        userMessage: "确认依据已变化，需要重新确认当前路线。",
        cause: "写入时从已审计事实重算的确认 hash 与呈现时的依据不一致。",
        impact: "路线不会锁定；确认身份保留，重新呈现后再确认。",
        recoveryKind: "refresh",
        recoveryInstruction: "重新呈现当前路线并确认。",
        retryOriginal: false,
      });
    }
    if (selected.classification.routeConfirmationRequired) {
      const pending = pendingDecisionForState(current);
      const gateMatches = pending?.kind === "route-confirmation"
        && pending.basisHash === basisHash
        && current.routeConfirmation?.basisHash === basisHash;
      if (!gateMatches) {
        throw new DevFlowError("ROUTE_CONFIRMATION_REQUIRED", "该路线需要用户确认，不能无门禁锁定。", {
          userMessage: "这条路线需要先确认；当前没有 hash 一致的待确认路线。",
          cause: "applyLock 收到需要路线确认的分类，但状态里没有匹配的待确认路线。",
          impact: "路线不会锁定。",
          recoveryKind: "retry",
          recoveryInstruction: "由 lockClassification 呈现路线确认，经 answer 确认后锁定。",
          retryOriginal: false,
        });
      }
    }
    await assertRouteExecutable(root, selected);
    const definition = routeDefinitionForFeature(selected.route, selected.classification.controls);
    const traceability = traceEnforcementRequired(selected.route, selected.classification.controls)
      ? await writeTraceSnapshot(root, emptyTraceabilityLedger(current.featureId, nextRevision, (await readProjectConfigSnapshot(root)).sha256)) : undefined;
    const review = reviewLedgerRequired(selected.route, selected.classification.controls)
      ? await writeReviewSnapshot(root, emptyReviewLedger(current.featureId, nextRevision)) : undefined;
    return {
      mutate: (draft) => {
        draft.schemaVersion = 6;
        draft.mode = "routed";
        draft.route = selected.route;
        draft.classification = selected.classification;
        draft.classificationBasis = selected.classificationBasis;
        draft.obligations = selected.obligations;
        draft.workflowCapabilities = normalizeWorkflowCapabilities(SUPPORTED_WORKFLOW_CAPABILITIES);
        draft.steps = Object.fromEntries(definition.orderedSteps.map((step) => [step, { status: "pending" as const }]));
        draft.humanGates = {};
        draft.artifacts = {};
        draft.verification = { attempts: [] };
        draft.logicComplete = false;
        if (traceability) draft.traceability = traceability;
        if (review) draft.review = review;
        delete draft.routeConfirmation;
      },
    };
  };
}

/** 路线确认经统一回答入口落账（ADR-0019）：一次锁定用户可见步骤，追溯与审查 pointer 同 revision。 */
export async function resolveRouteConfirmationForAnswer(ctx: AnswerResolveContext): Promise<AnswerResolveResult> {
  const { root, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  const pending = pendingDecisionForState(state);
  if (pending?.kind !== "route-confirmation" || !state.routeConfirmation) {
    throw new DevFlowError("ROUTE_CONFIRMATION_NOT_PENDING", "当前没有待确认路线。");
  }
  let promptEventId: string | undefined;
  let promptText: string | undefined;
  if (credential.source === "text") {
    promptEventId = credential.promptEventId;
    promptText = credential.promptText;
  }
  const matched = credential.source === "elicitation"
    ? { optionId: credential.action, comment: credential.comment }
    : (() => {
      const m = matchDecisionReply(pending, promptText ?? credential.promptText);
      return { optionId: m.option.id, comment: m.comment };
    })();
  if (matched.optionId !== "confirm") {
    if (credential.source === "elicitation") {
      throw new DevFlowError("DECISION_REPLY_NOT_RECOGNIZED", "请确认当前路线，或关闭表单后补充分类事实。");
    }
    throw new DevFlowError("ROUTE_CONFIRMATION_CORRECTION_REQUIRED", "路线需要修正，不能按当前分类锁定。", { comment: matched.comment });
  }
  const confirmation = state.routeConfirmation;
  let response: import("../policy/interaction.js").InteractionResponse | undefined;
  let transitionData: { previousRoute?: string; invalidatedSteps?: string[]; invalidatedArtifacts?: string[] } | undefined;

  if (state.mode === "intake") {
    // 首次锁定（intake → routed）只走 applyLock：写入时重算确认依据、检查
    // 路线可执行并挂快照 pointer；确认路径只追加凭证解析、消费 pending 与
    // 事件数据，不再有第二份字段赋值。
    const prepare = applyLock({ root, facts: confirmation.facts, basisHash: confirmation.basisHash });
    let confirmedLevel: string | undefined;
    let confirmedRoute: string[] | undefined;
    const next = await mutatePrepared(root, featureId, expectedRevision, "route-confirmation-accepted", async (current, nextStateRevision) => {
      const prepared = await prepare(current, nextStateRevision);
      const applyMutate = prepared.mutate;
      return {
        ...prepared,
        mutate: (draft) => {
          applyMutate(draft);
          confirmedLevel = draft.classification.level;
          confirmedRoute = draft.classification.orderedRoute;
          response = resolveResponseForAnswer(draft, interaction, {
            source: credential.source,
            action: credential.source === "elicitation" ? credential.action : undefined,
            comment: credential.source === "elicitation" ? credential.comment : undefined,
            userReply: credential.source === "text" ? (credential.promptText) : undefined,
            promptText,
            promptEventId,
            host,
          });
          delete draft.pendingDecision;
          draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
        },
        eventData: () => ({
          promptEventId,
          level: confirmedLevel,
          orderedRoute: confirmedRoute,
        }),
      };
    });
    if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
    return { state: next, action: "confirm" };
  }

  // 已 routed 的重分类重呈现确认：走重分类转换（保留已满足步骤、作废审查），
  // 不是首次锁定，不调用 applyLock（ADR-0020）。
  let selectedForEvent: ReturnType<typeof selectBaseRoute> | undefined;
  const next = await mutatePrepared(root, featureId, expectedRevision, "route-confirmation-accepted", async (current, nextStateRevision) => {
    const selected = selectBaseRoute(confirmation.facts);
    if (confirmationBasisHash(confirmation.facts, selected) !== confirmation.basisHash) {
      throw new DevFlowError("ROUTE_CONFIRMATION_STALE", "路线确认依据已变化。", {
        userMessage: "确认依据已变化，需要重新呈现当前路线。",
        impact: "路线不会变化；确认身份保留，重新呈现后再确认。",
        recoveryKind: "refresh",
        recoveryInstruction: "重新呈现当前路线并确认。",
        retryOriginal: false,
      });
    }
    await assertRouteExecutable(root, selected);
    const { preparedTraceability, preparedReview, reviewInvalidation } = await prepareRouteTransitionPointers(root, featureId, selected, current, nextStateRevision);
    selectedForEvent = selected;
    return {
      mutate: (draft) => {
        if (preparedTraceability) draft.traceability = preparedTraceability;
        if (preparedReview) draft.review = preparedReview;
        if (reviewInvalidation) draft.review = reviewInvalidation;
        // 先解析凭证（交互仍在 interactions 中），再做重分类转换（会清空交互）。
        response = resolveResponseForAnswer(draft, interaction, {
          source: credential.source,
          action: credential.source === "elicitation" ? credential.action : undefined,
          comment: credential.source === "elicitation" ? credential.comment : undefined,
          userReply: credential.source === "text" ? (credential.promptText) : undefined,
          promptText,
          promptEventId,
          host,
        });
        const transition = applyRouteTransition(draft, selected);
        transitionData = { previousRoute: transition.previousRoute, invalidatedSteps: transition.invalidatedSteps, invalidatedArtifacts: transition.invalidatedArtifacts };
        delete draft.pendingDecision;
        delete draft.routeConfirmation;
        draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
      },
      eventData: () => ({
        promptEventId,
        level: selectedForEvent?.classification.level,
        orderedRoute: selectedForEvent?.classification.orderedRoute,
        ...(transitionData ? { previousRoute: transitionData.previousRoute, invalidatedSteps: transitionData.invalidatedSteps, invalidatedArtifacts: transitionData.invalidatedArtifacts } : {}),
      }),
    };
  });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: "confirm" };
}

const levelRank: Record<string, number> = { XS: 0, S: 1, M: 2, L: 3 };
const topologyRank: Record<string, number> = { local: 0, "shared-contract": 1, "multi-chain": 2, "coordinated-rollback": 3 };

function isDowngrade(before: Classification, after: Classification): boolean {
  const riskRemoved = before.riskLabels.some((risk) => !after.riskLabels.includes(risk));
  return levelRank[after.level] < levelRank[before.level]
    || topologyRank[after.topology] < topologyRank[before.topology]
    || riskRemoved;
}

function controlsAreWeaker(before: Classification["controls"], after: Classification["controls"]): boolean {
  const planRank = { locate: 0, brief: 1, formal: 2 } as const;
  const reviewRank = { none: 0, focused: 1, independent: 2, full: 3 } as const;
  return before.requirements && !after.requirements
    || planRank[after.plan] < planRank[before.plan]
    || before.trace && !after.trace
    || before.planReview && !after.planReview
    || before.executionApproval && !after.executionApproval
    || before.checkpoints === "unit-chain" && after.checkpoints !== "unit-chain"
    || reviewRank[after.codeReview] < reviewRank[before.codeReview]
    || before.reviewRoles.some((role) => !after.reviewRoles.includes(role))
    || before.recovery.some((kind) => !after.recovery.includes(kind))
    || before.verification.some((kind) => !after.verification.includes(kind));
}

function applyRouteTransition(state: FeatureState, selected: ReturnType<typeof selectRoute>) {
  const previousRoute = state.route;
  const previousDefinition = routeDefinitionForFeature(previousRoute, state.classification.controls);
  const nextDefinition = routeDefinitionForFeature(selected.route, selected.classification.controls);
  const previousArtifacts = new Set([...previousDefinition.requiredArtifacts, ...(previousDefinition.generatedArtifacts ?? [])]);
  const nextArtifacts = new Set([...nextDefinition.requiredArtifacts, ...(nextDefinition.generatedArtifacts ?? [])]);
  const retainedArtifacts = Object.fromEntries(Object.entries(state.artifacts).filter(([kind]) => previousArtifacts.has(kind) && nextArtifacts.has(kind)));
  const retainedSteps: FeatureState["steps"] = {};
  for (const step of nextDefinition.orderedSteps) {
    if (["finalize", "verification"].includes(step)) break;
    if (state.steps[step]?.status !== "satisfied") break;
    retainedSteps[step] = state.steps[step];
  }
  const invalidatedSteps = Object.keys(state.steps).filter((step) => !retainedSteps[step]);
  const invalidatedArtifacts = Object.keys(state.artifacts).filter((kind) => !retainedArtifacts[kind]);
  state.classification = selected.classification;
  state.classificationBasis = selected.classificationBasis;
  state.obligations = selected.obligations;
  state.route = selected.route;
  state.artifacts = retainedArtifacts;
  state.steps = retainedSteps;
  state.humanGates = {};
  state.interactions = {};
  state.verification = { attempts: [] };
  state.logicComplete = false;
  if (!selected.classification.controls.trace) delete state.traceability;
  if (!reviewLedgerRequired(selected.route, selected.classification.controls)) delete state.review;
  return { previousRoute, invalidatedSteps, invalidatedArtifacts };
}

export async function reclassifyFeature(
  root: string,
  id: string,
  expectedRevision: number,
  next: ClassificationInput,
  reason: string,
  userEvidence?: string,
): Promise<FeatureState & { reclassifyNotice?: string }> {
  if (!reason) throw new DevFlowError("RECLASSIFICATION_REASON_REQUIRED", "reclassify requires a reason");
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  const selectedAtLock = selectRoute(next);
  const events = await readFeatureEvents(root, id);
  const governedWriteStarted = Object.values(initial.workspace.ownershipSource).includes("trusted-hook") || events.some((event) => event.type === "trusted-write-owned");
  const changedAtLock = selectedAtLock.route !== initial.route || JSON.stringify(selectedAtLock.classification) !== JSON.stringify(initial.classification);
  const weakerAtLock = isDowngrade(initial.classification, selectedAtLock.classification) || controlsAreWeaker(initial.classification.controls, selectedAtLock.classification.controls);
  if (governedWriteStarted && weakerAtLock) {
    throw new DevFlowError("RECLASSIFICATION_DOWNGRADE_FORBIDDEN", "首次 governed write 后控制只能单调增加。", { recoveryHint: "保留当前控制，或提交不会移除任何 level、风险、审查、恢复或验证保证的更强分类事实" });
  }
  if (!changedAtLock) throw new DevFlowError("RECLASSIFICATION_NOT_CHANGED", "分类事实和控制没有发生变化。", { recoveryHint: "无需重分类；继续当前路线" });
  await assertRouteExecutable(root, selectedAtLock);
  if (!governedWriteStarted && selectedAtLock.classification.routeConfirmationRequired) {
    if (pendingDecisionForState(initial)) throw new DevFlowError("DECISION_ALREADY_PENDING", "先处理当前唯一用户决策，再重算路线。", { recoveryHint: "使用 dev_flow_answer 回答当前问题" });
    const facts = {
      level: selectedAtLock.classification.level,
      topology: selectedAtLock.classification.topology,
      requirements: selectedAtLock.classification.requirements,
      riskLabels: selectedAtLock.classification.riskLabels,
      scopeFactRefs: selectedAtLock.classificationBasis.scopeFactRefs,
      topologyFactRefs: selectedAtLock.classificationBasis.topologyFactRefs,
      uncertaintyFactRefs: selectedAtLock.classificationBasis.uncertaintyFactRefs,
      riskFactRefs: selectedAtLock.classificationBasis.riskFactRefs,
      decisionRefs: selectedAtLock.classificationBasis.decisionRefs,
      signals: selectedAtLock.classificationBasis.signals,
    } as ClassificationFacts;
    let presentationEventId: string | undefined;
    return mutatePrepared(root, id, expectedRevision, "route-confirmation-represented", async () => ({ mutate: (draft) => {
      const basisHash = confirmationBasisHash(facts, selectedAtLock);
      draft.routeConfirmation = { facts, basisHash };
      const interaction = createInteraction(draft, {
        kind: "route-confirmation",
        target: "route-confirmation",
        basisHash,
        question: `分类事实变化，请重新确认路线：${selectedAtLock.classification.orderedRoute.join(" → ")}`,
        options: [{ id: "confirm", label: "确认这条路线" }, { id: "correct", label: "修正分类事实", requiresComment: true }],
      });
      presentationEventId = interaction.presentationEventId;
    }, eventData: () => ({ reason, previousRoute: initial.classification.orderedRoute, nextRoute: selectedAtLock.classification.orderedRoute, presentationEventId }) }));
  }
  let notice: string | undefined;
  let eventData: unknown = { reason };
  const state = await mutatePrepared(root, id, expectedRevision, "reclassified", async (current, nextStateRevision) => {
    const { preparedTraceability, preparedReview, reviewInvalidation } = await prepareRouteTransitionPointers(root, id, selectedAtLock, current, nextStateRevision);
    return { mutate: async (draft) => {
      if (draft.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only an active feature can be reclassified");
      const selected = selectRoute(next);
      if (preparedTraceability) draft.traceability = preparedTraceability;
      if (preparedReview) draft.review = preparedReview;
      if (reviewInvalidation) draft.review = reviewInvalidation;
      const before = draft.classification;
      const after = selected.classification;
      const transition = applyRouteTransition(draft, selected);
      eventData = { before, after, previousRoute: transition.previousRoute, nextRoute: selected.route, reason, userEvidence, invalidatedSteps: transition.invalidatedSteps, invalidatedArtifacts: transition.invalidatedArtifacts };
      notice = `分类已更新为 ${selected.route}，未继续登记的旧工件保留在磁盘作为审计历史。`;
    }, eventData: () => eventData };
  });
  return notice ? { ...state, reclassifyNotice: notice } : state;
}
