import readline from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { recordArtifact, recordArtifactWithTrace, scaffoldArtifact } from "../core/artifacts.js";
import { DevFlowError, failureFrom } from "../core/errors.js";
import { featureCheck, finalize, recordStep } from "../core/feature-check.js";
import { presentApproval, resolveApprovalAnswer, resolveApprovalElicitation } from "../core/approval-interactions.js";
import {
  initProject, startFeature, lockClassification, recordDecision, resolveRecordedDecision, abandonFeature, reclassifyFeature, recoverCorruptFeature, readState, readFeatureEvents, mutate, pauseFeature, resumeFeature, reconcileWorkspace,
} from "../core/state-store.js";
import type { FeatureState } from "../core/state-store.js";
import { buildFeatureMutationSummary } from "../core/execution-brief.js";
import { readCompactStatus } from "../core/status-projection.js";
import { inspectFeature, inspectionTopics } from "../core/inspection.js";
import { presentQualityException, resolveQualityExceptionAnswer } from "../core/quality-exceptions.js";
import { rebuildReviewProjection } from "../core/review-projection-rebuild.js";
import { beginImplementationUnit } from "../core/implementation-units.js";
import { checkpointImplementationUnit } from "../core/checkpoints.js";
import { executeRollback, presentRollbackGate, previewRollback, resolveRollbackGateElicitation, resolveRollbackGateAnswer, type RollbackPreview } from "../core/rollback.js";
import { runVerification } from "../core/verification.js";
import { allowedRiskLabels } from "../policy/contract.js";
import { deriveRiskRequirements, recommendClassification, selectRoute } from "../policy/route.js";
import { collectDoctorReport } from "./doctor.js";
import { emitAttention } from "./attention.js";
import { enableWindowsNotifications } from "./windows-notifications.js";
import { validateToolInput } from "./input-validation.js";
import { requestGrillDecision, resolveGrillAnswer, resolveGrillElicitation } from "../core/requirements-grill.js";
import { validateTraceDelta } from "../core/traceability.js";
import { inspectCurrentTrace } from "../core/traceability-gates.js";
import {
  beginReviewSampling,
  claimReviewJob,
  completeReviewSampling,
  createReviewBatch,
  failReviewSampling,
  getReviewJob,
  presentReviewRiskAcceptance,
  releaseReviewJob,
  resolveReviewRiskAcceptanceAnswer,
  submitReviewJob,
} from "../core/review-jobs.js";
import { parseHostAttestation, parseReviewJobCompletion, toPublicReviewJob } from "../policy/review.js";
import {
  getInteraction,
  interactionResponse,
  toPublicInteraction,
  type InteractionResponse,
  type PublicInteraction,
} from "../core/user-interactions.js";
import { matchDecisionReply, pendingDecisionForState, pendingInteractionForDecision } from "../core/decision-interactions.js";
import { resolvePromptEvent } from "../core/interaction-provenance.js";
import { lifecycleLabel, routeLabel, stageLabel } from "../policy/presentation.js";

const root = process.cwd();
// 原生 elicitation 表单在部分 Claude Code 客户端渲染损坏（选项不渲染、模态卡死），
// 默认关闭 form 模式；文本回答统一走 dev_flow_answer。
const formElicitationEnabled = process.env.DEV_FLOW_ELICITATION_FORM === "1";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.basename(moduleDirectory) === "dist" ? path.resolve(moduleDirectory, "..") : path.resolve(moduleDirectory, "../..");
const tools = [
  "dev_flow_init_project", "dev_flow_classify", "dev_flow_start", "dev_flow_lock_classification", "dev_flow_record_decision", "dev_flow_resolve_decision", "dev_flow_status", "dev_flow_inspect",
  "dev_flow_scaffold_artifact", "dev_flow_record_artifact", "dev_flow_record_step", "dev_flow_pause", "dev_flow_resume", "dev_flow_reconcile_workspace",
  "dev_flow_record_artifact_with_trace", "dev_flow_get_traceability", "dev_flow_rebuild_review_projection",
  "dev_flow_create_review_batch", "dev_flow_get_review_job", "dev_flow_claim_review_job", "dev_flow_submit_review_job", "dev_flow_sample_review_job", "dev_flow_release_review_job",
  "dev_flow_present_review_risk_acceptance",
  "dev_flow_present_approval", "dev_flow_present_quality_exception", "dev_flow_answer", "dev_flow_reclassify", "dev_flow_verify",
  "dev_flow_request_grill_decision",
  "dev_flow_feature_check", "dev_flow_finalize", "dev_flow_abandon", "dev_flow_enable_windows_notifications", "dev_flow_doctor",
  "dev_flow_begin_implementation_unit", "dev_flow_checkpoint_implementation_unit", "dev_flow_preview_rollback",
  "dev_flow_present_rollback_gate", "dev_flow_execute_rollback",
  "dev_flow_recover_corrupt_feature",
];

const object = (required: string[], properties: Record<string, unknown> = {}) => ({
  type: "object", required, properties, additionalProperties: false,
});
const string = { type: "string", minLength: 1 };
const integer = { type: "integer", minimum: 0 };
const featureMutation = (extra: Record<string, unknown> = {}, requiredExtras: string[] = []) => object(
  ["featureId", "expectedRevision", ...requiredExtras],
  { featureId: string, expectedRevision: integer, ...extra },
);

