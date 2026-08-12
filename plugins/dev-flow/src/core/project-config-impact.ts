import type { FeatureState } from "./state-store.js";
import type { projectConfigImpact } from "./project-config.js";
import { readTraceability } from "./traceability-store.js";
import { readCheckpointManifest } from "./checkpoint-store.js";

export interface ProjectConfigAffectedEvidence {
  featureId?: string;
  commandIds: string[];
  traceNodeIds: string[];
  checkpointIds: string[];
  verificationAttemptIds: number[];
  reviewRoles: string[];
}

/** Derive a bounded, client-visible inventory without mutating feature state. */
export async function collectProjectConfigAffectedEvidence(
  root: string,
  state: FeatureState | undefined,
  impact: ReturnType<typeof projectConfigImpact>,
): Promise<ProjectConfigAffectedEvidence> {
  const commandIds = [...new Set([...impact.modifiedCommandIds, ...impact.removedCommandIds])].sort();
  const empty = { commandIds, traceNodeIds: [], checkpointIds: [], verificationAttemptIds: [], reviewRoles: [] };
  if (!commandIds.length || !state) return empty;
  const changed = new Set(commandIds);
  const traceNodeIds: string[] = [];
  if (state.traceability) {
    const ledger = await readTraceability(root, state);
    for (const node of Object.values(ledger.nodes)) {
      if (node.status === "tombstoned" || (node.kind !== "rollback" && node.kind !== "implementation-unit")) continue;
      const refs = (node.kind === "rollback"
        ? [...node.forwardVerification, ...node.rollbackVerification]
        : [...node.forwardVerification])
        .filter((ref): ref is string => typeof ref === "string");
      if (refs.some((id) => changed.has(id))) traceNodeIds.push(node.id);
    }
  }
  const verificationAttemptIds = state.verification.attempts.flatMap((value) => {
    const attempt = value as { id?: unknown; verificationCommandHashes?: unknown };
    if (!Number.isInteger(attempt.id) || !attempt.verificationCommandHashes || typeof attempt.verificationCommandHashes !== "object") return [];
    return Object.keys(attempt.verificationCommandHashes).some((id) => changed.has(id)) ? [attempt.id as number] : [];
  }).sort((left, right) => left - right);
  const checkpointIds: string[] = [];
  for (const unit of state.implementationUnits ?? []) {
    if (!unit.checkpointId) continue;
    const manifest = await readCheckpointManifest(root, state.featureId, unit.checkpointId);
    if (Object.keys(manifest.verificationCommandHashes ?? {}).some((id) => changed.has(id))) checkpointIds.push(unit.checkpointId);
  }
  return {
    featureId: state.featureId,
    commandIds,
    traceNodeIds: traceNodeIds.sort(),
    checkpointIds: checkpointIds.sort(),
    verificationAttemptIds,
    reviewRoles: traceNodeIds.length ? ["rollback-operability"] : [],
  };
}
