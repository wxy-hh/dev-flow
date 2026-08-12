import { createHash, randomUUID } from "node:crypto";
import { DevFlowError } from "./errors.js";
import { matchDecisionReply, pendingDecisionForState, pendingInteractionForDecision } from "./decision-interactions.js";
import { resolveInteractionPromptEvent } from "./interaction-provenance.js";
import { resolveTextInteraction, createInteraction, type UserInteraction } from "./user-interactions.js";
import type { FeatureState } from "./state-store.js";
import { mutate, readActive, readFeatureEvents, readProjectConfig, readState } from "./state-store.js";
import { reconcileWorkspaceForFeature } from "./git-reconciliation.js";
import { reopenObligations } from "../policy/obligations.js";
import { pathWithinFileScope } from "../policy/rollback.js";
import { readTraceability } from "./traceability-store.js";
import { trustedWriteSummary } from "./workspace-store.js";

export function objectiveForSwitch(input: { objective?: string }): string {
  return typeof input.objective === "string" ? input.objective.trim() : "未命名需求";
}

function unknownOwnershipPaths(state: Pick<FeatureState, "workspace">): string[] {
  const candidates = new Set(state.workspace.unownedPaths ?? Object.keys(state.workspace.startedDirty));
  return [...candidates].filter((file) => state.workspace.ownership[file] === undefined).sort();
}

function presentedOwnershipPaths(interaction: UserInteraction): string[] {
  const persisted = interaction.workspaceBatchPaths ?? interaction.workspacePaths;
  if (persisted?.length) return [...new Set(persisted)].sort();
  // Early 5.0 single-path interactions encoded the immutable path in target.
  const legacyPrefix = "workspace-ownership:";
  return interaction.target.startsWith(legacyPrefix) && interaction.target.length > legacyPrefix.length
    ? [interaction.target.slice(legacyPrefix.length)] : [];
}

function workspaceOwnershipQuestion(paths: string[], single: boolean): string {
  if (single) return `路径“${paths[0]}”是否属于当前任务？`;
  return `发现 ${paths.length} 个无法归属的工作区路径：\n${paths.map((file) => `- ${file}`).join("\n")}\n请选择处理方式。`;
}

export function presentWorkspaceOwnership(
  state: FeatureState,
  paths: string[],
  options: { batchPaths?: string[]; remainingPaths?: string[]; single?: boolean; presentationEventId?: string } = {},
): { interaction: UserInteraction; presentationEventId: string } {
  const currentPaths = [...new Set(paths)].sort();
  const batchPaths = [...new Set(options.batchPaths ?? currentPaths)].sort();
  const single = options.single ?? currentPaths.length === 1;
  const presentationEventId = options.presentationEventId ?? randomUUID();
  const basisHash = createHash("sha256").update(JSON.stringify({ kind: "workspace-ownership", paths: batchPaths, fingerprint: state.workspace.lastWorkspaceFingerprint })).digest("hex");
  const interaction = createInteraction(state, {
    kind: "workspace-ownership",
    target: `workspace:${createHash("sha256").update(batchPaths.join("\n")).digest("hex").slice(0, 16)}:${currentPaths[0] ?? "batch"}`,
    basisHash,
    question: workspaceOwnershipQuestion(currentPaths, single),
    options: single ? [
      { id: "adopt", label: "纳入当前任务" },
      { id: "exclude", label: "排除并先处理" },
    ] : [
      { id: "adopt-all", label: "全部纳入当前任务" },
      { id: "exclude-all", label: "全部排除并先处理" },
      { id: "one-by-one", label: "逐个确认" },
    ],
    presentationEventId,
    workspacePaths: currentPaths,
    workspaceBatchPaths: batchPaths,
    ...(options.remainingPaths ? { workspaceRemainingPaths: [...options.remainingPaths] } : {}),
  });
  return { interaction, presentationEventId };
}

