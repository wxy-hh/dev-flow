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

export interface ClassificationInput {
  level: Level;
  topology: Topology;
  execution?: Execution;
  requirements?: RequirementsState;
  riskLabels?: RiskLabel[];
}

export interface Classification extends Required<Omit<ClassificationInput, "execution" | "requirements" | "riskLabels">> {
  execution?: Execution;
  requirements?: RequirementsState;
  riskLabels: RiskLabel[];
}

export interface RouteDefinition {
  orderedSteps: string[];
  requiredArtifacts: string[];
  artifactSteps?: Record<string, string[]>;
  featureCheckRequired: boolean;
}

export interface RiskEnhancement {
  checks: string[];
  verification: "behavior" | "integration" | "full";
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
  | { kind: "run-step"; step: string }
  | { kind: "feature-check" }
  | { kind: "finalize" };
