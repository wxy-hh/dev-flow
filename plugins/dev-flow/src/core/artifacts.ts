import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { reviewEnforcementRequired, traceEnforcementRequired } from "../policy/contract.js";
import type { TraceArtifactKind, TraceDelta } from "../policy/traceability.js";
import { renderArtifactTemplate } from "./artifact-templates.js";
import { DevFlowError } from "./errors.js";
import { approvalIds } from "./approval-basis.js";
import { mutate, mutatePrepared, readState, type FeatureState, type PreparedMutationOptions } from "./state-store.js";
import { currentOpenStep, routeDefinitionForState } from "./step-order.js";
import { compileArtifactPlanFromMarkdown } from "./plan-compile-context.js";
import { type PlanDiagnostic } from "./plan-compiler.js";
import { type TraceStoreOptions, writeTraceSnapshot } from "./traceability-store.js";
import { clearInteractionsByKind, clearInteractionsForTarget } from "./user-interactions.js";
import { prepareReviewInvalidation } from "./review-store.js";
import { reopenObligations } from "../policy/obligations.js";
import { normalizeUnicode } from "./path-normalization.js";
import { detectRollbackSplitWarning } from "../policy/rollback-warnings.js";
import { validatePlanTaskGraph } from "./plan-graph.js";
import { verificationCommandHashesForRefs } from "./project-config.js";

