import { createHash } from "node:crypto";
import { checkpointsEnforcementRequired, rollbackExecutionAllowed } from "../policy/contract.js";
import type { RollbackNode, TraceabilityLedger } from "../policy/traceability.js";
import { canonicalReviewValueJson } from "./review-store.js";
import { checkpointChain, readCheckpointBaseline } from "./checkpoints.js";
import type { CheckpointManifest } from "../policy/rollback.js";
import { DevFlowError } from "./errors.js";
import { snapshotProtectedRoots, type ProtectedFileSnapshot } from "./fingerprint.js";
import type { ProjectConfig } from "./project-config.js";
import { pathWithinFileScope } from "../policy/rollback.js";
import { mutate, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import { readProjectConfigSnapshot, readTraceability } from "./traceability-store.js";
import {
  clearInteractionsForTarget,
  createInteraction,
  getInteraction,
  resolveNativeInteraction,
  resolveTokenInteraction,
  toPublicInteraction,
  type InteractionResponse,
  type PublicInteraction,
} from "./user-interactions.js";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export interface RollbackConflict {
  path: string;
  expected: "checkpointed" | "absent";
  actual: "modified" | "missing" | "unregistered";
}

export interface RollbackFileAction {
  action: "restore" | "delete";
  path: string;
  blobSha256?: string;
  mode?: string;
}

export interface RollbackVerificationCommand {
  commandId: string;
  command: string;
}

export interface RollbackPreview {
  targetCheckpointId: string;
  targetUnitId: string;
  undoOrder: string[];
  undoCheckpoints: string[];
  filePlan: RollbackFileAction[];
  verificationCommands: RollbackVerificationCommand[];
  projectConfigSha256: string;
  previewBasisHash: string;
}

export interface RollbackChainView {
  enforced: boolean;
  chain: Array<{ checkpointId: string; unitId: string; sequence: number }>;
  validTargets: string[];
  conflicts: RollbackConflict[];
}

function rollbackNodes(nodes: TraceabilityLedger["nodes"]): RollbackNode[] {
  // Only current definitions may legitimize a rollback plan: stale or
  // tombstoned RUs mean the plan changed after the checkpoints were recorded.
  return Object.values(nodes).filter((node): node is RollbackNode => node.kind === "rollback" && node.status === "current");
}

/**
 * Expected tip state per checkpoint-touched path: the newest record in chain
 * order wins, and paths the chain deleted or renamed away are expected to be
 * absent. Present and absent are mutually exclusive.
 */
function expectedTipState(chain: CheckpointManifest[]): { present: Map<string, { sha256: string; mode: string }>; absent: Set<string> } {
  const present = new Map<string, { sha256: string; mode: string }>();
  const absent = new Set<string>();
  for (const manifest of chain) {
    for (const record of manifest.files) {
      if (record.change === "deleted") {
        present.delete(record.path);
        absent.add(record.path);
        continue;
      }
      if (record.change === "renamed") {
        present.delete(record.renamedFrom!);
        absent.add(record.renamedFrom!);
      }
      present.set(record.path, { sha256: record.afterSha256!, mode: record.afterMode! });
      absent.delete(record.path);
    }
  }
  return { present, absent };
}

/**
 * Detects unregistered modifications since the chain tip. Files recorded by
 * manifests must match the newest record; paths the chain removed must stay
 * absent; files never touched by the chain must still equal their chain-start
 * baseline; anything else inside a scope is an unregistered addition.
 */
export function detectChainConflicts(
  chain: CheckpointManifest[],
  snapshot: ProtectedFileSnapshot[],
  fileScopes: string[],
  baselineFiles: ProtectedFileSnapshot[] = [],
): RollbackConflict[] {
  const conflicts: RollbackConflict[] = [];
  const { present: expected, absent } = expectedTipState(chain);
  const baseline = new Map(baselineFiles.map((file) => [file.path, file]));
  const current = new Map(snapshot.map((file) => [file.path, file]));
  for (const [filePath, tip] of expected) {
    const present = current.get(filePath);
    if (!present) {
      conflicts.push({ path: filePath, expected: "checkpointed", actual: "missing" });
    } else if (present.sha256 !== tip.sha256 || present.mode !== tip.mode) {
      conflicts.push({ path: filePath, expected: "checkpointed", actual: "modified" });
    }
  }
  for (const filePath of absent) {
    if (current.has(filePath)) {
      conflicts.push({ path: filePath, expected: "absent", actual: "unregistered" });
    }
  }
  for (const file of snapshot) {
    if (expected.has(file.path) || absent.has(file.path)) continue;
    const base = baseline.get(file.path);
    if (base) {
      if (file.sha256 !== base.sha256 || file.mode !== base.mode) {
        conflicts.push({ path: file.path, expected: "checkpointed", actual: "modified" });
      }
      continue;
    }
    if (pathWithinFileScope(file.path, fileScopes)) {
      conflicts.push({ path: file.path, expected: "absent", actual: "unregistered" });
    }
  }
  for (const file of baselineFiles) {
    if (expected.has(file.path) || absent.has(file.path)) continue;
    if (!current.has(file.path)) {
      conflicts.push({ path: file.path, expected: "checkpointed", actual: "missing" });
    }
  }
  return conflicts.sort((a, b) => a.path.localeCompare(b.path));
}

function assertChainIntegrity(chain: CheckpointManifest[], nodes: RollbackNode[]): void {
  const checkpointedUnits = new Set(chain.map((manifest) => manifest.unitId));
  for (const [index, manifest] of chain.entries()) {
    const node = nodes.find((candidate) => candidate.id === manifest.unitId);
    if (!node) {
      throw new DevFlowError("ROLLBACK_CHAIN_INVALID", "checkpoint chain references a unit that is not current in the trace graph", {
        unitId: manifest.unitId,
      });
    }
    for (const dependency of node.dependsOn) {
      const dependencyIndex = chain.findIndex((candidate) => candidate.unitId === dependency);
      if (dependencyIndex === -1 && !checkpointedUnits.has(dependency)) {
        throw new DevFlowError("ROLLBACK_CHAIN_INVALID", "checkpoint chain has a dependency hole", {
          unitId: manifest.unitId,
          missingDependency: dependency,
        });
      }
      if (dependencyIndex > index) {
        throw new DevFlowError("ROLLBACK_CHAIN_INVALID", "checkpoint chain order violates the rollback DAG", {
          unitId: manifest.unitId,
          dependency,
        });
      }
    }
  }
}

interface PreviewContext {
  state: FeatureState;
  chain: CheckpointManifest[];
  nodes: RollbackNode[];
  config: ProjectConfig;
  projectConfigSha256: string;
}

async function previewContext(root: string, featureId: string): Promise<PreviewContext> {
  const state = await readState(root, featureId);
  if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
    throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "rollback preview requires a checkpoints:1 standard feature");
  }
  const ledger = await readTraceability(root, state);
  const nodes = rollbackNodes(ledger.nodes);
  const chain = await checkpointChain(root, featureId, state);
  assertChainIntegrity(chain, nodes);
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
  return { state, chain, nodes, config, projectConfigSha256 };
}

