import { createHash, randomUUID } from "node:crypto";
import { access, chmod, lstat, mkdir, open, readFile, readlink, rename, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { checkpointsEnforcementRequired, reviewEnforcementRequired, rollbackExecutionAllowed } from "../policy/contract.js";
import type { ImplementationUnitNode, TraceabilityLedger } from "../policy/traceability.js";
import { canonicalReviewValueJson, prepareReviewInvalidation } from "./review-store.js";
import { blobPath, checkpointChain, readCheckpoint, readCheckpointBaseline } from "./checkpoints.js";
import type { CheckpointManifest } from "../policy/rollback.js";
import { DevFlowError } from "./errors.js";
import { snapshotGovernedRoots, type ProtectedFileSnapshot } from "./fingerprint.js";
import { verificationCommandHashesForRefs, type ProjectConfig, type VerificationCommand } from "./project-config.js";
import { implementationUnitForNode, pathWithinFileScope } from "../policy/rollback.js";
import { implementationUnitBasisHash } from "./implementation-units.js";
import {
  appendFeatureEvent,
  mutate,
  mutatePrepared,
  readFeatureEvents,
  readState,
  type FeatureState,
} from "./state-store.js";
import {
  claimRollbackDriveLease,
  maintainRollbackDriveLease,
  prepareRollbackTransaction,
  readRollbackTransaction,
  releaseRollbackDriveLease,
  rollbackTransactionFinished,
  writeRollbackTransaction,
  type RollbackTransaction,
} from "./rollback-journal.js";
import { readProjectConfigSnapshot, readTraceability } from "./traceability-store.js";
import { runVerificationCommand } from "./verification.js";
import { approvalIds } from "./approval-basis.js";
import {
  clearInteractionsForTarget,
  createInteraction,
  resolveResponseForAnswer,
  textCompatible,
  toPublicInteraction,
  type PresentedInteraction,
  type PublicInteraction,
} from "./user-interactions.js";
import type { InteractionResponse } from "../policy/interaction.js";
import { resolveInteractionPromptEvent } from "./interaction-provenance.js";
import type { AnswerResolveContext, AnswerResolveResult } from "./interaction-answer.js";

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
  kind?: "file" | "symlink";
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
  verificationCommandHashes?: Record<string, string>;
  previewBasisHash: string;
}

export interface RollbackChainView {
  enforced: boolean;
  chain: Array<{ checkpointId: string; unitId: string; sequence: number }>;
  validTargets: string[];
  conflicts: RollbackConflict[];
  gateStatus?: {
    status: "pending" | "confirmed";
    targetCheckpointId: string;
    targetUnitId: string;
    interactionId: string;
    presentedAt: string;
    confirmedAt?: string;
  };
  openTransaction?: {
    transactionId: string;
    phase: string;
    targetCheckpointId: string;
    startedAt: string;
    error?: string;
  };
}

function rollbackNodes(nodes: TraceabilityLedger["nodes"]): ImplementationUnitNode[] {
  // Only current implementation-unit definitions may legitimize a rollback
  // plan: stale or tombstoned units mean the plan changed after checkpoints.
  return Object.values(nodes).filter((node): node is ImplementationUnitNode => node.kind === "implementation-unit" && node.status === "current");
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

function assertChainIntegrity(chain: CheckpointManifest[], nodes: ImplementationUnitNode[]): void {
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
  nodes: ImplementationUnitNode[];
  config: ProjectConfig;
  projectConfigSha256: string;
  verificationCommandHashes: Record<string, string>;
}

/**
 * The live chain: checkpoints whose units are still `checkpointed`. rolled_back
 * manifests stay on disk as history (visible in StatusView) but never join new
 * previews — their units' work no longer describes the workspace.
 */
function liveChain(state: FeatureState, chain: CheckpointManifest[]): CheckpointManifest[] {
  const liveIds = new Set(
    (state.implementationUnits ?? [])
      .filter((unit) => unit.status === "checkpointed" && unit.checkpointId)
      .map((unit) => unit.checkpointId),
  );
  return chain.filter((manifest) => liveIds.has(manifest.checkpointId));
}

async function previewContext(root: string, featureId: string): Promise<PreviewContext> {
  const state = await readState(root, featureId);
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls)) {
    throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "回撤预览要求动态路线启用 unit-chain checkpoint 控制。");
  }
  const ledger = await readTraceability(root, state);
  const nodes = rollbackNodes(ledger.nodes);
  const chain = liveChain(state, await checkpointChain(root, featureId, state));
  assertChainIntegrity(chain, nodes);
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
  const verificationRefs = chain.flatMap((manifest) => manifest.verificationCommands.map((command) => command.commandId));
  const verificationCommandHashes = Object.fromEntries(verificationRefs
    .filter((id) => config.verification.commands.some((command) => command.id === id))
    .map((id) => [id, verificationCommandHashesForRefs(config, [id])[id]])
    .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  return { state, chain, nodes, config, projectConfigSha256, verificationCommandHashes };
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
  const { state, chain, nodes, config, projectConfigSha256, verificationCommandHashes } = await previewContext(root, featureId);
  const target = chain.find((manifest) => manifest.checkpointId === targetCheckpointId);
  if (!target) {
    throw new DevFlowError("ROLLBACK_TARGET_INVALID", "rollback target is not a confirmed checkpoint in the live chain", {
      targetCheckpointId,
      validTargets: chain.map((manifest) => manifest.checkpointId),
    });
  }

  const suffix = chain.filter((manifest) => manifest.sequence > target.sequence);
  if (!suffix.length) {
    throw new DevFlowError("ROLLBACK_TARGET_INVALID", "rollback target is the live chain tip; there is nothing to undo", {
      targetCheckpointId,
    });
  }

  const stale = suffix.filter((manifest) => manifest.verificationCommandHashes
    ? Object.entries(manifest.verificationCommandHashes).some(([id, hash]) => verificationCommandHashes[id] !== hash)
    : manifest.projectConfigSha256 !== projectConfigSha256);
  if (stale.length) {
    throw new DevFlowError("ROLLBACK_BASIS_STALE", "project verification config changed after these checkpoints", {
      checkpointIds: stale.map((manifest) => manifest.checkpointId),
    });
  }

  const snapshot = await snapshotGovernedRoots(root, config);
  const fileScopes = [...new Set(nodes.flatMap((node) => node.fileScope))];
  const baselineFiles = (await readCheckpointBaseline(root, featureId, chain[0].unitId)).files;
  const conflicts = detectChainConflicts(chain, snapshot, fileScopes, baselineFiles);
  if (conflicts.length) {
    throw new DevFlowError("ROLLBACK_CONFLICT", "workspace has unregistered modifications; rollback would overwrite them", {
      conflicts,
    });
  }

  const undoManifests = [...suffix].reverse();
  const verificationCommands: RollbackVerificationCommand[] = [];
  for (const manifest of undoManifests) {
    const node = nodes.find((candidate) => candidate.id === manifest.unitId);
    for (const [index, reference] of (node?.forwardVerification ?? []).entries()) {
      const command = typeof reference === "string"
        ? config.verification.commands.find((candidate) => candidate.id === reference)
        : {
            id: `inline:${manifest.unitId}:${index}`,
            command: reference.command,
            args: [...reference.args ?? []],
            cwd: reference.cwd ?? ".",
            provides: ["targeted"] as VerificationCommand["provides"],
          };
      if (!command) {
        throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "rollback verification command is not configured", {
          unitId: manifest.unitId,
          commandId: reference,
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
            kind: record.beforeKind,
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
            kind: record.beforeKind,
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
    verificationCommandHashes,
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
    verificationCommandHashes,
    previewBasisHash,
  };
}

/** Read-only rollback summary for StatusView; conflicts are reported, never thrown. */
export async function rollbackChainView(root: string, state: FeatureState): Promise<RollbackChainView> {
  if (state.mode === "intake") return { enforced: false, chain: [], validTargets: [], conflicts: [] };
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls)) {
    return { enforced: false, chain: [], validTargets: [], conflicts: [] };
  }

  // Gate status and open transaction are read first so they survive ledger/chain
  // degradation (fail-soft below may clear chain fields but shouldn't hide a
  // pending gate or an open transaction).
  const gateStatus = state.rollbackGate?.status === "pending" || state.rollbackGate?.status === "confirmed"
    ? {
      status: state.rollbackGate.status as "pending" | "confirmed",
      targetCheckpointId: state.rollbackGate.targetCheckpointId,
      targetUnitId: state.rollbackGate.targetUnitId,
      interactionId: state.rollbackGate.interactionId,
      presentedAt: state.rollbackGate.presentedAt,
      ...(state.rollbackGate.status === "confirmed" && state.rollbackGate.confirmedAt
        ? { confirmedAt: state.rollbackGate.confirmedAt } : {}),
    }
    : undefined;

  let openTransaction: RollbackChainView["openTransaction"] | undefined;
  try {
    const tx = await readRollbackTransaction(root, state.featureId);
    if (tx && !rollbackTransactionFinished(tx)) {
      openTransaction = {
        transactionId: tx.transactionId,
        phase: tx.phase,
        targetCheckpointId: tx.targetCheckpointId,
        startedAt: tx.startedAt,
        ...(tx.error ? { error: tx.error } : {}),
      };
    }
  } catch {
    // An open transaction with an unreadable journal is already reported by
    // doctor; StatusView stays fail-soft.
  }

  let nodes: ImplementationUnitNode[];
  try {
    nodes = rollbackNodes((await readTraceability(root, state)).nodes);
  } catch {
    // StatusView stays fail-soft: trace corruption is already reported through
    // view.trace.blockers, and enforcement entry points still fail closed.
    return { enforced: true, chain: [], validTargets: [], conflicts: [], gateStatus, openTransaction };
  }
  const chain = await checkpointChain(root, state.featureId, state);
  const live = liveChain(state, chain);
  try {
    // Integrity is judged on the live chain: rolled_back history keeps its
    // dependencies in pending/rolled_back units, which are holes by design.
    assertChainIntegrity(live, nodes);
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
      gateStatus,
      openTransaction,
    };
  }
  const { config } = await readProjectConfigSnapshot(root);
  const snapshot = await snapshotGovernedRoots(root, config);
  const fileScopes = [...new Set(nodes.flatMap((node) => node.fileScope))];
  let baselineFiles: ProtectedFileSnapshot[] = [];
  if (live.length) {
    try {
      baselineFiles = (await readCheckpointBaseline(root, state.featureId, live[0].unitId)).files;
    } catch {
      // A missing baseline alongside confirmed checkpoints is corruption; the
      // projection degrades instead of crashing StatusView, while preview and
      // execution entry points stay fail-closed.
      return { enforced: true, chain: [], validTargets: [], conflicts: [], gateStatus, openTransaction };
    }
  }
  return {
    enforced: true,
    chain: chain.map((manifest) => ({
      checkpointId: manifest.checkpointId,
      unitId: manifest.unitId,
      sequence: manifest.sequence,
    })),
    // The live chain tip has nothing to undo and can never be a target.
    validTargets: live.slice(0, -1).map((manifest) => manifest.checkpointId),
    conflicts: live.length ? detectChainConflicts(live, snapshot, fileScopes, baselineFiles) : [],
    gateStatus,
    openTransaction,
  };
}

