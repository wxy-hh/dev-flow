import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { reviewEnforcementRequired, routeDefinitionForFeature, traceEnforcementRequired } from "../policy/contract.js";
import type { TraceArtifactKind, TraceDelta } from "../policy/traceability.js";
import { renderArtifactTemplate } from "./artifact-templates.js";
import { DevFlowError } from "./errors.js";
import { gatesInvalidatedByArtifact } from "./gate-basis.js";
import { mutate, mutatePrepared, readState, type FeatureState, type PreparedMutationOptions } from "./state-store.js";
import { currentOpenStep } from "./step-order.js";
import { parseTraceSourceBlocks } from "./traceability-anchors.js";
import { applyTraceDelta } from "./traceability.js";
import { readProjectConfigSnapshot, readTraceability, type TraceStoreOptions, writeTraceSnapshot } from "./traceability-store.js";
import { clearInteractionsByKind, clearInteractionsForTarget } from "./user-interactions.js";
import { prepareReviewInvalidation } from "./review-store.js";

const names: Record<string, string> = {
  status: "状态文档.md",
  "risk-card": "风险文档.md",
  requirements: "需求文档.md",
  "implementation-plan": "计划文档.md",
  "coverage-matrix": "覆盖矩阵文档.md",
  "boundary-card": "边界文档.md",
  "rollback-safety": "回滚安全文档.md",
  verification: "验证文档.md",
  "rollback-units": "回滚单元文档.md",
  "plan-review": "计划审核文档.md",
  "code-review": "代码审核文档.md",
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const featureDirectory = (root: string, id: string) => path.join(root, ".dev-flow", "features", id);
const traceArtifactKinds = new Set(["requirements", "implementation-plan", "coverage-matrix", "rollback-units"]);
const traceArtifactKindList = new Set<TraceArtifactKind>(["requirements", "implementation-plan", "coverage-matrix", "rollback-units"]);

interface ArtifactInvalidation {
  gates: string[];
  /** The source step remains satisfied; every later step is invalidated. */
  afterStep?: string;
}

/** The sole mapping from editable evidence to approvals and dependent workflow state. */
const artifactInvalidations: Record<string, ArtifactInvalidation> = {
  requirements: { gates: ["requirement_confirmation", "implementation_approval"], afterStep: "requirements" },
  "implementation-plan": { gates: ["implementation_approval"], afterStep: "implementation_plan" },
  "coverage-matrix": { gates: ["implementation_approval"], afterStep: "coverage_review" },
  "rollback-units": { gates: ["implementation_approval"], afterStep: "rollback_unit" },
  "risk-card": { gates: ["implementation_approval"] },
  "boundary-card": { gates: ["implementation_approval"] },
  "rollback-safety": { gates: ["implementation_approval"] },
};

export interface RecordArtifactWithTraceOptions {
  /** Test-only fault injection. Production callers omit this. */
  snapshot?: TraceStoreOptions;
  mutation?: PreparedMutationOptions;
}
function template(state: FeatureState, id: string, kind: string): string {
  if (traceArtifactKinds.has(kind)) {
    return renderArtifactTemplate({ featureId: id, route: state.route, requirementsState: state.classification.requirements }, kind);
  }
  return `---\ndev_flow:\n  schema_version: 1\n  feature_id: ${id}\n  route: ${state.route}\n  kind: ${kind}\n---\n\n# ${kind}\n\n`;
}

function effectiveRoute(state: FeatureState) {
  return routeDefinitionForFeature(state.route, state.workflowCapabilities);
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
    && traceEnforcementRequired(state.route, state.workflowCapabilities)) {
    throw new DevFlowError("TRACE_AWARE_REGISTRATION_REQUIRED", `${kind} must be registered with its Trace delta`);
  }
}

function invalidateArtifactDependents(state: FeatureState, kind: string, reason: "artifact-changed" | "trace-changed"): void {
  const rule = artifactInvalidations[kind] ?? { gates: gatesInvalidatedByArtifact(kind) };
  for (const gate of new Set([...rule.gates, ...gatesInvalidatedByArtifact(kind)])) {
    delete state.humanGates[gate];
    delete state.steps[gate];
    clearInteractionsForTarget(state, `gate:${gate}`);
  }
  if (rule.afterStep) {
    const ordered = effectiveRoute(state).orderedSteps;
    const sourceIndex = ordered.indexOf(rule.afterStep);
    for (const step of ordered.slice(sourceIndex + 1)) {
      delete state.steps[step];
      clearInteractionsForTarget(state, `gate:${step}`);
    }
  }
  if (kind === "requirements") clearInteractionsByKind(state, "grill");
  state.featureCheck = {};
  delete state.steps.feature_check;
  state.logicComplete = false;
  delete state.steps.finalize;
  // Keep the precise causal reason in the mutation event rather than state schema.
  void reason;
}

export async function assertArtifactCurrent(root: string, id: string, state: FeatureState, kind: string): Promise<string> {
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile(path.join(featureDirectory(root, id), artifact.path), "utf8");
  if (hash(contents) !== artifact.sha256) throw new DevFlowError("ARTIFACT_INTEGRITY_FAILED", kind);
  return contents;
}

