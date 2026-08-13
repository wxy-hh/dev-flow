import { readState, readFeatureEvents } from "./state-store.js";
import { inspectCurrentTrace } from "./traceability-gates.js";
import { readReviewLedger } from "./review-store.js";
import { reviewEnforcementRequired, traceEnforcementRequired } from "../policy/contract.js";
import { routeLabel, stageLabel } from "../policy/presentation.js";
import { effectiveStage } from "../policy/stages.js";
import { currentUnresolvedBlocking } from "./review-jobs.js";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";
import { pendingDecisionForState } from "./decision-interactions.js";
import { assertRepositoryFactCurrent } from "./repository-facts.js";
import { governanceLedger } from "./governance-state.js";
import { deriveCurrency } from "./basis-state.js";

export const inspectionTopics = ["classification", "artifacts", "trace", "review", "implementation", "verification", "delivery", "history", "diagnostics"] as const;
export type InspectionTopic = typeof inspectionTopics[number];

function topic(value: unknown): InspectionTopic {
  if (typeof value === "string" && inspectionTopics.includes(value as InspectionTopic)) return value as InspectionTopic;
  throw new DevFlowError("INSPECTION_TOPIC_INVALID", "inspect topic 必须是受支持的主题，不能使用 all。", { userMessage: "请选择一个明确的检查主题。", recoveryKind: "retry", recoveryInstruction: "从分类、工件、追溯、审查、实现、验证、交付、历史或诊断中选择一个主题。", retryOriginal: true });
}

async function classification(root: string, state: FeatureState) {
  const facts = [];
  for (const fact of state.governance?.repositoryFacts ?? []) {
    let freshness: "current" | "stale" | "unconfirmed" = "unconfirmed";
    if (fact.observedFingerprint) {
      try {
        await assertRepositoryFactCurrent(root, fact);
        freshness = "current";
      } catch (error) {
        freshness = error instanceof DevFlowError && error.code === "BOUNDARY_FACT_UNCONFIRMED" ? "unconfirmed" : "stale";
      }
    }
    facts.push({
      recordId: fact.recordId,
      assertion: fact.assertion,
      // 只展示安全的位置/范围信息，不暴露观察指纹等内部哈希。
      location: fact.location.kind === "positive"
        ? { kind: "positive", path: fact.location.path, ...(fact.location.anchor ? { anchor: fact.location.anchor } : {}) }
        : { kind: "negative", checkedScope: fact.location.checkedScope, conditions: fact.location.conditions },
      freshness,
    });
  }
  return {
    objective: state.objective ?? "未命名需求",
    scope: state.scope,
    ...(state.mode === "routed" ? { route: routeLabel(state.route), stage: stageLabel(effectiveStage(state)) } : { route: "路线尚未确定", stage: "需求了解" }),
    ...(facts.length ? { repositoryFacts: facts } : {}),
    decisionStatus: governanceLedger(state).decisions.reduce((summary, decision) => {
      const status = decision.supersededBy ? "superseded" : "resolved";
      summary[status] = (summary[status] ?? 0) + 1;
      return summary;
    }, {} as Record<string, number>),
  };
}

async function artifacts(state: FeatureState) {
  return {
    items: Object.entries(state.artifacts).map(([kind, artifact]) => ({ kind, path: artifact.path, registered: true })),
  };
}

async function trace(root: string, state: FeatureState) {
  if (state.mode === "intake" || !traceEnforcementRequired(state.route, state.classification.controls)) return { enforced: false, blocker: undefined };
  const inspection = await inspectCurrentTrace(root, state);
  // 验证处置分项统计：不把所有绿色结果统称为“测试通过”（ADR-0011）。
  const nodes = Object.values(inspection.ledger?.nodes ?? {}) as Array<{ kind?: string; status?: string; verificationDisposition?: { kind?: string } }>;
  const current = nodes.filter((node) => node.status === "current");
  const dispositions = current
    .filter((node) => node.kind === "acceptance-criterion" && node.verificationDisposition?.kind)
    .map((node) => node.verificationDisposition!.kind as string);
  // 恢复安排（ADR-0016）：哪些步骤要求、使用何种安排、要求来自哪项风险。
  const recoveries = current.filter((node) => node.kind === "recovery") as Array<{ id?: string; stepRef?: string; recoveryKind?: string; method?: string; riskRef?: string }>;
  const highRisk = (state.classification?.riskLabels ?? []).some((label) => label === "data" || label === "external" || label === "irreversible_consequence");
  return {
    enforced: true,
    summary: inspection.effectiveSummary,
    blocker: inspection.blocker ? "追溯证据需要修复" : undefined,
    verificationDispositions: {
      coveredByTest: current.filter((node) => node.kind === "acceptance-criterion").length - dispositions.length,
      byKind: [...new Set(dispositions)].sort().map((kind) => ({ kind, count: dispositions.filter((item) => item === kind).length })),
    },
    recovery: {
      required: highRisk,
      arrangements: recoveries.map((node) => ({
        id: node.id,
        stepRef: node.stepRef,
        recoveryKind: node.recoveryKind,
        method: node.method,
        riskRef: node.riskRef,
      })),
    },
  };
}