const riskLabelsSchema = { type: "array", items: { enum: allowedRiskLabels }, uniqueItems: true };
const classificationSignalsSchema = object(["impactScope", "sharedContract", "independentChains", "coordinatedRollback", "requirements", "formalControls"], {
  impactScope: { enum: ["single-location", "single-module", "cross-module"] },
  sharedContract: { type: "boolean" },
  independentChains: { type: "integer", minimum: 1 },
  coordinatedRollback: { type: "boolean" },
  requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
  formalControls: { type: "array", items: { enum: ["trace", "independent-review", "multiple-rollback-units"] }, uniqueItems: true },
});
const classificationBasisSchema = object(["scopeFacts", "topologyFacts", "uncertaintyFacts", "riskFacts", "decisionRefs"], {
  scopeFacts: { type: "array", items: string },
  topologyFacts: { type: "array", items: string },
  uncertaintyFacts: { type: "array", items: string },
  riskFacts: { type: "object", propertyNames: { enum: allowedRiskLabels }, additionalProperties: { type: "array", items: string } },
  decisionRefs: { type: "array", items: string },
  signals: classificationSignalsSchema,
});
const recommendedClassificationBasisSchema = object(["scopeFacts", "topologyFacts", "uncertaintyFacts", "riskFacts", "decisionRefs", "signals"], {
  ...classificationBasisSchema.properties,
});
const flatClassificationBasisProperties = {
  scopeFacts: classificationBasisSchema.properties.scopeFacts,
  topologyFacts: classificationBasisSchema.properties.topologyFacts,
  uncertaintyFacts: classificationBasisSchema.properties.uncertaintyFacts,
  riskFacts: classificationBasisSchema.properties.riskFacts,
  decisionRefs: classificationBasisSchema.properties.decisionRefs,
};
const classificationInputSchema = object(["level", "topology"], {
  level: { enum: ["XS", "S", "M", "L"] },
  topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
  execution: { enum: ["light", "standard"] },
  requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
  riskLabels: riskLabelsSchema,
  classificationBasis: classificationBasisSchema,
  ...flatClassificationBasisProperties,
  acceptanceAssistSuggested: { type: "boolean" },
});
const traceArtifactKinds = ["requirements", "implementation-plan", "coverage-matrix", "rollback-units"] as const;
const traceId = (prefix: string) => ({ type: "string", pattern: `^${prefix}-[0-9]{3,}$` });
const stringArray = { type: "array", minItems: 1, items: string };
const relativeCwd = { type: "string", minLength: 1, pattern: "^(?!/)(?![A-Za-z]:)(?!.*(?:^|/)\\.\\.(?:/|$)).*$" };
const inlineVerificationCommand = object(["command"], {
  command: string,
  args: { type: "array", items: string },
  cwd: relativeCwd,
});
const verificationCommandRef = { oneOf: [string, inlineVerificationCommand] };
const verificationCommandArray = { type: "array", minItems: 1, uniqueItems: true, items: verificationCommandRef };
const traceNodeSchemas = [
  object(["kind", "id"], { kind: { const: "requirement" }, id: traceId("REQ") }),
  object(["kind", "id", "parentRequirement"], { kind: { const: "acceptance-criterion" }, id: traceId("AC"), parentRequirement: traceId("REQ") }),
  object(["kind", "id", "covers", "rollbackUnit"], { kind: { const: "task" }, id: traceId("TASK"), covers: stringArray, rollbackUnit: traceId("RU") }),
  object(["kind", "id", "verifies"], { kind: { const: "test" }, id: traceId("TEST"), verifies: { type: "array", minItems: 1, items: traceId("AC") } }),
  object(["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification", "rollbackVerification"], {
    kind: { const: "rollback" }, id: traceId("RU"), tasks: { type: "array", minItems: 1, items: traceId("TASK") },
    dependsOn: { type: "array", items: traceId("RU") }, fileScope: stringArray, covers: stringArray,
    forwardVerification: verificationCommandArray, rollbackVerification: verificationCommandArray,
  }),
];
const traceDeltaSchema = object(["nodes"], {
  nodes: { type: "array", items: { oneOf: traceNodeSchemas } },
});
const reviewEvidenceSchema = object(["path"], { path: string, line: { type: "integer", minimum: 1 } });
const reviewFindingSchema = object(["severity", "category", "targets", "evidence", "claim", "recommendation"], {
  severity: { enum: ["blocking", "warning", "note"] },
  category: { enum: ["requirements-coverage", "architecture-testability", "rollback-operability", "security", "data-irreversibility"] },
  targets: { type: "array", minItems: 1, items: string },
  evidence: { type: "array", minItems: 1, items: reviewEvidenceSchema },
  claim: string,
  recommendation: string,
});
const reviewResolutionSchema = object(["findingId", "evidence", "note"], {
  findingId: string,
  evidence: { type: "array", minItems: 1, items: reviewEvidenceSchema },
  note: string,
});
const reviewCompletionSchema = object(["coverageSummary", "findings"], {
  coverageSummary: string,
  findings: { type: "array", items: reviewFindingSchema },
  resolutions: { type: "array", items: reviewResolutionSchema },
});
const reviewAttestationSchema = object(["host", "agentId", "issuedAt", "raw"], {
  host: { enum: ["claude", "codex"] },
  agentId: string,
  issuedAt: string,
  raw: string,
});

const scopeSchema = {
  type: "object",
  required: ["inScope", "outOfScope"],
  additionalProperties: false,
  properties: {
    inScope: { type: "array", items: { type: "string" } },
    outOfScope: { type: "array", items: { type: "string" } },
  },
};

const manualAcceptanceScenarioSchema = {
  type: "array",
  minItems: 1,
  items: object(["name", "evidence"], { name: string, evidence: string }),
};
const manualAcceptanceSchema = { oneOf: [
  object(["mode", "source", "scenarios"], {
    mode: { enum: ["browser", "code-path-audit"] },
    source: string,
    scenarios: manualAcceptanceScenarioSchema,
  }),
   object(["mode", "source", "userReply", "scenarios"], {
     mode: { const: "user-signoff" },
     source: string,
     userReply: string,
    scenarios: manualAcceptanceScenarioSchema,
  }),
] };

const interactionOptionSchema = object(["id", "label"], {
  id: string,
  label: string,
  description: string,
  requiresComment: { type: "boolean" },
});