/** Present a rollback confirmation gate with a preview basis and interaction. */
/** 回撤门禁呈现：统一基座 + 用户将确认的精确回撤预览。 */
export interface RollbackGatePresentation extends PresentedInteraction {
  preview: RollbackPreview;
}

export async function presentRollbackGate(
  root: string,
  featureId: string,
  expectedRevision: number,
  targetCheckpointId: string,
): Promise<RollbackGatePresentation> {
  const initial = await readState(root, featureId);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  if (!rollbackExecutionAllowed(initial.route, initial.classification.controls)) {
    throw new DevFlowError("ROLLBACK_EXECUTION_NOT_ALLOWED", "当前动态路线没有启用 executable-rollback 与 unit-chain 控制。");
  }
  if (initial.lifecycle !== "active") {
    throw new DevFlowError("INVALID_LIFECYCLE", "rollback gate requires an active feature");
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
    if (!rollbackExecutionAllowed(state.route, state.classification.controls)) {
      throw new DevFlowError("ROLLBACK_EXECUTION_NOT_ALLOWED", "当前动态路线没有启用 executable-rollback 与 unit-chain 控制。");
    }
    if (state.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "rollback gate requires an active feature");
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
    presentationEventId: interaction?.presentationEventId,
  }));

  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", targetCheckpointId);
  return { state, interaction: toPublicInteraction(interaction), interactionId: interaction.id, preview };
}

/**
 * 回撤确认门禁经统一回答入口落账（ADR-0019）：依据已变时清门禁并失败关闭，
 * 依据不变才允许 confirm/request-changes 在一笔 mutatePrepared 内落账。
 */
