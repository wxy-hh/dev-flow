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
/** The only base routes in v2. Risk never creates another route. */
export type RouteId = "xs" | "s" | "light-m" | "standard-m" | "light-l" | "standard-l";

export type RiskObligationKind = "review" | "verification" | "rollback" | "approval" | "checkpoint";
export type ObligationStatus = "pending" | "satisfied" | "stale";

export interface ClassificationBasis {
  scopeFacts: string[];
  topologyFacts: string[];
  uncertaintyFacts: string[];
  riskFacts: Partial<Record<RiskLabel, string[]>>;
  decisionRefs: string[];
  signals?: ClassificationSignals;
}

export interface ClassificationSignals {
  impactScope: "single-location" | "single-module" | "cross-module";
  sharedContract: boolean;
  independentChains: number;
  coordinatedRollback: boolean;
  requirements: RequirementsState;
  formalControls: Array<"trace" | "independent-review" | "multiple-rollback-units">;
}

export interface ClassificationReason {
  field: string;
  value: string | number | boolean;
  basisPaths: string[];
  message: string;
}

export interface ClassificationIssue {
  code: string;
  path: string;
  message: string;
  recoveryHint: string;
}

export type ClassificationPreview =
  | {
      readyToLock: true;
      classification: Classification;
      route: RouteId;
      obligations: ClassificationObligation[];
      reasons: ClassificationReason[];
      issues: [];
    }
  | {
      readyToLock: false;
      classification?: Classification;
      route?: RouteId;
      obligations?: ClassificationObligation[];
      reasons: ClassificationReason[];
      issues: ClassificationIssue[];
    };

export interface ClassificationFacts extends ClassificationBasis {
  level: Level;
  topology: Topology;
  execution?: Execution;
  requirements?: RequirementsState;
  riskLabels?: RiskLabel[];
  acceptanceAssistSuggested?: boolean;
}

export interface ClassificationObligation {
  id: string;
  kind: RiskObligationKind;
  source: "route" | "risk" | "topology" | "uncertainty";
  basisHash: string;
  status: ObligationStatus;
  reason: string;
  roles?: string[];
  verificationKinds?: VerificationKind[];
}

export interface StageCapabilityView {
  stage: string;
  activity: string;
  allowedActions: string[];
  completionCriteria: string[];
  obligations: Array<Pick<ClassificationObligation, "id" | "kind" | "status" | "reason">>;
  requiredEvidence?: RequiredEvidence;
  recoveryAction?: RecoveryAction;
  attention?: { reason: string; required: true };
}

export type RecoveryAction =
  | { kind: "retry"; reason: string }
  | { kind: "refresh-status"; reason: string }
  | { kind: "use-equivalent-operation"; reason: string }
  | { kind: "repair-current-unit"; reason: string }
  | { kind: "revise-plan"; reason: string }
  | { kind: "reclassify"; reason: string }
  | { kind: "ask-user"; reason: string; facts: string[]; impact: string; recommendation: string };

export interface DecisionRecord {
  id: string;
  question: string;
  status: "open" | "resolved" | "merged" | "dismissed";
  evidence?: string;
  conclusion?: string;
  factRefs?: string[];
  mergedInto?: string;
  dismissedReason?: string;
  source?: "grill";
}

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
  level?: Level;
  topology?: Topology;
  execution?: Execution;
  requirements?: RequirementsState;
  riskLabels?: RiskLabel[];
  classificationBasis?: ClassificationBasis;
  objective?: string;
  scope?: { inScope: string[]; outOfScope: string[] };
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
  classificationBasis?: ClassificationBasis;
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
    files?: "protected-root-paths";
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
  schemaVersion: 2;
  lifecycle: "active" | "paused" | "finalized" | "abandoned";
  route: RouteId;
  steps: Record<string, StepSnapshot | undefined>;
  obligations?: ClassificationObligation[];
  blockingFindings?: Array<{ blocking: boolean }>;
  classificationViolatesTopology?: boolean;
  verificationFresh?: boolean;
  featureCheckFresh?: boolean;
  logicComplete?: boolean;
  repair?: { status: "active" | "stalled" | "waiting-user" | "completed"; recoveryAction?: RecoveryAction };
}

export type NextAction =
  | { kind: "done" }
  | { kind: "intake"; activity: "investigate" | "resolve-decision" | "lock-classification"; reason: string }
  | { kind: "stop"; reason: "reclassification-required" | "resolve-blocking-findings" }
  | { kind: "waiting-user"; reason: string; recoveryAction: RecoveryAction }
  | { kind: "present-human-gate"; step: string }
  | { kind: "wait-human-gate"; step: string }
  | { kind: "scaffold-artifact"; step: string }
  /** Core owns the batch lifecycle before a review-enforced plan review can run. */
  | { kind: "create-review-batch"; step: "planning" }
  | {
      kind: "review-jobs-pending";
      step: "planning";
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