function commandSummary(command: { command: string; args: string[] }): string {
  return [command.command, ...command.args].join(" ");
}

/**
 * Computes a rollback plan without touching the workspace or feature state.
 * The undo set is the complete suffix after the target in reverse chain
 * order; any conflict or stale basis fails the whole preview.
 */
export async function previewRollback(root: string, featureId: string, targetCheckpointId: string): Promise<RollbackPreview> {
  const { state, chain, nodes, config, projectConfigSha256 } = await previewContext(root, featureId);
  const target = chain.find((manifest) => manifest.checkpointId === targetCheckpointId);
  if (!target) {
    throw new DevFlowError("ROLLBACK_TARGET_INVALID", "rollback target is not a confirmed checkpoint in the chain", {
      targetCheckpointId,
      validTargets: chain.map((manifest) => manifest.checkpointId),
    });
  }

  const snapshot = await snapshotProtectedRoots(root, config.protectedRoots);
  const fileScopes = [...new Set(nodes.flatMap((node) => node.fileScope))];
  const baselineFiles = (await readCheckpointBaseline(root, featureId, chain[0].unitId)).files;
  const conflicts = detectChainConflicts(chain, snapshot, fileScopes, baselineFiles);
  if (conflicts.length) {
    throw new DevFlowError("ROLLBACK_CONFLICT", "workspace has unregistered modifications; rollback would overwrite them", {
      conflicts,
    });
  }

  const suffix = chain.filter((manifest) => manifest.sequence > target.sequence);
  const stale = suffix.filter((manifest) => manifest.projectConfigSha256 !== projectConfigSha256);
  if (stale.length) {
    throw new DevFlowError("ROLLBACK_BASIS_STALE", "project verification config changed after these checkpoints", {
      checkpointIds: stale.map((manifest) => manifest.checkpointId),
    });
  }

  const undoManifests = [...suffix].reverse();
  const verificationCommands: RollbackVerificationCommand[] = [];
  for (const manifest of undoManifests) {
    const node = nodes.find((candidate) => candidate.id === manifest.unitId);
    for (const commandId of node?.rollbackVerification ?? []) {
      const command = config.verification.commands.find((candidate) => candidate.id === commandId);
      if (!command) {
        throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "rollback verification command is not configured", {
          unitId: manifest.unitId,
          commandId,
        });
      }
      verificationCommands.push({ commandId: command.id, command: commandSummary(command) });
    }
  }

  // Fold the suffix from newest to oldest with overwrite: the undo of an
  // older checkpoint runs later, so the oldest suffix manifest decides each
  // file's final state — exactly the state at the target checkpoint.
  const filePlan = new Map<string, RollbackFileAction>();
  const planAction = (path: string, action: RollbackFileAction) => {
    filePlan.set(path, action);
  };
  for (const manifest of undoManifests) {
    for (const record of manifest.files) {
      switch (record.change) {
        case "added":
          planAction(record.path, { action: "delete", path: record.path });
          break;
        case "renamed":
          planAction(record.path, { action: "delete", path: record.path });
          planAction(record.renamedFrom!, {
            action: "restore",
            path: record.renamedFrom!,
            blobSha256: record.beforeBlobSha256,
            mode: record.beforeMode,
          });
          break;
        case "deleted":
        case "modified":
        case "mode-changed":
          planAction(record.path, {
            action: "restore",
            path: record.path,
            blobSha256: record.beforeBlobSha256,
            mode: record.beforeMode,
          });
          break;
      }
    }
  }
  const plan = [...filePlan.values()].sort((a, b) => a.path.localeCompare(b.path));

  const previewBasisHash = digest(canonicalReviewValueJson({
    targetCheckpointId,
    targetUnitId: target.unitId,
    undoOrder: undoManifests.map((manifest) => manifest.unitId),
    filePlan: plan,
    verificationCommands,
    projectConfigSha256,
    traceabilitySha256: state.traceability?.sha256 ?? null,
  }));

  return {
    targetCheckpointId,
    targetUnitId: target.unitId,
    undoOrder: undoManifests.map((manifest) => manifest.unitId),
    undoCheckpoints: undoManifests.map((manifest) => manifest.checkpointId),
    filePlan: plan,
    verificationCommands,
    projectConfigSha256,
    previewBasisHash,
  };
}