export async function resolveRollbackGateForAnswer(ctx: AnswerResolveContext): Promise<AnswerResolveResult> {
  const { root, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "rollback-confirmation" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", interaction.id);
  }

  const gate = state.rollbackGate;
  if (!gate || gate.status !== "pending" || gate.interactionId !== interaction.id) {
    throw new DevFlowError("ROLLBACK_GATE_NOT_PENDING", "rollback gate is not pending or belongs to a different interaction");
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
      await mutate(root, featureId, expectedRevision, "rollback-gate-stale", async (draft) => {
        if (draft.rollbackGate?.interactionId === interaction.id) {
          delete draft.rollbackGate;
          clearInteractionsForTarget(draft, `rollback:${gate.targetCheckpointId}`);
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
    await mutate(root, featureId, expectedRevision, "rollback-gate-stale", async (draft) => {
      if (draft.rollbackGate?.interactionId === interaction.id) {
        delete draft.rollbackGate;
        clearInteractionsForTarget(draft, `rollback:${gate.targetCheckpointId}`);
      }
    });
    throw new DevFlowError("ROLLBACK_GATE_BASIS_CHANGED", "rollback preview basis hash changed since gate was presented; the pending gate has been cleared", {
      recoveryHint: "Present the rollback gate again after updating checkpoint state",
    });
  }

  // For text resolution, verify the confirming event is a real user
  // prompt from a later turn — not a tool event or a pre-presentation event.
  let promptEventId: string | undefined;
  let promptText: string | undefined;
  if (credential.source === "text") {
    const events = await readFeatureEvents(root, featureId);
    promptEventId = resolveInteractionPromptEvent(events, state, interaction, {
      host,
      userReply: credential.userReply,
    }).eventId;
    const eventRecord = events.find(
      (item) =>
        item.type === "host-event"
        && (item.data as { eventId?: string }).eventId === promptEventId,
    );
    if (!eventRecord) {
      throw new DevFlowError("ROLLBACK_GATE_PROVENANCE_UNAVAILABLE", "no matching host event found for the given promptEventId", {
        recoveryHint: "Ensure the host UserPromptSubmit hook is active, then submit one exact approval reply and retry",
      });
    }
    const event = eventRecord.data as { type?: string; text?: string; at?: string; host?: string };
    promptText = typeof event.text === "string" ? event.text : undefined;

    if (event.host !== host) {
      throw new DevFlowError("HOST_EVENT_HOST_MISMATCH", "host event belongs to a different host", {
        expectedHost: host,
        actualHost: event.host,
        eventId: promptEventId,
      });
    }

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

    // The reply text must be semantically compatible (prevents substituting a
    // different user prompt with the same eventId).
    if (!textCompatible(event.text ?? "", credential.userReply)) {
      throw new DevFlowError("ROLLBACK_GATE_REPLY_MISMATCH", "userReply must be compatible with the captured prompt text", {
        recoveryHint: "Pass the user prompt text that was captured for this event",
      });
    }
  }

  let response: InteractionResponse | undefined;
  const next = await mutatePrepared(root, featureId, expectedRevision, "rollback-gate-resolved", async (current) => {
    const currentGate = current.rollbackGate;
    if (!currentGate || currentGate.status !== "pending" || currentGate.interactionId !== interaction.id) {
      throw new DevFlowError("ROLLBACK_GATE_NOT_PENDING", "rollback gate was resolved concurrently");
    }
    return {
      mutate: (draft) => {
        response = resolveResponseForAnswer(draft, interaction, {
          source: credential.source,
          action: credential.source === "elicitation" ? credential.action : undefined,
          comment: credential.source === "elicitation" ? credential.comment : undefined,
          userReply: credential.source === "text" ? credential.userReply : undefined,
          promptText,
          promptEventId,
          host,
        });
        if (response.action === "confirm") {
          draft.rollbackGate = {
            ...currentGate,
            status: "confirmed",
            confirmedAt: new Date().toISOString(),
          };
        } else if (response.action === "request-changes") {
          delete draft.rollbackGate;
          clearInteractionsForTarget(draft, `rollback:${gate.targetCheckpointId}`);
        } else {
          throw new DevFlowError("INTERACTION_ACTION_INVALID", response.action);
        }
        draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
      },
      eventData: () => ({ gate: "rollback-confirmation", interactionId: interaction.id, response }),
    };
  });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...(response.comment ? { comment: response.comment } : {}) };
}

// ─── Rollback execution engine ───────────────────────────────────────────────
//
// The engine journals every stage to rollback-transaction.json so any crash is
// resumable from the exact stage it died in. Ordering invariants:
//   - the journal exists before any workspace byte moves;
//   - the full pre-rollback backup completes before the first rename;
//   - the journal records commit intent BEFORE the state CAS (two-write), and
//     `completedAt` is the single fully-done marker the mutation guard reads;
//   - compensation restores from the backup and moves extras to trash — bytes
//     are never unlinked mid-transaction.
// Injected fault points throw plain Errors (simulated crashes): they propagate
// untouched. Only DevFlowError after the first rename triggers compensation.

export type RollbackFaultPoint =
  | "before-journal-write"
  | "after-journal-write"
  | "during-backup"
  | "before-first-rename"
  | "after-first-rename"
  | "before-verification"
  | "before-state-cas"
  | "after-state-cas"
  | "during-compensation";

export interface ExecuteRollbackOptions {
  /** Test-only fault injection. Production callers omit this. */
  fault?: (point: RollbackFaultPoint) => void | Promise<void>;
}

export interface ExecuteRollbackResult {
  outcome: "committed";
  state: FeatureState;
  transaction: RollbackTransaction;
}

interface RollbackBackupManifest {
  schemaVersion: 1;
  transactionId: string;
  featureId: string;
  capturedAt: string;
  files: ProtectedFileSnapshot[];
}

interface SnapshotMismatch {
  path: string;
  expected: "present" | "absent";
  actual: "present" | "absent" | "changed";
}

const featureDirectory = (root: string, featureId: string) => path.join(root, ".dev-flow", "features", featureId);

async function pathExists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Same-directory temp file, fsync, chmod, atomic rename, directory fsync. */
async function writeFileAtomicMode(file: string, bytes: Buffer, mode: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temp, Number.parseInt(mode, 8));
  await rename(temp, file);
  await fsyncDirectory(path.dirname(file));
}

async function writeSymlinkAtomic(file: string, target: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await symlink(target, temp);
  await rename(temp, file);
  await fsyncDirectory(path.dirname(file));
}

async function writeAtomicBuffer(file: string, contents: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  await fsyncDirectory(path.dirname(file));
}

function validateBackupManifest(value: unknown, transactionId: string): asserts value is RollbackBackupManifest {
  const manifest = value as Partial<RollbackBackupManifest> | undefined;
  const files = manifest?.files;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.transactionId !== transactionId
    || typeof manifest.featureId !== "string" || typeof manifest.capturedAt !== "string"
    || !Array.isArray(files)
    || !files.every((file) => file && typeof file.path === "string"
      && /^[a-f0-9]{64}$/.test(file.sha256) && /^[0-7]{3,4}$/.test(file.mode))) {
    throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup manifest is invalid", { transactionId });
  }
}

async function readBackupManifest(manifestFile: string, transactionId: string): Promise<RollbackBackupManifest> {
  let raw: string;
  try { raw = await readFile(manifestFile, "utf8"); }
  catch {
    throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup manifest is missing", { transactionId });
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    validateBackupManifest(parsed, transactionId);
    return parsed;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup manifest is unreadable", { transactionId });
  }
}

