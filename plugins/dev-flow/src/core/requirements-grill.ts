import { assertArtifactCurrent } from "./artifacts.js";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";

const statuses = ["not_required", "pending", "in_progress", "complete"] as const;
export type GrillStatus = typeof statuses[number];

export interface GrillFrontMatter {
  status: GrillStatus;
  questionId?: string;
  responseHint?: string;
  questionLimit?: number;
}

function allowedStatuses(state: FeatureState): GrillStatus[] {
  return state.classification.requirements === "provided-confirmed" ? ["not_required", "complete"] : ["complete"];
}

function invalidStatus(details: Record<string, unknown>): never {
  throw new DevFlowError("GRILL_STATUS_INVALID", "requirements grill_status must be a supported enum", {
    allowed: statuses,
    recoveryHint: "Set grill_status to a supported value and re-record the requirements artifact",
    ...details,
  });
}

function parseNestedDevFlow(contents: string): Record<string, string> {
  const frontMatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontMatter) invalidStatus({ reason: "MISSING_FRONT_MATTER" });
  const lines = frontMatter.split(/\r?\n/);
  const devFlowIndexes = lines.map((line, index) => line === "dev_flow:" ? index : -1).filter((index) => index >= 0);
  if (devFlowIndexes.length !== 1) invalidStatus({ reason: "MISSING_OR_DUPLICATE_DEV_FLOW" });
  const fields: Record<string, string> = {};
  for (const line of lines.slice(devFlowIndexes[0] + 1)) {
    if (!line.startsWith("  ")) break;
    const match = line.match(/^  ([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (fields[key] !== undefined) invalidStatus({ reason: "DUPLICATE_FIELD", field: key });
    fields[key] = value;
  }
  return fields;
}

function readStatus(fields: Record<string, string>): GrillStatus {
  const status = fields.grill_status;
  if (!status || !statuses.includes(status as GrillStatus)) invalidStatus({ actual: status, reason: "MISSING_OR_INVALID_GRILL_STATUS" });
  return status as GrillStatus;
}

/** Parse grill front matter for progress. in_progress should carry question fields when reporting wait. */
export function parseGrillFrontMatter(contents: string): GrillFrontMatter {
  const fields = parseNestedDevFlow(contents);
  const status = readStatus(fields);
  const result: GrillFrontMatter = { status };
  if (fields.grill_question_id) result.questionId = fields.grill_question_id;
  if (fields.grill_response_hint) result.responseHint = fields.grill_response_hint;
  if (fields.grill_question_limit) {
    const limit = Number(fields.grill_question_limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
      throw new DevFlowError("GRILL_STATUS_INVALID", "grill_question_limit must be an integer 1-8", {
        recoveryHint: "Set grill_question_limit to 3 (visual) or up to 5 with Decision Log reason",
      });
    }
    result.questionLimit = limit;
  }
  if (status === "in_progress" && (!result.questionId || !result.responseHint)) {
    throw new DevFlowError("GRILL_STATUS_INVALID", "in_progress grill requires grill_question_id and grill_response_hint", {
      recoveryHint: "Set the current Q-id and response hint, record the requirements artifact, then ask the user",
    });
  }
  if (status === "complete" || status === "not_required") {
    if (result.questionId || result.responseHint) {
      throw new DevFlowError("GRILL_STATUS_INVALID", "complete/not_required grill must not retain current-question fields", {
        recoveryHint: "Clear grill_question_id and grill_response_hint when grill is finished",
      });
    }
  }
  return result;
}

/** Enforces the requirements-step grill contract after the artifact is registered. */
export async function assertRequirementsGrillSatisfied(root: string, id: string, state: FeatureState): Promise<void> {
  if (state.route !== "standard-m" && state.route !== "standard-l") return;
  const contents = await assertArtifactCurrent(root, id, state, "requirements");
  const fields = parseNestedDevFlow(contents);
  const status = readStatus(fields);
  const allowed = allowedStatuses(state);
  if (!allowed.includes(status)) {
    throw new DevFlowError("GRILL_INCOMPLETE", "requirements grill is not complete", {
      requirementsState: state.classification.requirements,
      status,
      allowedStatuses: allowed,
      recoveryHint: "Continue grillme until grill_status is complete, record the artifact, then record the requirements step",
    });
  }
  if (fields.grill_question_id || fields.grill_response_hint) {
    throw new DevFlowError("GRILL_STATUS_INVALID", "complete/not_required grill must not retain current-question fields", {
      recoveryHint: "Clear grill_question_id and grill_response_hint when grill is finished",
    });
  }
}
