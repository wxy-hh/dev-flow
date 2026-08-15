// 分类、路线与调度合同词汇。审查领域类型见 review.ts；v5 治理记录见 governance-records.ts。
import type { ReviewDepth, ReviewRole } from "./review.js";

export type Level = "XS" | "S" | "M" | "L";
export type Topology = "local" | "shared-contract" | "multi-chain" | "coordinated-rollback";
export type RequirementsState = "missing-or-unclear" | "documented-unconfirmed" | "provided-confirmed";
export type RiskLabel =
  | "security"
  | "data"
  | "money"
  | "external"
  | "availability"
  | "critical_correctness"
  | "irreversible_consequence";
/** v4 base level. Governance is compiled independently into orderedRoute. */
export type RouteId = "xs" | "s" | "m" | "l";
export type ChangeSurface = "single-site" | "single-component" | "multi-component" | "system-wide";
export type BehaviorChange = "mechanical" | "bounded-rule" | "new-capability" | "systemic-change";
export type PlanControl = "locate" | "brief" | "formal";
export type CheckpointControl = "baseline" | "unit-chain";
export type RecoveryControl = "delivery-reverse" | "operational-strategy" | "executable-rollback" | "irreversible-compensation";
export type CodeReviewControl = "none" | "focused" | "independent" | "full";

export interface GovernanceControls {
  requirements: boolean;
  plan: PlanControl;
  trace: boolean;
  planReview: boolean;
  reviewRoles: ReviewRole[];
  executionApproval: boolean;
  checkpoints: CheckpointControl;
  recovery: RecoveryControl[];
  codeReview: CodeReviewControl;
  verification: VerificationKind[];
  reasons: Record<string, string>;
}

/** User-requested controls are additive; Core merges them with factual minima. */
export interface GovernanceControlEnhancements {
  requirements?: true;
  plan?: "brief" | "formal";
  trace?: true;
  planReview?: true;
  reviewRoles?: ReviewRole[];
  executionApproval?: true;
  checkpoints?: "unit-chain";
  recovery?: Array<Exclude<RecoveryControl, "delivery-reverse">>;
  codeReview?: Exclude<CodeReviewControl, "none">;
  verification?: VerificationKind[];
}

export interface BoundaryAuditItem {
  id: string;
  kind: "assumption" | "free-space" | "tbd" | "fallback" | "scope" | "acceptance";
  disposition: "repository-fact" | "resolved-decision";
  /** 指向 governance.repositoryFacts 中当前可核对的事实记录（ADR-0018）。 */
  factRef?: string;
  decisionRef?: string;
  summary: string;
}

export interface BoundaryAudit {
  scanned: Array<BoundaryAuditItem["kind"]>;
  items: BoundaryAuditItem[];
}

export type FeatureLifecycle = "active" | "paused" | "finalized" | "abandoned";
export type Lifecycle = FeatureLifecycle;

export interface StartedDirtyPath {
  status: "staged" | "unstaged" | "untracked" | "deleted" | "renamed";
  sha256?: string;
  blobSha256?: string;
  renamedFrom?: string;
}

export interface ObservedCommit {
  hash: string;
  parentHashes: string[];
  changedPaths: string[];
  source: "feature" | "manual" | "unknown";
  observedAt: string;
}

export interface WorkspaceLineage {
  baseHead: string;
  baseBranch: string;
  observedHead: string;
  startedDirty: Record<string, StartedDirtyPath>;
  ownership: Record<string, "feature" | "excluded">;
  ownershipSource: Record<string, "user-adopted" | "trusted-hook" | "startup-excluded">;
  observedCommits: ObservedCommit[];
  /** Last reconciled per-path content/type/mode basis for precise freshness. */
  observedPathFingerprints: Record<string, string>;
  /** Paths observed as changed but still lacking an explicit ownership conclusion. */
  unownedPaths?: string[];
  lastWorkspaceFingerprint: string;
  reconciliationStatus: "current" | "required" | "blocked";
}

export interface EvidenceFreshness {
  basisHash?: string;
  fingerprint?: string;
  review: "current" | "stale" | "missing";
  verification: "current" | "stale" | "missing";
  checkpoint: "current" | "stale" | "missing";
  implementation: "current" | "stale" | "missing";
}

export type PendingDecisionKind =
  | "grill"
  | "approval"
  | "review-risk"
  | "rollback-confirmation"
  | "quality-exception"
  | "workspace-ownership"
  | "route-confirmation"
  | "task-switch"
  | "decision-ratification"
  | "decision-revision"
  | "plan-revision"
  | "side-effect-rerun"
  | "acceptance-confirmation";

