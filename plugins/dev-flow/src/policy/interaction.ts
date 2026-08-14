// 交互合同（CONTEXT.md「交互」）：等待用户决定的单一问题及其选项的持久化形状。
export type InteractionKind = "approval" | "grill" | "risk-acceptance" | "rollback-confirmation" | "quality-exception" | "workspace-ownership" | "route-confirmation" | "task-switch" | "decision-ratification" | "decision-revision" | "plan-revision" | "side-effect-rerun" | "acceptance-confirmation";
export type InteractionSource = "elicitation" | "text";

export type GrillAnswerCode = "A" | "B" | "C";

export interface GrillRecommendation {
  optionId: string;
  reason: string;
  /**
   * 高影响提醒（CONTEXT.md"推荐提醒"）：推荐方案的主要缺点。
   * 与 alternative 成对出现：提供其一就必须提供另一个，否则拒绝登记。
   */
  drawback?: string;
  /** 高影响提醒：某个替代方案更适用的条件，让用户能判断推荐前提是否成立。 */
  alternative?: { optionId: string; condition: string };
}

export interface InteractionOption {
  id: string;
  label: string;
  description?: string;
  requiresComment?: boolean;
}

export interface InteractionResponse {
  action: string;
  kind?: "option" | "other";
  answerCode?: GrillAnswerCode;
  selectedOptionId?: string;
  rawReply?: string;
  comment?: string;
  source: InteractionSource;
  promptEventId?: string;
  turnBoundaryEventId?: string;
  userReply?: string;
  host: "claude" | "codex";
  respondedAt: string;
}

export interface UserInteraction {
  id: string;
  kind: InteractionKind;
  target: string;
  basisHash: string;
  /** Immutable, Core-owned context for a one-time risk-acceptance decision. */
  binding?: {
    batchId: string;
    findingIds: string[];
    findingSetHash: string;
  };
  question?: string;
  options: InteractionOption[];
  recommendation?: GrillRecommendation;
  presentedAt: string;
  /** State revision captured when the question was presented. */
  presentedRevision?: number;
  /** Append-only ledger cursor identifying the event that presented this interaction. */
  presentationEventId?: string;
  /** Immutable workspace paths bound to an ownership question. */
  workspacePaths?: string[];
  /** Full unknown-path set captured when a batch ownership question was shown. */
  workspaceBatchPaths?: string[];
  /** Remaining paths for an explicit one-by-one ownership flow. */
  workspaceRemainingPaths?: string[];
  status: "pending" | "resolved";
  response?: InteractionResponse;
  /** 决策追认候选内容（kind === "decision-ratification" 时存在）。 */
  ratification?: { question: string; evidence: string; conclusion: string; factRefs: string[] };
  /** 决策修订候选内容（kind === "decision-revision" 时存在）。 */
  revision?: { decisionId: string; oldConclusion: string; newConclusion: string; reason: string; affected: string[] };
  /** 实施中计划修订候选（kind === "plan-revision" 时存在）。 */
  planRevision?: { affectedUnits: string[]; redoUnits: string[]; sideEffectUnits: string[]; reviewInvalidated: boolean; fallbackReason?: string };
  /** Internal immutable inputs used to reject a stale plan-revision preview. */
  planRevisionBasis?: { artifactSha256: string; projectConfigSha256: string; traceabilitySha256: string };
  /** 副作用单元重跑确认（kind === "side-effect-rerun" 时存在）。 */
  sideEffectRerun?: { units: string[] };
  /** 验收确认只证明用户确认当前 AC 结果，不证明浏览器或代码操作发生。 */
  acceptanceConfirmation?: { acceptanceCriterionIds: string[]; deliveryFingerprint: string; dispositionHash: string };
}