/** Full byte/mode comparison of an expected file set against a live snapshot. */
function snapshotMismatches(expected: ProtectedFileSnapshot[], current: ProtectedFileSnapshot[]): SnapshotMismatch[] {
  const mismatches: SnapshotMismatch[] = [];
  const expectedByPath = new Map(expected.map((file) => [file.path, file]));
  const currentByPath = new Map(current.map((file) => [file.path, file]));
  for (const [filePath, file] of expectedByPath) {
    const actual = currentByPath.get(filePath);
    if (!actual) {
      mismatches.push({ path: filePath, expected: "present", actual: "absent" });
    } else if (actual.sha256 !== file.sha256 || actual.mode !== file.mode || (actual.kind ?? "file") !== (file.kind ?? "file")) {
      mismatches.push({ path: filePath, expected: "present", actual: "changed" });
    }
  }
  for (const filePath of currentByPath.keys()) {
    if (!expectedByPath.has(filePath)) {
      mismatches.push({ path: filePath, expected: "absent", actual: "present" });
    }
  }
  return mismatches.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Fails closed when the workspace no longer equals the live chain tip that the
 * confirmed gate and journal were based on. captureBackup runs this before
 * snapshotting: a resume after a mid-backup crash must never absorb post
 * -confirmation edits into the "pre-rollback" backup — the file plan would
 * silently overwrite them and the commit cleanup would destroy the only copy.
 * Same per-file rule the preview enforced at gate time (detectChainConflicts).
 */
async function assertWorkspaceMatchesChainTip(root: string, featureId: string, config: ProjectConfig): Promise<void> {
  const state = await readState(root, featureId);
  const chain = liveChain(state, await checkpointChain(root, featureId, state));
  const nodes = rollbackNodes((await readTraceability(root, state)).nodes);
  const fileScopes = [...new Set(nodes.flatMap((node) => node.fileScope))];
  const baselineFiles = chain.length ? (await readCheckpointBaseline(root, featureId, chain[0].unitId)).files : [];
  const snapshot = await snapshotGovernedRoots(root, config);
  const conflicts = detectChainConflicts(chain, snapshot, fileScopes, baselineFiles);
  if (conflicts.length) {
    throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the confirmed rollback basis; refusing to capture it as the pre-rollback backup", {
      conflicts,
      recoveryHint: "Restore the drifted files to their checkpointed bytes, then resume the rollback with the same target; run dev_flow_doctor to inspect the open transaction",
    });
  }
}

/**
 * Captures the FULL governed-roots snapshot (bytes plus mode) into the
 * transaction recovery directory. The full snapshot — not just filePlan paths
 * — is what lets compensation undo verification-command drift and restore
 * every pre-rollback byte. Idempotent: a resume with a complete manifest only
 * verifies the workspace still matches it.
 */
async function captureBackup(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  config: ProjectConfig,
  options: ExecuteRollbackOptions,
): Promise<void> {
  const dir = path.join(featureDirectory(root, featureId), journal.backupDirectory);
  const manifestFile = path.join(dir, "backup-manifest.json");
  if (await pathExists(manifestFile)) {
    const manifest = await readBackupManifest(manifestFile, journal.transactionId);
    const current = await snapshotGovernedRoots(root, config);
    const mismatches = snapshotMismatches(manifest.files, current);
    if (mismatches.length) {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the recorded rollback backup", { mismatches });
    }
    return;
  }
  // No manifest: first capture, or a resume after a mid-backup crash. The
  // workspace must still equal the confirmed chain tip BEFORE anything is
  // snapshotted — otherwise drift would be absorbed into the backup.
  await assertWorkspaceMatchesChainTip(root, featureId, config);
  await mkdir(path.join(dir, "files"), { recursive: true });
  await mkdir(path.join(dir, "trash"), { recursive: true });
  const snapshot = await snapshotGovernedRoots(root, config);
  let first = true;
  for (const file of snapshot) {
    const bytes = file.kind === "symlink" ? Buffer.from(await readlink(path.join(root, file.path))) : await readFile(path.join(root, file.path));
    if (digest(bytes) !== file.sha256) {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "protected files changed while capturing the rollback backup", { path: file.path });
    }
    const blobFile = path.join(dir, "files", file.sha256);
    if (!(await pathExists(blobFile))) await writeAtomicBuffer(blobFile, bytes);
    if (first) {
      first = false;
      await options.fault?.("during-backup");
    }
  }
  const manifest: RollbackBackupManifest = {
    schemaVersion: 1,
    transactionId: journal.transactionId,
    featureId,
    capturedAt: new Date().toISOString(),
    files: snapshot,
  };
  await writeAtomicBuffer(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  // Drift during the capture window is still a basis violation: the manifest
  // must describe the live workspace byte-for-byte before any rename starts.
  // The next resume re-runs this same comparison through the branch above.
    const captureDrift = snapshotMismatches(manifest.files, await snapshotGovernedRoots(root, config));
  if (captureDrift.length) {
    throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "protected files changed while capturing the rollback backup", { mismatches: captureDrift });
  }
}

/**
 * Per-path fail-closed check: the live workspace at `filePath` must still equal
 * the pre-rollback backup expectation (present with same sha+mode, or absent).
 * Called immediately before each filePlan action so drift after backup and
 * before the write cannot be silently overwritten or trashed.
 */
async function assertPathMatchesBackupExpectation(
  root: string,
  filePath: string,
  expected: ProtectedFileSnapshot | undefined,
): Promise<void> {
  const absolute = path.join(root, filePath);
  if (expected) {
    let metadata;
    let bytes: Buffer;
    try {
      metadata = await lstat(absolute);
      bytes = expected.kind === "symlink" ? Buffer.from(await readlink(absolute)) : await readFile(absolute);
    } catch {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the pre-rollback backup before a file action", {
        path: filePath,
        expected: "present",
        actual: "missing",
        recoveryHint: "Restore the drifted path to its pre-rollback bytes, then resume the rollback with the same target",
      });
    }
    const mode = (metadata.mode & 0o777).toString(8).padStart(3, "0");
    const kind = metadata.isSymbolicLink() ? "symlink" : "file";
    if (digest(bytes) !== expected.sha256 || mode !== expected.mode || kind !== (expected.kind ?? "file")) {
      throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the pre-rollback backup before a file action", {
        path: filePath,
        expected: "present",
        actual: "changed",
        recoveryHint: "Restore the drifted path to its pre-rollback bytes, then resume the rollback with the same target",
      });
    }
    return;
  }
  if (await pathExists(absolute)) {
    throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted from the pre-rollback backup before a file action", {
      path: filePath,
      expected: "absent",
      actual: "present",
      recoveryHint: "Remove the unregistered path, then resume the rollback with the same target",
    });
  }
}

/**
 * Applies the journaled file plan from nextFileIndex onward. Restores read
 * checkpoint blobs (digest-verified); deletes are moved into the transaction
 * trash — never unlinked. Each applied action advances the journal before the
 * next one starts, so a crash resume skips exactly the completed prefix.
 *
 * Before every action the live path is checked against the backup-manifest
 * expectation (present: sha+mode; absent: missing). Drift after backup and
 * before the write is fail-closed — never overwrite or trash user edits.
 */
