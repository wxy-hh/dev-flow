import { createHash } from "node:crypto";
import { EMPTY_GOVERNANCE_LEDGER, type VerificationKind } from "../policy/types.js";
import { DevFlowError } from "./errors.js";
import { fingerprintFeatureOwned, snapshotGovernedRoots } from "./fingerprint.js";
import { assertRequirementsGrillSatisfied } from "./requirements-grill.js";
import { mutate, readProjectConfig, readState, type FeatureState } from "./state-store.js";
import { verificationCommandHashesForRefs, type ProjectConfig, type VerificationCommand } from "./project-config.js";
import { readTraceability } from "./traceability-store.js";
import type { AcceptanceDispositionState } from "../policy/types.js";
import type { TraceabilityLedger } from "../policy/traceability.js";
import { assertCurrentStep, currentOpenStep } from "./step-order.js";
import { recordRepairAttempt, startRepairLoop, markRepairCompleted } from "./repair-loop.js";
import { satisfyObligations } from "../policy/obligations.js";
import { reviewEnforcementRequired } from "../policy/contract.js";
import { invalidateAffectedClaims, persistThroughSnapshot, workspaceChangedError } from "./change-invalidation.js";
import { runVerificationProcess, writeVerificationOutput } from "./verification-store.js";

type VerificationInvocation = { executable: string; args: string[] };

