import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { deriveRiskRequirements } from "../policy/route.js";
import type { VerificationKind } from "../policy/types.js";
import { DevFlowError } from "./errors.js";
import { fingerprintProtectedRoots } from "./fingerprint.js";
import { assertRequirementsGrillSatisfied } from "./requirements-grill.js";
import { mutate, readProjectConfig, readState, type FeatureState } from "./state-store.js";
import type { VerificationCommand } from "./project-config.js";
import { assertCurrentStep, currentOpenStep } from "./step-order.js";

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

export interface ManualAcceptance {
  mode: "browser" | "user-signoff";
  source: string;
  scenarios: Array<{ name: string; evidence: string }>;
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
  output: string;
  fingerprint: string;
  host: "claude" | "codex";
  manualAcceptance?: ManualAcceptance;
};

function validateManualAcceptance(value: unknown): ManualAcceptance | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DevFlowError("INVALID_MANUAL_ACCEPTANCE", "manualAcceptance must be an object");
  }
  const input = value as Record<string, unknown>;
  if ((input.mode !== "browser" && input.mode !== "user-signoff")
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
  return { mode: input.mode, source: input.source.trim(), scenarios };
}

export async function runVerification(
  root: string,
  id: string,
  expectedRevision: number,
  host: "claude" | "codex",
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

  const fingerprint = await fingerprintProtectedRoots(root, config.protectedRoots);
  const replacingStaleVerification = Boolean(
    initial.verification.verifiedFingerprint
    && initial.verification.verifiedFingerprint !== fingerprint,
  );
  const startedAt = new Date().toISOString();
  let exitCode = 0;
  const output: string[] = [];
  for (const command of selected) {
    try {
      const invocation = verificationInvocation(command);
      const result = await run(invocation.executable, invocation.args, {
        cwd: path.resolve(root, command.cwd),
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      });
      output.push(`[${command.id}] ${result.stdout}${result.stderr}`);
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string; message: string };
      exitCode = typeof failure.code === "number" ? failure.code : 1;
      output.push(`[${command.id}] ${failure.stdout ?? ""}${failure.stderr ?? failure.message}`);
      break;
    }
  }
  const finishedAt = new Date().toISOString();

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
      commandIds: selected.map((item) => item.id),
      kinds,
      startedAt,
      finishedAt,
      exitCode,
      output: output.join("\n").slice(-32_000),
      fingerprint,
      host,
      ...(manualAcceptance ? { manualAcceptance } : {}),
    };
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
  const current = await fingerprintProtectedRoots(root, config.protectedRoots);
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
  const current = await fingerprintProtectedRoots(root, config.protectedRoots);
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
