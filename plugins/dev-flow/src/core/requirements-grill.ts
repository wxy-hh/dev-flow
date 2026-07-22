import { assertArtifactCurrent } from "./artifacts.js";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";

const statuses = ["not_required", "pending", "in_progress", "complete"] as const;
type GrillStatus = typeof statuses[number];

function allowedStatuses(state: FeatureState): GrillStatus[] {
  return state.classification.requirements === "provided-confirmed" ? ["not_required", "complete"] : ["complete"];
}

function invalidStatus(details: Record<string, unknown>): never {
  throw new DevFlowError("GRILL_STATUS_INVALID", "requirements grill_status must be a supported enum", { allowed: statuses, ...details });
}

function parseStatus(contents: string): GrillStatus {
  const frontMatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontMatter) invalidStatus({ reason: "MISSING_FRONT_MATTER" });
  const lines = frontMatter.split(/\r?\n/);
  const devFlowIndexes = lines.map((line, index) => line === "dev_flow:" ? index : -1).filter((index) => index >= 0);
  if (devFlowIndexes.length !== 1) invalidStatus({ reason: "MISSING_OR_DUPLICATE_DEV_FLOW" });
  const nestedLines: string[] = [];
  for (const line of lines.slice(devFlowIndexes[0] + 1)) {
    if (!line.startsWith("  ")) break;
    nestedLines.push(line);
  }
  const values = nestedLines.map((line) => line.match(/^  grill_status: ([^\r\n]+)$/)?.[1]?.trim()).filter((value): value is string => Boolean(value));
  if (values.length !== 1) invalidStatus({ reason: "MISSING_OR_DUPLICATE_GRILL_STATUS", count: values.length });
  const value = values[0];
  if (!statuses.includes(value as GrillStatus)) invalidStatus({ actual: value });
  return value as GrillStatus;
}

/** Enforces the requirements-step grill contract after the artifact is registered. */
export async function assertRequirementsGrillSatisfied(root: string, id: string, state: FeatureState): Promise<void> {
  if (state.route !== "standard-m" && state.route !== "standard-l") return;
  const contents = await assertArtifactCurrent(root, id, state, "requirements");
  const status = parseStatus(contents);
  const allowed = allowedStatuses(state);
  if (!allowed.includes(status)) {
    throw new DevFlowError("GRILL_INCOMPLETE", "requirements grill is not complete", {
      requirementsState: state.classification.requirements,
      status,
      allowedStatuses: allowed,
    });
  }
}