export interface PendingDecisionOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
  requiresComment?: boolean;
  answerCode?: "A" | "B" | "C";
}

export interface PendingDecision {
  kind: PendingDecisionKind;
  question: string;
  options: PendingDecisionOption[];
  recommendation?: { optionId: string; reason: string };
  presentation?: string;
  basisHash: string;
  presentedAt: string;
  presentedRevision: number;
  source: "core";
  /** Internal correlation only; never copied to the default user view. */
  target?: string;
  /** Append-only ledger cursor identifying the event that presented this decision. */
  presentationEventId?: string;
}

export interface QualityException {
  kind: "review" | "verification" | "checkpoint" | "implementation-evidence";
  basisHash: string;
  fingerprint: string;
  riskSummary: string;
  userEvidence: string;
  at: string;
  status: "current" | "stale";
}

export type RiskObligationKind = "review" | "verification" | "rollback" | "approval" | "checkpoint";
export type ObligationStatus = "pending" | "satisfied" | "stale";

export interface ClassificationBasis {
  scopeFactRefs: string[];
  topologyFactRefs: string[];
  uncertaintyFactRefs: string[];
  riskFactRefs: Partial<Record<RiskLabel, string[]>>;
  decisionRefs: string[];
  signals?: ClassificationSignals;
  controlEnhancements?: GovernanceControlEnhancements;
}

export interface ClassificationSignals {
  changeSurface: ChangeSurface;
  behaviorChange: BehaviorChange;
  topology: Topology;
  unitCount: number;
  requirements: RequirementsState;
  operationalRecovery: boolean;
  executableRollback: boolean;
  upwardLevel?: Level;
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
  status: "open" | "resolved" | "merged" | "dismissed" | "superseded";
  evidence?: string;
  conclusion?: string;
  factRefs?: string[];
  mergedInto?: string;
  dismissedReason?: string;
  /** 决策修订链：被该较新决策取代；原始记录保持不可变。 */
  supersededBy?: string;
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
  requirements?: RequirementsState;
  riskLabels?: RiskLabel[];
  classificationBasis?: ClassificationBasis;
  controlEnhancements?: GovernanceControlEnhancements;
  objective?: string;
  scope?: { inScope: string[]; outOfScope: string[] };
  /** Suggest browser/user acceptance assistance without making it a route condition. */
  acceptanceAssistSuggested?: boolean;
}

export interface Classification {
  level: Level;
  topology: Topology;
  requirements?: RequirementsState;
  riskLabels: RiskLabel[];
  acceptanceAssistSuggested: boolean;
  classificationBasis?: ClassificationBasis;
  controls: GovernanceControls;
  orderedRoute: string[];
  routeConfirmationRequired: boolean;
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
}

export type VerificationKind = "targeted" | "behavior" | "integration" | "full";

export interface RequiredEvidence {
  fields: {
    reviewType?: "plan" | "code";
    reviewDepth?: "full";
    /** Satisfied only by Core after it validates the current review batch. */
    reviewBatch?: true;
    files?: "governed-root-paths";
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
  schemaVersion: 5;
  lifecycle: "active" | "paused" | "finalized" | "abandoned";
  route: RouteId;
  /** Core-compiled operational steps for this feature's dynamic controls. */
  orderedSteps?: string[];
  steps: Record<string, StepSnapshot | undefined>;
  obligations?: ClassificationObligation[];
  blockingFindings?: Array<{ blocking: boolean }>;
  classificationViolatesTopology?: boolean;
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
      /** jobs-open: the pending work queue, straight from the review gate. */
      jobs?: Array<{ jobId: string; role: ReviewRole; reviewDepth: ReviewDepth; status: "pending" | "claimed" | "sampling" | "submitted" | "reused" }>;
      /** blocking: unresolved blocking finding ids, straight from the gate result. */
      findingIds?: string[];
      /** isolation: submitted jobs missing an isolation proof, straight from the gate result. */
      jobIds?: string[];
    }
  | {
      kind: "repair-trace";
      step: string;
      code: "TRACE_SLICE_INCOMPLETE" | "TRACE_SLICE_STALE";
      details: Record<string, unknown>;
    }
  /** Phase-3 unit lifecycle: the next implementation unit to begin or checkpoint. */
  | { kind: "begin-implementation-unit"; unitId: string }
  | { kind: "checkpoint-implementation-unit"; unitId: string }
  | { kind: "run-step"; step: string; requiredEvidence?: RequiredEvidence; advisory?: { code: "OPEN_QUESTIONS_UNCONVERGED"; items: string[] } }
  | { kind: "finalize" };