const names: Record<string, string> = {
  requirements: "需求文档.md",
  "implementation-plan": "实施计划.md",
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const featureDirectory = (root: string, id: string) => path.join(root, ".dev-flow", "features", id);
const traceArtifactKinds = new Set(["requirements", "implementation-plan"]);
const traceArtifactKindList = new Set<TraceArtifactKind>(["requirements", "implementation-plan"]);

interface ArtifactInvalidation {
  /** The source step remains satisfied; every later step is invalidated. */
  afterStep?: string;
  /** Review-enforced plan edits reopen the source step itself. */
  reopenFromStep?: string;
}

/** The sole mapping from editable evidence to approvals and dependent workflow state. */
const artifactInvalidations: Record<string, ArtifactInvalidation> = {
  requirements: { afterStep: "requirements_alignment" },
  "implementation-plan": { afterStep: "planning", reopenFromStep: "planning" },
};

export interface RecordArtifactWithTraceOptions {
  /** Test-only fault injection. Production callers omit this. */
  snapshot?: TraceStoreOptions;
  mutation?: PreparedMutationOptions;
}
export interface RecordArtifactWithTraceResult {
  state: FeatureState;
  warnings?: string[];
}
function template(state: FeatureState, id: string, kind: string): string {
  if (traceArtifactKinds.has(kind)) {
    return renderArtifactTemplate({ featureId: id, route: state.route, requirementsState: state.classification.requirements, controls: state.classification.controls }, kind);
  }
  return `---\ndev_flow:\n  schema_version: 3\n  feature_id: ${id}\n  route: ${state.route}\n  kind: ${kind}\n---\n\n# ${kind}\n\n`;
}

function effectiveRoute(state: FeatureState) {
  return routeDefinitionForState(state);
}

function artifactKinds(definition: ReturnType<typeof effectiveRoute>): string[] {
  return [...new Set([...definition.requiredArtifacts, ...(definition.generatedArtifacts ?? [])])];
}

function assertManualRegistrationAllowed(state: FeatureState, kind: string, traceAware: boolean): void {
  const route = effectiveRoute(state);
  if ((route.generatedArtifacts ?? []).includes(kind)) {
    throw new DevFlowError("GENERATED_ARTIFACT_READ_ONLY", `${kind} is generated from state and cannot be registered as manual evidence`);
  }
  if (!route.requiredArtifacts.includes(kind)) {
    throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  }
  if (!traceAware && traceArtifactKinds.has(kind)
    && traceEnforcementRequired(state.route, state.classification.controls)) {
    throw new DevFlowError("TRACE_AWARE_REGISTRATION_REQUIRED", `${kind} must be registered with its Trace delta`);
  }
}

function assertPlanRevisionQuiescent(state: FeatureState, kind: string): void {
  if (kind !== "implementation-plan") return;
  const active = (state.implementationUnits ?? []).find((unit) => unit.status === "active");
  if (active) {
    throw new DevFlowError("PLAN_REVISION_REQUIRES_QUIESCENT_UNIT", "implementation-plan cannot change while an implementation unit is active", {
      activeUnitId: active.unitId,
      hint: "先 checkpoint、取消（dev_flow_abandon_implementation_unit）或 rollback 再修订计划",
    });
  }
}

function cleanupTombstonedPendingUnits(state: FeatureState, ledger: { nodes: Record<string, { status: string }> }): void {
  if (!state.implementationUnits) return;
  state.implementationUnits = state.implementationUnits.filter((unit) => {
    if (unit.status !== "pending") return true;
    return ledger.nodes[unit.unitId]?.status === "current";
  });
}

/** Apply the route-specific invalidation semantics for an edited artifact. */
export function invalidateFromStep(state: FeatureState, kind: string): { planningReopened: boolean } {
  const rule = artifactInvalidations[kind] ?? {};
  let planningReopened = false;
  const reopenFromStep = rule.reopenFromStep
    && reviewEnforcementRequired(state.route, state.classification.controls)
    ? rule.reopenFromStep
    : undefined;
  if (reopenFromStep) {
    const ordered = effectiveRoute(state).orderedSteps;
    const sourceIndex = ordered.indexOf(reopenFromStep);
    for (const step of ordered.slice(sourceIndex)) delete state.steps[step];
    planningReopened = reopenFromStep === "planning";
  } else if (rule.afterStep) {
    const ordered = effectiveRoute(state).orderedSteps;
    const sourceIndex = ordered.indexOf(rule.afterStep);
    for (const step of ordered.slice(sourceIndex + 1)) delete state.steps[step];
  }
  state.logicComplete = false;
  delete state.steps.finalize;
  return { planningReopened };
}

function invalidateArtifactDependents(
  state: FeatureState,
  kind: string,
  reason: "artifact-changed" | "trace-changed",
  executionBasisChanged: boolean,
): { planningReopened: boolean } {
  const invalidation = invalidateFromStep(state, kind);
  if (executionBasisChanged) {
    for (const approval of approvalIds(state)) {
      delete state.humanGates[approval];
      clearInteractionsForTarget(state, `approval:${approval}`);
    }
    state.obligations = reopenObligations(state.obligations, ["approval"]);
  }
  if (kind === "requirements") clearInteractionsByKind(state, "grill");
  state.logicComplete = false;
  delete state.steps.finalize;
  // Keep the precise causal reason in the mutation event rather than state schema.
  void reason;
  return invalidation;
}

export async function assertArtifactCurrent(root: string, id: string, state: FeatureState, kind: string): Promise<string> {
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile(path.join(featureDirectory(root, id), normalizeUnicode(artifact.path)), "utf8");
  if (hash(contents) !== artifact.sha256) throw new DevFlowError("ARTIFACT_INTEGRITY_FAILED", kind);
  return contents;
}

/** Read an edited artifact for a domain workflow that is about to re-register it. */
export async function readArtifactText(root: string, id: string, artifactPath: string): Promise<string> {
  return readFile(path.join(featureDirectory(root, id), normalizeUnicode(artifactPath)), "utf8");
}

export async function scaffoldArtifact(root: string, id: string, expectedRevision: number, kind: string): Promise<FeatureState> {
  const state = await readState(root, id); if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can scaffold artifacts");
  const route = effectiveRoute(state);
  if (!artifactKinds(route).includes(kind)) throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  if (kind === "plan-review" && reviewEnforcementRequired(state.route, state.classification.controls)) {
    throw new DevFlowError("GENERATED_ARTIFACT_READ_ONLY", "plan-review is generated from the immutable review ledger");
  }
  const currentStep = currentOpenStep(state); const requiredNow = currentStep
    ? [...(route.artifactSteps?.[currentStep] ?? []), ...(route.generatedArtifactSteps?.[currentStep] ?? [])]
    : [];
  if (!requiredNow.includes(kind)) throw new DevFlowError("ARTIFACT_OUT_OF_ORDER", `${kind} is not required by ${currentStep ?? "a pending step"}`, { expectedStep: currentStep });
  const filename = names[kind] ? normalizeUnicode(names[kind]) : undefined; if (!filename) throw new DevFlowError("INVALID_ARTIFACT", "unknown artifact kind"); const target = path.join(featureDirectory(root, id), filename);
  const content = template(state, id, kind); await writeFile(target, content, { flag: "wx" }).catch(async (error) => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
  const contents = await readFile(target, "utf8"); return mutate(root, id, expectedRevision, "artifact-scaffolded", (current) => { current.artifacts[kind] = { path: filename, sha256: hash(contents) }; });
}
/** Registers the edited file as the current evidence and revokes approvals whose basis changed. */
export async function recordArtifact(root: string, id: string, expectedRevision: number, kind: string): Promise<FeatureState> {
  const state = await readState(root, id);
  assertManualRegistrationAllowed(state, kind, false);
  assertPlanRevisionQuiescent(state, kind);
  const artifact = state.artifacts[kind]; if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile(path.join(featureDirectory(root, id), normalizeUnicode(artifact.path)), "utf8"); const checksum = hash(contents);
  if (kind === "implementation-plan" && state.classification.controls.plan === "formal") {
    const errors = validatePlanTaskGraph(contents);
    if (errors.length) {
      throw new DevFlowError("PLAN_TASK_GRAPH_INVALID", "实施计划的任务间关系校验未通过", {
        errors,
        recoveryHint: "修正计划中每个任务声明的 implementation_unit、每个 UNIT 的 tasks/depends_on，确保引用闭合且依赖无环后重新登记",
      });
    }
  }
  return mutate(root, id, expectedRevision, "artifact-recorded", (current) => {
    assertPlanRevisionQuiescent(current, kind);
    current.artifacts[kind] = { ...artifact, path: normalizeUnicode(artifact.path), sha256: checksum };
    invalidateArtifactDependents(current, kind, "artifact-changed", true);
  }, { kind, invalidationReason: "artifact-changed", planningReopened: kind === "implementation-plan" && reviewEnforcementRequired(state.route, state.classification.controls) });
}

/**
 * Registers one editable Trace artifact and its complete delta as one state CAS.
 * A snapshot may become an orphan on a pre-commit failure, but state remains on
 * the old artifact hash and pointer until the state.json commit succeeds.
 */
export async function recordArtifactWithTrace(
  root: string,
  id: string,
  expectedRevision: number,
  artifactKind: TraceArtifactKind,
  _traceDelta: TraceDelta,
  options: RecordArtifactWithTraceOptions = {},
): Promise<RecordArtifactWithTraceResult> {
  void _traceDelta;
  if (artifactKind !== "requirements" && artifactKind !== "implementation-plan") {
    throw new DevFlowError("UNSUPPORTED_TRACE_ARTIFACT_KIND", `${artifactKind} is not a v6 editable Trace artifact`, {
      recoveryHint: "v6 只保留 requirements 与 implementation-plan；公开 traceDelta 已删除。",
    });
  }
  return recordArtifactFromMarkdown(root, id, expectedRevision, artifactKind, options);
}

/**
 * v6 read-only plan preflight from the edited Markdown only. No traceDelta is
 * accepted, and the function has no side effects: no revision advance, no
 * snapshot writes, no review batch creation.
 */
export async function validatePlanFromMarkdown(
  root: string,
  id: string,
  artifactKind: TraceArtifactKind,
): Promise<{
  ok: boolean;
  diagnostics: PlanDiagnostic[];
  semanticSha256?: string;
  implementationUnits?: import("./plan-compiler.js").ImplementationUnitProjection[];
  recoveryArrangements?: import("./plan-compiler.js").RecoveryArrangementProjection[];
}> {
  const state = await readState(root, id);
  if (!traceArtifactKindList.has(artifactKind)) throw new DevFlowError("INVALID_ARTIFACT", artifactKind);
  if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can validate plans");
  if (!traceEnforcementRequired(state.route, state.classification.controls)) {
    throw new DevFlowError("TRACE_NOT_ENFORCED", `${artifactKind} does not use Trace registration on ${state.route}`, {
      route: state.route,
      recoveryHint: "当前路线不强制 Trace；请改用 dev_flow_record_artifact 登记该文档",
    });
  }
  const compilation = await compileArtifactPlanFromMarkdown(root, id, state, {
    artifactKind,
    nextStateRevision: state.revision + 1,
  });
  return {
    ok: compilation.result.ok,
    diagnostics: compilation.result.diagnostics,
    ...(compilation.semanticSha256 ? { semanticSha256: compilation.semanticSha256 } : {}),
    ...(compilation.result.implementationUnits ? { implementationUnits: compilation.result.implementationUnits } : {}),
    ...(compilation.result.recoveryArrangements ? { recoveryArrangements: compilation.result.recoveryArrangements } : {}),
  };
}

/**
 * v6 trace artifact registration from structured Markdown only. The edited
 * file is the single semantic source; Core parses, compiles and persists the
 * new Trace pointer in the same state CAS.
 */
export async function recordArtifactFromMarkdown(
  root: string,
  id: string,
  expectedRevision: number,
  artifactKind: TraceArtifactKind,
  options: RecordArtifactWithTraceOptions = {},
): Promise<RecordArtifactWithTraceResult> {
  if (artifactKind !== "requirements" && artifactKind !== "implementation-plan") {
    throw new DevFlowError("UNSUPPORTED_TRACE_ARTIFACT_KIND", `${artifactKind} is not a v6 editable Trace artifact`, {
      recoveryHint: "v6 只保留 requirements 与 implementation-plan 两类 Trace artifact",
    });
  }
  let eventData: Record<string, unknown> = { kind: artifactKind };
  let warnings: string[] = [];
  const state = await mutatePrepared(root, id, expectedRevision, "artifact-recorded-with-trace", async (current, nextStateRevision) => {
    if (current.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can register artifacts");
    if (traceEnforcementRequired(current.route, current.classification.controls) === false) {
      throw new DevFlowError("TRACE_NOT_ENFORCED", `${artifactKind} does not use Trace registration on ${current.route}`, {
        route: current.route,
        recoveryHint: "当前路线不强制 Trace；请改用 dev_flow_record_artifact 登记该文档",
      });
    }
    assertManualRegistrationAllowed(current, artifactKind, true);
    assertPlanRevisionQuiescent(current, artifactKind);
    const compilation = await compileArtifactPlanFromMarkdown(root, id, current, { artifactKind, nextStateRevision });
    const compile = compilation.result;
    if (compile.ok === false || compile.ledger === undefined || compilation.input === undefined) {
      throw new DevFlowError("PLAN_INVALID", "实施计划编译未通过。", {
        diagnostics: compile.diagnostics,
        userMessage: "实施计划存在需要修正的问题。",
        cause: `计划编译发现 ${compile.diagnostics.length} 处问题。`,
        impact: "计划没有登记，状态与工件均未变化。",
        recoveryKind: "retry",
        recoveryInstruction: "按诊断逐项修正 Markdown 后重新预检并登记。",
        retryOriginal: true,
      });
    }
    const ledger = compile.ledger;
    const artifact = compilation.artifact;
    const artifactSha256 = compilation.input.artifactSha256;
    const config = compilation.config;
    const executionNodes = Object.values(ledger.nodes)
      .filter((node) => node.status === "current" && node.kind !== "test")
      .map((node) => node.kind === "implementation-unit" ? {
        kind: node.kind, id: node.id, tasks: node.tasks, dependsOn: node.dependsOn, fileScope: node.fileScope,
        covers: node.covers, forwardVerification: node.forwardVerification,
      } : node.kind === "recovery" ? {
        kind: node.kind, id: node.id, stepRef: node.stepRef, recoveryKind: node.recoveryKind, method: node.method, riskRef: node.riskRef,
      } : node.kind === "task" ? { kind: node.kind, id: node.id, covers: node.covers, implementationUnit: node.implementationUnit }
        : { kind: node.kind, id: node.id })
      .sort((left, right) => left.id.localeCompare(right.id));
    const executionVerificationRefs = Object.values(ledger.nodes)
      .filter((node): node is Extract<typeof node, { kind: "implementation-unit" }> =>
        node.status === "current" && node.kind === "implementation-unit")
      .flatMap((node) => node.forwardVerification);
    const executionSemanticBasisHash = hash(JSON.stringify({
      nodes: executionNodes,
      verificationCommandHashes: verificationCommandHashesForRefs(config, executionVerificationRefs),
    }));
    warnings = detectRollbackSplitWarning(Object.values(ledger.nodes).filter((node): node is Extract<typeof node, { kind: "implementation-unit" }> => node.kind === "implementation-unit"));
    const pointer = await writeTraceSnapshot(root, ledger, options.snapshot);
    const artifactChanged = artifact.sha256 !== artifactSha256;
    const traceChanged = compilation.semanticSha256 !== undefined && compilation.input.currentLedger
      ? JSON.stringify(compilation.input.currentLedger.nodes) !== JSON.stringify(ledger.nodes)
        || JSON.stringify(compilation.input.currentLedger.edges) !== JSON.stringify(ledger.edges)
      : true;
    const executionBasisChanged = current.executionSemanticBasisHash !== executionSemanticBasisHash;
    const reviewPointer = artifactChanged || traceChanged
      ? await prepareReviewInvalidation(root, current, nextStateRevision)
      : undefined;
    eventData = {
      kind: artifactKind,
      artifactChanged,
      traceChanged,
      ...(compilation.semanticSha256 ? { semanticSha256: compilation.semanticSha256 } : {}),
      invalidationReason: artifactChanged ? "artifact-changed" : traceChanged ? "trace-changed" : undefined,
      ...(executionBasisChanged ? { executionBasisChanged: true } : {}),
      ...(warnings.length ? { warnings } : {}),
    };
    return {
      mutate: (draft) => {
        draft.artifacts[artifactKind] = { ...artifact, sha256: artifactSha256 };
        draft.traceability = pointer;
        draft.executionSemanticBasisHash = executionSemanticBasisHash;
        if (reviewPointer) draft.review = reviewPointer;
        if (artifactChanged || traceChanged || executionBasisChanged) {
          const invalidation = invalidateArtifactDependents(
            draft,
            artifactKind,
            artifactChanged ? "artifact-changed" : "trace-changed",
            executionBasisChanged,
          );
          cleanupTombstonedPendingUnits(draft, ledger);
          eventData = { ...eventData, planningReopened: invalidation.planningReopened };
        }
      },
      eventData: () => eventData,
    };
  }, options.mutation);
  return warnings.length ? { state, warnings } : { state };
}

export async function assertArtifactIntegrity(root: string, id: string): Promise<void> {
  const state = await readState(root, id);
  for (const kind of artifactKinds(effectiveRoute(state))) {
    await assertArtifactCurrent(root, id, state, kind);
  }
}

/**
 * 只读计划预检（issue 10）：零副作用——不推进阶段、不增加 revision、
 * 不写快照、不创建审查批次、不产生审计垃圾。诊断顺序稳定，与正式登记
 * 使用完全相同的编译函数，因此同一计划在预检与登记时产生相同诊断。
 */
export async function validatePlan(
  root: string,
  id: string,
  artifactKind: TraceArtifactKind,
  _traceDelta?: TraceDelta,
): Promise<{
  ok: boolean;
  diagnostics: PlanDiagnostic[];
  implementationUnits?: import("./plan-compiler.js").ImplementationUnitProjection[];
  recoveryArrangements?: import("./plan-compiler.js").RecoveryArrangementProjection[];
}> {
  void _traceDelta;
  return validatePlanFromMarkdown(root, id, artifactKind);
}
