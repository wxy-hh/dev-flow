export type TraceStatus = "current" | "stale" | "tombstoned";
export type RequirementId = `REQ-${string}`;
export type AcceptanceCriterionId = `AC-${string}`;
export type TaskId = `TASK-${string}`;
export type TestId = `TEST-${string}`;
export type RollbackId = `RU-${string}`;
export type TraceId =
  | RequirementId
  | AcceptanceCriterionId
  | TaskId
  | TestId
  | RollbackId;

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
}

export interface TaskNode extends TraceSource {
  kind: "task";
  id: TaskId;
  covers: Array<RequirementId | AcceptanceCriterionId>;
  rollbackUnit: RollbackId;
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

export type TraceNode =
  | RequirementNode
  | AcceptanceCriterionNode
  | TaskNode
  | TestNode
  | RollbackNode;

export type TraceNodeInput =
  | { kind: "requirement"; id: RequirementId }
  | {
      kind: "acceptance-criterion";
      id: AcceptanceCriterionId;
      parentRequirement: RequirementId;
    }
  | {
      kind: "task";
      id: TaskId;
      covers: Array<RequirementId | AcceptanceCriterionId>;
      rollbackUnit: RollbackId;
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
    | "rollback-unit"
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