/** Read-only rollback summary for StatusView; conflicts are reported, never thrown. */
export async function rollbackChainView(root: string, state: FeatureState): Promise<RollbackChainView> {
  if (!checkpointsEnforcementRequired(state.route, state.workflowCapabilities)) {
    return { enforced: false, chain: [], validTargets: [], conflicts: [] };
  }
  let nodes: RollbackNode[];
  try {
    nodes = rollbackNodes((await readTraceability(root, state)).nodes);
  } catch {
    // StatusView stays fail-soft: trace corruption is already reported through
    // view.trace.blockers, and enforcement entry points still fail closed.
    return { enforced: true, chain: [], validTargets: [], conflicts: [] };
  }
  const chain = await checkpointChain(root, state.featureId, state);
  try {
    assertChainIntegrity(chain, nodes);
  } catch {
    // The chain no longer matches the current trace graph (plan amended or
    // units tombstoned): the historical chain stays visible, but nothing may
    // be targeted and no scope-derived conflicts are computed.
    return {
      enforced: true,
      chain: chain.map((manifest) => ({
        checkpointId: manifest.checkpointId,
        unitId: manifest.unitId,
        sequence: manifest.sequence,
      })),
      validTargets: [],
      conflicts: [],
    };
  }
  const { config } = await readProjectConfigSnapshot(root);
  const snapshot = await snapshotProtectedRoots(root, config.protectedRoots);
  const fileScopes = [...new Set(nodes.flatMap((node) => node.fileScope))];
  let baselineFiles: ProtectedFileSnapshot[] = [];
  if (chain.length) {
    try {
      baselineFiles = (await readCheckpointBaseline(root, state.featureId, chain[0].unitId)).files;
    } catch {
      // A missing baseline alongside confirmed checkpoints is corruption; the
      // projection degrades instead of crashing StatusView, while preview and
      // execution entry points stay fail-closed.
      return { enforced: true, chain: [], validTargets: [], conflicts: [] };
    }
  }
  return {
    enforced: true,
    chain: chain.map((manifest) => ({
      checkpointId: manifest.checkpointId,
      unitId: manifest.unitId,
      sequence: manifest.sequence,
    })),
    validTargets: chain.map((manifest) => manifest.checkpointId),
    conflicts: detectChainConflicts(chain, snapshot, fileScopes, baselineFiles),
  };
}

