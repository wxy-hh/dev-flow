import readline from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { recordArtifact, recordArtifactWithTrace, scaffoldArtifact } from "../core/artifacts.js";
import { DevFlowError } from "../core/errors.js";
import { featureCheck, finalize, recordStep } from "../core/feature-check.js";
import { confirmGate, presentGate, resolveGateElicitation, resolveGateToken } from "../core/human-gates.js";
import {
  initProject, startFeature, abandonFeature, reclassifyFeature, switchActive, recoverCorruptFeature, readState,
} from "../core/state-store.js";
import { nextAction } from "../core/next.js";
import { readStatusView } from "../core/status.js";
import { runVerification } from "../core/verification.js";
import { allowedRiskLabels } from "../policy/contract.js";
import { deriveRiskRequirements, selectRoute } from "../policy/route.js";
import { collectDoctorReport } from "./doctor.js";
import { emitAttention } from "./attention.js";
import { enableWindowsNotifications } from "./windows-notifications.js";
import { requestGrillDecision, resolveGrillElicitation, resolveGrillToken } from "../core/requirements-grill.js";
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
  resolveReviewRiskAcceptanceToken,
  submitReviewJob,
} from "../core/review-jobs.js";
import { parseReviewJobCompletion } from "../policy/review.js";
import {
  getInteraction,
  interactionResponse,
  toPublicInteraction,
  type InteractionResponse,
  type PublicInteraction,
} from "../core/user-interactions.js";

const root = process.cwd();
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.basename(moduleDirectory) === "dist" ? path.resolve(moduleDirectory, "..") : path.resolve(moduleDirectory, "../..");
const tools = [
  "dev_flow_init_project", "dev_flow_classify", "dev_flow_start", "dev_flow_status", "dev_flow_next",
  "dev_flow_switch_active", "dev_flow_scaffold_artifact", "dev_flow_record_artifact", "dev_flow_record_step",
  "dev_flow_record_artifact_with_trace", "dev_flow_get_traceability",
  "dev_flow_create_review_batch", "dev_flow_get_review_job", "dev_flow_claim_review_job", "dev_flow_submit_review_job", "dev_flow_sample_review_job",
  "dev_flow_present_review_risk_acceptance", "dev_flow_resolve_review_risk_acceptance",
  "dev_flow_present_gate", "dev_flow_confirm_gate", "dev_flow_reclassify", "dev_flow_verify",
  "dev_flow_respond_interaction", "dev_flow_request_grill_decision", "dev_flow_resolve_grill_decision",
  "dev_flow_feature_check", "dev_flow_finalize", "dev_flow_abandon", "dev_flow_enable_windows_notifications", "dev_flow_doctor",
  "dev_flow_recover_corrupt_feature",
];

const object = (required: string[], properties: Record<string, unknown> = {}) => ({
  type: "object", required, properties, additionalProperties: false,
});
const string = { type: "string", minLength: 1 };
const integer = { type: "integer", minimum: 0 };
const featureMutation = (extra: Record<string, unknown> = {}) => object(
  ["featureId", "expectedRevision"],
  { featureId: string, expectedRevision: integer, ...extra },
);

