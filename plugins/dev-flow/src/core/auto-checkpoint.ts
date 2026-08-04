import { randomUUID } from "node:crypto";
import { fingerprintProtectedRoots, snapshotProtectedRoots } from "./fingerprint.js";
import { mutate, readProjectConfig, type FeatureState } from "./state-store.js";
import { decisionBasisHash, satisfyObligations } from "../policy/obligations.js";

export interface AutomaticCheckpoint {
  checkpointId: string;
  stage: string;
  capturedAt: string;
  fingerprint: string;
  files: string[];
  basisHash: string;
}

/**
 * Capture a small, content-addressed checkpoint summary without turning
 * checkpointing into a user-visible route action. The existing rollback
 * transaction remains the destructive recovery primitive; this ledger records
 * the safe boundary and actual file set used by drift analysis.
 */
export async function captureAutomaticCheckpoint(
  root: string,
  featureId: string,
  expectedRevision: number,
  stage: string,
  reason = "stage-boundary",
): Promise<FeatureState> {
  const config = await readProjectConfig(root);
  const files = await snapshotProtectedRoots(root, config);
  const fingerprint = await fingerprintProtectedRoots(root, config);
  const capturedAt = new Date().toISOString();
  const checkpoint: AutomaticCheckpoint = {
    checkpointId: `AUTO-${randomUUID()}`,
    stage,
    capturedAt,
    fingerprint,
    files: files.map((file) => file.path).sort(),
    basisHash: decisionBasisHash({ stage, reason, fingerprint, files: files.map((file) => file.path).sort() }),
  };
  return mutate(root, featureId, expectedRevision, "automatic-checkpoint-captured", (state) => {
    state.checkpoints = [...(state.checkpoints ?? []), checkpoint];
    state.obligations = satisfyObligations(state.obligations, ["checkpoint"]);
  }, { checkpointId: checkpoint.checkpointId, stage, reason });
}
