import { stableJson } from "../policy/stable-json.js";
import type { EvidenceObjectRef, EvidenceStorePointer } from "../policy/evidence-store.js";
import {
  parseAttemptLog,
  parseFeatureStateArchivePointers,
  parseGovernanceLedger,
  parseInteractionLedger,
  parseWorkspaceLineage,
  type FeatureStateArchivePointers,
} from "../policy/state-archive.js";
import { putEvidenceObject, readEvidenceObject } from "./evidence-store.js";
import type { FeatureState } from "./state-store.js";

export type ArchivedStateCollections = FeatureStateArchivePointers;

function hasEntries(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return Boolean(value);
}

/**
 * Phase 8 seam: freeze the unbounded FeatureState collections into logical
 * Evidence Store refs. Callers later switch state to pointer/summary fields;
 * this function intentionally does not mutate state.
 */
export async function archiveLargeStateCollections(
  root: string,
  state: FeatureState,
): Promise<ArchivedStateCollections> {
  let pointer: EvidenceStorePointer = { catalogSha256: "0".repeat(64), objectCount: 0, packCount: 0 };
  const result: ArchivedStateCollections = { schemaVersion: 1, featureId: state.featureId, pointer };
  const put = async (kind: EvidenceObjectRef["kind"], value: unknown): Promise<EvidenceObjectRef> => {
    const stored = await putEvidenceObject(
      root,
      state.featureId,
      kind,
      Buffer.from(`${stableJson(value)}\n`, "utf8"),
    );
    pointer = stored.pointer;
    return stored.ref;
  };
  if (hasEntries(state.workspace)) result.workspaceLineage = await put("workspace-lineage", state.workspace);
  const resolvedInteractions = Object.fromEntries(
    Object.entries(state.interactions ?? {}).filter(([, interaction]) => interaction.status === "resolved"),
  );
  if (hasEntries(resolvedInteractions)) result.interactionLedger = await put("interaction-ledger", resolvedInteractions);
  if (hasEntries(state.governance)) result.governanceLedger = await put("governance-ledger", state.governance);
  if (hasEntries(state.verification.attempts)) result.verificationLedger = await put("verification-log", state.verification.attempts);
  const repairAttempts = state.repair?.attempts;
  if (hasEntries(repairAttempts)) result.repairLedger = await put("repair-log", repairAttempts);
  result.pointer = pointer;
  return result;
}

async function readArchivedJson(root: string, featureId: string, ref: EvidenceObjectRef | undefined): Promise<unknown> {
  if (ref === undefined) return undefined;
  return JSON.parse((await readEvidenceObject(root, featureId, ref)).toString("utf8"));
}

/**
 * Read-boundary hydration: a v6 persisted state only contains archive pointers
 * for the unbounded collections; this function restores the full v5 in-memory
 * shape before validation. The returned state keeps archivedCollections so a
 * later mutation can persist idempotently without losing the pointers.
 */
export async function hydrateFeatureState(root: string, raw: unknown): Promise<FeatureState> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("persisted state is invalid");
  }
  const persisted = raw as Record<string, unknown>;
  if (typeof persisted.featureId !== "string") throw new TypeError("persisted state featureId is invalid");
  const featureId = persisted.featureId;
  if (persisted.archivedCollections === undefined) {
    throw new TypeError("v6 persisted state is missing archivedCollections");
  }
  const pointers = parseFeatureStateArchivePointers(persisted.archivedCollections);
  if (pointers.featureId !== featureId) throw new TypeError("persisted archive featureId does not match state");
  const state = { ...persisted, schemaVersion: 6 as const, archivedCollections: pointers } as FeatureState;
  if (pointers.workspaceLineage) {
    state.workspace = parseWorkspaceLineage(await readArchivedJson(root, featureId, pointers.workspaceLineage));
  }
  if (pointers.governanceLedger) {
    state.governance = parseGovernanceLedger(await readArchivedJson(root, featureId, pointers.governanceLedger));
  }
  if (pointers.interactionLedger) {
    const resolvedInteractions = parseInteractionLedger(await readArchivedJson(root, featureId, pointers.interactionLedger));
    state.interactions = { ...(state.interactions ?? {}), ...(resolvedInteractions as FeatureState["interactions"]) };
  }
  const verificationLedger = pointers.verificationLedger
    ? parseAttemptLog(await readArchivedJson(root, featureId, pointers.verificationLedger), "verification")
    : undefined;
  state.verification = {
    ...(state.verification ?? { attempts: [] }),
    attempts: verificationLedger
      ? verificationLedger as FeatureState["verification"]["attempts"]
      : (state.verification?.attempts ?? []),
  };
  if (pointers.repairLedger) {
    const repairLedger = parseAttemptLog(await readArchivedJson(root, featureId, pointers.repairLedger), "repair");
    state.repair = { ...(state.repair ?? { status: "completed", maxAttempts: 3 }), attempts: repairLedger } as FeatureState["repair"];
  }
  return state;
}

/**
 * Write-boundary sliming: archive all unbounded collections, then produce the
 * v6 persisted shape. The caller mutates the hydrated full state first, so
 * this function never mutates the in-memory object.
 */
export async function persistableFeatureState(root: string, state: FeatureState): Promise<FeatureState> {
  const pointers = await archiveLargeStateCollections(root, state);
  const persisted = { ...state, schemaVersion: 6 as const, archivedCollections: pointers } as Record<string, unknown>;
  persisted.interactions = Object.fromEntries(Object.entries(state.interactions ?? {}).filter(([, interaction]) => interaction.status === "pending"));
  persisted.verification = { ...state.verification };
  delete (persisted.verification as Record<string, unknown>).attempts;
  if (state.repair) {
    persisted.repair = { ...state.repair };
    delete (persisted.repair as Record<string, unknown>).attempts;
  }
  delete persisted.workspace;
  delete persisted.governance;
  return persisted as unknown as FeatureState;
}