async function applyFilePlan(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  options: ExecuteRollbackOptions,
): Promise<void> {
  const dir = path.join(featureDirectory(root, featureId), journal.backupDirectory);
  const trash = path.join(dir, "trash");
  const backup = await readBackupManifest(path.join(dir, "backup-manifest.json"), journal.transactionId);
  const expectedByPath = new Map(backup.files.map((file) => [file.path, file]));
  for (let index = journal.nextFileIndex; index < journal.filePlan.length; index += 1) {
    const action = journal.filePlan[index];
    if (index === 0) await options.fault?.("before-first-rename");
    await assertPathMatchesBackupExpectation(root, action.path, expectedByPath.get(action.path));
    const target = path.join(root, action.path);
    if (action.action === "restore") {
      const blobFile = path.join(featureDirectory(root, featureId), blobPath(action.blobSha256!));
      let bytes: Buffer;
      try { bytes = await readFile(blobFile); }
      catch {
        throw new DevFlowError("ROLLBACK_CHECKPOINT_CORRUPT", "checkpoint blob is missing", {
          blobSha256: action.blobSha256,
          path: action.path,
        });
      }
      if (digest(bytes) !== action.blobSha256) {
        throw new DevFlowError("ROLLBACK_CHECKPOINT_CORRUPT", "checkpoint blob failed its digest check", {
          blobSha256: action.blobSha256,
          path: action.path,
        });
      }
      if (action.kind === "symlink") await writeSymlinkAtomic(target, bytes.toString("utf8"));
      else await writeFileAtomicMode(target, bytes, action.mode!);
    } else {
      const trashFile = path.join(trash, `${String(index).padStart(4, "0")}-${path.basename(action.path)}`);
      if (await pathExists(target)) {
        await mkdir(trash, { recursive: true });
        await rename(target, trashFile);
        await fsyncDirectory(path.dirname(target));
        await fsyncDirectory(trash);
      } else if (!(await pathExists(trashFile))) {
        // Neither the workspace nor the trash has the path: it moved under us.
        throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "file planned for deletion vanished outside the transaction", { path: action.path });
      }
      // A crash between the rename and the journal update re-enters here with
      // the trash entry already present: the action counts as applied.
    }
    journal.nextFileIndex = index + 1;
    await writeRollbackTransaction(root, featureId, journal);
    // Progressive post-action check: already-applied paths must still match the
    // plan. External edits after a rename must not be silently compensated later.
    const progressive = await expectedPlanStateAfter(root, featureId, journal, journal.nextFileIndex);
    // Only re-check paths touched so far (cheap and precise for the after-rename window).
    for (const action of journal.filePlan.slice(0, journal.nextFileIndex)) {
      const expected = progressive.find((file) => file.path === action.path);
      if (action.action === "delete") {
        if (await pathExists(path.join(root, action.path))) {
          throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted after a rollback file action", {
            path: action.path,
            source: "post-plan",
            expected: "absent",
            actual: "present",
            recoveryHint: "Restore the drifted path to the post-plan state, then resume the rollback with the same target",
          });
        }
      } else if (expected) {
        let metadata;
        let bytes: Buffer;
        try {
          metadata = await lstat(path.join(root, action.path));
          bytes = expected.kind === "symlink" ? Buffer.from(await readlink(path.join(root, action.path))) : await readFile(path.join(root, action.path));
        } catch {
          throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted after a rollback file action", {
            path: action.path,
            source: "post-plan",
            expected: "present",
            actual: "missing",
            recoveryHint: "Restore the drifted path to the post-plan state, then resume the rollback with the same target",
          });
        }
        const mode = (metadata.mode & 0o777).toString(8).padStart(3, "0");
        if (digest(bytes) !== expected.sha256 || mode !== expected.mode) {
          throw new DevFlowError("ROLLBACK_HASH_MISMATCH", "workspace drifted after a rollback file action", {
            path: action.path,
            source: "post-plan",
            expected: "present",
            actual: "changed",
            recoveryHint: "Restore the drifted path to the post-plan state, then resume the rollback with the same target",
          });
        }
      }
    }
    if (index === 0) await options.fault?.("after-first-rename");
  }
  journal.phase = "verifying";
  await writeRollbackTransaction(root, featureId, journal);
}

/** Re-derives the rollback verification commands from the journal's undo order. */
async function transactionVerificationCommands(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  config: ProjectConfig,
): Promise<Array<{ unitId: string; command: VerificationCommand }>> {
  const state = await readState(root, featureId);
  const nodes = rollbackNodes((await readTraceability(root, state)).nodes);
  const plan: Array<{ unitId: string; command: VerificationCommand }> = [];
  for (const unitId of journal.undoOrder) {
    const node = nodes.find((candidate) => candidate.id === unitId);
    if (!node) {
      throw new DevFlowError("ROLLBACK_CHAIN_INVALID", "undo unit is not current in the trace graph", { unitId });
    }
    for (const [index, reference] of node.forwardVerification.entries()) {
      const command = typeof reference === "string"
        ? config.verification.commands.find((candidate) => candidate.id === reference)
        : {
            id: `inline:${unitId}:${index}`,
            command: reference.command,
            args: [...reference.args ?? []],
            cwd: reference.cwd ?? ".",
            provides: ["targeted"] as VerificationCommand["provides"],
          };
      if (!command) {
        throw new DevFlowError("TRACE_VERIFICATION_COMMAND_UNKNOWN", "rollback verification command is not configured", {
          unitId,
          commandId: reference,
        });
      }
      plan.push({ unitId, command });
    }
  }
  return plan;
}