const toolSchemas: Record<string, { description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean> }> = {
  dev_flow_init_project: { description: "Create strict project configuration.", inputSchema: object(["config"], { config: { type: "object" } }) },
  dev_flow_classify: {
    description: "Pure route classification (read-only preview).",
    inputSchema: object([], {
      classificationBasis: recommendedClassificationBasisSchema,
      level: { enum: ["XS", "S", "M", "L"] },
      topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
      execution: { enum: ["light", "standard"] },
      requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
      riskLabels: riskLabelsSchema,
      acceptanceAssistSuggested: { type: "boolean", description: "Offer optional browser/user acceptance help; never blocks the route." },
      manualAcceptanceRequired: { type: "boolean" },
    }),
    annotations: { readOnlyHint: true },
  },
  dev_flow_start: {
    description: "Create an unclassified intake feature.",
    inputSchema: object(["featureId", "objective", "host"], {
      objective: string,
      featureId: string,
      activation: { enum: ["active", "paused"] },
      scope: scopeSchema,
      host: { enum: ["claude", "codex"] },
    }),
  },
  dev_flow_lock_classification: {
    description: "Atomically lock a classification after intake decisions are resolved.",
    inputSchema: featureMutation({ classification: classificationInputSchema }, ["classification"]),
  },
  dev_flow_record_decision: {
    description: "Record one unresolved user-owned decision in the shared ledger. Returns the decisionId, which you can feed back into dev_flow_lock_classification decisionRefs. Conflict-tolerant: on a stale expectedRevision it re-reads and retries once internally, so parallel calls are safe.",
    inputSchema: featureMutation({ question: string, factRefs: { type: "array", items: string }, host: { enum: ["claude", "codex"] } }, ["question", "host"]),
  },
  dev_flow_resolve_decision: {
    description: "Resolve one decision with normalized user evidence and conclusion.",
    inputSchema: featureMutation({ decisionId: string, evidence: string, conclusion: string, host: { enum: ["claude", "codex"] } }, ["decisionId", "evidence", "conclusion", "host"]),
  },
  dev_flow_status: { description: "Read the compact daily status of one feature.", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_inspect: { description: "Read one detailed topic; full state is never exposed through a single public response.", inputSchema: object(["featureId", "topic"], { featureId: string, topic: { enum: inspectionTopics } }), annotations: { readOnlyHint: true } },
  dev_flow_scaffold_artifact: { description: "Create only the current route artifact. For editable artifacts, read the registered path before editing, then record it. Generated status artifacts are read-only: scaffold them and continue with the requested step; do not edit or record them.", inputSchema: featureMutation({ kind: string }, ["kind"]) },
  dev_flow_record_artifact: { description: "Register an edited route artifact.", inputSchema: featureMutation({ kind: string }, ["kind"]) },
  dev_flow_record_artifact_with_trace: {
    description: "Atomically register one Trace source artifact and its complete Trace delta.",
    inputSchema: featureMutation({ kind: { enum: traceArtifactKinds }, traceDelta: traceDeltaSchema }, ["kind", "traceDelta"]),
  },
  dev_flow_get_traceability: {
    description: "Read the current Trace pointer, ledger, effective summary, and current-step blockers.",
    inputSchema: object(["featureId"], { featureId: string }),
    annotations: { readOnlyHint: true },
  },
  dev_flow_rebuild_review_projection: { description: "Rebuild only the generated review projection from the immutable ledger.", inputSchema: featureMutation(), },
  dev_flow_create_review_batch: {
    description: "Create or return the Core-derived immutable review batch for the current basis.",
    inputSchema: featureMutation(),
  },
  dev_flow_get_review_job: {
    description: "Read only the claimed job's immutable package. A job capability never reveals sibling jobs.",
    inputSchema: object(["featureId", "batchId", "jobId", "capability"], { featureId: string, batchId: string, jobId: string, capability: string }),
    annotations: { readOnlyHint: true },
  },
  dev_flow_claim_review_job: {
    description: "Claim one current review job using a high-entropy retry key; returns the job capability.",
    inputSchema: featureMutation({ batchId: string, jobId: string, claimRequestId: string }, ["batchId", "jobId", "claimRequestId"]),
  },
  dev_flow_release_review_job: {
    description: "Release the current review job claim back to pending using the same capability; expired claims remain releasable by their holder.",
    inputSchema: featureMutation({ batchId: string, jobId: string, capability: string }, ["batchId", "jobId", "capability"]),
  },
  dev_flow_submit_review_job: {
    description: "Submit one claimed job's structured completion. Optional host attestation can raise multi-agent-attested only; Core still owns assurance.",
    inputSchema: featureMutation({
      batchId: string,
      jobId: string,
      capability: string,
      completion: reviewCompletionSchema,
      attestation: reviewAttestationSchema,
    }, ["batchId", "jobId", "capability", "completion"]),
  },
  dev_flow_sample_review_job: {
    description: "Ask a sampling-capable MCP client to complete one pending review job. The server owns the one-use request and submits only a validated response.",
    inputSchema: object(["featureId", "expectedRevision", "batchId", "jobId"], {
      featureId: string,
      expectedRevision: integer,
      batchId: string,
      jobId: string,
    }),
  },
  dev_flow_present_review_risk_acceptance: {
    description: "Present a one-time user decision for an exact set of current blocking review findings.",
    inputSchema: featureMutation({ findingIds: { type: "array", minItems: 1, uniqueItems: true, items: string } }, ["findingIds"]),
  },
  dev_flow_answer: {
    description: "Answer the one current user decision in plain Chinese; Core resolves its kind and trusted host provenance.",
    inputSchema: featureMutation({ userReply: string, host: { enum: ["claude", "codex"] } }, ["userReply", "host"]),
  },
  dev_flow_present_quality_exception: {
    description: "Present one workflow-quality risk for an explicit user decision; integrity failures cannot use this path.",
    inputSchema: featureMutation({ kind: { enum: ["review", "verification", "checkpoint", "implementation-evidence"] }, basisHash: string, fingerprint: string, riskSummary: string, host: { enum: ["claude", "codex"] } }, ["kind", "basisHash", "fingerprint", "riskSummary", "host"]),
  },
  dev_flow_record_step: { description: "Record the current non-gate route step.", inputSchema: featureMutation({ step: string, evidence: {} }, ["step", "evidence"]) },
  dev_flow_pause: { description: "Pause an active feature without requiring commit, verification, or finalize.", inputSchema: featureMutation({ reason: string, host: { enum: ["claude", "codex"] } }, ["reason", "host"]) },
  dev_flow_resume: { description: "Resume a paused feature after automatic workspace reconciliation.", inputSchema: object(["featureId", "host"], { featureId: string, host: { enum: ["claude", "codex"] } }) },
  dev_flow_reconcile_workspace: { description: "Reconcile manual commits and workspace changes without asking for already-authorized commit permission.", inputSchema: featureMutation({ host: { enum: ["claude", "codex"] } }, ["host"]) },
  dev_flow_begin_implementation_unit: {
    description: "Begin the next rollback unit of a checkpoints:1 feature; Core derives basis, scope, and dependency order.",
    inputSchema: object(["featureId", "expectedRevision", "unitId"], { featureId: string, expectedRevision: integer, unitId: traceId("RU") }),
  },
  dev_flow_checkpoint_implementation_unit: {
    description: "Confirm the active rollback unit: scope-checked diff, forward verification, content-addressed checkpoint.",
    inputSchema: object(["featureId", "expectedRevision", "unitId"], { featureId: string, expectedRevision: integer, unitId: traceId("RU") }),
  },
  dev_flow_preview_rollback: {
    description: "Read-only rollback plan for a confirmed checkpoint: undo order, restored files, verification commands.",
    inputSchema: object(["featureId", "targetCheckpointId"], { featureId: string, targetCheckpointId: string }),
    annotations: { readOnlyHint: true },
  },
  dev_flow_present_rollback_gate: {
    description: "Present a rollback confirmation gate for a confirmed checkpoint. Requires checkpoints:1 and rollbackExecution:1.",
    inputSchema: object(["featureId", "expectedRevision", "targetCheckpointId", "host"], { featureId: string, expectedRevision: integer, targetCheckpointId: string, host: { enum: ["claude", "codex"] } }),
  },
  dev_flow_execute_rollback: {
    description: "Execute a confirmed rollback as a resumable file transaction. Rolls back to the target checkpoint, undoing all later units in reverse order.",
    inputSchema: object(["featureId", "expectedRevision", "targetCheckpointId"], { featureId: string, expectedRevision: integer, targetCheckpointId: string }),
  },
  dev_flow_present_approval: { description: "Present one Core-derived approval obligation.", inputSchema: featureMutation({ approvalId: string, host: { enum: ["claude", "codex"] } }, ["approvalId", "host"]) },
  dev_flow_request_grill_decision: {
    description: "Present the current grill question as structured choices when the host supports MCP elicitation, otherwise return one-time text replies.",
    inputSchema: featureMutation({
      questionId: string,
      question: string,
      options: { type: "array", minItems: 2, maxItems: 3, items: interactionOptionSchema },
      host: { enum: ["claude", "codex"] },
    }, ["questionId", "question", "options", "host"]),
  },
  dev_flow_reclassify: {
    description: "Reclassify route (stricter always; same-level standard→light with userEvidence before implementation).",
    inputSchema: featureMutation({ classification: classificationInputSchema, reason: string, userEvidence: string }, ["classification", "reason"]),
  },
  dev_flow_verify: {
    description: "Run only configured verification commands and optionally record manual acceptance.",
    inputSchema: featureMutation({
      commandIds: { type: "array", items: string },
      host: { enum: ["claude", "codex"] },
      manualAcceptance: manualAcceptanceSchema,
    }, ["host"]),
  },
  dev_flow_feature_check: { description: "Check route completeness and fresh evidence.", inputSchema: featureMutation() },
  dev_flow_finalize: { description: "Set logic-complete after all obligations pass.", inputSchema: featureMutation() },
  dev_flow_abandon: { description: "Terminally abandon a non-finalized feature.", inputSchema: featureMutation({ reason: string, userEvidence: string }, ["reason", "userEvidence"]) },
  dev_flow_enable_windows_notifications: {
    description: "Explicitly enable per-user Windows Toast notifications for Dev Flow. Does not change feature state.",
    inputSchema: object([]),
  },
  dev_flow_doctor: { description: "Diagnose plugin and project wiring.", inputSchema: object([]), annotations: { readOnlyHint: true } },
  dev_flow_recover_corrupt_feature: {
    description: "Backup and abandon a corrupt active feature, or resume its doctor-reported recovery journal.",
    inputSchema: object(
      ["featureId", "stateSha256", "action", "reason", "userEvidence", "host"],
      {
        featureId: string,
        stateSha256: string,
        activeSha256: string,
        action: { enum: ["abandon"] },
        reason: string,
        userEvidence: string,
        host: { enum: ["claude", "codex"] },
      },
    ),
  },
};

/** Protocol-level JSON-RPC result (initialize, tools/list, …). */
function protocolResult(id: unknown, value: unknown) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: value })}\n`);
}

/** tools/call result: MCP CallToolResult shape. */
function toolResult(id: unknown, value: unknown) {
  const view = value && typeof value === "object" && !Array.isArray(value)
    ? value as { contentView?: unknown; structuredContentView?: unknown }
    : {};
  const contentValue = view.contentView === undefined ? value : view.contentView;
  const structuredValue = view.structuredContentView === undefined ? value : view.structuredContentView;
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(contentValue) }],
      structuredContent: structuredValue,
    },
  })}\n`);
}

