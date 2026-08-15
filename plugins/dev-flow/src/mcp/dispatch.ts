import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordArtifact, recordArtifactWithTrace, scaffoldArtifact, validatePlan } from "../core/artifacts.js";
import { presentApproval } from "../core/approval-interactions.js";
import { DevFlowError } from "../core/errors.js";
import { finalize, recordStep } from "../core/feature-check.js";
import { answer } from "../core/interaction-answer.js";
import {
  initProject, updateProjectConfig, startFeature, lockClassification, recordDecision, reviseDecision, revisePlanDuringImplementation, abandonFeature, reclassifyFeature, recoverCorruptFeature, repairFeature, readState, pauseFeature, resumeFeature, reconcileWorkspace, assertHostHealth, registerRepositoryFact, registerRepositoryFacts,
} from "../core/state-store.js";
import { readCompactStatus } from "../core/status-projection.js";
import { inspectFeature, inspectionTopics } from "../core/inspection.js";
import { presentQualityException } from "../core/quality-exceptions.js";
import { rebuildReviewProjection } from "../core/review-projection-rebuild.js";
import { beginImplementationUnit, abandonImplementationUnit } from "../core/implementation-units.js";
import { checkpointImplementationUnit } from "../core/checkpoints.js";
import { executeRollback, presentRollbackGate, previewRollback, type RollbackPreview } from "../core/rollback.js";
import { runVerification } from "../core/verification.js";
import { presentAcceptanceConfirmation, recordAcceptanceEvidence } from "../core/acceptance.js";
import { allowedRiskLabels } from "../policy/contract.js";
import { type RepositoryObservation } from "../policy/governance-records.js";
import { deriveRiskRequirements, recommendClassification, selectRoute } from "../policy/route.js";
import { stableJson } from "../policy/stable-json.js";
import { collectDoctorReport } from "./doctor.js";
import { elicitAndAnswer, interactionEnvelope, type ElicitationSelection } from "./interaction-pipeline.js";
import { enableWindowsNotifications } from "./windows-notifications.js";
import { validateToolInput } from "./input-validation.js";
import { requestGrillDecision } from "../core/requirements-grill.js";
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
  startIsolatedReview,
  submitReviewJob,
} from "../core/review-jobs.js";
import { parseHostAttestation, parseReviewJobCompletion, toPublicReviewJob } from "../policy/review.js";
import { getInteraction, toPublicInteraction, type PublicInteraction } from "../core/user-interactions.js";
import { pendingDecisionForState, pendingInteractionForDecision } from "../core/decision-interactions.js";
import type { AttentionEvent } from "./attention.js";