/** Progressive expected state after the first `appliedCount` filePlan actions. */
async function expectedPlanStateAfter(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  appliedCount: number,
): Promise<ProtectedFileSnapshot[]> {
  const manifest = await readBackupManifest(
    path.join(featureDirectory(root, featureId), journal.backupDirectory, "backup-manifest.json"),
    journal.transactionId,
  );
  const expected = new Map(manifest.files.map((file) => [file.path, { ...file }]));
  for (const action of journal.filePlan.slice(0, appliedCount)) {
    if (action.action === "restore") {
      expected.set(action.path, { path: action.path, sha256: action.blobSha256!, mode: action.mode!, kind: action.kind ?? "file" });
    } else {
      expected.delete(action.path);
    }
  }
  return [...expected.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** The workspace state the file plan must produce: the backup replayed through it. */
async function expectedPlanState(root: string, featureId: string, journal: RollbackTransaction): Promise<ProtectedFileSnapshot[]> {
  return expectedPlanStateAfter(root, featureId, journal, journal.filePlan.length);
}

async function recordVerificationAttempt(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  attempt: Record<string, unknown>,
): Promise<string> {
  const attemptId = randomUUID();
  const state = await readState(root, featureId);
  await appendFeatureEvent(root, featureId, state.revision, "rollback-verification-attempt", {
    attemptId,
    transactionId: journal.transactionId,
    ...attempt,
  });
  journal.verificationAttemptIds.push(attemptId);
  await writeRollbackTransaction(root, featureId, journal);
  return attemptId;
}

/**
 * Runs the undo units' rollback verification commands. Passed attempts are
 * never re-run (a crash between commands resumes with the next one). A failed
 * command — including a passing command that drifted protected files — throws
 * ROLLBACK_VERIFICATION_FAILED, which the driver converts into compensation.
 */
async function runRollbackVerification(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  config: ProjectConfig,
  options: ExecuteRollbackOptions,
): Promise<void> {
  await options.fault?.("before-verification");
  const commands = await transactionVerificationCommands(root, featureId, journal, config);
  const events = await readFeatureEvents(root, featureId);
  const passedByUnit = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.type !== "rollback-verification-attempt") continue;
    const data = event.data as { transactionId?: string; unitId?: string; commandId?: string; status?: string };
    if (data.transactionId !== journal.transactionId || data.status !== "passed" || !data.unitId || !data.commandId) continue;
    const passed = passedByUnit.get(data.unitId) ?? new Set<string>();
    passed.add(data.commandId);
    passedByUnit.set(data.unitId, passed);
  }
  for (const { unitId, command } of commands) {
    if (passedByUnit.get(unitId)?.has(command.id)) continue;
    const startedAt = new Date().toISOString();
    const result = await runVerificationCommand(root, command);
    const attemptId = await recordVerificationAttempt(root, featureId, journal, {
      unitId,
      commandId: command.id,
      command: commandSummary(command),
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode,
      output: result.output.slice(-4_000),
      startedAt,
      completedAt: new Date().toISOString(),
    });
    if (result.exitCode !== 0) {
      throw new DevFlowError("ROLLBACK_VERIFICATION_FAILED", "rollback verification failed; the transaction compensates the workspace", {
        unitId,
        phase: "rollback",
        commandId: command.id,
        command: commandSummary(command),
        cwd: command.cwd,
        attemptId,
        exitCode: result.exitCode,
        outputTail: result.output.slice(-4_000),
        recoveryHint: "修复回撤验证失败原因后，使用同一事务重试；事务会保留原回撤前备份",
      });
    }
  }
  // Drift guard: after the undo, the workspace must equal the backup replayed
  // through the file plan exactly. A command-side effect (or an unexpected
  // write during verification) is a verification failure and compensates from
  // the pre-rollback backup, per the transaction contract.
  const expected = await expectedPlanState(root, featureId, journal);
  const current = await snapshotGovernedRoots(root, config);
  const mismatches = snapshotMismatches(expected, current);
  if (mismatches.length) {
    const attemptId = await recordVerificationAttempt(root, featureId, journal, {
      unitId: null,
      commandId: "drift-guard",
      command: "governed-root drift guard",
      status: "failed",
      reason: "drift",
      mismatches,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
      throw new DevFlowError("ROLLBACK_VERIFICATION_FAILED", "rollback verification changed protected files; the transaction compensates the workspace", {
        unitId: null,
        phase: "rollback",
        commandId: "drift-guard",
        command: "governed-root drift guard",
        cwd: ".",
        exitCode: 1,
        outputTail: "protected files differ from the expected rollback state",
        attemptId,
        mismatches,
        source: "verification-drift",
        recoveryHint: "检查回撤验证是否写入受保护文件，然后恢复到预期回撤状态并重试事务",
      });
  }
}

async function recordCompensationAttempt(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  attempt: { status: "passed" | "failed"; reason?: string; mismatches?: SnapshotMismatch[]; startedAt: string },
): Promise<string> {
  const attemptId = randomUUID();
  const state = await readState(root, featureId);
  await appendFeatureEvent(root, featureId, state.revision, "rollback-compensation-attempt", {
    attemptId,
    transactionId: journal.transactionId,
    status: attempt.status,
    ...(attempt.reason ? { reason: attempt.reason } : {}),
    ...(attempt.mismatches ? { mismatches: attempt.mismatches } : {}),
    startedAt: attempt.startedAt,
    completedAt: new Date().toISOString(),
  });
  journal.verificationAttemptIds.push(attemptId);
  await writeRollbackTransaction(root, featureId, journal);
  return attemptId;
}

/** Blocks recovery: the journal keeps the error and the backup scene is preserved. */
async function blockRecovery(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  message: string,
  details: Record<string, unknown>,
): Promise<never> {
  journal.error = message;
  await writeRollbackTransaction(root, featureId, journal);
  throw new DevFlowError("ROLLBACK_RECOVERY_BLOCKED", "rollback recovery is blocked: compensation could not restore the pre-rollback workspace", {
    transactionId: journal.transactionId,
    backupDirectory: journal.backupDirectory,
    attemptIds: [...journal.verificationAttemptIds],
    ...details,
    recoveryHint: "Resolve the reported cause, then resume the same rollback transaction; the backup scene is preserved",
  });
}

/**
 * Restores every pre-rollback byte/mode from the backup, moves extras (drift
 * output) to trash, then verifies the workspace against the backup manifest.
 * Only a corrupt backup or a failed comparison blocks recovery; everything is
 * idempotent so a crash mid-compensation simply resumes the restore.
 */
async function compensateRollback(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  config: ProjectConfig,
  options: ExecuteRollbackOptions,
): Promise<void> {
  if (journal.phase !== "compensating") {
    journal.phase = "compensating";
    await writeRollbackTransaction(root, featureId, journal);
  }
  const dir = path.join(featureDirectory(root, featureId), journal.backupDirectory);
  const startedAt = new Date().toISOString();
  try {
    const manifest = await readBackupManifest(path.join(dir, "backup-manifest.json"), journal.transactionId);
    let restored = 0;
    for (const file of manifest.files) {
      const blobFile = path.join(dir, "files", file.sha256);
      let bytes: Buffer;
      try { bytes = await readFile(blobFile); }
      catch {
        throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup bytes are missing", { path: file.path, sha256: file.sha256 });
      }
      if (digest(bytes) !== file.sha256) {
        throw new DevFlowError("ROLLBACK_BACKUP_CORRUPT", "rollback backup bytes failed their digest check", { path: file.path, sha256: file.sha256 });
      }
      if (file.kind === "symlink") await writeSymlinkAtomic(path.join(root, file.path), bytes.toString("utf8"));
      else await writeFileAtomicMode(path.join(root, file.path), bytes, file.mode);
      restored += 1;
      if (restored === 1) await options.fault?.("during-compensation");
    }
    // Extras (for example verification drift output) move to trash — never unlink.
    const current = await snapshotGovernedRoots(root, config);
    const expectedPaths = new Set(manifest.files.map((file) => file.path));
    const trash = path.join(dir, "trash");
    for (const file of current) {
      if (expectedPaths.has(file.path)) continue;
      const trashFile = path.join(trash, `extra-${digest(file.path).slice(0, 16)}-${path.basename(file.path)}`);
      await mkdir(trash, { recursive: true });
      await rename(path.join(root, file.path), trashFile);
      await fsyncDirectory(path.dirname(path.join(root, file.path)));
    }
    const after = await snapshotGovernedRoots(root, config);
    const mismatches = snapshotMismatches(manifest.files, after);
    if (mismatches.length) {
      await recordCompensationAttempt(root, featureId, journal, { status: "failed", reason: "mismatch", mismatches, startedAt });
      await blockRecovery(root, featureId, journal, "compensation verification failed: the workspace does not match the pre-rollback backup", { mismatches });
    }
    await recordCompensationAttempt(root, featureId, journal, { status: "passed", startedAt });
  } catch (error) {
    if (error instanceof DevFlowError && error.code === "ROLLBACK_BACKUP_CORRUPT") {
      await recordCompensationAttempt(root, featureId, journal, { status: "failed", reason: "backup-corrupt", startedAt });
      await blockRecovery(root, featureId, journal, error.message, { cause: error.details });
    }
    throw error;
  }
  journal.phase = "compensated";
  delete journal.error;
  await writeRollbackTransaction(root, featureId, journal);
}

/** The success state CAS: units, downstream freshness, approval basis, gate. */
async function commitRollbackState(root: string, featureId: string, journal: RollbackTransaction): Promise<FeatureState> {
  const target = await readCheckpoint(root, featureId, journal.targetCheckpointId);
  return mutatePrepared(root, featureId, journal.stateRevision, "rollback-executed", async (current, nextStateRevision) => {
    const nodes = rollbackNodes((await readTraceability(root, current)).nodes);
    // The approval survives only while the plan basis at the target checkpoint
    // still equals the current basis; an amended plan must re-earn it.
    const basisKept = implementationUnitBasisHash(current) === target.basisHash;
    const review = reviewEnforcementRequired(current.route, current.classification.controls)
      ? await prepareReviewInvalidation(root, current, nextStateRevision)
      : undefined;
    return {
      mutate: (draft) => {
        const units = draft.implementationUnits ?? [];
        for (const unitId of journal.undoOrder) {
          const unit = units.find((candidate) => candidate.unitId === unitId);
          if (!unit) {
            throw new DevFlowError("ROLLBACK_CHAIN_INVALID", "undo unit is missing from implementation state", { unitId });
          }
          unit.status = "rolled_back";
        }
        // The chain-earliest undone unit becomes the next work item — pending
        // as a fresh incarnation (no checkpoint, fingerprint, or nonce) — while
        // later undone units stay rolled_back for audit.
        const earliest = units.find((candidate) => candidate.unitId === journal.undoOrder[journal.undoOrder.length - 1])!;
        earliest.status = "pending";
        delete earliest.checkpointId;
        delete earliest.startedFingerprint;
        delete earliest.beginNonce;
        if (!basisKept) {
          for (const approvalId of approvalIds(draft)) {
            delete draft.humanGates[approvalId];
            clearInteractionsForTarget(draft, `approval:${approvalId}`);
          }
          draft.obligations = (draft.obligations ?? []).map((obligation) => obligation.kind === "approval"
            ? { ...obligation, status: "pending" as const }
            : obligation);
        }
        // Units registered after the checkpoints (an amended plan) join as pending.
        const basisHash = implementationUnitBasisHash(draft);
        for (const node of nodes) {
          if (!units.some((candidate) => candidate.unitId === node.id)) {
            units.push(implementationUnitForNode(node, basisHash));
          }
        }
        draft.implementationUnits = units;
        for (const step of ["implementation", "code_review", "verification", "finalize"]) {
          delete draft.steps[step];
        }
        draft.logicComplete = false;
        delete draft.verification.satisfiedByAttemptId;
        delete draft.verification.verifiedFingerprint;
        if (review) draft.review = review;
        delete draft.rollbackGate;
        clearInteractionsForTarget(draft, `rollback:${journal.targetCheckpointId}`);
      },
      eventData: {
        transactionId: journal.transactionId,
        targetCheckpointId: journal.targetCheckpointId,
        targetUnitId: journal.targetUnitId,
        undoOrder: [...journal.undoOrder],
        undoCheckpoints: [...(journal.undoCheckpoints ?? [])],
        verificationAttemptIds: [...journal.verificationAttemptIds],
      },
    };
  }, { allowRollbackTransaction: journal.transactionId });
}

/**
 * Removes transaction backup material without touching drive-lease.json. The
 * lease is the compatibility mirror for older hosts and remains until the
 * completedAt marker is durable; releaseRollbackDriveLease then removes it and
 * the now-empty recovery directory in the driver's finally block.
 */
async function cleanupRollbackBackup(root: string, featureId: string, journal: RollbackTransaction): Promise<void> {
  const directory = path.join(featureDirectory(root, featureId), journal.backupDirectory);
  await rm(path.join(directory, "files"), { recursive: true, force: true });
  await rm(path.join(directory, "trash"), { recursive: true, force: true });
  await rm(path.join(directory, "backup-manifest.json"), { force: true });
}

async function finishCommitted(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  options: ExecuteRollbackOptions,
): Promise<ExecuteRollbackResult> {
  await options.fault?.("before-state-cas");
  let state = await readState(root, featureId);
  // The journal already records commit intent; the CAS runs exactly once
  // (mutations by anyone else are blocked while the journal is unfinished).
  if (state.revision === journal.stateRevision) {
    state = await commitRollbackState(root, featureId, journal);
  }
  await options.fault?.("after-state-cas");
  // Keep the legacy lease mirror in place until completedAt is durable. Older
  // hosts only see that path; deleting the whole directory first would let one
  // of them claim a still-open journal during a rolling upgrade.
  await cleanupRollbackBackup(root, featureId, journal);
  journal.completedAt = new Date().toISOString();
  await writeRollbackTransaction(root, featureId, journal);
  return { outcome: "committed", state, transaction: journal };
}

/** Compensated terminal: consume the one-shot gate, clean up, then report the failure. */
async function finishCompensated(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  cause: DevFlowError,
): Promise<never> {
  const state = await readState(root, featureId);
  if (state.revision === journal.stateRevision) {
    await mutatePrepared(root, featureId, journal.stateRevision, "rollback-compensated", async () => ({
      mutate: (draft) => {
        delete draft.rollbackGate;
        clearInteractionsForTarget(draft, `rollback:${journal.targetCheckpointId}`);
      },
      eventData: {
        transactionId: journal.transactionId,
        targetCheckpointId: journal.targetCheckpointId,
        cause: cause.code,
      },
    }), { allowRollbackTransaction: journal.transactionId });
  }
  await cleanupRollbackBackup(root, featureId, journal);
  journal.completedAt = new Date().toISOString();
  await writeRollbackTransaction(root, featureId, journal);
  throw new DevFlowError("ROLLBACK_EXECUTION_FAILED", "rollback execution failed; the workspace was compensated to its pre-rollback state", {
    compensated: true,
    transactionId: journal.transactionId,
    cause: cause.code,
    attemptIds: [...journal.verificationAttemptIds],
  });
}

/** Drives a journaled transaction from its current phase to a terminal phase. */
async function driveRollbackTransaction(
  root: string,
  featureId: string,
  journal: RollbackTransaction,
  options: ExecuteRollbackOptions,
): Promise<ExecuteRollbackResult> {
  // Exclusive driver: concurrent resumes on the same open journal get BUSY.
  const lease = await claimRollbackDriveLease(root, featureId, journal.transactionId);
  const heartbeat = maintainRollbackDriveLease(root, featureId, lease);
  try {
    heartbeat.assertOwned();
    // Re-read under the lease so we drive the latest durable phase/index.
    const current = await readRollbackTransaction(root, featureId);
    if (!current || current.transactionId !== journal.transactionId) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "rollback transaction disappeared while claiming the drive lease", {
        transactionId: journal.transactionId,
      });
    }
    journal = current;
    const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
    try {
      const commandHashes = journal.verificationCommandHashes
        ? verificationCommandHashesForRefs(config, Object.keys(journal.verificationCommandHashes))
        : undefined;
      const commandSliceStale = journal.verificationCommandHashes
        ? Object.entries(journal.verificationCommandHashes).some(([id, hash]) => commandHashes?.[id] !== hash)
        : projectConfigSha256 !== journal.projectConfigSha256;
      if ((journal.phase === "prepared" || journal.phase === "backing-up" || journal.phase === "rolling-back" || journal.phase === "verifying")
        && commandSliceStale) {
        throw new DevFlowError("ROLLBACK_BASIS_STALE", "project verification config changed during the rollback transaction", {
          transactionId: journal.transactionId,
        });
      }
      if (journal.phase === "prepared") {
        journal.phase = "backing-up";
        await writeRollbackTransaction(root, featureId, journal);
      }
      if (journal.phase === "backing-up") {
        await captureBackup(root, featureId, journal, config, options);
        heartbeat.assertOwned();
        journal.phase = "rolling-back";
        journal.nextFileIndex = 0;
        await writeRollbackTransaction(root, featureId, journal);
      }
      if (journal.phase === "rolling-back") {
        await applyFilePlan(root, featureId, journal, options);
        heartbeat.assertOwned();
      }
      if (journal.phase === "verifying") {
        await runRollbackVerification(root, featureId, journal, config, options);
        heartbeat.assertOwned();
        // Two-write ordering: the journal records commit intent BEFORE the state CAS.
        journal.phase = "committed";
        await writeRollbackTransaction(root, featureId, journal);
      }
      if (journal.phase === "committed") {
        return await finishCommitted(root, featureId, journal, options);
      }
      if (journal.phase === "compensating") {
        await compensateRollback(root, featureId, journal, config, options);
      }
      // journal.phase === "compensated": cleanup and the failure report remain.
      return await finishCompensated(root, featureId, journal, new DevFlowError(
        "ROLLBACK_VERIFICATION_FAILED",
        "rollback verification failed (resumed transaction)",
        { transactionId: journal.transactionId },
      ));
    } catch (error) {
      // Injected faults are plain Errors (simulated crashes): propagate untouched.
      if (!(error instanceof DevFlowError)) throw error;
      if (error.code === "ROLLBACK_RECOVERY_BLOCKED") throw error;
      // Drift before or during the file plan may be user work: leave those
      // bytes alone. Verification drift is reported as
      // ROLLBACK_VERIFICATION_FAILED and compensates below.
      if (error.code === "ROLLBACK_HASH_MISMATCH" || error.code === "ROLLBACK_TRANSACTION_BUSY") throw error;
      // Before the first rename nothing was applied; after compensation started
      // (or the commit intent was journaled) the current path owns the outcome.
      if (journal.phase !== "rolling-back" && journal.phase !== "verifying") throw error;
      // The undo was partially applied: restore the pre-rollback workspace from
      // the backup, then surface the original failure (command exit≠0 only).
      await compensateRollback(root, featureId, journal, config, options);
      return await finishCompensated(root, featureId, journal, error);
    }
  } finally {
    await heartbeat.stop();
    await releaseRollbackDriveLease(root, featureId, lease);
  }
}