export async function resolveWorkspaceOwnershipText(
  root: string,
  id: string,
  expectedRevision: number,
  interactionId: string,
  userReply: string,
  host: "claude" | "codex",
): Promise<{ state: FeatureState; action: string }> {
  const current = await readState(root, id);
  const decision = pendingDecisionForState(current);
  const interaction = current.interactions?.[interactionId] as UserInteraction | undefined;
  if (decision?.kind !== "workspace-ownership" || !interaction || interaction.status !== "pending") {
    throw new DevFlowError("WORKSPACE_OWNERSHIP_NOT_PENDING", "当前没有待确认的工作区归属问题。");
  }
  const prompt = resolveInteractionPromptEvent(await readFeatureEvents(root, id), current, interaction, { host, userReply });
  const presentedPaths = presentedOwnershipPaths(interaction);
  const currentPaths = unknownOwnershipPaths(current);
  if (JSON.stringify(presentedPaths) !== JSON.stringify(currentPaths)) {
    throw new DevFlowError("WORKSPACE_OWNERSHIP_STALE", "待确认路径清单已变化，请重新对账后回答。", {
      userMessage: "工作区路径清单已变化，旧回答不会被套用。",
      cause: "呈现后的未知路径集合与当前未知路径集合不一致。",
      impact: "系统没有批量接纳或排除新的未确认路径。",
      recoveryKind: "refresh",
      recoveryInstruction: "先调用 dev_flow_reconcile_workspace 刷新清单，再回答当前问题。",
      retryOriginal: true,
      paths: presentedPaths,
    });
  }
  const matched = matchDecisionReply(decision, prompt.text);
  let nextPresentationEventId: string | undefined;
  const state = await mutate(root, id, expectedRevision, "workspace-ownership-answered", async (draft) => {
    const draftInteraction = draft.interactions?.[interactionId] as UserInteraction | undefined;
    if (!draftInteraction || draftInteraction.status !== "pending" || pendingDecisionForState(draft)?.basisHash !== decision.basisHash) {
      throw new DevFlowError("WORKSPACE_OWNERSHIP_STALE", "工作区归属问题的依据已变化，请重新对账后回答。");
    }
    const batchPaths = presentedOwnershipPaths(draftInteraction);
    const unknown = unknownOwnershipPaths(draft);
    if (JSON.stringify(batchPaths) !== JSON.stringify(unknown)) {
      throw new DevFlowError("WORKSPACE_OWNERSHIP_STALE", "待确认路径清单已变化，请重新对账后回答。", {
        userMessage: "工作区路径清单已变化，旧回答不会被套用。",
        cause: "呈现后的未知路径集合与当前未知路径集合不一致。",
        impact: "系统没有批量接纳或排除新的未确认路径。",
        recoveryKind: "refresh",
        recoveryInstruction: "先调用 dev_flow_reconcile_workspace 刷新清单，再回答当前问题。",
        retryOriginal: true,
        paths: batchPaths,
      });
    }
    resolveTextInteraction(draft, interactionId, prompt.text, host, { promptEventId: prompt.eventId });
    const currentPaths = draftInteraction.workspacePaths ?? batchPaths;
    if (matched.option.id === "adopt-all" || matched.option.id === "adopt" || matched.option.id === "include") {
      for (const file of matched.option.id === "adopt" || matched.option.id === "include" ? currentPaths : batchPaths) {
        draft.workspace.ownership[file] = "feature";
        draft.workspace.ownershipSource[file] = "user-adopted";
      }
    } else if (matched.option.id === "exclude-all" || matched.option.id === "exclude") {
      for (const file of matched.option.id === "exclude" ? currentPaths : batchPaths) {
        draft.workspace.ownership[file] = "excluded";
      }
    }
    draft.workspace.unownedPaths = (draft.workspace.unownedPaths ?? []).filter((file) => draft.workspace.ownership[file] === undefined);
    if (matched.option.id === "one-by-one") {
      const first = batchPaths[0];
      const next = presentWorkspaceOwnership(draft, [first], { batchPaths, remainingPaths: batchPaths.slice(1), single: true });
      nextPresentationEventId = next.presentationEventId;
    } else if ((matched.option.id === "adopt" || matched.option.id === "include" || matched.option.id === "exclude") && draftInteraction.workspaceRemainingPaths?.length) {
      const remaining = draftInteraction.workspaceRemainingPaths;
      const next = presentWorkspaceOwnership(draft, [remaining[0]], { batchPaths: remaining, remainingPaths: remaining.slice(1), single: true });
      nextPresentationEventId = next.presentationEventId;
    }
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({
    promptEventId: prompt.eventId,
    action: matched.option.id,
    ...(nextPresentationEventId ? { presentationEventId: nextPresentationEventId } : {}),
  }));
  return { state, action: matched.option.id };
}

export { unknownOwnershipPaths };

/** Resolve the active-feature switch question through the same interaction contract. */
export async function resolveTaskSwitchAnswer(
  root: string,
  id: string,
  expectedRevision: number,
  userReply: string,
  host: "claude" | "codex",
): Promise<{ state: FeatureState; action: string }> {
  const current = await readState(root, id);
  const decision = pendingDecisionForState(current);
  const interaction = decision ? pendingInteractionForDecision(current, decision) : undefined;
  if (decision?.kind !== "task-switch" || !interaction || interaction.status !== "pending") {
    throw new DevFlowError("TASK_SWITCH_NOT_PENDING", "当前没有待处理的任务切换问题。", { recoveryHint: "刷新状态后继续当前任务" });
  }
  const prompt = resolveInteractionPromptEvent(await readFeatureEvents(root, id), current, interaction, { host, userReply });
  const match = matchDecisionReply(decision, prompt.text);
  const state = await mutate(root, id, expectedRevision, "task-switch-answered", (draft) => {
    const live = draft.interactions?.[interaction.id] as UserInteraction | undefined;
    if (!live || live.status !== "pending") throw new DevFlowError("INTERACTION_ALREADY_RESOLVED", interaction.id);
    resolveTextInteraction(draft, interaction.id, prompt.text, host, { promptEventId: prompt.eventId });
    if (match.option.id === "pause-old") {
      draft.lifecycle = "paused";
      draft.resumeSummary = "旧任务已暂停；恢复时会自动对账工作区。";
    }
  }, () => ({ targetFeatureId: interaction.target.slice("task-switch:".length), action: match.option.id, promptEventId: prompt.eventId }));
  return { state, action: match.option.id };
}

export async function reconcileWorkspace(
  root: string,
  id: string,
  expectedRevision: number,
  host: "claude" | "codex",
): Promise<FeatureState> {
  const state = await readState(root, id);
  const config = await readProjectConfig(root);
  const { workspace, contentChanged, changedPaths } = await reconcileWorkspaceForFeature(root, state, config);
  const legalCheckpointPaths = contentChanged ? await legalActiveUnitChanges(root, state, changedPaths) : new Set<string>();
  const active = state.lifecycle === "finalized" && contentChanged ? await readActive(root) : undefined;
  const reopenedLifecycle = state.lifecycle === "finalized" && contentChanged ? (!active || active.featureId === id ? "active" : "paused") : undefined;
  const checkpointAffected = contentChanged ? checkpointAffectedByPaths(state, changedPaths, legalCheckpointPaths) : false;
  let presentationEventId: string | undefined;
  return mutate(root, id, expectedRevision, "workspace-reconciled", (draft) => {
    draft.workspace = workspace;
    if (contentChanged) markAffectedEvidenceStale(draft, changedPaths, reopenedLifecycle, legalCheckpointPaths);
    presentationEventId = queueNextOwnershipDecision(draft);
    draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, () => ({
    observedHead: workspace.observedHead,
    commitCount: workspace.observedCommits.length,
    contentChanged,
    checkpointAffected,
    reopenedLifecycle,
    unresolvedOwnership: changedPaths.filter((file) => workspace.ownership[file] === undefined),
    ...(presentationEventId ? { presentationEventId } : {}),
  }));
}

export function queueNextOwnershipDecision(draft: FeatureState): string | undefined {
  if (pendingDecisionForState(draft)) return undefined;
  const paths = unknownOwnershipPaths(draft);
  if (!paths.length) return undefined;
  return presentWorkspaceOwnership(draft, paths).presentationEventId;
}

export function markAffectedEvidenceStale(
  draft: FeatureState,
  changedPaths: string[],
  reopenedLifecycle?: "active" | "paused",
  legalCheckpointPaths: ReadonlySet<string> = new Set(),
): void {
  const checkpointAffected = checkpointAffectedByPaths(draft, changedPaths, legalCheckpointPaths);
  draft.evidenceFreshness = {
    ...draft.evidenceFreshness,
    verification: draft.verification.satisfiedByAttemptId !== undefined ? "stale" : draft.evidenceFreshness.verification,
    checkpoint: checkpointAffected ? "stale" : draft.evidenceFreshness.checkpoint,
    implementation: "current",
  };
  if (checkpointAffected) {
    delete draft.steps.implementation;
    delete draft.steps.code_review;
    delete draft.steps.verification;
    delete draft.steps.finalize;
    draft.currentStage = "implementation";
  } else if (draft.steps.verification?.status === "satisfied" || draft.steps.finalize?.status === "satisfied") {
    delete draft.steps.verification;
    delete draft.steps.finalize;
    draft.currentStage = "verification";
  }
  draft.logicComplete = false;
  if (reopenedLifecycle) {
    draft.lifecycle = reopenedLifecycle;
    delete draft.deliverySnapshot;
    draft.resumeSummary = reopenedLifecycle === "active"
      ? `已撤销过期的完成声明，从“${draft.currentStage ?? "当前阶段"}”继续。`
      : `完成后检测到真实内容漂移；另一个 feature 正在进行，本任务已恢复为暂停状态并回退到“${draft.currentStage ?? "当前阶段"}”。`;
  }
  draft.obligations = reopenObligations(draft.obligations, [
    ...(checkpointAffected ? ["checkpoint" as const] : []),
    "verification",
  ]);
}

export function checkpointAffectedByPaths(state: FeatureState, changedPaths: string[], legalCheckpointPaths: ReadonlySet<string>): boolean {
  const externallyChangedPaths = changedPaths.filter((file) => !legalCheckpointPaths.has(file));
  return state.checkpoints?.some((checkpoint) => checkpoint.files.some((file) => externallyChangedPaths.includes(file))) ?? false;
}

export async function legalActiveUnitChanges(root: string, state: FeatureState, changedPaths: string[]): Promise<Set<string>> {
  const activeUnit = state.implementationUnits?.find((unit) => unit.status === "active" || unit.status === "verified");
  if (!activeUnit || !state.traceability || !state.checkpoints?.length) return new Set();
  const trace = await readTraceability(root, state);
  const node = trace.nodes[activeUnit.unitId];
  if (!node || node.kind !== "rollback" || node.status !== "current") return new Set();
  const events = await readFeatureEvents(root, state.featureId);
  let lastCheckpointEventIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === "automatic-checkpoint-captured") { lastCheckpointEventIndex = index; break; }
  }
  const legal = new Set<string>();
  for (const file of changedPaths) {
    if (!pathWithinFileScope(file, node.fileScope)) continue;
    let event: (typeof events)[number] | undefined;
    for (let index = events.length - 1; index > lastCheckpointEventIndex; index -= 1) {
      const candidate = events[index];
      const after = candidate.type === "trusted-write-owned" ? (candidate.data as { after?: Record<string, unknown> }).after : undefined;
      if (typeof after?.[file] === "string") { event = candidate; break; }
    }
    if (!event) continue;
    const expected = (event.data as { after: Record<string, string> }).after[file];
    if (expected === await trustedWriteSummary(root, file)) legal.add(file);
  }
  return legal;
}
