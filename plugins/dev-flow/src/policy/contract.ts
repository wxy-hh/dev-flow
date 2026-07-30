import contractJson from "../../policy/contract.json" with { type: "json" };
import {
  ZERO_WORKFLOW_CAPABILITIES,
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

if (contract.schemaVersion !== 1) {
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

function ensureGeneratedArtifact(definition: RouteDefinition, artifact: string): void {
  if (!definition.generatedArtifacts) definition.generatedArtifacts = [];
  if (!definition.generatedArtifacts.includes(artifact)) definition.generatedArtifacts.push(artifact);
}

function moveArtifactSteps(
  definition: RouteDefinition,
  artifact: string,
  steps?: string[],
): void {
  if (!definition.generatedArtifactSteps) definition.generatedArtifactSteps = {};
  const sourceSteps = steps ?? Object.entries(definition.artifactSteps ?? {})
    .filter(([, artifacts]) => artifacts.includes(artifact))
    .map(([step]) => step);
  for (const step of sourceSteps) {
    const source = definition.artifactSteps?.[step] ?? [];
    if (source.includes(artifact)) {
      const remaining = source.filter((kind) => kind !== artifact);
      if (remaining.length === 0) delete definition.artifactSteps?.[step];
      else if (definition.artifactSteps) definition.artifactSteps[step] = remaining;
    }
    const generated = definition.generatedArtifactSteps[step] ?? [];
    if (!generated.includes(artifact)) definition.generatedArtifactSteps[step] = [...generated, artifact];
  }
}

function moveArtifactToGenerated(
  definition: RouteDefinition,
  artifact: string,
  steps?: string[],
): void {
  definition.requiredArtifacts = definition.requiredArtifacts.filter((kind) => kind !== artifact);
  ensureGeneratedArtifact(definition, artifact);
  moveArtifactSteps(definition, artifact, steps);
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
  capabilities: WorkflowCapabilities | undefined,
): RouteDefinition {
  const definition = cloneRouteDefinition(routeDefinition(route));
  const normalized = normalizeWorkflowCapabilities(capabilities);

  if (route === "risk-minimal" || route === "standard-m") {
    moveArtifactToGenerated(definition, "status");
  }

  for (const transition of definition.artifactTransitions ?? []) {
    if (normalized[transition.capability] === 1) {
      moveArtifactToGenerated(definition, transition.artifact, transition.steps);
    }
  }

  validateArtifactModes(definition);
  return definition;
}

export function traceEnforcementRequired(
  route: RouteId,
  capabilities: WorkflowCapabilities | undefined,
): boolean {
  return normalizeWorkflowCapabilities(capabilities).trace === 1
    && (route === "standard-m" || route === "standard-l");
}

export function reviewEnforcementRequired(
  route: RouteId,
  capabilities: WorkflowCapabilities | undefined,
): boolean {
  return normalizeWorkflowCapabilities(capabilities).review === 1
    && (route === "standard-m" || route === "standard-l");
}

export function checkpointsEnforcementRequired(
  route: RouteId,
  capabilities: WorkflowCapabilities | undefined,
): boolean {
  // Checkpoints build on the trace rollback graph: enforcement requires the
  // trace capability and a standard route, just like traceEnforcementRequired.
  return normalizeWorkflowCapabilities(capabilities).checkpoints === 1
    && traceEnforcementRequired(route, capabilities);
}

export function rollbackExecutionAllowed(
  route: RouteId,
  capabilities: WorkflowCapabilities | undefined,
): boolean {
  return normalizeWorkflowCapabilities(capabilities).rollbackExecution === 1
    && checkpointsEnforcementRequired(route, capabilities);
}