/** Clears a confirmed gate whose basis no longer matches, so it can be re-presented. */
async function clearStaleRollbackGate(root: string, featureId: string, expectedRevision: number, targetCheckpointId: string): Promise<void> {
  await mutate(root, featureId, expectedRevision, "rollback-gate-stale", async (state) => {
    if (state.rollbackGate?.targetCheckpointId === targetCheckpointId) {
      delete state.rollbackGate;
      clearInteractionsForTarget(state, `rollback:${targetCheckpointId}`);
    }
  });
}

/**
 * Executes a confirmed rollback as a resumable file transaction. An open
 * journal for the same target resumes from its recorded phase; a mismatched
 * target is rejected. Success returns the post-CAS state; verification failure
 * compensates the workspace and throws ROLLBACK_EXECUTION_FAILED; a
 * compensation that cannot verify its restore throws ROLLBACK_RECOVERY_BLOCKED.
 */
export async function executeRollback(
  root: string,
  featureId: string,
  expectedRevision: number,
  targetCheckpointId: string,
  options: ExecuteRollbackOptions = {},
): Promise<ExecuteRollbackResult> {
  const initial = await readState(root, featureId);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  }
  const open = await readRollbackTransaction(root, featureId);
  if (open && !rollbackTransactionFinished(open)) {
    if (open.targetCheckpointId !== targetCheckpointId) {
      throw new DevFlowError("ROLLBACK_TRANSACTION_MISMATCH", "an open rollback transaction targets a different checkpoint", {
        transactionId: open.transactionId,
        openTargetCheckpointId: open.targetCheckpointId,
        targetCheckpointId,
        recoveryHint: "Resume the open transaction with its original target checkpoint",
      });
    }
    return driveRollbackTransaction(root, featureId, open, options);
  }
  // Fresh execution; a finished journal from an earlier transaction is replaced.
  if (!rollbackExecutionAllowed(initial.route, initial.classification.controls)) {
    throw new DevFlowError("ROLLBACK_EXECUTION_NOT_ALLOWED", "当前动态路线没有启用 executable-rollback 与 unit-chain 控制。");
  }
  if (initial.lifecycle !== "active") {
    throw new DevFlowError("INVALID_LIFECYCLE", "rollback execution requires an active feature");
  }
  const gate = initial.rollbackGate;
  if (gate?.status !== "confirmed") {
    throw new DevFlowError("ROLLBACK_GATE_NOT_CONFIRMED", "rollback execution requires a confirmed rollback gate");
  }
  if (gate.targetCheckpointId !== targetCheckpointId) {
    throw new DevFlowError("ROLLBACK_GATE_TARGET_MISMATCH", "rollback target does not match the confirmed gate", {
      confirmedTargetCheckpointId: gate.targetCheckpointId,
      targetCheckpointId,
    });
  }
  let preview: RollbackPreview;
  try {
    preview = await previewRollback(root, featureId, targetCheckpointId);
  } catch (error) {
    if (error instanceof DevFlowError) {
      await clearStaleRollbackGate(root, featureId, expectedRevision, targetCheckpointId);
      throw new DevFlowError("ROLLBACK_GATE_BASIS_CHANGED", "rollback preview failed since the gate was confirmed; the gate has been cleared", {
        originalError: error.code,
        recoveryHint: "Resolve the conflict or update checkpoints, then present the rollback gate again",
      });
    }
    throw error;
  }
  if (preview.previewBasisHash !== gate.previewBasisHash) {
    await clearStaleRollbackGate(root, featureId, expectedRevision, targetCheckpointId);
    throw new DevFlowError("ROLLBACK_GATE_BASIS_CHANGED", "rollback preview basis changed since the gate was confirmed; the gate has been cleared", {
      recoveryHint: "Present the rollback gate again after updating checkpoint state",
    });
  }
  const transactionId = randomUUID();
  const journal: RollbackTransaction = {
    schemaVersion: 1,
    transactionId,
    featureId,
    phase: "prepared",
    targetCheckpointId,
    targetUnitId: preview.targetUnitId,
    undoOrder: [...preview.undoOrder],
    undoCheckpoints: [...preview.undoCheckpoints],
    previewBasisHash: preview.previewBasisHash,
    stateRevision: expectedRevision,
    backupDirectory: `checkpoints/recovery/${transactionId}`,
    nextFileIndex: 0,
    filePlan: preview.filePlan.map((action) => ({ ...action })),
    verificationAttemptIds: [],
    projectConfigSha256: preview.projectConfigSha256,
    ...(preview.verificationCommandHashes ? { verificationCommandHashes: preview.verificationCommandHashes } : {}),
    startedAt: new Date().toISOString(),
  };
  await options.fault?.("before-journal-write");
  // Project lock: scan every open journal + re-check revision + write prepared.
  // Concurrent hosts cannot both pass the open-transaction check and land journals.
  await prepareRollbackTransaction(root, featureId, expectedRevision, journal);
  await options.fault?.("after-journal-write");
  return driveRollbackTransaction(root, featureId, journal, options);
}
