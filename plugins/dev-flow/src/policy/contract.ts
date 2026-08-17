import contractJson from "../../policy/contract.json" with { type: "json" };
import {
  ZERO_WORKFLOW_CAPABILITIES,
  type GovernanceControls,
  type RiskEnhancement,
  type RiskLabel,
  type RouteDefinition,
  type RouteId,
  type WorkflowCapabilities,
} from "./types.js";

interface ContractShape {
  schemaVersion: number;
  routes: Record<RouteId, RouteDefinition>;
  riskEnhancements: Record<string, RiskEnhancement>;
  topologyMinimumLevel: Record<string, string>;
  topologyStrictOrder: string[];
}

export const contract = contractJson as ContractShape;

if (contract.schemaVersion !== 6) {
  throw new Error(`unsupported contract schema ${String(contract.schemaVersion)}`);
}

export const allowedRiskLabels = Object.freeze(Object.keys(contract.riskEnhancements) as RiskLabel[]);

export function routeDefinition(route: RouteId): RouteDefinition {
  return contract.routes[route];
}

function cloneArtifactSteps(steps: Record<string, string[]> | undefined): Record<string, string[]> | undefined {
  if (!steps) return undefined;
  return Object.fromEntries(Object.entries(steps).map(([step, artifacts]) => [step, [...artifacts]]));
}

function cloneRouteDefinition(definition: RouteDefinition): RouteDefinition {
  return {
    ...definition,
    orderedSteps: [...definition.orderedSteps],
    requiredArtifacts: [...definition.requiredArtifacts],
    ...(definition.generatedArtifacts ? { generatedArtifacts: [...definition.generatedArtifacts] } : {}),
    ...(definition.artifactSteps ? { artifactSteps: cloneArtifactSteps(definition.artifactSteps) } : {}),
    ...(definition.generatedArtifactSteps ? { generatedArtifactSteps: cloneArtifactSteps(definition.generatedArtifactSteps) } : {}),
    ...(definition.artifactTransitions ? {
      artifactTransitions: definition.artifactTransitions.map((transition) => ({ ...transition, steps: [...transition.steps] })),
    } : {}),
  };
}

function validateArtifactModes(definition: RouteDefinition): void {
  const generated = definition.generatedArtifacts ?? [];
  const overlap = definition.requiredArtifacts.find((artifact) => generated.includes(artifact));
  if (overlap) throw new Error(`route contract artifact ${overlap} cannot be both editable and generated`);
}

export function normalizeWorkflowCapabilities(
  value: WorkflowCapabilities | undefined,
): WorkflowCapabilities {
  const candidate = value ?? ZERO_WORKFLOW_CAPABILITIES;
  if (candidate.trace !== 0 && candidate.trace !== 1
    || candidate.review !== 0 && candidate.review !== 1
    || candidate.checkpoints !== 0 && candidate.checkpoints !== 1
    || candidate.rollbackExecution !== 0 && candidate.rollbackExecution !== 1) {
    throw new Error("workflow capabilities must use 0 or 1");
  }
  return Object.freeze({ ...candidate });
}

export function routeDefinitionForFeature(
  route: RouteId,
  controls: GovernanceControls | undefined,
): RouteDefinition {
  const definition = cloneRouteDefinition(routeDefinition(route));
  if (controls) {
    definition.orderedSteps = [];
    if (controls.requirements) definition.orderedSteps.push("requirements_alignment");
    definition.orderedSteps.push(controls.plan === "locate" ? "locate" : controls.plan === "brief" ? "boundary" : "planning");
    // Plan review and execution approval are Core-owned gates attached to the
    // planning→implementation transition; classification.orderedRoute exposes
    // them, while recordable steps remain artifact/action stages.
    definition.orderedSteps.push("implementation");
    if (controls.codeReview !== "none") definition.orderedSteps.push("code_review");
    definition.orderedSteps.push("verification", "finalize");
    definition.requiredArtifacts = [];
    definition.artifactSteps = {};
    if (controls.requirements) {
      definition.requiredArtifacts.push("requirements");
      definition.artifactSteps.requirements_alignment = ["requirements"];
    }
    if (controls.plan === "formal") {
      definition.requiredArtifacts.push("implementation-plan");
      definition.artifactSteps.planning = ["implementation-plan"];
    }
    if (controls.planReview) {
      definition.generatedArtifacts = ["plan-review"];
      definition.generatedArtifactSteps = { planning: ["plan-review"] };
    }
  }

  validateArtifactModes(definition);
  return definition;
}

/** route 参数保留在签名里：它是调用方语义的一部分，判决本身只认 controls。 */
export function traceEnforcementRequired(
  route: RouteId,
  controls: GovernanceControls | undefined,
): boolean {
  return controls?.trace ?? false;
}

export function reviewEnforcementRequired(
  route: RouteId,
  controls: GovernanceControls | undefined,
): boolean {
  return controls?.planReview ?? false;
}

export function reviewLedgerRequired(
  route: RouteId,
  controls: GovernanceControls | undefined,
): boolean {
  return controls ? controls.planReview || controls.codeReview !== "none" : false;
}

export function checkpointsEnforcementRequired(
  route: RouteId,
  controls: GovernanceControls | undefined,
): boolean {
  // Unit checkpoints build on the Trace rollback graph, so enforcement also
  // requires the route's Trace control.
  return controls ? controls.checkpoints === "unit-chain" && controls.trace : false;
}

export function rollbackExecutionAllowed(
  route: RouteId,
  controls: GovernanceControls | undefined,
): boolean {
  return controls
    ? controls.recovery.includes("executable-rollback") && checkpointsEnforcementRequired(route, controls)
    : false;
}
