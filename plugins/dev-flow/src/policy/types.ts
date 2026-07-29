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
  review: 0,
  checkpoints: 0,
  rollbackExecution: 0,
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

export type VerificationKind = "targeted" | "behavior" | "integration" | "full";

export interface RequiredEvidence {
  fields: {
    reviewType?: "plan" | "code";
    reviewDepth?: "full";
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
  | {
      kind: "repair-trace";
      step: string;
      code: "TRACE_SLICE_INCOMPLETE" | "TRACE_SLICE_STALE";
      details: Record<string, unknown>;
    }
  | { kind: "run-step"; step: string; requiredEvidence?: RequiredEvidence }
  | { kind: "feature-check"; requiredEvidence?: RequiredEvidence }
  | { kind: "finalize" };