const readOnlyResponseTools = new Set([
  "dev_flow_init_project",
  "dev_flow_classify",
  "dev_flow_status",
  "dev_flow_inspect",
  "dev_flow_get_traceability",
  "dev_flow_get_review_job",
  "dev_flow_preview_rollback",
  "dev_flow_enable_windows_notifications",
  "dev_flow_doctor",
]);

function isFeatureState(value: unknown): value is FeatureState {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as { schemaVersion?: unknown }).schemaVersion === 3
    && typeof (value as { featureId?: unknown }).featureId === "string"
    && typeof (value as { revision?: unknown }).revision === "number"
    && typeof (value as { mode?: unknown }).mode === "string");
}

/** Apply the compact contract only to mutation responses; read-only views stay full. */
function compactMutationResult(toolName: string, value: unknown): unknown {
  if (readOnlyResponseTools.has(toolName)) return value;
  const mutationContent = (summary: ReturnType<typeof buildFeatureMutationSummary>, interaction?: PublicInteraction) => ({
    状态: lifecycleLabel(summary.lifecycle),
    ...(summary.route ? { 路线: routeLabel(summary.route) } : {}),
    当前阶段: stageLabel(summary.stage),
    下一步: summary.logicComplete ? "当前任务已完成。" : "按当前状态继续下一步。",
    需要用户决定: summary.counters.openInteractions > 0,
    健康状态: summary.counters.blockingFindings > 0 ? "需要处理" : "正常",
    ...(interaction?.status === "pending" ? {
      需要用户决定: true,
      当前问题: interaction.question ?? "请回答当前问题。",
      选项: interaction.options.map((option) => option.label),
    } : {}),
  });
  if (isFeatureState(value)) {
    const summary = buildFeatureMutationSummary(value);
    return { contentView: mutationContent(summary), structuredContentView: { ...summary, state: summary, control: { featureId: summary.featureId, expectedRevision: summary.revision, stage: summary.stage, lifecycle: summary.lifecycle } } };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (isFeatureState(record.state)) {
    const summary = buildFeatureMutationSummary(record.state);
    const content = mutationContent(summary, record.interaction as PublicInteraction | undefined);
    return { contentView: record.decisionId ? { 决策ID: record.decisionId, ...content } : content, structuredContentView: { ...record, ...summary, state: summary, control: { featureId: summary.featureId, expectedRevision: summary.revision, stage: summary.stage, lifecycle: summary.lifecycle } } };
  }
  return value;
}

function failure(id: unknown, error: unknown) {
  const value = failureFrom(error);
  const content = JSON.stringify({
    状态: "未完成",
    原因: value.cause,
    提示: value.userMessage,
    影响: value.impact,
    恢复动作: value.recovery.instruction,
  });
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      isError: true,
      content: [{ type: "text", text: content }],
      structuredContent: value,
    },
  })}\n`);
}

function protocolFailure(id: unknown, error: unknown): void {
  const value = failureFrom(error);
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: value.userMessage, data: value } })}\n`);
}

function emitAttentionNotification(event: Parameters<typeof emitAttention>[0]): void {
  void emitAttention(event, {
    emit: (message) => process.stdout.write(`${JSON.stringify(message)}\n`),
  });
}

function assertExactToolInput(value: unknown, keys: string[], tool: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value as Record<string, unknown>).some((key) => !keys.includes(key))
    || keys.some((key) => !(key in (value as Record<string, unknown>)))) {
    throw new DevFlowError("INVALID_TOOL_INPUT", `${tool} input does not match its schema`);
  }
}

function assertTraceRegistrationInput(value: unknown): asserts value is {
  featureId: string; expectedRevision: number; kind: typeof traceArtifactKinds[number]; traceDelta: unknown;
} {
  assertExactToolInput(value, ["featureId", "expectedRevision", "kind", "traceDelta"], "dev_flow_record_artifact_with_trace");
  const input = value as { featureId: unknown; expectedRevision: unknown; kind: unknown; traceDelta: unknown };
  if (typeof input.featureId !== "string" || !input.featureId
    || typeof input.expectedRevision !== "number" || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0
    || !traceArtifactKinds.includes(input.kind as typeof traceArtifactKinds[number])) {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_record_artifact_with_trace input does not match its schema");
  }
  validateTraceDelta(input.traceDelta);
}

function assertTraceReadInput(value: unknown): asserts value is { featureId: string } {
  assertExactToolInput(value, ["featureId"], "dev_flow_get_traceability");
  if (typeof value.featureId !== "string" || !value.featureId) {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_get_traceability input does not match its schema");
  }
}

function assertReviewMutationInput(
  value: unknown,
  tool: string,
  stringExtras: string[],
  otherExtras: string[] = [],
): asserts value is Record<string, unknown> & { featureId: string; expectedRevision: number } {
  assertExactToolInput(value, ["featureId", "expectedRevision", ...stringExtras, ...otherExtras], tool);
  if (typeof value.featureId !== "string" || !value.featureId
    || typeof value.expectedRevision !== "number" || !Number.isInteger(value.expectedRevision) || value.expectedRevision < 0
    || stringExtras.some((key) => typeof value[key] !== "string" || !(value[key] as string))) {
    throw new DevFlowError("INVALID_TOOL_INPUT", `${tool} input does not match its schema`);
  }
}

function assertReviewGetInput(value: unknown): asserts value is { featureId: string; batchId: string; jobId: string; capability: string } {
  assertExactToolInput(value, ["featureId", "batchId", "jobId", "capability"], "dev_flow_get_review_job");
  if (typeof value.featureId !== "string" || !value.featureId || typeof value.batchId !== "string" || !value.batchId
    || typeof value.jobId !== "string" || !value.jobId || typeof value.capability !== "string" || !value.capability) {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_get_review_job input does not match its schema");
  }
}

function assertReviewSubmitInput(value: unknown): asserts value is Record<string, unknown> & {
  featureId: string; expectedRevision: number; batchId: string; jobId: string; capability: string; completion: unknown; attestation?: unknown;
} {
  const extras = ["completion", ...(value && typeof value === "object" && !Array.isArray(value) && "attestation" in value ? ["attestation"] : [])];
  assertReviewMutationInput(value, "dev_flow_submit_review_job", ["batchId", "jobId", "capability"], extras);
  try { parseReviewJobCompletion(value.completion); }
  catch (error) {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_submit_review_job input does not match its schema", {
      mutationApplied: false,
      ...(error instanceof Error ? { cause: error.message } : {}),
    });
  }
  if (value.attestation !== undefined) {
    try { parseHostAttestation(value.attestation); }
    catch (error) {
      throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_submit_review_job attestation does not match its schema", {
        mutationApplied: false,
        ...(error instanceof Error ? { cause: error.message } : {}),
      });
    }
  }
}

function assertReviewSamplingInput(value: unknown): asserts value is Record<string, unknown> & {
  featureId: string; expectedRevision: number; batchId: string; jobId: string;
} {
  assertReviewMutationInput(value, "dev_flow_sample_review_job", ["batchId", "jobId"]);
}

const ROLLBACK_UNIT_ID = /^RU-[0-9]{3,}$/;

function assertUnitMutationInput(value: unknown, tool: string): asserts value is Record<string, unknown> & {
  featureId: string; expectedRevision: number; unitId: string;
} {
  assertReviewMutationInput(value, tool, ["unitId"]);
  if (typeof value.unitId !== "string" || !ROLLBACK_UNIT_ID.test(value.unitId)) {
    throw new DevFlowError("INVALID_TOOL_INPUT", `${tool} input does not match its schema`);
  }
}

