import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { deriveRiskRequirements } from "../policy/route.js";
import type { VerificationKind } from "../policy/types.js";
import { DevFlowError } from "./errors.js";
import type { HostId } from "./host-id.js";
import { fingerprintProtectedRoots } from "./fingerprint.js";
import { assertRequirementsGrillSatisfied } from "./requirements-grill.js";
import { mutate, readFeatureEvents, readProjectConfig, readState, type FeatureState } from "./state-store.js";
import { resolvePromptEvent } from "./interaction-provenance.js";
import type { VerificationCommand } from "./project-config.js";
import { assertCurrentStep, currentOpenStep } from "./step-order.js";
import { recordRepairAttempt, startRepairLoop, markRepairCompleted } from "./repair-loop.js";
import { satisfyObligations } from "../policy/obligations.js";
import { reviewEnforcementRequired } from "../policy/contract.js";

const run = promisify(execFile);

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

export interface CommandRunResult {
  exitCode: number;
  output: string;
}

/** Shared deterministic runner for one configured verification command. */
export async function runVerificationCommand(root: string, command: VerificationCommand): Promise<CommandRunResult> {
  try {
    const invocation = verificationInvocation(command);
    const result = await run(invocation.executable, invocation.args, {
      cwd: path.resolve(root, command.cwd),
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    return { exitCode: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message: string };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? failure.message}`,
    };
  }
}

export interface ManualAcceptance {
  mode: "browser" | "user-signoff" | "code-path-audit";
  source: string;
  scenarios: Array<{ name: string; evidence: string }>;
  userReply?: string;
}

const userSignoffPhrases = ["验收通过", "确认验收", "同意验收", "approved", "LGTM"] as const;

function normalizeReply(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export interface VerificationFreshness {
  status: "missing" | "fresh" | "stale";
  reasonCode?: "VERIFICATION_STALE";
  recoveryHint?: string;
}

type Attempt = {
  id: number;
  commandIds: string[];
  kinds: VerificationKind[];
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  /** Legacy readers may still find an inline output field. New attempts use the file. */
  output?: string;
  outputTail: string;
  outputPath: string;
  fingerprint: string;
  host: HostId;
  manualAcceptance?: ManualAcceptance;
  phase?: "preflight" | "forward";
};

function validateManualAcceptance(value: unknown): ManualAcceptance | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "manualAcceptance must be an object");
  }
  const input = value as Record<string, unknown>;
  if ((input.mode !== "browser" && input.mode !== "user-signoff" && input.mode !== "code-path-audit")
    || typeof input.source !== "string" || !input.source.trim()
    || !Array.isArray(input.scenarios) || input.scenarios.length === 0
    || "outcome" in input) {
    throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "manualAcceptance is incomplete or invalid");
  }
  const scenarios = input.scenarios.map((scenario) => {
    if (typeof scenario !== "object" || scenario === null || Array.isArray(scenario)) {
      throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "manualAcceptance scenarios must be objects");
    }
    const item = scenario as Record<string, unknown>;
    if (typeof item.name !== "string" || !item.name.trim()
      || typeof item.evidence !== "string" || !item.evidence.trim()) {
      throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "manualAcceptance scenarios require name and evidence");
    }
    return { name: item.name.trim(), evidence: item.evidence.trim() };
  });
  if (input.mode === "user-signoff") {
    const userReply = input.userReply;
    if (typeof userReply !== "string" || !userReply.trim()) {
      throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "user-signoff requires a userReply");
    }
    if (!userSignoffPhrases.some((phrase) => normalizeReply(phrase) === normalizeReply(userReply))) {
      throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "user-signoff reply is not an explicit acceptance phrase", {
        allowed: userSignoffPhrases,
      });
    }
    return {
      mode: input.mode,
      source: input.source.trim(),
      scenarios,
      userReply,
    };
  }
  if (input.userReply !== undefined) {
    throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "only user-signoff may include a userReply");
  }
  return { mode: input.mode, source: input.source.trim(), scenarios };
}

function consumedSignoffEventIds(state: FeatureState): Set<string> {
  const consumed = new Set<string>();
  for (const attempt of state.verification.attempts) {
    const manualAcceptance = (attempt as { manualAcceptance?: { promptEventId?: unknown } }).manualAcceptance;
    if (typeof manualAcceptance?.promptEventId === "string") consumed.add(manualAcceptance.promptEventId);
  }
  for (const gate of Object.values(state.humanGates)) {
    const confirmation = (gate as { confirmation?: { promptEventId?: unknown; turnBoundaryEventId?: unknown } }).confirmation;
    if (typeof confirmation?.promptEventId === "string") consumed.add(confirmation.promptEventId);
    if (typeof confirmation?.turnBoundaryEventId === "string") consumed.add(confirmation.turnBoundaryEventId);
  }
  return consumed;
}

async function assertOptionalManualAcceptance(
  root: string,
  id: string,
  state: FeatureState,
  manualAcceptance: ManualAcceptance | undefined,
  host: HostId,
): Promise<void> {
  if (manualAcceptance?.mode !== "user-signoff") return;

  const events = await readFeatureEvents(root, id);
  resolvePromptEvent(events, {
    host,
    userReply: manualAcceptance.userReply!,
    presentedAt: new Date(0).toISOString(),
    presentedRevision: state.revision - 1,
    consumedEventIds: consumedSignoffEventIds(state),
  });
}

function assertMoneyBehaviorCommands(state: FeatureState, commandIds: string[], behaviorCommands: string[]): void {
  if (!state.classification.riskLabels.includes("money")) return;
  if (!behaviorCommands.length) {
    throw new DevFlowError("MONEY_BEHAVIOR_COMMAND_REQUIRED", "money-risk features require configured behaviorCommands");
  }
  const missing = behaviorCommands.filter((id) => !commandIds.includes(id));
  if (missing.length) {
    throw new DevFlowError("MONEY_BEHAVIOR_COMMAND_REQUIRED", "money-risk features must run every configured behavior command", {
      missing,
    });
  }
}

export async function runVerification(
  root: string,
  id: string,
  expectedRevision: number,
  host: HostId,
  commandIds?: string[],
  manualAcceptanceInput?: ManualAcceptance,
): Promise<FeatureState> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: initial.revision,
    });
  }
  await assertRequirementsGrillSatisfied(root, id, initial);
  const manualAcceptance = validateManualAcceptance(manualAcceptanceInput);
  const config = await readProjectConfig(root);
  const selected = commandIds?.length
    ? config.verification.commands.filter((command) => commandIds.includes(command.id))
    : config.verification.commands;
  if (!selected.length || commandIds?.some((command) => !selected.some((item) => item.id === command))) {
    throw new DevFlowError("UNKNOWN_VERIFICATION_COMMAND", "verification command is not configured");
  }
  await assertOptionalManualAcceptance(root, id, initial, manualAcceptance, host);
  assertMoneyBehaviorCommands(initial, selected.map((command) => command.id), config.verification.behaviorCommands);

  const fingerprint = await fingerprintProtectedRoots(root, config);
  const replacingStaleVerification = Boolean(
    initial.verification.verifiedFingerprint
    && initial.verification.verifiedFingerprint !== fingerprint,
  );
  const startedAt = new Date().toISOString();
  let exitCode = 0;
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
      if (result.exitCode !== 0) {
        exitCode = result.exitCode;
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
    const kinds: VerificationKind[] = state.classification.riskLabels.length
      ? deriveRiskRequirements(state.classification.riskLabels).verification
      : ["targeted"];
    const attempt: Attempt = {
      id: state.verification.attempts.length + 1,
      commandIds: [...preflight, ...selected].map((item) => item.id),
      kinds,
      startedAt,
      finishedAt,
      exitCode,
      outputTail: fullOutput.slice(-4_000),
      outputPath: `verification/${state.verification.attempts.length + 1}.log`,
      fingerprint,
      host,
      phase,
      ...(manualAcceptance ? { manualAcceptance } : {}),
    };
    const outputFile = path.join(root, ".dev-flow", "features", id, attempt.outputPath);
    await mkdir(path.dirname(outputFile), { recursive: true });
    await writeFile(outputFile, fullOutput);
    state.verification.attempts.push(attempt);
    delete state.verification.satisfiedByAttemptId;
    delete state.verification.verifiedFingerprint;
    state.steps.verification = { status: "pending", evidence: { attemptId: attempt.id, exitCode } };
    if (exitCode === 0) {
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
          ...(manualAcceptance ? { manualAcceptance } : {}),
        },
      };
      if (state.repair) state.repair = markRepairCompleted(state.repair);
      state.obligations = satisfyObligations(state.obligations, ["verification"]);
      if (state.classification.riskLabels.length && !reviewEnforcementRequired(state.route, state.workflowCapabilities)) {
        state.obligations = satisfyObligations(state.obligations, ["review"]);
      }
      if (state.classification.riskLabels.includes("irreversible_consequence")) {
        state.obligations = satisfyObligations(state.obligations, ["rollback"]);
      }
      // Keep the persisted cache aligned with the route-derived public stage.
      // The steps remain the source of truth for ordering.
      state.currentStage = "finalize";
    } else {
       const signature = `${exitCode}:${createHash("sha256").update(fullOutput).digest("hex").slice(0, 16)}`;
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
  const current = await fingerprintProtectedRoots(root, config);
  if (state.verification.verifiedFingerprint === current) return { status: "fresh" };
  return {
    status: "stale",
    reasonCode: "VERIFICATION_STALE",
    recoveryHint: "Protected files changed; rerun verification before feature-check or finalize",
  };
}

/** Read-only freshness check used by status/next; callers must not mutate state. */
export async function verificationIsStale(root: string, state: FeatureState): Promise<boolean> {
  return (await readVerificationFreshness(root, state)).status === "stale";
}

/** Invalidates downstream claims when protected business files changed after a successful verification. */
export async function invalidateStaleVerification(
  root: string,
  id: string,
  expectedRevision: number,
): Promise<FeatureState | undefined> {
  const config = await readProjectConfig(root);
  const current = await fingerprintProtectedRoots(root, config);
  const state = await readState(root, id);
  if (!state.verification.verifiedFingerprint || state.verification.verifiedFingerprint === current) return undefined;
  if (state.revision !== expectedRevision) {
    throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", {
      currentRevision: state.revision,
    });
  }
  return mutate(root, id, expectedRevision, "verification-invalidated", (draft) => {
    delete draft.verification.satisfiedByAttemptId;
    delete draft.verification.verifiedFingerprint;
    draft.steps.verification = { status: "pending", evidence: { reason: "protected-files-changed", current } };
    draft.featureCheck = {};
    delete draft.steps.feature_check;
    draft.logicComplete = false;
    delete draft.steps.finalize;
  });
}