const riskLabelsSchema = { type: "array", items: { enum: allowedRiskLabels }, uniqueItems: true };
const traceArtifactKinds = ["requirements", "implementation-plan", "coverage-matrix", "rollback-units"] as const;
const traceId = (prefix: string) => ({ type: "string", pattern: `^${prefix}-[0-9]{3,}$` });
const stringArray = { type: "array", minItems: 1, items: string };
const traceNodeSchemas = [
  object(["kind", "id"], { kind: { const: "requirement" }, id: traceId("REQ") }),
  object(["kind", "id", "parentRequirement"], { kind: { const: "acceptance-criterion" }, id: traceId("AC"), parentRequirement: traceId("REQ") }),
  object(["kind", "id", "covers", "rollbackUnit"], { kind: { const: "task" }, id: traceId("TASK"), covers: stringArray, rollbackUnit: traceId("RU") }),
  object(["kind", "id", "verifies"], { kind: { const: "test" }, id: traceId("TEST"), verifies: { type: "array", minItems: 1, items: traceId("AC") } }),
  object(["kind", "id", "tasks", "dependsOn", "fileScope", "covers", "forwardVerification", "rollbackVerification"], {
    kind: { const: "rollback" }, id: traceId("RU"), tasks: { type: "array", minItems: 1, items: traceId("TASK") },
    dependsOn: { type: "array", items: traceId("RU") }, fileScope: stringArray, covers: stringArray,
    forwardVerification: stringArray, rollbackVerification: stringArray,
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

const scopeSchema = {
  type: "object",
  required: ["inScope", "outOfScope"],
  additionalProperties: false,
  properties: {
    inScope: { type: "array", items: { type: "string" } },
    outOfScope: { type: "array", items: { type: "string" } },
  },
};

const manualAcceptanceSchema = object(["mode", "source", "scenarios"], {
  mode: { enum: ["browser", "user-signoff", "code-path-audit"] },
  source: string,
  promptEventId: string,
  userReply: string,
  scenarios: {
    type: "array",
    minItems: 1,
    items: object(["name", "evidence"], { name: string, evidence: string }),
  },
});

const interactionOptionSchema = object(["id", "label"], {
  id: string,
  label: string,
  description: string,
  requiresComment: { type: "boolean" },
});

const toolSchemas: Record<string, { description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean> }> = {
  dev_flow_init_project: { description: "Create strict project configuration.", inputSchema: object(["config"], { config: { type: "object" } }) },
  dev_flow_classify: {
    description: "Pure route classification.",
    inputSchema: object(["level", "topology"], {
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
    description: "Create a classified feature.",
    inputSchema: object(["level", "topology"], {
      level: { enum: ["XS", "S", "M", "L"] },
      topology: { enum: ["local", "shared-contract", "multi-chain", "coordinated-rollback"] },
      execution: { enum: ["light", "standard"] },
      requirements: { enum: ["missing-or-unclear", "documented-unconfirmed", "provided-confirmed"] },
      riskLabels: riskLabelsSchema,
      acceptanceAssistSuggested: { type: "boolean", description: "Offer optional browser/user acceptance help; never blocks the route." },
      manualAcceptanceRequired: { type: "boolean" },
      featureId: string,
      activation: { enum: ["active", "paused"] },
      scope: scopeSchema,
      host: { enum: ["claude", "codex"] },
    }),
  },
  dev_flow_status: { description: "Read one feature StatusView (state + progress).", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_next: { description: "Return the unique allowed next action.", inputSchema: object(["featureId"], { featureId: string }), annotations: { readOnlyHint: true } },
  dev_flow_switch_active: { description: "Atomically hand off the single active feature.", inputSchema: object(["fromFeatureId", "toFeatureId", "reason"], { fromFeatureId: string, toFeatureId: string, reason: string }) },
  dev_flow_scaffold_artifact: { description: "Create only the current route artifact. For editable artifacts, read the registered path before editing, then record it. Generated status artifacts are read-only: scaffold them and continue with the requested step; do not edit or record them.", inputSchema: featureMutation({ kind: string }) },
  dev_flow_record_artifact: { description: "Register an edited route artifact.", inputSchema: featureMutation({ kind: string }) },
  dev_flow_record_artifact_with_trace: {
    description: "Atomically register one Trace source artifact and its complete Trace delta.",
    inputSchema: featureMutation({ kind: { enum: traceArtifactKinds }, traceDelta: traceDeltaSchema }),
  },
  dev_flow_get_traceability: {
    description: "Read the current Trace pointer, ledger, effective summary, and current-step blockers.",
    inputSchema: object(["featureId"], { featureId: string }),
    annotations: { readOnlyHint: true },
  },
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
    inputSchema: featureMutation({ batchId: string, jobId: string, claimRequestId: string }),
  },
  dev_flow_submit_review_job: {
    description: "Submit one claimed job's structured completion. Assurance, role, depth, and basis are Core-derived.",
    inputSchema: featureMutation({ batchId: string, jobId: string, capability: string, completion: reviewCompletionSchema }),
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
    inputSchema: featureMutation({ findingIds: { type: "array", minItems: 1, uniqueItems: true, items: string } }),
  },
  dev_flow_resolve_review_risk_acceptance: {
    description: "Resolve the one-time risk-acceptance token. Replays are accepted only for the identical prior reply.",
    inputSchema: featureMutation({
      interactionId: string,
      userReply: string,
      promptEventId: string,
      host: { enum: ["claude", "codex"] },
    }),
  },
  dev_flow_record_step: { description: "Record the current non-gate route step.", inputSchema: featureMutation({ step: string, evidence: {} }) },
  dev_flow_present_gate: { description: "Present a strict human gate.", inputSchema: featureMutation({ gate: { enum: ["requirement_confirmation", "implementation_approval"] } }) },
  dev_flow_confirm_gate: {
    description: "Confirm a presented gate with later user evidence.",
    inputSchema: featureMutation({
      gate: { enum: ["requirement_confirmation", "implementation_approval"] },
      userReply: string,
      promptEventId: string,
      turnBoundaryEventId: string,
      host: { enum: ["claude", "codex"] },
    }),
  },
  dev_flow_respond_interaction: {
    description: "Resolve the current gate through its one-time text-token fallback.",
    inputSchema: featureMutation({
      interactionId: string,
      userReply: string,
      promptEventId: string,
      turnBoundaryEventId: string,
      host: { enum: ["claude", "codex"] },
    }),
  },
  dev_flow_request_grill_decision: {
    description: "Present the current grill question as structured choices when the host supports MCP elicitation, otherwise return one-time text replies.",
    inputSchema: featureMutation({
      questionId: string,
      question: string,
      options: { type: "array", minItems: 2, maxItems: 8, items: interactionOptionSchema },
      host: { enum: ["claude", "codex"] },
    }),
  },
  dev_flow_resolve_grill_decision: {
    description: "Resolve a current grill question through its one-time text-token fallback.",
    inputSchema: featureMutation({
      interactionId: string,
      userReply: string,
      promptEventId: string,
      host: { enum: ["claude", "codex"] },
    }),
  },
  dev_flow_reclassify: {
    description: "Reclassify route (stricter always; same-level standard→light with userEvidence before implementation).",
    inputSchema: featureMutation({ classification: { type: "object" }, reason: string, userEvidence: string }),
  },
  dev_flow_verify: {
    description: "Run only configured verification commands and optionally record manual acceptance.",
    inputSchema: featureMutation({
      commandIds: { type: "array", items: string },
      host: { enum: ["claude", "codex"] },
      manualAcceptance: manualAcceptanceSchema,
    }),
  },
  dev_flow_feature_check: { description: "Check route completeness and fresh evidence.", inputSchema: featureMutation() },
  dev_flow_finalize: { description: "Set logic-complete after all obligations pass.", inputSchema: featureMutation() },
  dev_flow_abandon: { description: "Terminally abandon a non-finalized feature.", inputSchema: featureMutation({ reason: string, userEvidence: string }) },
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
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
    },
  })}\n`);
}

function failure(id: unknown, error: unknown) {
  const value = error instanceof DevFlowError
    ? { code: error.code, message: error.message, details: error.details }
    : { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: value.message, data: value } })}\n`);
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
  featureId: string; expectedRevision: number; batchId: string; jobId: string; capability: string; completion: unknown;
} {
  assertReviewMutationInput(value, "dev_flow_submit_review_job", ["batchId", "jobId", "capability"], ["completion"]);
  try { parseReviewJobCompletion(value.completion); }
  catch {
    throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_submit_review_job input does not match its schema");
  }
}