function assertPreviewRollbackInput(value: unknown): asserts value is { featureId: string; targetCheckpointId: string } {
  assertExactToolInput(value, ["featureId", "targetCheckpointId"], "dev_flow_preview_rollback");
  if (typeof value.featureId !== "string" || !value.featureId
    || typeof value.targetCheckpointId !== "string" || !value.targetCheckpointId) {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_preview_rollback input does not match its schema");
  }
}

function assertRollbackMutationInput(value: unknown, tool: string, includeHost = false): asserts value is Record<string, unknown> & {
  featureId: string; expectedRevision: number; targetCheckpointId: string;
} {
  assertReviewMutationInput(value, tool, ["targetCheckpointId"], includeHost ? ["host"] : []);
  if (typeof value.targetCheckpointId !== "string" || !value.targetCheckpointId) {
    throw new DevFlowError("INVALID_TOOL_INPUT", `${tool} input does not match its schema`);
  }
}

type ElicitationResult = { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };
type ElicitationSelection = { action: string; comment?: string };

/** A consistent result shape for every native or text interaction operation. */
function interactionEnvelope(
  state: FeatureState,
  interaction: PublicInteraction,
  interactionOutcome: string,
  response?: InteractionResponse,
) {
  const optionLabel = interaction.options.find((option) => option.id === interactionOutcome)?.label;
  return {
    state,
    interaction,
    interactionOutcome: optionLabel ?? interactionOutcome,
    ...(response ? { response: { action: optionLabel ?? response.action, ...(response.comment ? { comment: response.comment } : {}) } } : {}),
  };
}

/** Rollback confirmations expose the exact preview that their basis hash commits to. */
function rollbackGateMessage(preview: RollbackPreview): string {
  const files = preview.filePlan.map((action) => `${action.action === "restore" ? "恢复" : "删除"} ${action.path}`);
  const verification = preview.verificationCommands.map((command) => command.command);
  return [
    `回撤目标：该实现单元最近一次保存点。`,
    `将撤销 ${preview.undoOrder.length} 个实现单元（按提交顺序倒序）。`,
    `文件影响（${files.length}）：${files.length ? files.join("；") : "无"}。`,
    `回撤验证：${verification.length ? verification.join("；") : "无"}。`,
    "确认执行回撤？",
  ].join("\n");
}

/** A submitter may inspect its own accepted payload, never sibling review output. */
function reviewSubmissionEnvelope(
  result: Awaited<ReturnType<typeof submitReviewJob>>,
  submittedJobId: string,
) {
  const job = result.batch.jobs.find((candidate) => candidate.jobId === submittedJobId);
  if (!job) throw new DevFlowError("REVIEW_INTEGRITY_FAILED", "submitted review job is missing from its batch", { submittedJobId });
   const publicJob = toPublicReviewJob(job);
  return {
    state: result.state,
    idempotent: result.idempotent,
    job: publicJob,
    batch: {
      batchId: result.batch.batchId,
      basisHash: result.batch.basisHash,
      validity: result.batch.validity,
      progress: result.batch.progress,
      assuranceLevel: result.batch.assuranceLevel,
      executionMode: result.batch.executionMode,
      jobs: result.batch.jobs.map(({ jobId, role, reviewDepth, status }) => ({ jobId, role, reviewDepth, status })),
    },
  };
}

const classificationBasisKeys = ["scopeFacts", "topologyFacts", "uncertaintyFacts", "riskFacts", "decisionRefs"] as const;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function normalizeLockClassification(value: Record<string, unknown>): Record<string, unknown> {
  const nested = value.classificationBasis;
  const nestedBasis = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : undefined;
  const flatBasis = Object.fromEntries(classificationBasisKeys
    .filter((key) => Object.hasOwn(value, key))
    .map((key) => [key, value[key]]));
  if (nestedBasis && Object.keys(flatBasis).length) {
    const conflicts = classificationBasisKeys.filter((key) => Object.hasOwn(flatBasis, key)
      && stableJson(flatBasis[key]) !== stableJson(nestedBasis[key]))
      .map((key) => ({
        path: `$.classification.classificationBasis.${key}`,
        nestedValue: nestedBasis[key],
        flatValue: flatBasis[key],
      }));
    if (conflicts.length) {
      throw new DevFlowError("CLASSIFICATION_BASIS_CONFLICT", "nested and flat classification basis fields disagree", { conflicts });
    }
  }
  const basis = nestedBasis ?? flatBasis;
  return {
    ...value,
    ...basis,
    ...(Object.keys(basis).length ? { classificationBasis: basis } : {}),
  };
}

class McpConnection {
  private supportsFormElicitation = false;
  private supportsSampling = false;
  private nextClientRequestId = 0;
  private readonly pending = new Map<string, {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timeout?: ReturnType<typeof setTimeout>;
  }>();

  configure(capabilities: unknown): void {
    this.supportsFormElicitation = false;
    this.supportsSampling = false;
    if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return;
    const sampling = (capabilities as { sampling?: unknown }).sampling;
    this.supportsSampling = !!sampling && typeof sampling === "object" && !Array.isArray(sampling);
    const elicitation = (capabilities as { elicitation?: unknown }).elicitation;
    if (!elicitation || typeof elicitation !== "object" || Array.isArray(elicitation)) return;
    const modes = elicitation as Record<string, unknown>;
    this.supportsFormElicitation = formElicitationEnabled && (Object.keys(modes).length === 0 || modes.form !== undefined);
  }

  consumeResponse(message: { id?: unknown; method?: unknown; result?: unknown; error?: unknown }): boolean {
    if (typeof message.id !== "string" || message.method !== undefined) return false;
    const pending = this.pending.get(message.id);
    if (!pending) return false;
    this.pending.delete(message.id);
    if (pending.timeout) clearTimeout(pending.timeout);
    if (message.error !== undefined) {
      pending.reject(new Error(`client request failed: ${JSON.stringify(message.error)}`));
    } else {
      pending.resolve(message.result);
    }
    return true;
  }

  close(): void {
    for (const { reject, timeout } of this.pending.values()) {
      if (timeout) clearTimeout(timeout);
      reject(new Error("MCP client stream closed while awaiting a client request"));
    }
    this.pending.clear();
  }

  assertSamplingSupported(): void {
    if (!this.supportsSampling) {
      throw new DevFlowError("REVIEW_SAMPLING_UNSUPPORTED", "MCP client did not advertise sampling/createMessage capability");
    }
  }