function quoteForWindowsCommandProcessor(value: string): string {
  if (value.length > 0 && !/[\s"&|<>()^%!]/u.test(value)) return value;
  return `"${value.replace(/(["^&|<>()%!])/gu, "^$1")}"`;
}

/**
 * Windows package-manager commands such as `npm` resolve to .cmd wrappers.
 * execFile cannot launch those wrappers directly, so invoke cmd.exe explicitly
 * while retaining execFile for every other platform.
 */
export function verificationInvocation(
  command: Pick<VerificationCommand, "command" | "args">,
  platform = process.platform,
  commandProcessor = process.env.ComSpec ?? "cmd.exe",
): VerificationInvocation {
  if (platform !== "win32") return { executable: command.command, args: command.args };
  return {
    executable: commandProcessor,
    args: ["/d", "/s", "/c", [command.command, ...command.args].map(quoteForWindowsCommandProcessor).join(" ")],
  };
}

export type CommandExitReason = "success" | "non-zero-exit" | "timeout" | "output-limit" | "spawn-failure";

/** 稳定默认：未配置单命令覆盖时的超时与输出上限。 */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const DEFAULT_COMMAND_MAX_OUTPUT_BYTES = 1024 * 1024;

export interface CommandRunResult {
  exitCode: number;
  output: string;
  /** 结束原因：环境/进程问题（timeout/output-limit/spawn-failure）与测试失败（non-zero-exit）分开报告。 */
  exitReason: CommandExitReason;
}

/** Shared deterministic runner for one configured verification command. */
export async function runVerificationCommand(root: string, command: VerificationCommand): Promise<CommandRunResult> {
  const timeout = command.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxBuffer = command.maxOutputBytes ?? DEFAULT_COMMAND_MAX_OUTPUT_BYTES;
  const invocation = verificationInvocation(command);
  return runVerificationProcess(root, {
    ...invocation,
    cwd: command.cwd,
    timeoutMs: timeout,
    maxOutputBytes: maxBuffer,
  });
}

export interface VerificationFreshness {
  status: "missing" | "fresh" | "stale";
  reasonCode?: "VERIFICATION_STALE";
  recoveryHint?: string;
}

type Attempt = {
  id: number;
  /** Only forward commands count as verification evidence. */
  commandIds: string[];
  /** Environment preparation is audited separately and never provides a guarantee. */
  preflightCommandIds?: string[];
  /** Hashes of every configured command executed by this attempt, scoped to this attempt. */
  verificationCommandHashes?: Record<string, string>;
  kinds: VerificationKind[];
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  /** 结束原因：success/non-zero-exit/timeout/output-limit/spawn-failure。 */
  exitReason: CommandExitReason;
  /** Legacy readers may still find an inline output field. New attempts use the file. */
  output?: string;
  outputTail: string;
  outputPath: string;
  fingerprint: string;
  host: "claude" | "codex";
  phase?: "preflight" | "forward";
};

function successfulAttempt(state: FeatureState): Attempt | undefined {
  const attemptId = state.verification.satisfiedByAttemptId;
  if (attemptId === undefined) return undefined;
  return state.verification.attempts.find((value) => {
    const candidate = value as { id?: unknown };
    return candidate.id === attemptId;
  }) as Attempt | undefined;
}

function verificationCommandSliceStale(
  state: FeatureState,
  config: Pick<ProjectConfig, "verification">,
): boolean {
  const attempt = successfulAttempt(state);
  if (!attempt?.verificationCommandHashes) return false;
  const refs = [...attempt.commandIds, ...(attempt.preflightCommandIds ?? [])];
  const current = verificationCommandHashesForRefs(config, refs);
  return Object.entries(attempt.verificationCommandHashes).some(([id, hash]) => current[id] !== hash);
}

export function minimalGuaranteeCommands(state: FeatureState, config: ProjectConfig): ProjectConfig["verification"]["commands"] {
  const needed = new Set(state.classification.controls.verification);
  const preflight = new Set(config.verification.preflightCommands ?? []);
  const candidates = [...config.verification.commands].filter((command) => !preflight.has(command.id)).sort((left, right) => left.id.localeCompare(right.id));
  const coversAll = (commands: ProjectConfig["verification"]["commands"]): boolean => {
    const provided = new Set(commands.flatMap((command) => command.provides));
    return [...needed].every((kind) => provided.has(kind));
  };
  const choose = (
    size: number,
    start: number,
    selected: ProjectConfig["verification"]["commands"],
  ): ProjectConfig["verification"]["commands"] | undefined => {
    if (selected.length === size) return coversAll(selected) ? [...selected] : undefined;
    for (let index = start; index <= candidates.length - (size - selected.length); index += 1) {
      selected.push(candidates[index]);
      const match = choose(size, index + 1, selected);
      selected.pop();
      if (match) return match;
    }
    return undefined;
  };
  for (let size = 1; size <= candidates.length; size += 1) {
    const selected = choose(size, 0, []);
    if (selected) return selected;
  }
  const configured = new Set(candidates.flatMap((command) => command.provides));
  throw new DevFlowError("VERIFICATION_GUARANTEE_UNCONFIGURED", "项目没有配置满足当前保证集的验证命令。", {
    missingGuarantees: [...needed].filter((kind) => !configured.has(kind)),
    recoveryHint: "在 project schema v2 中为验证命令声明 provides，然后重试",
  });
}

function dispositionKindForCriterion(ledger: TraceabilityLedger, criterionId: string): AcceptanceDispositionState["dispositionKind"] {
  const node = ledger.nodes[criterionId];
  if (node?.kind === "acceptance-criterion" && node.verificationDisposition) return node.verificationDisposition.kind;
  return "behavior-test";
}

function syncAcceptanceDispositions(
  state: FeatureState,
  ledger: TraceabilityLedger,
  fingerprint: string,
  provided: Set<string>,
  commandSucceeded: boolean,
): { complete: boolean; pending: string[] } {
  const currentCriteria = Object.values(ledger.nodes).filter((node) => node.status === "current" && node.kind === "acceptance-criterion");
  state.acceptance ??= { evidence: [], dispositions: [] };
  const pending: string[] = [];
  for (const criterion of currentCriteria) {
    const kind = dispositionKindForCriterion(ledger, criterion.id);
    const existing = state.acceptance.dispositions.find((item) => item.acceptanceCriterionId === criterion.id);
    let status: AcceptanceDispositionState["status"] = "pending";
    let evidenceRefs = existing?.evidenceRefs ?? [];
    if (kind === "human-acceptance") {
      status = existing?.basis.sha256 === fingerprint && existing.status === "satisfied" ? "satisfied" : existing?.basis.sha256 === fingerprint ? existing.status : "stale";
      evidenceRefs = [
        ...state.acceptance.evidence.filter((record) => record.acceptanceCriterionId === criterion.id && record.basis.sha256 === fingerprint && record.evidenceKind !== "agent-self-check").map((record) => record.recordId),
        ...(existing?.evidenceRefs.filter((ref) => ref.startsWith("CRED-ACCEPTANCE-")) ?? []),
      ];
      if (existing?.evidenceRefs.some((ref) => ref.startsWith("CRED-ACCEPTANCE-")) && existing.basis.sha256 === fingerprint && existing.status === "satisfied") status = "satisfied";
    } else if (kind === "file-check") {
      status = state.acceptance.evidence.some((record) => record.acceptanceCriterionId === criterion.id && record.evidenceKind === "file-inspection" && record.basis.sha256 === fingerprint) ? "satisfied" : "pending";
    } else {
      const commandKind = kind === "behavior-test" ? "behavior" : kind === "type-check" ? "type" : "rule";
      status = commandSucceeded && provided.has(commandKind) ? "satisfied" : "pending";
    }
    const next: AcceptanceDispositionState = { acceptanceCriterionId: criterion.id as `AC-${string}`, dispositionKind: kind, status, evidenceRefs: [...new Set(evidenceRefs)], basis: { kind: "content", sha256: fingerprint } };
    if (existing) Object.assign(existing, next); else state.acceptance.dispositions.push(next);
    if (status !== "satisfied") pending.push(criterion.id);
  }
  return { complete: pending.length === 0, pending };
}

export async function runVerification(
  root: string,
  id: string,
  expectedRevision: number,
  host: "claude" | "codex",
  commandIds?: string[],
): Promise<FeatureState> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision,
    });
  }
  const invalidated = await invalidateAffectedClaims(root, id, expectedRevision);
  if (invalidated) throw workspaceChangedError(invalidated);
  await assertRequirementsGrillSatisfied(root, id, initial);
  const config = await readProjectConfig(root);
  // preflight 的定位是环境准备：每次验证自动执行且绝不提供保证证据。调用方
  // 显式把 preflight 命令选为验证命令属于调用错误，直接拒绝而不是静默排除，
  // 避免其 provides 被误当作验证保证证据。
  const preflightIds = new Set(config.verification.preflightCommands ?? []);
  if (commandIds?.some((commandId) => preflightIds.has(commandId))) {
    throw new DevFlowError("PREFLIGHT_COMMAND_NOT_SELECTABLE", "preflight 命令是环境准备，不能作为验证命令显式选择。", {
      commandIds: commandIds.filter((commandId) => preflightIds.has(commandId)),
      recoveryHint: "从 commandIds 中移除 preflight 命令；环境准备会在每次验证时自动执行，只有普通验证命令能提供保证证据。",
    });
  }
  const selected = commandIds?.length
    ? config.verification.commands.filter((command) => commandIds.includes(command.id))
    : minimalGuaranteeCommands(initial, config);
  if (!selected.length || commandIds?.some((command) => !selected.some((item) => item.id === command))) {
    throw new DevFlowError("UNKNOWN_VERIFICATION_COMMAND", "verification command is not configured");
  }
  const provided = new Set(selected.flatMap((command) => command.provides));
  const missingGuarantees = initial.classification.controls.verification.filter((kind) => !provided.has(kind));
  if (missingGuarantees.length) throw new DevFlowError("VERIFICATION_GUARANTEE_UNCOVERED", "选择的命令不能覆盖当前最终保证集。", { missingGuarantees });

  const fingerprint = await fingerprintFeatureOwned(root, config, initial.workspace.ownership);
  const trace = initial.traceability ? await readTraceability(root, initial) : undefined;
  const replacingStaleVerification = Boolean(
    initial.verification.verifiedFingerprint
    && initial.verification.verifiedFingerprint !== fingerprint,
  ) || verificationCommandSliceStale(initial, config);
  const startedAt = new Date().toISOString();
  let exitCode = 0;
  let exitReason: CommandExitReason = "success";
  let phase: Attempt["phase"] = "forward";
  const output: string[] = [];
  const preflight = (config.verification.preflightCommands ?? []).map((commandId) => {
    const command = config.verification.commands.find((candidate) => candidate.id === commandId);
    if (!command) throw new DevFlowError("INVALID_PROJECT_CONFIG", "preflight command is not configured", { commandId });
    return command;
  });
  for (const group of [
    { phase: "preflight" as const, commands: preflight },
    { phase: "forward" as const, commands: selected },
  ]) {
    if (exitCode !== 0) break;
    for (const command of group.commands) {
      const result = await runVerificationCommand(root, command);
      output.push(`[${command.id}] ${result.output}`);
      if (result.exitReason !== "success") {
        exitCode = result.exitCode;
        exitReason = result.exitReason;
        phase = group.phase;
        break;
      }
    }
  }
  const finishedAt = new Date().toISOString();
  const fullOutput = output.join("\n");

  return mutate(root, id, expectedRevision, "verification-recorded", async (state) => {
    if (state.lifecycle !== "active") {
      throw new DevFlowError("INVALID_LIFECYCLE", "only active features can verify");
    }
    if (currentOpenStep(state) !== "verification"
      && !(replacingStaleVerification && state.steps.verification?.status === "satisfied")) {
      assertCurrentStep(state, "verification");
    }
    await assertRequirementsGrillSatisfied(root, id, state);
    const kinds: VerificationKind[] = [...state.classification.controls.verification];
    const attempt: Attempt = {
      id: state.verification.attempts.length + 1,
      commandIds: selected.map((item) => item.id),
      ...(preflight.length ? { preflightCommandIds: preflight.map((item) => item.id) } : {}),
      verificationCommandHashes: verificationCommandHashesForRefs(config, [
        ...selected.map((item) => item.id),
        ...preflight.map((item) => item.id),
      ]),
      kinds,
      startedAt,
      finishedAt,
      exitCode,
      exitReason,
      outputTail: fullOutput.slice(-4_000),
      outputPath: `verification/${state.verification.attempts.length + 1}.log`,
      fingerprint,
      host,
      phase,
    };
    await writeVerificationOutput(root, id, attempt.outputPath, fullOutput);
    state.verification.attempts.push(attempt);
    delete state.verification.satisfiedByAttemptId;
    delete state.verification.verifiedFingerprint;
    state.steps.verification = { status: "pending", evidence: { attemptId: attempt.id, exitCode, exitReason } };
    const acceptance = trace
      ? syncAcceptanceDispositions(state, trace, fingerprint, new Set(selected.flatMap((command) => command.provides)), exitCode === 0)
      : { complete: true, pending: [] as string[] };
    if (exitCode === 0 && acceptance.complete) {
      // 通过时刻的逐文件快照：后续交付内容变化时失效传播据此定位受影响
      // 实现单元并重开审查/验证（issue 21）。
      const snapshot = await snapshotGovernedRoots(root, config);
      const snapshotPath = await persistThroughSnapshot(root, id, snapshot, fingerprint, "verification");
      // 治理账本：验证通过形成 verification-current 声明（spec §202）。
      const gov = state.governance ?? EMPTY_GOVERNANCE_LEDGER;
      const claimId = `CLAIM-${createHash("sha256").update(`verification-current|${fingerprint}`).digest("hex").slice(0, 16)}`;
      const claims = [...gov.claims];
      if (!claims.some((claim) => claim.recordId === claimId)) {
        claims.push({
          recordId: claimId,
          kind: "claim",
          claimType: "verification-current",
          subject: id,
          basis: { kind: "content", sha256: fingerprint },
          recordedAt: finishedAt,
        });
      }
      state.governance = { ...gov, claims };
      state.verification.satisfiedByAttemptId = attempt.id;
      state.verification.verifiedFingerprint = fingerprint;
      state.businessFingerprint = fingerprint;
      state.steps.verification = {
        status: "satisfied",
        evidence: {
          attemptId: attempt.id,
          commandIds: attempt.commandIds,
          kinds: attempt.kinds,
          fingerprint,
          snapshotPath,
          acceptance: state.acceptance?.dispositions.map((disposition) => ({ ...disposition })),
        },
      };
      if (state.repair) state.repair = markRepairCompleted(state.repair);
      state.obligations = satisfyObligations(state.obligations, ["verification"]);
      if (state.classification.riskLabels.length && !reviewEnforcementRequired(state.route, state.classification.controls)) {
        state.obligations = satisfyObligations(state.obligations, ["review"]);
      }
      if (state.classification.riskLabels.includes("irreversible_consequence")) {
        state.obligations = satisfyObligations(state.obligations, ["rollback"]);
      }
      // Keep the persisted cache aligned with the route-derived public stage.
      // The steps remain the source of truth for ordering.
      state.currentStage = "finalize";
    } else if (exitCode === 0) {
      // 自动命令成功不代表人工验收已经完成；保留尝试记录但不写
      // verification-current claim，也不满足 verification 步骤。
      state.steps.verification = {
        status: "pending",
        evidence: {
          attemptId: attempt.id,
          commandIds: attempt.commandIds,
          kinds: attempt.kinds,
          fingerprint,
          pendingAcceptanceCriteria: acceptance.pending,
          message: "自动检查通过，人工验收待完成",
        },
      };
      state.evidenceFreshness.verification = "missing";
    } else {
      // 结束原因进入修复签名：环境/进程问题（timeout/output-limit/spawn-failure）
      // 与代码缺陷（non-zero-exit）不会相互归并，模型不会针对不存在的缺陷反复修复。
      const signature = `${exitReason}:${createHash("sha256").update(fullOutput).digest("hex").slice(0, 16)}`;
      state.repair = recordRepairAttempt(state.repair ?? startRepairLoop(), signature, output.slice(-3));
    }
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  });
}

export async function readVerificationFreshness(
  root: string,
  state: FeatureState,
): Promise<VerificationFreshness> {
  if (!state.verification.verifiedFingerprint) return { status: "missing" };
  const config = await readProjectConfig(root);
  const current = await fingerprintFeatureOwned(root, config, state.workspace.ownership);
  if (state.verification.verifiedFingerprint === current && !verificationCommandSliceStale(state, config)) return { status: "fresh" };
  return {
    status: "stale",
    reasonCode: "VERIFICATION_STALE",
    recoveryHint: "governed 文件已变化；完成 finalize 前请重新运行验证",
  };
}

/** Read-only freshness check used by status/next; callers must not mutate state. */
export async function verificationIsStale(root: string, state: FeatureState): Promise<boolean> {
  return (await readVerificationFreshness(root, state)).status === "stale";
}