/** Present a rollback confirmation gate with a preview basis and interaction. */
export async function presentRollbackGate(
  root: string,
  featureId: string,
  expectedRevision: number,
  targetCheckpointId: string,
): Promise<{ state: FeatureState; interaction: PublicInteraction; preview: RollbackPreview }> {
  const initial = await readState(root, featureId);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  if (!rollbackExecutionAllowed(initial.route, initial.workflowCapabilities)) {
    throw new DevFlowError("ROLLBACK_EXECUTION_NOT_ALLOWED", "rollback execution requires checkpoints:1 and rollbackExecution:1 in a standard route");
  }
  if (initial.rollbackGate?.status === "pending") {
    throw new DevFlowError("ROLLBACK_GATE_ALREADY_PRESENTED", "a rollback confirmation gate is already pending", {
      interactionId: initial.rollbackGate.interactionId,
    });
  }

  // Compute preview to validate target and establish the binding basis hash.
  const preview = await previewRollback(root, featureId, targetCheckpointId);

  let interaction: ReturnType<typeof createInteraction> | undefined;
  const state = await mutate(root, featureId, expectedRevision, "rollback-gate-presented", async (state) => {
    if (!rollbackExecutionAllowed(state.route, state.workflowCapabilities)) {
      throw new DevFlowError("ROLLBACK_EXECUTION_NOT_ALLOWED", "rollback execution requires checkpoints:1 and rollbackExecution:1 in a standard route");
    }
    if (state.rollbackGate?.status === "pending") {
      throw new DevFlowError("ROLLBACK_GATE_ALREADY_PRESENTED", "a rollback confirmation gate was presented concurrently");
    }
    interaction = createInteraction(state, {
      kind: "rollback-confirmation",
      target: `rollback:${targetCheckpointId}`,
      basisHash: preview.previewBasisHash,
      options: [
        { id: "confirm", label: "确认回撤" },
        { id: "request-changes", label: "提出修改意见", requiresComment: true },
      ],
    });
    state.rollbackGate = {
      status: "pending",
      targetCheckpointId: preview.targetCheckpointId,
      targetUnitId: preview.targetUnitId,
      previewBasisHash: preview.previewBasisHash,
      interactionId: interaction.id,
      stateRevision: state.revision,
      presentedAt: new Date().toISOString(),
    };
  }, () => ({
    gate: "rollback-confirmation",
    targetCheckpointId,
    interactionId: interaction?.id,
  }));

  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", targetCheckpointId);
  return { state, interaction: toPublicInteraction(interaction), preview };
}