  private request(method: string, params: unknown, timeoutMilliseconds?: number): Promise<unknown> {
    const id = `dev-flow-${++this.nextClientRequestId}`;
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const pending: { resolve(value: unknown): void; reject(error: Error): void; timeout?: ReturnType<typeof setTimeout> } = { resolve, reject };
      if (timeoutMilliseconds !== undefined) {
        pending.timeout = setTimeout(() => {
          if (this.pending.delete(id)) {
            reject(new DevFlowError("REVIEW_SAMPLING_TIMEOUT", "MCP sampling/createMessage did not return before its lease expired"));
          }
        }, timeoutMilliseconds);
      }
      this.pending.set(id, pending);
    });
  }

  async sampleReview(job: { role: string; reviewDepth: string; package: unknown }): Promise<unknown> {
    this.assertSamplingSupported();
    const response = await this.request("sampling/createMessage", {
      messages: [{
        role: "user",
        content: JSON.stringify({
          instruction: "Return exactly one JSON review completion with coverageSummary, findings, and optional resolutions. Do not include prose outside the JSON object.",
          role: job.role,
          reviewDepth: job.reviewDepth,
          package: job.package,
        }),
      }],
    }, 120_000);
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw new DevFlowError("REVIEW_SAMPLING_RESPONSE_INVALID", "sampling/createMessage returned an invalid response");
    }
    const content = (response as { content?: unknown }).content;
    const items = Array.isArray(content) ? content : [content];
    if (items.length !== 1 || !items[0] || typeof items[0] !== "object" || Array.isArray(items[0])
      || (items[0] as { type?: unknown }).type !== "text" || typeof (items[0] as { text?: unknown }).text !== "string") {
      throw new DevFlowError("REVIEW_SAMPLING_RESPONSE_INVALID", "sampling/createMessage must return one text JSON completion");
    }
    try { return JSON.parse((items[0] as { text: string }).text); }
    catch { throw new DevFlowError("REVIEW_SAMPLING_RESPONSE_INVALID", "sampling/createMessage text must be valid JSON"); }
  }

  async elicit(interaction: PublicInteraction, message: string): Promise<ElicitationSelection | undefined> {
    if (!this.supportsFormElicitation) return undefined;
    let raw: unknown;
    try {
      raw = await this.request("elicitation/create", {
        mode: "form",
        message,
        requestedSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              title: "操作",
              description: "选择确认、提出修改意见，或当前问题的一个选项",
              enum: interaction.options.map((option) => option.id),
              enumNames: interaction.options.map((option) => option.label),
            },
            comment: {
              type: "string",
              title: "修改意见 / 补充说明",
              description: "选择“提出修改意见”或“其他”时必填",
            },
          },
          required: ["action"],
        },
      });
    } catch {
      return undefined;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const result = raw as ElicitationResult;
    if (result.action !== "accept" || !result.content || typeof result.content.action !== "string") return undefined;
    const comment = typeof result.content.comment === "string" ? result.content.comment : undefined;
    return { action: result.content.action, ...(comment ? { comment } : {}) };
  }
}

function samplingFailureCode(error: unknown): "client-error" | "timeout" | "invalid-response" | "validation-failed" {
  if (error instanceof DevFlowError) {
    if (error.code === "REVIEW_SAMPLING_TIMEOUT" || error.code === "REVIEW_SAMPLING_REQUEST_EXPIRED") return "timeout";
    if (error.code === "REVIEW_SAMPLING_RESPONSE_INVALID") return "invalid-response";
  }
  if (error instanceof Error && (/^client request failed:/.test(error.message) || /^MCP client stream closed/.test(error.message))) {
    return "client-error";
  }
  return "validation-failed";
}