// doctor 诊断需要插件安装根；测试经 data: URL bundle 加载时 import.meta.url
// 不可解析为文件路径，退化为项目根（doctor 在进程内测试中无诊断对象）。
function pluginRootForDoctor(fallbackRoot: string): string {
  try {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    return path.basename(moduleDirectory) === "dist" ? path.resolve(moduleDirectory, "..") : path.resolve(moduleDirectory, "../..");
  } catch {
    return fallbackRoot;
  }
}

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
const reviewRolesSchema = { type: "array", uniqueItems: true, items: { enum: [
  "code-quality", "requirement-fidelity",
  "requirements-coverage", "architecture-testability", "rollback-operability", "security",
  "data-irreversibility", "money-safety", "contract-failure", "recovery-observability", "critical-correctness",
] } };
const controlEnhancementsSchema = object([], {
  requirements: { const: true },
  plan: { enum: ["brief", "formal"] },
  trace: { const: true },
  planReview: { const: true },
  reviewRoles: reviewRolesSchema,
  executionApproval: { const: true },
  checkpoints: { const: "unit-chain" },
  recovery: { type: "array", uniqueItems: true, items: { enum: ["operational-strategy", "executable-rollback", "irreversible-compensation"] } },
  codeReview: { enum: ["focused", "independent", "full"] },
  verification: { type: "array", uniqueItems: true, items: { enum: ["targeted", "behavior", "integration", "full"] } },
});
const classificationSignalsSchema = object(["changeSurface", "behaviorChange", "topology", "unitCount", "requirements", "operationalRecovery", "executableRollback"], {
  changeSurface: { enum: ["single-site", "single-component", "multi-component", "system-wide"] },
  behaviorChange: { enum: ["mechanical", "bounded-rule", "new-capability", "systemic-change"] },
  topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
  unitCount: { type: "integer", minimum: 1 },
  requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
  operationalRecovery: { type: "boolean" },
  executableRollback: { type: "boolean" },
  upwardLevel: { enum: ["XS", "S", "M", "L"] },
});
const classificationBasisSchema = object(["scopeFactRefs", "topologyFactRefs", "uncertaintyFactRefs", "riskFactRefs", "decisionRefs"], {
  scopeFactRefs: { type: "array", items: string },
  topologyFactRefs: { type: "array", items: string },
  uncertaintyFactRefs: { type: "array", items: string },
  riskFactRefs: { type: "object", propertyNames: { enum: allowedRiskLabels }, additionalProperties: { type: "array", items: string } },
  decisionRefs: { type: "array", items: string },
  signals: classificationSignalsSchema,
  controlEnhancements: controlEnhancementsSchema,
});
const recommendedClassificationBasisSchema = object(["scopeFactRefs", "topologyFactRefs", "uncertaintyFactRefs", "riskFactRefs", "decisionRefs", "signals"], {
  ...classificationBasisSchema.properties,
});
const flatClassificationBasisProperties = {
  scopeFactRefs: classificationBasisSchema.properties.scopeFactRefs,
  topologyFactRefs: classificationBasisSchema.properties.topologyFactRefs,
  uncertaintyFactRefs: classificationBasisSchema.properties.uncertaintyFactRefs,
  riskFactRefs: classificationBasisSchema.properties.riskFactRefs,
  decisionRefs: classificationBasisSchema.properties.decisionRefs,
};
const classificationInputSchema = object(["level", "topology"], {
  level: { enum: ["XS", "S", "M", "L"] },
  topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
  requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
  riskLabels: riskLabelsSchema,
  classificationBasis: classificationBasisSchema,
  ...flatClassificationBasisProperties,
  acceptanceAssistSuggested: { type: "boolean" },
  controlEnhancements: controlEnhancementsSchema,
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
  object(["kind", "id", "parentRequirement"], { kind: { const: "acceptance-criterion" }, id: traceId("AC"), parentRequirement: traceId("REQ"), verificationDisposition: object(["kind"], { kind: { enum: ["behavior-test", "type-check", "rule-check", "file-check", "human-acceptance"] }, reason: string, target: string }) }),
  object(["kind", "id", "covers", "implementationUnit"], { kind: { const: "task" }, id: traceId("TASK"), covers: stringArray, implementationUnit: traceId("UNIT") }),
  object(["kind", "id", "verifies"], { kind: { const: "test" }, id: traceId("TEST"), verifies: { type: "array", minItems: 1, items: traceId("AC") } }),
  object(["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification", "rollbackVerification"], {
    kind: { const: "rollback" }, id: traceId("RU"), tasks: { type: "array", minItems: 1, items: traceId("TASK") },
    dependsOn: { type: "array", items: traceId("RU") }, fileScope: stringArray, covers: stringArray,
    forwardVerification: verificationCommandArray, rollbackVerification: verificationCommandArray,
  }),
  object(["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification"], {
    kind: { const: "implementation-unit" }, id: traceId("UNIT"), tasks: { type: "array", minItems: 1, items: traceId("TASK") },
    dependsOn: { type: "array", items: traceId("UNIT") }, fileScope: stringArray, covers: stringArray,
    forwardVerification: verificationCommandArray,
  }),
  object(["kind", "id", "stepRef", "recoveryKind", "method", "riskRef"], {
    kind: { const: "recovery" }, id: traceId("REC"), stepRef: { type: "string", pattern: "^(UNIT|TASK)-[0-9]{3,}$" },
    recoveryKind: { enum: ["rollback", "compensation"] }, method: string, riskRef: string,
  }),
];
const traceDeltaSchema = object(["nodes"], {
  nodes: { type: "array", items: { oneOf: traceNodeSchemas } },
});
const reviewEvidenceSchema = object(["path"], { path: string, line: { type: "integer", minimum: 1 } });
const reviewFindingSchema = object(["severity", "category", "targets", "evidence", "claim", "recommendation"], {
  severity: { enum: ["blocking", "warning", "note"] },
  category: { enum: ["code-quality", "requirement-fidelity", "requirements-coverage", "architecture-testability", "rollback-operability", "security", "data-irreversibility", "money-safety", "contract-failure", "recovery-observability", "critical-correctness"] },
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
  // 与 policy/review.ts 的 parseHostAttestation 白名单一致：hostEventId 必须指向
  // 宿主捕获的 review-execution 事件才会被 Core 计入来源/隔离证明；isolated 只是
  // 声明，不能单独形成证明。
  hostEventId: string,
  isolated: { type: "boolean" },
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

const repositoryObservationSchema = {
  oneOf: [
    object(["kind", "path"], { kind: { const: "file-exists" }, path: string }),
    object(["kind", "path", "text"], { kind: { const: "text-present" }, path: string, text: string, occurrence: { type: "integer", minimum: 1 } }),
    object(["kind", "path", "symbol"], { kind: { const: "symbol-present" }, path: string, symbol: string }),
    object(["kind", "path", "pointer", "expected"], { kind: { const: "json-value" }, path: string, pointer: string, expected: {} }),
    object(["kind", "checkedScope", "pattern", "patternKind"], {
      kind: { const: "search-absent" },
      checkedScope: { type: "array", minItems: 1, items: string },
      pattern: string,
      patternKind: { enum: ["literal", "regex"] },
    }),
  ],
};

const acceptanceEvidenceSchema = {
  oneOf: [
    object(["kind", "eventId"], { kind: { const: "browser-operation" }, eventId: string, note: string }),
    object(["kind", "path", "sourceEventId"], { kind: { const: "screenshot" }, path: string, sourceEventId: string, note: string }),
    object(["kind", "observation"], { kind: { const: "file-inspection" }, observation: repositoryObservationSchema, note: string }),
    object(["kind", "note"], { kind: { const: "agent-self-check" }, note: string }),
  ],
};

const interactionOptionSchema = object(["id", "label", "description"], {
  id: string,
  label: string,
  description: string,
  requiresComment: { type: "boolean" },
});
const grillRecommendationSchema = object(["optionId", "reason"], {
  optionId: string,
  reason: string,
  drawback: string,
  alternative: object(["optionId", "condition"], { optionId: string, condition: string }),
});
const boundaryAuditItemSchema = object(["id", "kind", "disposition", "summary"], {
  id: string,
  kind: { enum: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"] },
  disposition: { enum: ["repository-fact", "resolved-decision"] },
  factRef: string,
  decisionRef: string,
  summary: string,
});
const boundaryAuditSchema = object(["scanned", "items"], {
  scanned: { type: "array", minItems: 6, uniqueItems: true, items: { enum: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"] } },
  items: { type: "array", items: boundaryAuditItemSchema },
});

export type ToolSchemaEntry = { description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean>; expose?: boolean };

export const toolSchemas = {
  dev_flow_init_project: { description: "Create strict project configuration.", inputSchema: object(["config"], { config: { type: "object" } }) },
  dev_flow_update_project: { description: "Update strict project configuration using sha256 compare-and-swap.", inputSchema: object(["config", "expectedSha256"], { config: { type: "object" }, expectedSha256: string }) },
  dev_flow_classify: {
    description: "Pure route classification (read-only preview).",
    inputSchema: object([], {
      classificationBasis: recommendedClassificationBasisSchema,
      level: { enum: ["XS", "S", "M", "L"] },
      topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
      requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
      riskLabels: riskLabelsSchema,
      controlEnhancements: controlEnhancementsSchema,
      acceptanceAssistSuggested: { type: "boolean", description: "Offer optional browser/user acceptance help; never blocks the route." },
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
    inputSchema: featureMutation({ classification: classificationInputSchema, boundaryAudit: boundaryAuditSchema }, ["classification", "boundaryAudit"]),
  },
  dev_flow_record_decision: {
    description: "Record an already-known user conclusion as one trusted resolved decision.",
    inputSchema: featureMutation({ question: string, evidence: string, conclusion: string, factRefs: { type: "array", items: string }, host: { enum: ["claude", "codex"] } }, ["question", "evidence", "conclusion", "host"]),
  },
  dev_flow_record_repository_fact: {
    description: "Execute and register one reproducible repository observation; BoundaryAudit only accepts current fact records.",
    inputSchema: featureMutation({
      observation: repositoryObservationSchema,
      host: { enum: ["claude", "codex"] },
    }, ["observation", "host"]),
  },
  dev_flow_record_repository_facts: {
    description: "Execute and register many reproducible repository observations in one CAS write; BoundaryAudit only accepts current fact records.",
    inputSchema: featureMutation({
      observations: { type: "array", minItems: 1, maxItems: 50, items: repositoryObservationSchema },
      host: { enum: ["claude", "codex"] },
    }, ["observations", "host"]),
  },
  dev_flow_revise_decision: {
    description: "Revise a registered decision before implementation: show the old decision, new conclusion, and affected work, then ratify with one confirmation.",
    inputSchema: featureMutation({
      decisionId: string,
      newConclusion: string,
      reason: string,
      host: { enum: ["claude", "codex"] },
    }, ["decisionId", "newConclusion", "reason", "host"]),
  },
  dev_flow_revise_plan: {
    description: "Revise the implementation plan during planning/implementation: pause the current step, show affected units and side-effect warnings, then redo only the affected work after confirmation.",
    inputSchema: featureMutation({
      kind: { const: "implementation-plan" },
      traceDelta: traceDeltaSchema,
      host: { enum: ["claude", "codex"] },
    }, ["kind", "traceDelta", "host"]),
  },
  dev_flow_status: { description: "Read the compact daily status of one feature.", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_inspect: { description: "Read one detailed topic; full state is never exposed through a single public response.", inputSchema: object(["featureId", "topic"], { featureId: string, topic: { enum: inspectionTopics } }), annotations: { readOnlyHint: true } },
  dev_flow_scaffold_artifact: { description: "Create only the current route artifact. For editable artifacts, read the registered path before editing, then record it. Generated status artifacts are read-only: scaffold them and continue with the requested step; do not edit or record them.", inputSchema: featureMutation({ kind: string }, ["kind"]) },
  dev_flow_record_artifact: { description: "Register an edited route artifact.", inputSchema: featureMutation({ kind: string }, ["kind"]) },
  dev_flow_validate_plan: {
    description: "Read-only plan preflight: returns the complete diagnostic set in stable order with zero side effects; formal registration uses the same compile result.",
    inputSchema: featureMutation({ kind: { enum: traceArtifactKinds }, traceDelta: traceDeltaSchema }, ["kind", "traceDelta"]),
    annotations: { readOnlyHint: true },
  },
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
  dev_flow_start_isolated_review: {
    description: "Declare that a claimed code review job will be executed in an isolated subagent context. The host SubagentOutput hook completes the declaration; agents cannot self-attest isolation.",
    inputSchema: featureMutation({ batchId: string, jobId: string, executionId: string, host: { enum: ["claude", "codex"] } }, ["batchId", "jobId", "executionId", "host"]),
  },
  dev_flow_submit_review_job: {
    description: "Submit one claimed job's structured completion. Host attestation is diagnostic unless a trusted verifier accepts it; Core still owns assurance. Isolation proof requires a real host-captured review-execution event or server sampling; agent-authored event claims never qualify.",
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
  dev_flow_record_review_execution_event: {
    expose: false, // 宿主接缝：agent 不可调用、不进入 tools/list，也无需 dispatch case
    description: "Record one review-execution event for the active feature (host adapter seam for subagent reviews). Only this dedicated event type can prove review source or context isolation; ordinary user-prompt/tool events never qualify. contextId must identify the review context and implementationContextId the implementation context; submitReviewJob validates that contextId differs from implementationContextId.",
    inputSchema: object(["event"], {
      event: object(["eventId", "type", "host", "batchId", "jobId", "executionId", "sourceId", "contextId", "implementationContextId"], {
        eventId: string,
        type: { const: "review-execution" },
        host: { enum: ["claude", "codex"] },
        batchId: string,
        jobId: string,
        executionId: string,
        sourceId: string,
        contextId: string,
        implementationContextId: string,
        parentContextId: string,
        text: string,
      }),
    }),
  },
  dev_flow_present_review_risk_acceptance: {
    description: "Present a one-time user decision for an exact set of current blocking review findings.",
    inputSchema: featureMutation({ findingIds: { type: "array", minItems: 1, uniqueItems: true, items: string }, host: { enum: ["claude", "codex"] } }, ["findingIds", "host"]),
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
    description: "Begin the next implementation unit of a checkpoints:1 feature; Core derives basis, scope, and dependency order.",
    inputSchema: object(["featureId", "expectedRevision", "unitId"], { featureId: string, expectedRevision: integer, unitId: traceId("UNIT") }),
  },
  dev_flow_checkpoint_implementation_unit: {
    description: "Confirm the active implementation unit: scope-checked diff, forward verification, content-addressed checkpoint.",
    inputSchema: object(["featureId", "expectedRevision", "unitId"], { featureId: string, expectedRevision: integer, unitId: traceId("UNIT") }),
  },
  dev_flow_abandon_implementation_unit: {
    description: "Cancel the active implementation unit without touching the workspace; the unit returns to pending so the plan can be re-registered and the unit re-begun (e.g. after a verification config change made its Trace basis stale).",
    inputSchema: object(["featureId", "expectedRevision", "unitId", "reason", "host"], { featureId: string, expectedRevision: integer, unitId: traceId("UNIT"), reason: string, host: { enum: ["claude", "codex"] } }),
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
  dev_flow_present_approval: { description: "Present the unique current Core-derived approval obligation.", inputSchema: featureMutation({ host: { enum: ["claude", "codex"] } }, ["host"]) },
  dev_flow_record_acceptance_evidence: {
    description: "Record one current, verifiable acceptance artifact for one human-acceptance criterion. Text-only self-checks remain informational.",
    inputSchema: featureMutation({ acceptanceCriterionId: traceId("AC"), evidence: acceptanceEvidenceSchema, host: { enum: ["claude", "codex"] } }, ["acceptanceCriterionId", "evidence", "host"]),
  },
  dev_flow_present_acceptance_confirmation: {
    description: "Present a one-time confirmation for selected human-acceptance criteria, bound to the current delivery content.",
    inputSchema: featureMutation({ acceptanceCriterionIds: { type: "array", minItems: 1, uniqueItems: true, items: traceId("AC") }, host: { enum: ["claude", "codex"] } }, ["acceptanceCriterionIds", "host"]),
  },
  dev_flow_request_grill_decision: {
    description: "Present the current grill question as structured choices when the host supports MCP elicitation, otherwise return one-time text replies.",
    inputSchema: featureMutation({
      questionId: string,
      question: string,
      options: { type: "array", minItems: 2, maxItems: 3, items: interactionOptionSchema },
      recommendation: grillRecommendationSchema,
      host: { enum: ["claude", "codex"] },
    }, ["questionId", "question", "options", "recommendation", "host"]),
  },
  dev_flow_reclassify: {
    description: "Recompute controls before governed writes; after implementation starts only monotonic strengthening is allowed.",
    inputSchema: featureMutation({ classification: classificationInputSchema, reason: string, userEvidence: string }, ["classification", "reason"]),
  },
  dev_flow_verify: {
    description: "Run configured verification commands. Acceptance evidence is recorded separately and cannot be self-reported here.",
    inputSchema: featureMutation({
      commandIds: { type: "array", items: string },
      host: { enum: ["claude", "codex"] },
    }, ["host"]),
  },
  dev_flow_finalize: { description: "Set logic-complete after all obligations pass.", inputSchema: featureMutation() },
  dev_flow_repair_feature: { description: "Rebuild derived pointers, stage, freshness, and review/status projections only.", inputSchema: featureMutation({ host: { enum: ["claude", "codex"] } }, ["host"]) },
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
} satisfies Record<string, ToolSchemaEntry>;

type ToolName = keyof typeof toolSchemas;
// 内部接缝（expose: false）不进公开面、也不要求 dispatch case；公开面由声明派生，杜绝"注册了却忘了暴露"
export type PublicToolName = { [K in ToolName]: (typeof toolSchemas)[K] extends { expose: false } ? never : K }[ToolName];
export const publicTools = (Object.keys(toolSchemas) as ToolName[]).filter((name) => (toolSchemas[name] as ToolSchemaEntry).expose !== false);
const publicToolSet = new Set<string>(publicTools);

// 运行时形状由入口 validateToolInput 按 schema 保证；此处只做类型窄化。
function traceRegistrationInput(value: unknown): {
  featureId: string; expectedRevision: number; kind: typeof traceArtifactKinds[number];
  traceDelta: import("../policy/traceability.js").TraceDelta;
} {
  return value as {
    featureId: string; expectedRevision: number; kind: typeof traceArtifactKinds[number];
    traceDelta: import("../policy/traceability.js").TraceDelta;
  };
}

// 运行时形状由入口 validateToolInput 按 schema 保证；此处只做类型窄化。
function traceReadInput(value: unknown): { featureId: string } {
  return value as { featureId: string };
}

// 运行时形状由入口 validateToolInput 按 schema 保证；此处只做类型窄化。
function reviewMutationInput(value: unknown): Record<string, unknown> & { featureId: string; expectedRevision: number } {
  return value as Record<string, unknown> & { featureId: string; expectedRevision: number };
}

// 运行时形状由入口 validateToolInput 按 schema 保证；此处只做类型窄化。
function reviewGetInput(value: unknown): { featureId: string; batchId: string; jobId: string; capability: string } {
  return value as { featureId: string; batchId: string; jobId: string; capability: string };
}

// 运行时形状由入口 validateToolInput 按 schema 保证；此处只做类型窄化。
function reviewSubmitInput(value: unknown): Record<string, unknown> & {
  featureId: string; expectedRevision: number; batchId: string; jobId: string; capability: string; completion: unknown; attestation?: unknown;
} {
  return value as Record<string, unknown> & {
    featureId: string; expectedRevision: number; batchId: string; jobId: string; capability: string; completion: unknown; attestation?: unknown;
  };
}

// 运行时形状由入口 validateToolInput 按 schema 保证；此处只做类型窄化。
function reviewSamplingInput(value: unknown): Record<string, unknown> & {
  featureId: string; expectedRevision: number; batchId: string; jobId: string;
} {
  return value as Record<string, unknown> & { featureId: string; expectedRevision: number; batchId: string; jobId: string };
}

// 运行时形状由入口 validateToolInput 按 schema 保证；此处只做类型窄化。
function unitMutationInput(value: unknown): Record<string, unknown> & {
  featureId: string; expectedRevision: number; unitId: string;
} {
  return value as Record<string, unknown> & { featureId: string; expectedRevision: number; unitId: string };
}

// 运行时形状由入口 validateToolInput 按 schema 保证；此处只做类型窄化。
function previewRollbackInput(value: unknown): { featureId: string; targetCheckpointId: string } {
  return value as { featureId: string; targetCheckpointId: string };
}

// 运行时形状由入口 validateToolInput 按 schema 保证；此处只做类型窄化。
function rollbackMutationInput(value: unknown): Record<string, unknown> & {
  featureId: string; expectedRevision: number; targetCheckpointId: string;
} {
  return value as Record<string, unknown> & { featureId: string; expectedRevision: number; targetCheckpointId: string };
}

type ElicitationResult = { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };

/** First-slice answer outcomes map back to user-facing messages for the text tool. */
function answerOutcomeMessage(action: string, kind: string | undefined): string | undefined {
  if (kind === "workspace-ownership") {
    if (action === "adopt-all" || action === "adopt" || action === "include") return "已将路径纳入当前任务。";
    if (action === "exclude-all" || action === "exclude") return "已将路径排除；系统不会自动还原或暂存它们。";
    if (action === "one-by-one") return "已切换为逐个确认路径。";
    return undefined;
  }
  if (kind === "route-confirmation" && action === "confirm") return "路线已按可信用户确认原子锁定。";
  if (kind === "task-switch") {
    if (action === "pause-old") return "旧任务已暂停并释放 active 指针；重试 dev_flow_start 即可开始新任务。";
    if (action === "finish-old") return "已解除任务切换待决；请先完成当前任务，再开始新任务。";
    if (action === "return-old") return "已解除任务切换待决，继续当前任务。";
    return undefined;
  }
  return undefined;
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

const classificationBasisKeys = ["scopeFactRefs", "topologyFactRefs", "uncertaintyFactRefs", "riskFactRefs", "decisionRefs", "controlEnhancements"] as const;

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

export class McpConnection {
  private supportsFormElicitation = false;
  private supportsSampling = false;
  private elicitationFused = false;
  private readonly expired = new Set<string>();
  private nextClientRequestId = 0;
  private readonly pending = new Map<string, {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timeout?: ReturnType<typeof setTimeout>;
  }>();

  configure(capabilities: unknown, clientInfo?: unknown): void {
    this.supportsFormElicitation = false;
    this.elicitationFused = false;
    this.supportsSampling = false;
    if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return;
    const sampling = (capabilities as { sampling?: unknown }).sampling;
    this.supportsSampling = !!sampling && typeof sampling === "object" && !Array.isArray(sampling);
    const clientName = clientInfo && typeof clientInfo === "object" && !Array.isArray(clientInfo)
      ? (clientInfo as { name?: unknown }).name
      : undefined;
    // Claude Code currently renders oneOf form fields as a nested control that
    // requires expand + space + extra focus navigation. Prefer the trusted
    // text interaction immediately instead of waiting for the form timeout.
    if (clientName === "claude-code") return;
    const elicitation = (capabilities as { elicitation?: unknown }).elicitation;
    if (!elicitation || typeof elicitation !== "object" || Array.isArray(elicitation)) return;
    const modes = elicitation as Record<string, unknown>;
    this.supportsFormElicitation = Object.keys(modes).length === 0 || modes.form !== undefined;
  }

  consumeResponse(message: { id?: unknown; method?: unknown; result?: unknown; error?: unknown }): boolean {
    if (typeof message.id !== "string" || message.method !== undefined) return false;
    const pending = this.pending.get(message.id);
    if (!pending) return this.expired.delete(message.id);
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
            this.expired.add(id);
            process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "Dev Flow request timed out" } })}\n`);
            reject(new DevFlowError(method === "elicitation/create" ? "ELICITATION_TIMEOUT" : "REVIEW_SAMPLING_TIMEOUT", "MCP client request timed out"));
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
    if (!this.supportsFormElicitation || this.elicitationFused) return undefined;
    let raw: unknown;
    const choices = interaction.kind === "grill"
      ? [
        ...interaction.options.map((option) => ({
          const: option.id,
          title: `${option.answerCode}. ${option.label}${option.recommended ? "（推荐）" : ""}`,
        })),
        { const: "other", title: "其他（请补充方案和理由）" },
      ]
      : interaction.options.map((option) => ({ const: option.id, title: option.label }));
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
              oneOf: choices,
            },
            comment: {
              type: "string",
              title: "修改意见 / 补充说明",
              description: "选择“提出修改意见”或“其他”时必填",
            },
          },
          required: ["action"],
        },
      }, process.env.NODE_ENV === "test" && /^\d+$/.test(process.env.DEV_FLOW_ELICITATION_TIMEOUT_MS ?? "")
        ? Number(process.env.DEV_FLOW_ELICITATION_TIMEOUT_MS)
        : 60_000);
    } catch {
      this.elicitationFused = true;
      return undefined;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const result = raw as ElicitationResult;
    if (result.action !== "accept" || !result.content || typeof result.content.action !== "string") {
      this.elicitationFused = true;
      return undefined;
    }
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

/**
 * dispatch 的窄端口：MCP 客户端能力（elicit/sampleReview）与注意力通知。
 * 生产实现由入口从 McpConnection 适配；测试注入纯 fake，进程内即可驱动全部工具。
 */
export interface DispatchPorts {
  elicit(interaction: PublicInteraction, question: string): Promise<ElicitationSelection | undefined>;
  sampleReview(job: { role: string; reviewDepth: string; package: unknown }): Promise<unknown>;
  assertSamplingSupported(): void;
  notify(event: AttentionEvent): void;
}

export async function dispatch(root: string, name: string, a: any, ports: DispatchPorts) {
  // 与原入口顺序一致：先 schema 校验（未知工具由 validateToolInput 抛 UNKNOWN_TOOL），
  // 再挡 expose:false 的内部接缝工具。
  validateToolInput(name, a, toolSchemas);
  if (!publicToolSet.has(name)) throw new DevFlowError("UNKNOWN_TOOL", name);
  const pipelinePorts = { elicit: ports.elicit, notify: ports.notify, answer };
  const tool = name as PublicToolName;
  switch (tool) {
    case "dev_flow_init_project": {
      await initProject(root, a.config);
      return { 状态: "已初始化", 配置路径: path.join(root, ".dev-flow", "project.json"), 下一步: "调用 dev_flow_start 开始一个需求。" };
    }
    case "dev_flow_update_project": {
      const result = await updateProjectConfig(root, a.config, a.expectedSha256);
      return { 状态: "已更新", 配置路径: path.join(root, ".dev-flow", "project.json"), previousSha256: result.previousSha256, sha256: result.sha256, 变化: result.impact, 受影响证据: result.affectedEvidence, 下一步: "新增或扩充验证能力可继续当前任务；被引用命令变化的 Trace/RU 需要按错误提示重新登记。" };
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
    case "dev_flow_record_repository_fact": return registerRepositoryFact(root, a.featureId, a.expectedRevision, { observation: a.observation }, a.host);
    case "dev_flow_record_repository_facts": {
      if (!Array.isArray(a.observations)) throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_record_repository_facts requires observations[]");
      const observations = a.observations as Array<RepositoryObservation>;
      return registerRepositoryFacts(root, a.featureId, a.expectedRevision, observations.map((observation) => ({ observation })), a.host);
    }
    case "dev_flow_revise_decision": {
      const result = await reviseDecision(root, a.featureId, a.expectedRevision, a.decisionId, a.newConclusion, a.reason, a.host);
      return elicitAndAnswer(pipelinePorts, result, {
        root, featureId: a.featureId, host: a.host,
        decision: "decision-revision",
        question: result.interaction.question ?? "请确认是否修订该决定。",
      });
    }
    case "dev_flow_revise_plan": {
      const result = await revisePlanDuringImplementation(root, a.featureId, a.expectedRevision, a.traceDelta, a.host);
      return elicitAndAnswer(pipelinePorts, result, {
        root, featureId: a.featureId, host: a.host,
        decision: "plan-revision",
        question: result.interaction.question ?? "请确认是否修订实施计划。",
      });
    }
    case "dev_flow_lock_classification": {
      const classification = normalizeLockClassification(a.classification as Record<string, unknown>);
      const { level, topology, requirements, riskLabels, acceptanceAssistSuggested, scopeFactRefs, topologyFactRefs, uncertaintyFactRefs, riskFactRefs, decisionRefs, controlEnhancements } = classification;
      const state = await lockClassification(root, a.featureId, a.expectedRevision, {
        level, topology, ...(requirements ? { requirements } : {}),
        ...(riskLabels ? { riskLabels } : {}), ...(acceptanceAssistSuggested !== undefined ? { acceptanceAssistSuggested } : {}),
        scopeFactRefs, topologyFactRefs, uncertaintyFactRefs, riskFactRefs, decisionRefs,
        ...(controlEnhancements ? { controlEnhancements } : {}),
        classificationBasis: classification.classificationBasis,
        signals: (classification.classificationBasis as { signals?: any } | undefined)?.signals,
      } as any, a.boundaryAudit);
      const decision = pendingDecisionForState(state);
      const interaction = decision ? pendingInteractionForDecision(state, decision) : undefined;
      if (decision?.kind !== "route-confirmation" || !interaction) return state;
      return elicitAndAnswer(pipelinePorts, { state, interaction: toPublicInteraction(interaction), interactionId: interaction.id }, {
        root, featureId: a.featureId, host: state.lastUpdatedBy.host,
        decision: "route-confirmation",
        question: interaction.question ?? decision.question,
      });
    }
    case "dev_flow_status": return readCompactStatus(root, a.featureId);
    case "dev_flow_inspect": return inspectFeature(root, a.featureId, a.topic);
    case "dev_flow_scaffold_artifact": return scaffoldArtifact(root, a.featureId, a.expectedRevision, a.kind);
    case "dev_flow_record_artifact": return recordArtifact(root, a.featureId, a.expectedRevision, a.kind);
    case "dev_flow_record_artifact_with_trace": {
      const input = traceRegistrationInput(a);
      validateTraceDelta(input.traceDelta);
      return recordArtifactWithTrace(root, input.featureId, input.expectedRevision, input.kind, input.traceDelta);
    }
    case "dev_flow_validate_plan": {
      const input = traceRegistrationInput(a);
      validateTraceDelta(input.traceDelta);
      return validatePlan(root, input.featureId, input.kind, input.traceDelta);
    }
    case "dev_flow_get_traceability": {
      const input = traceReadInput(a);
      const state = await readState(root, input.featureId);
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
      const input = reviewMutationInput(a);
      return createReviewBatch(root, input.featureId, input.expectedRevision);
    }
    case "dev_flow_get_review_job": {
      const input = reviewGetInput(a);
      return getReviewJob(root, input.featureId, input.batchId, input.jobId, input.capability);
    }
    case "dev_flow_claim_review_job": {
      const input = reviewMutationInput(a);
      return claimReviewJob(root, input.featureId, input.expectedRevision, input.batchId as string, input.jobId as string, input.claimRequestId as string);
    }
    case "dev_flow_release_review_job": {
      const input = reviewMutationInput(a);
      return releaseReviewJob(root, input.featureId, input.expectedRevision, input.batchId as string, input.jobId as string, input.capability as string);
    }
    case "dev_flow_start_isolated_review": {
      const input = reviewMutationInput(a);
      if (typeof input.executionId !== "string" || !input.executionId || (input.host !== "claude" && input.host !== "codex")) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_start_isolated_review input does not match its schema");
      }
      return startIsolatedReview(root, input.featureId, input.expectedRevision, input.batchId as string, input.jobId as string, input.executionId, input.host as "claude" | "codex");
    }
    case "dev_flow_submit_review_job": {
      const input = reviewSubmitInput(a);
      try { parseReviewJobCompletion(input.completion); }
      catch (error) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_submit_review_job input does not match its schema", {
          mutationApplied: false,
          ...(error instanceof Error ? { cause: error.message } : {}),
        });
      }
      if (input.attestation !== undefined) {
        try { parseHostAttestation(input.attestation); }
        catch (error) {
          throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_submit_review_job attestation does not match its schema", {
            mutationApplied: false,
            ...(error instanceof Error ? { cause: error.message } : {}),
          });
        }
      }
      const result = await submitReviewJob(
        root, input.featureId, input.expectedRevision, input.batchId, input.jobId, input.capability, input.completion, input.attestation,
      );
      return reviewSubmissionEnvelope(result, input.jobId);
    }
    case "dev_flow_sample_review_job": {
      const input = reviewSamplingInput(a);
      // Capability negotiation is intentionally before beginReviewSampling so an
      // unsupported client cannot create a server-held job or mutate the pointer.
      ports.assertSamplingSupported();
      const started = await beginReviewSampling(root, input.featureId, input.expectedRevision, input.batchId, input.jobId);
      try {
        const completion = await ports.sampleReview({
          role: started.job.role,
          reviewDepth: started.job.reviewDepth,
          package: started.package,
        });
        const completed = await completeReviewSampling(
          root, input.featureId, started.state.revision, input.batchId, input.jobId, started.requestId, completion,
        );
        return reviewSubmissionEnvelope({ ...completed, idempotent: false }, input.jobId);
      } catch (error) {
        try {
          await failReviewSampling(
            root,
            input.featureId,
            started.state.revision,
            input.batchId,
            input.jobId,
            started.requestId,
            samplingFailureCode(error),
          );
        } catch {
          // A CAS conflict or a concurrent recovery must not turn a sampling
          // failure into a successful response. The original failure is safer.
        }
        const code = error instanceof DevFlowError ? error.code : "REVIEW_SAMPLING_FAILED";
        throw new DevFlowError("REVIEW_SAMPLING_FAILED", "sampling review did not produce an accepted completion", {
          batchId: input.batchId,
          jobId: input.jobId,
          causeCode: code,
      });
    }
    }
    case "dev_flow_record_decision": {
      // ADR-0008：较早聊天中的决定先追认；整句命中最近未消费消息时可自动落账。
      const result = await recordDecision(root, a.featureId, a.expectedRevision, a.question, a.evidence, a.conclusion, a.factRefs ?? [], a.host);
      if (!result.interaction || !result.interactionId) {
        return {
          state: result.state,
          decisionId: result.decisionId,
          ratifiedFrom: result.ratifiedFrom,
          question: result.question,
          evidence: result.evidence,
          conclusion: result.conclusion,
        };
      }
      return elicitAndAnswer(pipelinePorts, { state: result.state, interaction: result.interaction, interactionId: result.interactionId }, {
        root, featureId: a.featureId, host: a.host,
        decision: "decision-ratification",
        question: result.interaction.question ?? "请确认是否登记该决定。",
        extra: { decisionId: result.decisionId },
      });
    }
    case "dev_flow_present_review_risk_acceptance": {
      const input = reviewMutationInput(a);
      if (!Array.isArray(input.findingIds) || !input.findingIds.length || input.findingIds.some((findingId) => typeof findingId !== "string" || !findingId)) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_present_review_risk_acceptance input does not match its schema");
      }
      const result = await presentReviewRiskAcceptance(root, input.featureId, input.expectedRevision, input.findingIds);
      return elicitAndAnswer(pipelinePorts, result, {
        root, featureId: input.featureId, host: input.host as "claude" | "codex",
        decision: "review-risk",
        question: result.interaction.question ?? "请决定是否接受当前阻断性发现的风险。",
        pendingOutcome: result.idempotent ? "pending" : "presented",
      });
    }
    case "dev_flow_record_step": {
      if (a.step === "implementation" && a.evidence && typeof a.evidence === "object" && Object.hasOwn(a.evidence, "files")) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "implementation evidence.files was removed in Dev Flow 5.0", {
          issues: [{ path: "$.evidence.files", message: "Core derives implementation files from trusted writes and ownership" }],
          recoveryHint: "删除 evidence.files，先用 implementation inspect 查看派生文件，再重试 record_step",
        });
      }
      return recordStep(root, a.featureId, a.expectedRevision, a.step, a.evidence);
    }
    case "dev_flow_pause": return pauseFeature(root, a.featureId, a.expectedRevision, a.reason, a.host);
    case "dev_flow_resume": return resumeFeature(root, a.featureId, a.host);
    case "dev_flow_reconcile_workspace": return reconcileWorkspace(root, a.featureId, a.expectedRevision, a.host);
    case "dev_flow_begin_implementation_unit": {
      const input = unitMutationInput(a);
      return beginImplementationUnit(root, input.featureId, input.expectedRevision, input.unitId);
    }
    case "dev_flow_checkpoint_implementation_unit": {
      const input = unitMutationInput(a);
      return checkpointImplementationUnit(root, input.featureId, input.expectedRevision, input.unitId);
    }
    case "dev_flow_abandon_implementation_unit": {
      const input = unitMutationInput(a);
      if (typeof input.reason !== "string" || !input.reason.trim() || (input.host !== "claude" && input.host !== "codex")) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_abandon_implementation_unit input does not match its schema");
      }
      return abandonImplementationUnit(root, input.featureId, input.expectedRevision, input.unitId, input.reason, input.host);
    }
    case "dev_flow_preview_rollback": {
      const input = previewRollbackInput(a);
      return previewRollback(root, input.featureId, input.targetCheckpointId);
    }
    case "dev_flow_present_rollback_gate": {
      const input = rollbackMutationInput(a);
      const presentation = await presentRollbackGate(root, input.featureId, input.expectedRevision, input.targetCheckpointId);
      return elicitAndAnswer(pipelinePorts, presentation, {
        root, featureId: input.featureId, host: input.host as "claude" | "codex",
        decision: "rollback-confirmation",
        question: rollbackGateMessage(presentation.preview),
        extra: { preview: presentation.preview },
      });
    }
    case "dev_flow_execute_rollback": {
      const input = rollbackMutationInput(a);
      const result = await executeRollback(root, input.featureId, input.expectedRevision, input.targetCheckpointId);
      return { outcome: result.outcome, state: result.state, transactionId: result.transaction.transactionId };
    }
    case "dev_flow_present_approval": {
      const presentation = await presentApproval(root, a.featureId, a.expectedRevision);
      return elicitAndAnswer(pipelinePorts, presentation, {
        root, featureId: a.featureId, host: a.host,
        decision: "approval",
        approvalId: presentation.approvalId,
        question: "请确认当前执行摘要，或提出需要修改的意见。",
      });
     }
    case "dev_flow_record_acceptance_evidence": {
      return recordAcceptanceEvidence(root, a.featureId, a.expectedRevision, {
        acceptanceCriterionId: a.acceptanceCriterionId,
        evidence: a.evidence,
        host: a.host,
      });
    }
    case "dev_flow_present_acceptance_confirmation": {
      const presentation = await presentAcceptanceConfirmation(root, a.featureId, a.expectedRevision, a.acceptanceCriterionIds);
      return elicitAndAnswer(pipelinePorts, presentation, {
        root, featureId: a.featureId, host: a.host,
        decision: "acceptance-confirmation",
        question: presentation.interaction.question ?? "请确认当前验收结果。",
      });
    }
     case "dev_flow_answer": {
       await assertHostHealth(root, a.host, "回答当前问题");
       const prior = await readState(root, a.featureId);
       const priorDecision = pendingDecisionForState(prior);
       const priorInteraction = priorDecision ? pendingInteractionForDecision(prior, priorDecision) : undefined;
       const result = await answer({
         root,
         featureId: a.featureId,
         expectedRevision: a.expectedRevision,
         host: a.host,
         credential: { source: "text", userReply: a.userReply },
       });
       const interaction = priorInteraction ? getInteraction(result.state, priorInteraction.id) : undefined;
       const publicInteraction = interaction ? toPublicInteraction(interaction) : undefined;
       const response = interaction?.response;
       // 下一题经 answer 返回契约给出（AnswerResult.pending，ADR-0019）：
       // 不再从 result.state 自行重推导 pending。
       const pending = result.pending;
       const message = answerOutcomeMessage(result.action, priorDecision?.kind);
       return {
         ...(publicInteraction ? interactionEnvelope(result.state, publicInteraction, response?.action ?? result.action, response) : { state: result.state }),
         action: result.action,
         ...(result.comment ? { comment: result.comment } : {}),
         ...(message ? { message } : {}),
         ...(pending ? { attention: "请只回答当前这一道问题。", 需要用户决定: true, pending } : { 需要用户决定: false }),
       };
     }
     case "dev_flow_present_quality_exception": {
       const result = await presentQualityException(root, a.featureId, a.expectedRevision, {
         kind: a.kind,
         basisHash: a.basisHash,
         fingerprint: a.fingerprint,
         riskSummary: a.riskSummary,
       });
       return elicitAndAnswer(pipelinePorts, result, {
         root, featureId: a.featureId, host: a.host,
         decision: "quality-exception",
         question: result.interaction.question ?? "请决定是否接受当前风险。",
       });
     }
    case "dev_flow_request_grill_decision": {
      const result = await requestGrillDecision(root, a.featureId, a.expectedRevision, {
        questionId: a.questionId,
        question: a.question,
        options: a.options,
        recommendation: a.recommendation,
         host: a.host,
      });
      return elicitAndAnswer(pipelinePorts, result, {
        root, featureId: a.featureId, host: a.host,
        decision: "grill",
        question: result.interaction.presentation ?? result.interaction.question ?? "请选择一个方案。",
      });
    }
    case "dev_flow_reclassify": return reclassifyFeature(root, a.featureId, a.expectedRevision, a.classification, a.reason, a.userEvidence);
    case "dev_flow_verify": return runVerification(
       root, a.featureId, a.expectedRevision, a.host, a.commandIds,
    );
    case "dev_flow_repair_feature": return repairFeature(root, a.featureId, a.expectedRevision, a.host);
    case "dev_flow_finalize": {
      const state = await finalize(root, a.featureId, a.expectedRevision);
      ports.notify({ kind: "workflow-finalized", featureId: a.featureId });
      return state;
    }
    case "dev_flow_abandon": return abandonFeature(root, a.featureId, a.expectedRevision, a.reason, a.userEvidence);
    case "dev_flow_enable_windows_notifications": return enableWindowsNotifications({ nodeExecutable: process.execPath });
    case "dev_flow_doctor": return collectDoctorReport(root, pluginRootForDoctor(root), __DEV_FLOW_VERSION__, publicTools);
    case "dev_flow_recover_corrupt_feature": return recoverCorruptFeature(root, {
      featureId: a.featureId,
      stateSha256: a.stateSha256,
      activeSha256: a.activeSha256,
      action: a.action,
      reason: a.reason,
      userEvidence: a.userEvidence,
       host: a.host,
    });
    default: {
      // 任一公开工具（PublicToolName）缺 dispatch case 时此赋值在编译期报错
      const _exhaustive: never = tool;
      throw new DevFlowError("UNKNOWN_TOOL", name);
    }
  }
}