/**
 * Shared resolution logic for rollback-confirmation interactions, dispatched
 * from the public elicitation and text-token wrappers below.
 */
async function resolveRollbackGateResponse(
  root: string,
  featureId: string,
  expectedRevision: number,
  interactionId: string,
  host: "claude" | "codex",
  input:
    | { action: string; comment?: string; source: "elicitation" }
    | { userReply: string; promptEventId: string; source: "text-token" },
): Promise<FeatureState> {
  const initial = await readState(root, featureId);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }

  const gate = initial.rollbackGate;
  if (!gate || gate.status !== "pending" || gate.interactionId !== interactionId) {
    throw new DevFlowError("ROLLBACK_GATE_NOT_PENDING", "rollback gate is not pending or belongs to a different interaction");
  }

  const interaction = getInteraction(initial, interactionId);
  if (interaction.kind !== "rollback-confirmation" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", interactionId);
  }

  // Re-compute preview to detect basis changes (new checkpoints, conflicts,
  // project config changes, target replacement).  On failure, clear the
  // pending gate in a CAS-safe mutate so the user can re-present; the
  // underlying issue (conflict / stale chain) will be caught naturally on
  // the next presentRollbackGate call.
  let currentPreview: RollbackPreview;
  try {
    currentPreview = await previewRollback(root, featureId, gate.targetCheckpointId);
  } catch (err) {
    if (err instanceof DevFlowError) {
      await mutate(root, featureId, expectedRevision, "rollback-gate-stale", async (state) => {
        if (state.rollbackGate?.interactionId === interactionId) {
          delete state.rollbackGate;
          clearInteractionsForTarget(state, `rollback:${gate.targetCheckpointId}`);
        }
      });
      throw new DevFlowError("ROLLBACK_GATE_BASIS_CHANGED", "rollback preview failed or basis changed since gate was presented; the pending gate has been cleared", {
        originalError: err.code,
        recoveryHint: "Resolve the conflict or update checkpoints, then present the rollback gate again",
      });
    }
    throw err;
  }
  if (currentPreview.previewBasisHash !== gate.previewBasisHash) {
    await mutate(root, featureId, expectedRevision, "rollback-gate-stale", async (state) => {
      if (state.rollbackGate?.interactionId === interactionId) {
        delete state.rollbackGate;
        clearInteractionsForTarget(state, `rollback:${gate.targetCheckpointId}`);
      }
    });
    throw new DevFlowError("ROLLBACK_GATE_BASIS_CHANGED", "rollback preview basis hash changed since gate was presented; the pending gate has been cleared", {
      recoveryHint: "Present the rollback gate again after updating checkpoint state",
    });
  }

  // For text-token resolution, verify the confirming event is a real user
  // prompt from a later turn — not a tool event or a pre-presentation event.
  if (input.source === "text-token") {
    if (!input.promptEventId) {
      throw new DevFlowError("ROLLBACK_GATE_PROVENANCE_UNAVAILABLE", "text-token resolution requires a prompt event id", {
        recoveryHint: "Pass the host-captured promptEventId from a user prompt that occurred after gate presentation",
      });
    }
    const events = await readFeatureEvents(root, featureId);
    const eventRecord = events.find(
      (item) =>
        item.type === "host-event"
        && (item.data as { eventId?: string }).eventId === input.promptEventId,
    );
    if (!eventRecord) {
      throw new DevFlowError("ROLLBACK_GATE_PROVENANCE_UNAVAILABLE", "no matching host event found for the given promptEventId", {
        recoveryHint: "Ensure the host UserPromptSubmit hook is active, then submit one exact approval reply and retry",
      });
    }
    const event = eventRecord.data as { type?: string; text?: string; at?: string; host?: string };

    // Only user-prompt events represent genuine user input.
    if (event.type !== "user-prompt") {
      throw new DevFlowError("ROLLBACK_GATE_PROVENANCE_UNAVAILABLE", "the event referenced by promptEventId is not a user prompt; tool events cannot confirm a gate", {
        recoveryHint: "Submit the confirmation reply in a user message, not through a tool callback",
      });
    }

    // The event must be from a strictly later revision than gate presentation.
    if (eventRecord.revision <= gate.stateRevision) {
      throw new DevFlowError("ROLLBACK_GATE_SAME_TURN", "confirmation must come from a later user turn after gate presentation", {
        recoveryHint: "Submit the confirmation reply in a later user message",
      });
    }

    // Timestamp must be after gate presentation (clock-based defense).
    if (Date.parse(event.at ?? "") < Date.parse(gate.presentedAt)) {
      throw new DevFlowError("ROLLBACK_GATE_SAME_TURN", "confirmation event timestamp is before gate presentation", {
        recoveryHint: "Submit the confirmation reply after the gate has been presented",
      });
    }

    // The reply text must match exactly (prevents substituting a different
    // user prompt with the same eventId).
    if (event.text !== input.userReply) {
      throw new DevFlowError("ROLLBACK_GATE_REPLY_MISMATCH", "userReply must match the captured prompt text exactly", {
        recoveryHint: "Pass the exact user prompt text that was captured for this event",
      });
    }
  }

  let response: InteractionResponse | undefined;
  return mutate(root, featureId, expectedRevision, "rollback-gate-resolved", async (state) => {
    const currentGate = state.rollbackGate;
    if (!currentGate || currentGate.status !== "pending" || currentGate.interactionId !== interactionId) {
      throw new DevFlowError("ROLLBACK_GATE_NOT_PENDING", "rollback gate was resolved concurrently");
    }

    response =
      input.source === "elicitation"
        ? resolveNativeInteraction(state, interactionId, input.action, input.comment, host)
        : resolveTokenInteraction(state, interactionId, input.userReply, host, input.promptEventId);

    if (response.action === "confirm") {
      state.rollbackGate = {
        ...currentGate,
        status: "confirmed",
        confirmedAt: new Date().toISOString(),
      };
    } else if (response.action === "request-changes") {
      delete state.rollbackGate;
      clearInteractionsForTarget(state, `rollback:${gate.targetCheckpointId}`);
    } else {
      throw new DevFlowError("INTERACTION_ACTION_INVALID", response.action);
    }
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({ gate: "rollback-confirmation", interactionId, response }));
}

/** Resolve a rollback confirmation gate through an elicitation response. */
export async function resolveRollbackGateElicitation(
  root: string,
  featureId: string,
  expectedRevision: number,
  interactionId: string,
  action: string,
  comment: string | undefined,
  host: "claude" | "codex",
): Promise<FeatureState> {
  return resolveRollbackGateResponse(root, featureId, expectedRevision, interactionId, host, {
    action,
    comment,
    source: "elicitation",
  });
}

/** Resolve a rollback confirmation gate through a text-token fallback reply. */
export async function resolveRollbackGateToken(
  root: string,
  featureId: string,
  expectedRevision: number,
  interactionId: string,
  userReply: string,
  host: "claude" | "codex",
  promptEventId: string,
): Promise<FeatureState> {
  return resolveRollbackGateResponse(root, featureId, expectedRevision, interactionId, host, {
    userReply,
    promptEventId,
    source: "text-token",
  });
}