export async function scaffoldArtifact(root: string, id: string, expectedRevision: number, kind: string): Promise<FeatureState> {
  const state = await readState(root, id); if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can scaffold artifacts");
  const route = effectiveRoute(state);
  if (!artifactKinds(route).includes(kind)) throw new DevFlowError("ARTIFACT_NOT_REQUIRED", `${kind} is not required for ${state.route}`);
  if (kind === "plan-review" && reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
    throw new DevFlowError("GENERATED_ARTIFACT_READ_ONLY", "plan-review is generated from the immutable review ledger");
  }
  const currentStep = currentOpenStep(state); const requiredNow = currentStep
    ? [...(route.artifactSteps?.[currentStep] ?? []), ...(route.generatedArtifactSteps?.[currentStep] ?? [])]
    : [];
  if (!requiredNow.includes(kind)) throw new DevFlowError("ARTIFACT_OUT_OF_ORDER", `${kind} is not required by ${currentStep ?? "a pending step"}`, { expectedStep: currentStep });
  const filename = names[kind]; if (!filename) throw new DevFlowError("INVALID_ARTIFACT", "unknown artifact kind"); const target = path.join(featureDirectory(root, id), filename);
  const content = template(state, id, kind); await writeFile(target, content, { flag: "wx" }).catch(async (error) => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
  const contents = await readFile(target, "utf8"); return mutate(root, id, expectedRevision, "artifact-scaffolded", (current) => { current.artifacts[kind] = { path: filename, sha256: hash(contents) }; });
}
/** Registers the edited file as the current evidence and revokes approvals whose basis changed. */
export async function recordArtifact(root: string, id: string, expectedRevision: number, kind: string): Promise<FeatureState> {
  const state = await readState(root, id);
  assertManualRegistrationAllowed(state, kind, false);
  const artifact = state.artifacts[kind]; if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile(path.join(featureDirectory(root, id), artifact.path), "utf8"); const checksum = hash(contents);
  return mutate(root, id, expectedRevision, "artifact-recorded", (current) => {
    current.artifacts[kind] = { ...artifact, sha256: checksum };
    invalidateArtifactDependents(current, kind, "artifact-changed");
  }, { kind, invalidationReason: "artifact-changed" });
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
  traceDelta: TraceDelta,
  options: RecordArtifactWithTraceOptions = {},
): Promise<FeatureState> {
  if (!traceArtifactKindList.has(artifactKind)) throw new DevFlowError("INVALID_ARTIFACT", artifactKind);
  let eventData: Record<string, unknown> = { kind: artifactKind };
  return mutatePrepared(root, id, expectedRevision, "artifact-recorded-with-trace", async (current, nextStateRevision) => {
    if (current.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can register artifacts");
    assertManualRegistrationAllowed(current, artifactKind, true);
    const artifact = current.artifacts[artifactKind];
    if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", artifactKind);
    const contents = await readFile(path.join(featureDirectory(root, id), artifact.path), "utf8");
    const artifactSha256 = hash(contents);
    const sourceBlocks = parseTraceSourceBlocks(contents);
    const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
    const currentLedger = await readTraceability(root, current);
    const ledger = applyTraceDelta({
      current: currentLedger,
      route: current.route,
      artifactKind,
      artifactSha256,
      sourceBlocks,
      delta: traceDelta,
      projectConfigSha256,
      verificationCommandIds: config.verification.commands.map((command) => command.id),
      nextStateRevision,
    });
    const pointer = await writeTraceSnapshot(root, ledger, options.snapshot);
    const artifactChanged = artifact.sha256 !== artifactSha256;
    const traceChanged = JSON.stringify(currentLedger.nodes) !== JSON.stringify(ledger.nodes)
      || JSON.stringify(currentLedger.edges) !== JSON.stringify(ledger.edges);
    const reviewPointer = artifactChanged || traceChanged
      ? await prepareReviewInvalidation(root, current, nextStateRevision)
      : undefined;
    eventData = {
      kind: artifactKind,
      artifactChanged,
      traceChanged,
      invalidationReason: artifactChanged ? "artifact-changed" : traceChanged ? "trace-changed" : undefined,
    };
    return {
      mutate: (draft) => {
        draft.artifacts[artifactKind] = { ...artifact, sha256: artifactSha256 };
        draft.traceability = pointer;
        if (reviewPointer) draft.review = reviewPointer;
        if (artifactChanged || traceChanged) {
          invalidateArtifactDependents(draft, artifactKind, artifactChanged ? "artifact-changed" : "trace-changed");
        }
      },
      eventData: () => eventData,
    };
  }, options.mutation);
}
export async function assertArtifactIntegrity(root: string, id: string): Promise<void> {
  const state = await readState(root, id);
  for (const kind of artifactKinds(effectiveRoute(state))) {
    await assertArtifactCurrent(root, id, state, kind);
  }
}
