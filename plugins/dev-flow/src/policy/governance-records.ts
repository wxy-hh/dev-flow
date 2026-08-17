import type { EvidenceObjectRef } from "./evidence-store.js";

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
  /** Phase 6 record-owned baseline ref for content-bound claims (review-complete / verification-current). */
  baselineRef?: EvidenceObjectRef;
}

/** 授权：用户允许特定动作或接受特定风险的有界许可。 */
export interface GovernanceAuthorization extends GovernanceRecordBase {
  kind: "authorization";
  authorizationType: "risk-acceptance" | "dangerous-command" | "approval";
  target: string;
  credentialId?: string;
  /** Phase 6 record-owned baseline ref for content-bound risk acceptance. */
  baselineRef?: EvidenceObjectRef;
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
