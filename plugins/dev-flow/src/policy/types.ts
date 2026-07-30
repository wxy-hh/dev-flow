export type Level = "XS" | "S" | "M" | "L";
export type Topology = "local" | "shared-contract" | "multi-chain" | "coordinated-rollback";
export type Execution = "light" | "standard";
export type RequirementsState = "missing-or-unclear" | "documented-unconfirmed" | "provided-confirmed";
export type RiskLabel =
  | "security"
  | "data"
  | "money"
  | "external"
  | "availability"
  | "critical_correctness"
  | "irreversible_consequence";
export type RouteId = "xs" | "s" | "risk-minimal" | "light-m" | "standard-m" | "light-l" | "standard-l";

export interface WorkflowCapabilities {
  trace: 0 | 1;
  review: 0 | 1;
  checkpoints: 0 | 1;
  rollbackExecution: 0 | 1;
}

export const ZERO_WORKFLOW_CAPABILITIES: WorkflowCapabilities = Object.freeze({
  trace: 0,
  review: 0,
  checkpoints: 0,
  rollbackExecution: 0,
});

export const SUPPORTED_WORKFLOW_CAPABILITIES: WorkflowCapabilities = Object.freeze({
  trace: 1,
  review: 1,
  checkpoints: 1,
  rollbackExecution: 1,
});

export interface ClassificationInput {
  level: Level;
  topology: Topology;
  execution?: Execution;
  requirements?: RequirementsState;
  riskLabels?: RiskLabel[];
  /** Suggest browser/user acceptance assistance without making it a route condition. */
  acceptanceAssistSuggested?: boolean;
  /** @deprecated Compatibility input; new state never persists this field. */
  manualAcceptanceRequired?: boolean;
}

export interface Classification {
  level: Level;
  topology: Topology;
  execution?: Execution;
  requirements?: RequirementsState;
  riskLabels: RiskLabel[];
  acceptanceAssistSuggested: boolean;
}

export interface RouteDefinition {
  orderedSteps: string[];
  requiredArtifacts: string[];
  generatedArtifacts?: string[];
  artifactSteps?: Record<string, string[]>;
  generatedArtifactSteps?: Record<string, string[]>;
  artifactTransitions?: Array<{
    artifact: string;
    capability: keyof WorkflowCapabilities;
    from: "editable" | "absent";
    to: "generated";
    steps: string[];
  }>;
  featureCheckRequired: boolean;
}

export type ReviewAssurance =
  | "multi-perspective"
  | "independent-sampling"
  | "multi-agent-attested"
  | "multi-agent-verified";

export type ReviewExecutionMode =
  | "isolated-sequential"
  | "mcp-sampling"
  | "native-subagent";

export type ReviewRole =
  | "requirements-coverage"
  | "architecture-testability"
  | "rollback-operability"
  | "security"
  | "data-irreversibility";

/** Review 2a keeps finding categories aligned with the role that produced them. */
export type ReviewFindingCategory = ReviewRole;
export type ReviewDepth = "standard" | "full";
export type ReviewFindingSeverity = "blocking" | "warning" | "note";

export interface ReviewJobRequirement {
  role: ReviewRole;
  reviewDepth: ReviewDepth;
}

export interface ReviewJobCompletion {
  coverageSummary: string;
  findings: ReviewFindingInput[];
  resolutions?: ReviewFindingResolutionInput[];
}

export interface ReviewFindingInput {
  severity: ReviewFindingSeverity;
  category: ReviewFindingCategory;
  targets: string[];
  evidence: Array<{ path: string; line?: number }>;
  claim: string;
  recommendation: string;
}

export interface ReviewFinding extends ReviewFindingInput {
  findingId: string;
  jobId: string;
}

export interface ReviewFindingResolutionInput {
  findingId: string;
  evidence: Array<{ path: string; line?: number }>;
  note: string;
}

export type VerificationKind = "targeted" | "behavior" | "integration" | "full";

export interface RequiredEvidence {
  fields: {
    reviewType?: "plan" | "code";
    reviewDepth?: "full";
    /** Satisfied only by Core after it validates the current review batch. */
    reviewBatch?: true;
  };
  checks: string[];
  verificationKinds: VerificationKind[];
}

export interface RiskEnhancement {
  checks: string[];
  verification: Exclude<VerificationKind, "targeted">;
}

export interface DerivedRiskRequirements {
  checks: string[];
  verification: Array<RiskEnhancement["verification"]>;
}

export interface StepSnapshot {
  status: "pending" | "satisfied";
  artifactReady?: boolean;
}

export interface DeriveState {
  schemaVersion: 1;
  lifecycle: "active" | "paused" | "finalized" | "abandoned";
  route: RouteId;
  steps: Record<string, StepSnapshot | undefined>;
  blockingFindings?: Array<{ blocking: boolean }>;
  classificationViolatesTopology?: boolean;
  verificationFresh?: boolean;
  featureCheckFresh?: boolean;
  logicComplete?: boolean;
}

export type NextAction =
  | { kind: "done" }
  | { kind: "stop"; reason: "reclassification-required" | "resolve-blocking-findings" }
  | { kind: "present-human-gate"; step: string }
  | { kind: "wait-human-gate"; step: string }
  | { kind: "scaffold-artifact"; step: string }
  /** Core owns the batch lifecycle before a review-enforced plan review can run. */
  | { kind: "create-review-batch"; step: "plan_review" }
  | {
      kind: "review-jobs-pending";
      step: "plan_review";
      batchId: string;
      jobs: Array<{ jobId: string; role: ReviewRole; reviewDepth: ReviewDepth; status: "pending" | "claimed" | "sampling" | "submitted" }>;
    }
  | {
      kind: "repair-trace";
      step: string;
      code: "TRACE_SLICE_INCOMPLETE" | "TRACE_SLICE_STALE";
      details: Record<string, unknown>;
    }
  /** Phase-3 unit lifecycle: the next rollback unit to begin or checkpoint. */
  | { kind: "begin-implementation-unit"; unitId: string }
  | { kind: "checkpoint-implementation-unit"; unitId: string }
  | { kind: "run-step"; step: string; requiredEvidence?: RequiredEvidence }
  | { kind: "feature-check"; requiredEvidence?: RequiredEvidence }
  | { kind: "finalize" };