async function call(name: string, a: any, connection: McpConnection) {
  switch (name) {
    case "dev_flow_init_project": {
      await initProject(root, a.config);
      return { 状态: "已初始化", 配置路径: path.join(root, ".dev-flow", "project.json"), 下一步: "调用 dev_flow_start 开始一个需求。" };
    }
    case "dev_flow_classify": {
      if (!a.classificationBasis && (a.level === undefined || a.topology === undefined)) {
        throw new DevFlowError("CLASSIFICATION_ARGS_INVALID", "classify requires classificationBasis or level+topology", {
          userMessage: "分类预览参数不足。",
          cause: "需提供 classificationBasis（推荐模式）或 level+topology。",
          impact: "无法生成分类预览。",
          recoveryKind: "retry",
          recoveryInstruction: "补齐 classificationBasis 或 level+topology 后重试 dev_flow_classify。",
          retryOriginal: true,
          requiresUserDecision: false,
        });
      }
      if (a.classificationBasis?.signals) {
        const preview = recommendClassification(a.classificationBasis);
        return preview.readyToLock
          ? { ...preview, riskRequirements: deriveRiskRequirements(preview.classification.riskLabels) }
          : preview;
      }
      const selected = selectRoute(a);
      return {
        ...selected,
        riskRequirements: deriveRiskRequirements(selected.classification.riskLabels),
      };
    }
    case "dev_flow_start": return startFeature(root, { ...a, host: a.host });
    case "dev_flow_lock_classification": {
      const classification = normalizeLockClassification(a.classification as Record<string, unknown>);
      const { level, topology, execution, requirements, riskLabels, acceptanceAssistSuggested, scopeFacts, topologyFacts, uncertaintyFacts, riskFacts, decisionRefs } = classification;
      return lockClassification(root, a.featureId, a.expectedRevision, {
        level, topology, ...(execution ? { execution } : {}), ...(requirements ? { requirements } : {}),
        ...(riskLabels ? { riskLabels } : {}), ...(acceptanceAssistSuggested !== undefined ? { acceptanceAssistSuggested } : {}),
        scopeFacts, topologyFacts, uncertaintyFacts, riskFacts, decisionRefs,
        classificationBasis: classification.classificationBasis,
      } as any);
    }
    case "dev_flow_status": return readCompactStatus(root, a.featureId);
    case "dev_flow_inspect": return inspectFeature(root, a.featureId, a.topic);
    case "dev_flow_scaffold_artifact": return scaffoldArtifact(root, a.featureId, a.expectedRevision, a.kind);
    case "dev_flow_record_artifact": return recordArtifact(root, a.featureId, a.expectedRevision, a.kind);
    case "dev_flow_record_artifact_with_trace": {
      assertTraceRegistrationInput(a);
      const input = a as { featureId: string; expectedRevision: number; kind: typeof traceArtifactKinds[number]; traceDelta: import("../policy/traceability.js").TraceDelta };
      return recordArtifactWithTrace(root, input.featureId, input.expectedRevision, input.kind, input.traceDelta);
    }
    case "dev_flow_get_traceability": {
      assertTraceReadInput(a);
      const state = await readState(root, a.featureId);
      const inspection = await inspectCurrentTrace(root, state);
      return {
        pointer: state.traceability,
        ...(inspection.ledger ? { ledger: inspection.ledger } : {}),
        ...(inspection.effectiveSummary ? { effectiveSummary: inspection.effectiveSummary } : {}),
        blockers: inspection.blocker ? [inspection.blocker] : [],
      };
    }
    case "dev_flow_rebuild_review_projection": return rebuildReviewProjection(root, a.featureId, a.expectedRevision);
    case "dev_flow_create_review_batch": {
      assertReviewMutationInput(a, "dev_flow_create_review_batch", []);
      return createReviewBatch(root, a.featureId, a.expectedRevision);
    }
    case "dev_flow_get_review_job": {
      assertReviewGetInput(a);
      return getReviewJob(root, a.featureId, a.batchId, a.jobId, a.capability);
    }
    case "dev_flow_claim_review_job": {
      assertReviewMutationInput(a, "dev_flow_claim_review_job", ["batchId", "jobId", "claimRequestId"]);
      return claimReviewJob(root, a.featureId, a.expectedRevision, a.batchId as string, a.jobId as string, a.claimRequestId as string);
    }
    case "dev_flow_release_review_job": {
      assertReviewMutationInput(a, "dev_flow_release_review_job", ["batchId", "jobId", "capability"]);
      return releaseReviewJob(root, a.featureId, a.expectedRevision, a.batchId as string, a.jobId as string, a.capability as string);
    }
    case "dev_flow_submit_review_job": {
      assertReviewSubmitInput(a);
      const result = await submitReviewJob(
        root, a.featureId, a.expectedRevision, a.batchId, a.jobId, a.capability, a.completion, a.attestation,
      );
      return reviewSubmissionEnvelope(result, a.jobId);
    }
    case "dev_flow_sample_review_job": {
      assertReviewSamplingInput(a);
      // Capability negotiation is intentionally before beginReviewSampling so an
      // unsupported client cannot create a server-held job or mutate the pointer.
      connection.assertSamplingSupported();
      const started = await beginReviewSampling(root, a.featureId, a.expectedRevision, a.batchId, a.jobId);
      try {
        const completion = await connection.sampleReview({
          role: started.job.role,
          reviewDepth: started.job.reviewDepth,
          package: started.package,
        });
        const completed = await completeReviewSampling(
          root, a.featureId, started.state.revision, a.batchId, a.jobId, started.requestId, completion,
        );
        return reviewSubmissionEnvelope({ ...completed, idempotent: false }, a.jobId);
      } catch (error) {
        try {
          await failReviewSampling(
            root,
            a.featureId,
            started.state.revision,
            a.batchId,
            a.jobId,
            started.requestId,
            samplingFailureCode(error),
          );
        } catch {
          // A CAS conflict or a concurrent recovery must not turn a sampling
          // failure into a successful response. The original failure is safer.
        }
        const code = error instanceof DevFlowError ? error.code : "REVIEW_SAMPLING_FAILED";
        throw new DevFlowError("REVIEW_SAMPLING_FAILED", "sampling review did not produce an accepted completion", {
          batchId: a.batchId,
          jobId: a.jobId,
          causeCode: code,
      });
    }
    }
    case "dev_flow_record_decision": return recordDecision(
      root, a.featureId, a.expectedRevision, a.question, a.factRefs ?? [], a.host,
    );
    case "dev_flow_resolve_decision": return resolveRecordedDecision(
      root, a.featureId, a.expectedRevision, a.decisionId, a.evidence, a.conclusion, a.host,
    );
    case "dev_flow_present_review_risk_acceptance": {
      assertReviewMutationInput(a, "dev_flow_present_review_risk_acceptance", [], ["findingIds"]);
      if (!Array.isArray(a.findingIds) || !a.findingIds.length || a.findingIds.some((findingId) => typeof findingId !== "string" || !findingId)) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_present_review_risk_acceptance input does not match its schema");
      }
      const result = await presentReviewRiskAcceptance(root, a.featureId, a.expectedRevision, a.findingIds);
      return interactionEnvelope(result.state, result.interaction, result.idempotent ? "pending" : "presented");
    }
    case "dev_flow_record_step": return recordStep(root, a.featureId, a.expectedRevision, a.step, a.evidence);
    case "dev_flow_pause": return pauseFeature(root, a.featureId, a.expectedRevision, a.reason, a.host);
    case "dev_flow_resume": return resumeFeature(root, a.featureId, a.host);
    case "dev_flow_reconcile_workspace": return reconcileWorkspace(root, a.featureId, a.expectedRevision, a.host);
    case "dev_flow_begin_implementation_unit": {
      assertUnitMutationInput(a, "dev_flow_begin_implementation_unit");
      return beginImplementationUnit(root, a.featureId, a.expectedRevision, a.unitId);
    }
    case "dev_flow_checkpoint_implementation_unit": {
      assertUnitMutationInput(a, "dev_flow_checkpoint_implementation_unit");
      return checkpointImplementationUnit(root, a.featureId, a.expectedRevision, a.unitId);
    }
    case "dev_flow_preview_rollback": {
      assertPreviewRollbackInput(a);
      return previewRollback(root, a.featureId, a.targetCheckpointId);
    }
    case "dev_flow_present_rollback_gate": {
      assertRollbackMutationInput(a, "dev_flow_present_rollback_gate", true);
      const presentation = await presentRollbackGate(root, a.featureId, a.expectedRevision, a.targetCheckpointId);
      emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: "rollback-confirmation" });
      const selection = await connection.elicit(
        presentation.interaction,
        rollbackGateMessage(presentation.preview),
      );
      if (!selection) return { ...interactionEnvelope(presentation.state, presentation.interaction, "pending"), preview: presentation.preview };
      const state = await resolveRollbackGateElicitation(
        root, a.featureId, presentation.state.revision, presentation.interactionId,
         selection.action, selection.comment, a.host as "claude" | "codex",
      );
      return {
        ...interactionEnvelope(
          state,
           toPublicInteraction(getInteraction(state, presentation.interactionId)),
           selection.action,
           interactionResponse(state, presentation.interactionId),
        ),
        preview: presentation.preview,
      };
    }
    case "dev_flow_execute_rollback": {
      assertRollbackMutationInput(a, "dev_flow_execute_rollback");
      const result = await executeRollback(root, a.featureId, a.expectedRevision, a.targetCheckpointId);
      return { outcome: result.outcome, state: result.state, transactionId: result.transaction.transactionId };
    }
    case "dev_flow_present_approval": {
      const presentation = await presentApproval(root, a.featureId, a.expectedRevision, a.approvalId);
      emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: "approval", approvalId: a.approvalId });
      const selection = await connection.elicit(
        presentation.approvalInteraction,
        "请确认当前执行摘要，或提出需要修改的意见。",
      );
      if (!selection) return interactionEnvelope(presentation, presentation.approvalInteraction, "pending");
      const state = await resolveApprovalElicitation(
        root, a.featureId, presentation.revision, presentation.interactionId,
         selection.action, selection.comment, a.host,
      );
      return interactionEnvelope(
        state,
        presentation.approvalInteraction,
        selection.action,
         interactionResponse(state, presentation.interactionId),
       );
     }
     case "dev_flow_answer": {
       const state = await readState(root, a.featureId);
       const decision = pendingDecisionForState(state);
        if (!decision) {
          return {
            state,
           message: "当前没有需要回答的问题。",
           nextStep: "流程将按当前阶段自动继续。",
         };
       }
       const interaction = pendingInteractionForDecision(state, decision);
       if (!interaction) {
         const prompt = resolvePromptEvent(await readFeatureEvents(root, a.featureId), {
           host: a.host,
           userReply: a.userReply,
           presentedAt: decision.presentedAt,
           presentedRevision: decision.presentedRevision,
         });
         const matched = matchDecisionReply(decision, a.userReply);
         const next = await mutate(root, a.featureId, a.expectedRevision, "decision-answered", (draft) => {
           const current = draft.pendingDecision;
           if (!current) throw new DevFlowError("DECISION_ALREADY_RESOLVED", "当前问题已经处理。", { userMessage: "当前问题已经处理，请刷新状态。", recoveryKind: "refresh", recoveryInstruction: "刷新当前状态后继续。", retryOriginal: false });
           delete draft.pendingDecision;
           if (current.kind === "workspace-ownership" && current.target?.startsWith("workspace:")) {
             const file = current.target.slice("workspace:".length);
             const owner = matched.option.id === "adopt" ? "feature" : "excluded";
             draft.workspace.ownership[file] = owner;
             if (owner === "feature") draft.workspace.ownershipSource[file] = "user-adopted";
             const nextFile = Object.keys(draft.workspace.startedDirty).find((candidate) => draft.workspace.ownership[candidate] === undefined);
             if (nextFile) {
               draft.pendingDecision = {
                 kind: "workspace-ownership",
                 question: `启动前已发现路径“${nextFile}”存在改动。它是否属于当前任务？`,
                 options: [
                   { id: "adopt", label: "纳入当前任务", recommended: true },
                   { id: "exclude", label: "先处理后继续" },
                 ],
                 basisHash: current.basisHash,
                 presentedAt: new Date().toISOString(),
                 presentedRevision: draft.revision,
                 source: "core",
                 target: `workspace:${nextFile}`,
               };
             }
           } else if (current.kind === "task-switch" && matched.option.id === "pause-old") {
             draft.lifecycle = "paused";
             draft.resumeSummary = "旧任务已暂停；恢复时会自动对账工作区。";
           }
         }, { eventId: prompt.eventId, action: matched.option.id });
          return {
            state: next,
           message: matched.option.id === "adopt" ? "已将该路径纳入当前任务。" : matched.option.id === "exclude" ? "已将该路径排除；系统不会自动还原或暂存它。" : "已记录你的选择，流程将按当前任务状态继续。",
           ...(next.pendingDecision ? { attention: "请只回答当前这一道问题。", 需要用户决定: true } : { 需要用户决定: false }),
         };
       }
       if (decision.kind === "approval") {
         const next = await resolveApprovalAnswer(root, a.featureId, a.expectedRevision, interaction.id, a.userReply, a.host);
         const response = interactionResponse(next, interaction.id);
         return interactionEnvelope(next, toPublicInteraction(getInteraction(next, interaction.id)), response?.action ?? "已处理", response);
       }
       if (decision.kind === "grill") {
         const result = await resolveGrillAnswer(root, a.featureId, a.expectedRevision, interaction.id, a.userReply, a.host);
         return interactionEnvelope(result.state, result.interaction, result.response?.action ?? "已处理", result.response);
       }
       if (decision.kind === "review-risk") {
         const result = await resolveReviewRiskAcceptanceAnswer(root, a.featureId, a.expectedRevision, interaction.id, a.userReply, a.host);
         const response = interactionResponse(result.state, interaction.id);
         return interactionEnvelope(result.state, toPublicInteraction(getInteraction(result.state, interaction.id)), result.idempotent ? "已接受风险" : response?.action ?? "已处理", response);
       }
       if (decision.kind === "quality-exception") {
         const next = await resolveQualityExceptionAnswer(root, a.featureId, a.expectedRevision, interaction.id, a.userReply, a.host);
         const response = interactionResponse(next, interaction.id);
         return interactionEnvelope(next, toPublicInteraction(getInteraction(next, interaction.id)), response?.action ?? "已处理", response);
       }
       if (decision.kind === "rollback-confirmation") {
         const next = await resolveRollbackGateAnswer(root, a.featureId, a.expectedRevision, interaction.id, a.userReply, a.host);
         const response = interactionResponse(next, interaction.id);
         return interactionEnvelope(next, toPublicInteraction(getInteraction(next, interaction.id)), response?.action ?? "已处理", response);
       }
       throw new DevFlowError("DECISION_KIND_UNSUPPORTED", "当前决策类型还没有可用的回答处理器。", {
         userMessage: "当前问题暂时不能自动处理。",
         cause: `决策类型为 ${decision.kind}。`,
         impact: "流程保持在当前阶段。",
         recoveryKind: "repair",
         recoveryInstruction: "运行 doctor 检查插件版本和状态。",
         retryOriginal: false,
       });
     }
     case "dev_flow_present_quality_exception": {
       const result = await presentQualityException(root, a.featureId, a.expectedRevision, {
         kind: a.kind,
         basisHash: a.basisHash,
         fingerprint: a.fingerprint,
         riskSummary: a.riskSummary,
       });
       emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: "quality-exception" });
       const selection = await connection.elicit(result.interaction, result.interaction.question ?? "请决定是否接受当前风险。");
       if (!selection) return interactionEnvelope(result.state, result.interaction, "pending");
       const next = await resolveQualityExceptionAnswer(root, a.featureId, result.state.revision, result.interactionId, selection.action, a.host);
       const response = interactionResponse(next, result.interactionId);
       return interactionEnvelope(next, toPublicInteraction(getInteraction(next, result.interactionId)), response?.action ?? selection.action, response);
     }
    case "dev_flow_request_grill_decision": {
      const result = await requestGrillDecision(root, a.featureId, a.expectedRevision, {
        questionId: a.questionId,
        question: a.question,
        options: a.options,
         host: a.host,
      });
      emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: "grill" });
      const selection = await connection.elicit(result.interaction, result.interaction.question ?? "请选择一个方案。");
      if (!selection) return interactionEnvelope(result.state, result.interaction, "pending");
      const resolved = await resolveGrillElicitation(
         root, a.featureId, result.state.revision, result.interactionId,
          selection.action, selection.comment, a.host,
       );
       return interactionEnvelope(resolved.state, resolved.interaction, selection.action, resolved.response);
     }
    case "dev_flow_reclassify": return reclassifyFeature(root, a.featureId, a.expectedRevision, a.classification, a.reason, a.userEvidence);
    case "dev_flow_verify": return runVerification(
       root, a.featureId, a.expectedRevision, a.host, a.commandIds, a.manualAcceptance,
    );
    case "dev_flow_feature_check": return featureCheck(root, a.featureId, a.expectedRevision);
    case "dev_flow_finalize": {
      const state = await finalize(root, a.featureId, a.expectedRevision);
      emitAttentionNotification({ kind: "workflow-finalized", featureId: a.featureId });
      return state;
    }
    case "dev_flow_abandon": return abandonFeature(root, a.featureId, a.expectedRevision, a.reason, a.userEvidence);
    case "dev_flow_enable_windows_notifications": return enableWindowsNotifications({ nodeExecutable: process.execPath });
    case "dev_flow_doctor": return collectDoctorReport(root, pluginRoot, __DEV_FLOW_VERSION__, tools);
    case "dev_flow_recover_corrupt_feature": return recoverCorruptFeature(root, {
      featureId: a.featureId,
      stateSha256: a.stateSha256,
      activeSha256: a.activeSha256,
      action: a.action,
      reason: a.reason,
      userEvidence: a.userEvidence,
       host: a.host,
    });
    default: throw new DevFlowError("UNKNOWN_TOOL", name);
  }
}