async function review(root: string, state: FeatureState) {
  if (state.mode === "intake" || !reviewEnforcementRequired(state.route, state.classification.controls)) return { enforced: false };
  // issue 16：inspect 与推进门禁共用同一未解发现归约（与 reviewGate 共用内部函数，
  // 禁止第三套）。作业未齐时也如实显示已提交 job 的 blocking finding。
  const ledger = await readReviewLedger(root, state);
  const current = ledger.batches.find((batch) => batch.validity === "current");
  const unresolved = current ? currentUnresolvedBlocking(ledger, current, state) : [];
  // issue 19：来源维度与隔离维度分开展示，互不替代。
  const isolation = current?.jobs.flatMap((job) => job.submission?.isolationProof ? [{ jobId: job.jobId, mode: job.submission.isolationProof.mode }] : []) ?? [];
  return {
    enforced: true,
    currentBatch: current ? { progress: current.progress, roles: current.jobs.map((job) => ({ role: job.role, status: job.status })) } : undefined,
    unresolvedBlockingCount: unresolved.length,
    ...(current?.unknownDiffInfo ? { unknownDiff: current.unknownDiffInfo } : {}),
    independence: {
      // 隔离上下文证明与多来源证明是两个正交维度。
      isolatedJobs: isolation,
      assuranceLevel: current?.assuranceLevel,
      executionMode: current?.executionMode,
    },
    staleBatchCount: ledger.batches.filter((batch) => batch.validity === "stale").length,
  };
}

async function implementation(state: FeatureState) {
  const units = state.implementationUnits ?? [];
  return { total: units.length, completed: units.filter((unit) => unit.status === "checkpointed").length, active: units.find((unit) => unit.status === "active") ? "有一个实现单元正在进行" : "无" };
}

async function verification(state: FeatureState) {
  const attempts = state.verification.attempts;
  const latest = attempts.at(-1) as { exitCode?: unknown; exitReason?: unknown; phase?: unknown; acceptanceKind?: unknown } | undefined;
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  const accepted = governanceLedger(state).authorizations
    .filter((authorization) => authorization.authorizationType === "risk-acceptance" && authorization.target === "verification")
    .map((authorization) => ({
      authorization,
      status: deriveCurrency(authorization, { contentFingerprint: state.businessFingerprint }) === "current"
        && (!Number.isFinite(invalidatedAt) || !authorization.recordedAt || Date.parse(authorization.recordedAt) >= invalidatedAt)
        ? "current" as const : "stale" as const,
    }));
  return {
    attempts: attempts.length,
    freshness: state.evidenceFreshness.verification,
    passed: Boolean(state.verification.satisfiedByAttemptId !== undefined),
    acceptance: (state.acceptance?.dispositions ?? []).map((disposition) => ({
      acceptanceCriterionId: disposition.acceptanceCriterionId,
      dispositionKind: disposition.dispositionKind,
      status: disposition.status,
      evidenceRefs: [...disposition.evidenceRefs],
    })),
    ...(latest ? {
      latestAttempt: {
        id: attempts.length,
        exitCode: latest.exitCode,
        // 结束原因分开报告：timeout/output-limit/spawn-failure 是环境或进程
        // 问题，non-zero-exit 才是代码缺陷；不统一显示为“测试失败”。
        exitReason: latest.exitReason ?? "unknown",
        phase: latest.phase ?? "forward",
        // 验收来源分级（ADR-0009）：self-check 表示只有智能体文字说明，
        // 不构成人工验收完成。
        ...(latest.acceptanceKind ? { acceptanceKind: latest.acceptanceKind } : {}),
      },
    } : {}),
    // 风险接受只对当时的交付内容有效（issue 22）：current 表示门禁仍在
    // 豁免验证义务，stale 表示内容已变化、验证已重新打开，需重跑后重新判断。
    riskAcceptance: accepted.map(({ authorization, status }) => ({
      status,
      acceptedAt: authorization.recordedAt,
      riskSummary: authorization.target,
    })),
  };
}

async function delivery(state: FeatureState) {
  const snapshot = state.deliverySnapshot as { excludedChangedPaths?: string[] } | undefined;
  return {
    lifecycle: state.lifecycle,
    workspace: state.workspace.reconciliationStatus,
    snapshot: state.deliverySnapshot ? "已生成" : "未生成",
    featureOwnedPathCount: Object.values(state.workspace.ownership).filter((value) => value === "feature").length,
    ...(snapshot?.excludedChangedPaths?.length ? { excludedChangedPaths: snapshot.excludedChangedPaths } : {}),
  };
}

async function history(root: string, state: FeatureState) {
  const events = await readFeatureEvents(root, state.featureId);
  return {
    count: events.length,
    recent: events.slice(-10).map((event) => ({ at: event.at, type: event.type })),
  };
}

async function diagnostics(root: string, state: FeatureState) {
  const events = await readFeatureEvents(root, state.featureId);
  return {
    featureId: state.featureId,
    revision: state.revision,
    schemaVersion: state.schemaVersion,
    workspace: state.workspace,
    artifacts: state.artifacts,
    traceability: state.traceability,
    review: state.review,
    pendingDecision: pendingDecisionForState(state),
    recentEvents: events.slice(-20),
  };
}

export async function inspectFeature(root: string, featureId: string, requestedTopic: string): Promise<{ topic: InspectionTopic; content: unknown }> {
  const selected = topic(requestedTopic);
  const state = await readState(root, featureId);
  const content = selected === "classification"
    ? await classification(root, state)
    : selected === "artifacts"
      ? await artifacts(state)
      : selected === "trace"
        ? await trace(root, state)
        : selected === "review"
          ? await review(root, state)
          : selected === "implementation"
            ? await implementation(state)
            : selected === "verification"
              ? await verification(state)
              : selected === "delivery"
                ? await delivery(state)
                : selected === "history"
                  ? await history(root, state)
                  : await diagnostics(root, state);
  return { topic: selected, content };
}