function assertReviewSamplingInput(value: unknown): asserts value is Record<string, unknown> & {
  featureId: string; expectedRevision: number; batchId: string; jobId: string;
} {
  assertReviewMutationInput(value, "dev_flow_sample_review_job", ["batchId", "jobId"]);
}

type ElicitationResult = { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };
type ElicitationSelection = { action: string; comment?: string };

/** A consistent result shape for every native or text interaction operation. */
function interactionEnvelope(
  state: object,
  interaction: PublicInteraction,
  interactionOutcome: string,
  response?: InteractionResponse,
) {
  return {
    ...state,
    interaction,
    interactionOutcome,
    ...(response ? { response } : {}),
  };
}

/** A submitter may inspect its own accepted payload, never sibling review output. */
function reviewSubmissionEnvelope(
  result: Awaited<ReturnType<typeof submitReviewJob>>,
  submittedJobId: string,
) {
  const job = result.batch.jobs.find((candidate) => candidate.jobId === submittedJobId);
  if (!job) throw new DevFlowError("REVIEW_INTEGRITY_FAILED", "submitted review job is missing from its batch", { submittedJobId });
  const { claim: _claim, ...publicJob } = job;
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
    this.supportsFormElicitation = Object.keys(modes).length === 0 || modes.form !== undefined;
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
    case "dev_flow_init_project": return initProject(root, a.config);
    case "dev_flow_classify": {
      const selected = selectRoute(a);
      return {
        ...selected,
        riskRequirements: deriveRiskRequirements(selected.classification.riskLabels),
      };
    }
    case "dev_flow_start": return startFeature(root, { ...a, host: a.host ?? "codex" });
    case "dev_flow_status": return readStatusView(root, a.featureId);
    case "dev_flow_next": return nextAction(root, a.featureId);
    case "dev_flow_switch_active": return switchActive(root, a.fromFeatureId, a.toFeatureId, a.reason);
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
    case "dev_flow_submit_review_job": {
      assertReviewSubmitInput(a);
      const result = await submitReviewJob(root, a.featureId, a.expectedRevision, a.batchId, a.jobId, a.capability, a.completion);
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
    case "dev_flow_present_review_risk_acceptance": {
      assertReviewMutationInput(a, "dev_flow_present_review_risk_acceptance", [], ["findingIds"]);
      if (!Array.isArray(a.findingIds) || !a.findingIds.length || a.findingIds.some((findingId) => typeof findingId !== "string" || !findingId)) {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_present_review_risk_acceptance input does not match its schema");
      }
      const result = await presentReviewRiskAcceptance(root, a.featureId, a.expectedRevision, a.findingIds);
      return interactionEnvelope(result.state, result.interaction, result.idempotent ? "pending" : "presented");
    }
    case "dev_flow_resolve_review_risk_acceptance": {
      assertReviewMutationInput(a, "dev_flow_resolve_review_risk_acceptance", ["interactionId", "userReply", "promptEventId"], ["host"]);
      if (a.host !== undefined && a.host !== "claude" && a.host !== "codex") {
        throw new DevFlowError("INVALID_TOOL_INPUT", "dev_flow_resolve_review_risk_acceptance input does not match its schema");
      }
      const result = await resolveReviewRiskAcceptanceToken(
        root, a.featureId, a.expectedRevision, a.interactionId as string, a.userReply as string,
        a.promptEventId as string, (a.host as "claude" | "codex" | undefined) ?? "codex",
      );
      const interaction = toPublicInteraction(getInteraction(result.state, a.interactionId as string));
      return interactionEnvelope(result.state, interaction, result.idempotent ? "accepted" : "resolved", interactionResponse(result.state, a.interactionId as string));
    }
    case "dev_flow_record_step": return recordStep(root, a.featureId, a.expectedRevision, a.step, a.evidence);
    case "dev_flow_present_gate": {
      const presentation = await presentGate(root, a.featureId, a.expectedRevision, a.gate);
      emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: a.gate });
      const selection = await connection.elicit(
        presentation.gateInteraction,
        a.gate === "requirement_confirmation"
          ? "请确认当前需求，或提出需要修改的意见。"
          : "请确认当前实现计划，或提出需要修改的意见。",
      );
      if (!selection) return interactionEnvelope(presentation, presentation.gateInteraction, "pending");
      const state = await resolveGateElicitation(
        root, a.featureId, presentation.revision, presentation.gateInteraction.id,
        selection.action, selection.comment, a.host ?? "codex",
      );
      return interactionEnvelope(
        state,
        presentation.gateInteraction,
        selection.action,
        interactionResponse(state, presentation.gateInteraction.id),
      );
    }
    case "dev_flow_confirm_gate": return confirmGate(root, a.featureId, a.expectedRevision, a.gate, a.userReply, { promptEventId: a.promptEventId, turnBoundaryEventId: a.turnBoundaryEventId }, a.host ?? "codex");
    case "dev_flow_respond_interaction": {
      const state = await resolveGateToken(
        root, a.featureId, a.expectedRevision, a.interactionId, a.userReply,
        { promptEventId: a.promptEventId, turnBoundaryEventId: a.turnBoundaryEventId }, a.host ?? "codex",
      );
      const response = interactionResponse(state, a.interactionId);
      return interactionEnvelope(
        state,
        toPublicInteraction(getInteraction(state, a.interactionId)),
        response?.action ?? "resolved",
        response,
      );
    }
    case "dev_flow_request_grill_decision": {
      const result = await requestGrillDecision(root, a.featureId, a.expectedRevision, {
        questionId: a.questionId,
        question: a.question,
        options: a.options,
        host: a.host ?? "codex",
      });
      emitAttentionNotification({ kind: "decision-required", featureId: a.featureId, decision: "grill" });
      const selection = await connection.elicit(result.interaction, result.interaction.question ?? "请选择一个方案。");
      if (!selection) return interactionEnvelope(result.state, result.interaction, "pending");
      const resolved = await resolveGrillElicitation(
        root, a.featureId, result.state.revision, result.interaction.id,
        selection.action, selection.comment, a.host ?? "codex",
      );
      return interactionEnvelope(resolved.state, resolved.interaction, selection.action, resolved.response);
    }
    case "dev_flow_resolve_grill_decision": {
      const resolved = await resolveGrillToken(
        root, a.featureId, a.expectedRevision, a.interactionId, a.userReply, a.promptEventId, a.host ?? "codex",
      );
      return interactionEnvelope(resolved.state, resolved.interaction, resolved.response?.action ?? "resolved", resolved.response);
    }
    case "dev_flow_reclassify": return reclassifyFeature(root, a.featureId, a.expectedRevision, a.classification, a.reason, a.userEvidence);
    case "dev_flow_verify": return runVerification(
      root, a.featureId, a.expectedRevision, a.host ?? "codex", a.commandIds, a.manualAcceptance,
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
      host: a.host ?? "codex",
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
        instructions: "Classify before starting. Call dev_flow_next and execute exactly one returned action. A presented human gate may open a native structured confirmation control; otherwise use the returned one-time reply. Use dev_flow_init_project before start.",
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
      toolResult(message.id, await call(message.params?.name, message.params?.arguments ?? {}, connection));
      return;
    }
    if (message.method === "ping") {
      protocolResult(message.id, {});
      return;
    }
    failure(message.id, new DevFlowError("UNKNOWN_METHOD", String(message.method ?? "missing method")));
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