const connection = new McpConnection();
const inFlight = new Set<Promise<void>>();

async function dispatchRequest(message: { id?: unknown; method?: string; params?: any; result?: unknown; error?: unknown }): Promise<void> {
  try {
    // Notifications have no id; ignore after initialize handshake.
    if (!Object.hasOwn(message, "id") || message.id === undefined || message.id === null) return;

    if (message.method === "initialize") {
      connection.configure(message.params?.capabilities);
      protocolResult(message.id, {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        serverInfo: { name: "dev-flow", version: __DEV_FLOW_VERSION__ },
        capabilities: { tools: {} },
         instructions: "先完成事实调查和路线分类。日常读取 dev_flow_status；它会显示中文阶段、当前下一步和唯一待决问题。所有用户决定统一使用 dev_flow_answer，系统会自动按问题类型处理。没有真实决策缺口时流程会自动推进。先调用 dev_flow_init_project，再开始 feature。",
      });
      return;
    }
    if (message.method === "tools/list") {
      protocolResult(message.id, {
        tools: tools.map((name) => ({ name, ...toolSchemas[name] })),
      });
      return;
    }
    if (message.method === "tools/call") {
      const name = message.params?.name;
      const arguments_ = message.params?.arguments ?? {};
      validateToolInput(name, arguments_, toolSchemas);
      toolResult(message.id, compactMutationResult(name, await call(name, arguments_, connection)));
      return;
    }
    if (message.method === "ping") {
      protocolResult(message.id, {});
      return;
    }
    protocolFailure(message.id, new DevFlowError("UNKNOWN_METHOD", String(message.method ?? "missing method")));
  } catch (error) {
    if (message?.id !== undefined && message?.id !== null) failure(message.id, error);
  }
}

let requestTail = Promise.resolve();
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let message: { id?: unknown; method?: string; params?: any; result?: unknown; error?: unknown };
  try {
    message = JSON.parse(line);
  } catch {
    continue;
  }
  if (connection.consumeResponse(message)) continue;
  const task = requestTail.then(() => dispatchRequest(message)).finally(() => inFlight.delete(task));
  requestTail = task;
  inFlight.add(task);
}
connection.close();
await Promise.allSettled(inFlight);
