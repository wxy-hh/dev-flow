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

export type ReviewAssurance =
  | "multi-perspective"
  | "independent-sampling"
  | "multi-agent-verified";

export type ReviewExecutionMode =
  | "isolated-sequential"
  | "parallel-safe"
  | "mcp-sampling"
  | "native-subagent";

export type ReviewRole =
  | "code-quality"
  | "requirement-fidelity"
  | "requirements-coverage"
  | "architecture-testability"
  | "rollback-operability"
  | "security"
  | "data-irreversibility"
  | "money-safety"
  | "contract-failure"
  | "recovery-observability"
  | "critical-correctness";

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
  outcome?: "resolved" | "still-blocking" | "risk-acceptance-required";
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
  verificationFresh?: boolean;
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
      jobs: Array<{ jobId: string; role: ReviewRole; reviewDepth: ReviewDepth; status: "pending" | "claimed" | "sampling" | "submitted" | "reused" }>;
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
  | { kind: "run-step"; step: string; requiredEvidence?: RequiredEvidence }
  | { kind: "finalize" };

// ===== v5 治理记录（Issue 01：类型隔离 + 依据当前性） =====
//
// 五类治理记录保持独立领域类型：决策表达用户当前选择，治理声明表达某项
// 流程要求当前成立，授权表达用户允许特定动作或接受特定风险，凭证只证明
// 用户确实作出了回答，已确认仓库事实只记录可定位的观察结论。任何一类
// 都不能转换成另一类（ADR-0003、spec 类型隔离）。当前性一律由 Core 的
// 依据状态模块从不可变记录与当前依据派生，调用者不得写入结论字段。

/** 记录依据：记录产生时绑定的内容、事件或语义切片。 */
export type RecordBasisKind = "content" | "event" | "slice";
export type RecordBasis =
  | { kind: "content"; sha256: string }
  | { kind: "event"; eventId: string }
  | { kind: "slice"; sliceKey: string; sliceHash: string };

/** 当前性结论：只由 Core 依据状态模块派生，不允许写入记录。 */
export type RecordCurrency = "current" | "stale" | "unconfirmed";

export interface GovernanceRecordBase {
  recordId: string;
  /** 追加修订链：被该较新记录取代；原始记录保持不可变。 */
  supersededBy?: string;
  /** 记录产生时的依据；v4 迁移记录可能缺失（保守派生为 unconfirmed）。 */
  basis?: RecordBasis;
  recordedAt?: string;
}

/** 决策：用户针对一个具体问题的当前结论。 */
export interface GovernanceDecision extends GovernanceRecordBase {
  kind: "decision";
  question: string;
  conclusion: string;
  credentialId?: string;
}

/** 治理声明：某项流程要求当前成立的 Core 判断。 */
export interface GovernanceClaim extends GovernanceRecordBase {
  kind: "claim";
  claimType: "review-complete" | "verification-current" | "checkpoint-current" | "approval-current" | "risk-accepted";
  subject: string;
}

/** 授权：用户允许特定动作或接受特定风险的有界许可。 */
export interface GovernanceAuthorization extends GovernanceRecordBase {
  kind: "authorization";
  authorizationType: "risk-acceptance" | "dangerous-command" | "approval";
  target: string;
  credentialId?: string;
}

/** 凭证：证明用户确实作出了回答；只来自宿主捕获，不来自智能体转述。 */
export interface GovernanceCredential extends GovernanceRecordBase {
  kind: "credential";
  source: "native-form" | "text";
  host: "claude" | "codex";
  interactionId: string;
  optionId?: string;
  rawText?: string;
}

/** 独立的验收记录；验收记录不是通用 evidence，也不能转化为授权或治理声明。 */
export type AcceptanceEvidenceKind = "browser-operation" | "screenshot" | "file-inspection" | "agent-self-check";
export interface AcceptanceEvidenceRecord extends GovernanceRecordBase {
  kind: "acceptance-evidence";
  evidenceKind: AcceptanceEvidenceKind;
  acceptanceCriterionId: `AC-${string}`;
  basis: { kind: "content"; sha256: string };
  /** 由 Core 复制后的内容寻址文件，仅 screenshot/file-inspection 使用。 */
  artifactPath?: string;
  artifactSha256?: string;
  eventId?: string;
  observation?: RepositoryObservation;
  note?: string;
}

export interface AcceptanceDispositionState {
  acceptanceCriterionId: `AC-${string}`;
  dispositionKind: "behavior-test" | "type-check" | "rule-check" | "file-check" | "human-acceptance";
  status: "pending" | "satisfied" | "stale";
  evidenceRefs: string[];
  basis: { kind: "content"; sha256: string };
}

export interface AcceptanceState {
  evidence: AcceptanceEvidenceRecord[];
  dispositions: AcceptanceDispositionState[];
}

/** 仓库事实位置：肯定事实指向具体位置，否定事实记录检查范围。 */
export type RepositoryFactLocation =
  | { kind: "positive"; path: string; anchor?: string }
  | { kind: "negative"; checkedScope: string[]; conditions: string };

export type RepositoryObservation =
  | { kind: "file-exists"; path: string }
  | { kind: "text-present"; path: string; text: string; occurrence?: number }
  | { kind: "symbol-present"; path: string; symbol: string }
  | { kind: "json-value"; path: string; pointer: string; expected: unknown }
  | { kind: "search-absent"; checkedScope: string[]; pattern: string; patternKind: "literal" | "regex" };

/** 已确认仓库事实：肯定事实指向具体位置，否定事实记录检查范围。 */
export interface GovernanceRepositoryFact extends GovernanceRecordBase {
  kind: "repository-fact";
  assertion: string;
  location: RepositoryFactLocation;
  /** 可重复执行的机器观察；旧位置字段仅保留给加载入口迁移与展示。 */
  observation?: RepositoryObservation;
  observedFingerprint: string;
}

export interface GovernanceLedger {
  decisions: GovernanceDecision[];
  claims: GovernanceClaim[];
  authorizations: GovernanceAuthorization[];
  credentials: GovernanceCredential[];
  repositoryFacts: GovernanceRepositoryFact[];
}

export const EMPTY_GOVERNANCE_LEDGER: GovernanceLedger = Object.freeze({
  decisions: [],
  claims: [],
  authorizations: [],
  credentials: [],
  repositoryFacts: [],
});
