export type TraceStatus = "current" | "stale" | "tombstoned";
export type RequirementId = `REQ-${string}`;
export type AcceptanceCriterionId = `AC-${string}`;
export type TaskId = `TASK-${string}`;
export type TestId = `TEST-${string}`;
export type ImplementationUnitId = `UNIT-${string}`;
export type RollbackId = `RU-${string}`;
export type RecoveryId = `REC-${string}`;
export type TraceId =
  | RequirementId
  | AcceptanceCriterionId
  | TaskId
  | TestId
  | ImplementationUnitId
  | RollbackId
  | RecoveryId;

export type TraceArtifactKind =
  | "requirements"
  | "implementation-plan"
  | "coverage-matrix"
  | "rollback-units";

export interface InlineVerificationCommand {
  command: string;
  args?: string[];
  cwd?: string;
}

export type VerificationCommandRef = string | InlineVerificationCommand;

export type VerificationDispositionKind = "behavior-test" | "type-check" | "rule-check" | "file-check" | "human-acceptance";

/**
 * 一项验收条件的最终核对方式（ADR-0011 / issue 11）。
 * behavior-test 必须由 TEST 节点 verifies；其他处置必须给出非空理由，
 * 不能把可自动测试的行为变化伪装成非行为验证。
 */
export interface VerificationDisposition {
  kind: VerificationDispositionKind;
  /** 非行为处置的核对方法与预期证据；行为测试可省略。 */
  reason?: string;
  /** 可选定位：被核对的文件路径或规则名。 */
  target?: string;
}

export interface TraceSource {
  sourceArtifact: TraceArtifactKind;
  sourceSha256: string;
  sourceAnchor: string;
  sourceBlockSha256: string;
  status: TraceStatus;
}

export interface RequirementNode extends TraceSource {
  kind: "requirement";
  id: RequirementId;
}

export interface AcceptanceCriterionNode extends TraceSource {
  kind: "acceptance-criterion";
  id: AcceptanceCriterionId;
  parentRequirement: RequirementId;
  /** 最终验证处置：缺省视为 behavior-test（必须有 TEST verifies）。 */
  verificationDisposition?: VerificationDisposition;
}

export interface TaskNode extends TraceSource {
  kind: "task";
  id: TaskId;
  covers: Array<RequirementId | AcceptanceCriterionId>;
  implementationUnit: ImplementationUnitId;
  /** TDD 开发顺序（与最终验证处置分开记录）：test-first 先红灯再实现。 */
  tdd?: "test-first" | "direct";
}

export interface TestNode extends TraceSource {
  kind: "test";
  id: TestId;
  verifies: AcceptanceCriterionId[];
}

export interface RollbackNode extends TraceSource {
  kind: "rollback";
  id: RollbackId;
  tasks: TaskId[];
  dependsOn: RollbackId[];
  fileScope: string[];
  covers: Array<RequirementId | AcceptanceCriterionId>;
  forwardVerification: VerificationCommandRef[];
  rollbackVerification: VerificationCommandRef[];
  sourceArtifact: "implementation-plan" | "rollback-units";
  verificationConfigSha256: string;
}

/**
 * 实现单元只表达执行范围、依赖和前向验证。回滚/补偿属于独立的
 * RecoveryNode，不能通过给实现单元换一个旧 RU 名称来隐式获得。
 */
export interface ImplementationUnitNode extends TraceSource {
  kind: "implementation-unit";
  id: ImplementationUnitId;
  tasks: TaskId[];
  dependsOn: ImplementationUnitId[];
  fileScope: string[];
  covers: Array<RequirementId | AcceptanceCriterionId>;
  forwardVerification: VerificationCommandRef[];
  sourceArtifact: "implementation-plan";
  verificationConfigSha256: string;
}

/**
 * 恢复安排（ADR-0016 / issue 13）：独立于实现单元的补偿或回滚方法。
 * 实现单元表达工作范围、依赖与前向验证，不携带回撤语义；恢复安排只
 * 表达“失败后如何撤销或补偿”，两者不能互相替代。
 */
export interface RecoveryNode extends TraceSource {
  kind: "recovery";
  id: RecoveryId;
  /** 关联的具体高风险实现步骤。 */
  stepRef: ImplementationUnitId | TaskId;
  /** 恢复方式：回滚或补偿。 */
  recoveryKind: "rollback" | "compensation";
  method: string;
  /** Core 派生的结构化风险要求。 */
  riskRef: string;
}

export type TraceNode =
  | RequirementNode
  | AcceptanceCriterionNode
  | TaskNode
  | TestNode
  | ImplementationUnitNode
  | RollbackNode
  | RecoveryNode;

export type TraceNodeInput =
  | { kind: "requirement"; id: RequirementId }
  | {
      kind: "acceptance-criterion";
      id: AcceptanceCriterionId;
      parentRequirement: RequirementId;
      verificationDisposition?: VerificationDisposition;
    }
  | {
      kind: "task";
      id: TaskId;
      covers: Array<RequirementId | AcceptanceCriterionId>;
      implementationUnit: ImplementationUnitId;
      tdd?: "test-first" | "direct";
    }
  | { kind: "test"; id: TestId; verifies: AcceptanceCriterionId[] }
  | {
      kind: "rollback";
      id: RollbackId;
      tasks: TaskId[];
      dependsOn: RollbackId[];
      fileScope: string[];
      covers: Array<RequirementId | AcceptanceCriterionId>;
       forwardVerification: VerificationCommandRef[];
      rollbackVerification: VerificationCommandRef[];
    }
  | {
      kind: "implementation-unit";
      id: ImplementationUnitId;
      tasks: TaskId[];
      dependsOn: ImplementationUnitId[];
      fileScope: string[];
      covers: Array<RequirementId | AcceptanceCriterionId>;
      forwardVerification: VerificationCommandRef[];
    }
  | {
      kind: "recovery";
      id: RecoveryId;
      stepRef: ImplementationUnitId | TaskId;
      recoveryKind: "rollback" | "compensation";
      method: string;
      riskRef: string;
    };

export interface TraceDelta {
  nodes: TraceNodeInput[];
}

export interface TraceSummary {
  total: number;
  current: number;
  stale: number;
  tombstoned: number;
}

export interface TraceabilityPointer {
  path: `traceability/snapshots/${string}.json`;
  sha256: string;
  revision: number;
  summary: TraceSummary;
}

export interface TraceEdge {
  from: TraceId;
  type:
    | "parent"
    | "covers"
    | "verifies"
    | "implementation-unit"
    | "contains-task"
    | "depends-on";
  to: TraceId;
}

export interface TraceabilityLedger {
  schemaVersion: 1;
  featureId: string;
  revision: number;
  stateRevision: number;
  projectConfigSha256: string;
  verificationCommandHashes?: Record<string, string>;
  nodes: Record<string, TraceNode>;
  edges: TraceEdge[];
  summary: TraceSummary;
}
