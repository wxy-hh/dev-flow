import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { DevFlowError } from "./errors.js";
import { fingerprintProtectedRoots } from "./fingerprint.js";
import { readProjectConfig, readState } from "./state-store.js";
import { mutate, type FeatureState } from "./state-store.js";
import { assertCurrentStep } from "./step-order.js";
import { deriveRiskRequirements } from "../policy/route.js";
import { assertRequirementsGrillSatisfied } from "./requirements-grill.js";

const run = promisify(execFile);
type Attempt = { id: number; commandIds: string[]; kinds: string[]; startedAt: string; finishedAt: string; exitCode: number; output: string; fingerprint: string; host: "claude" | "codex" };

export async function runVerification(root: string, id: string, expectedRevision: number, host: "claude" | "codex", commandIds?: string[]): Promise<FeatureState> {
  const initial = await readState(root, id);
  if (initial.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: initial.revision });
  await assertRequirementsGrillSatisfied(root, id, initial);
  const config = await readProjectConfig(root);
  const selected = commandIds?.length
    ? config.verification.commands.filter((command) => commandIds.includes(command.id))
    : config.verification.commands;
  if (!selected.length || (commandIds?.some((command) => !selected.some((item) => item.id === command)))) {
    throw new DevFlowError("UNKNOWN_VERIFICATION_COMMAND", "verification command is not configured");
  }
  const fingerprint = await fingerprintProtectedRoots(root, config.protectedRoots);
  const startedAt = new Date().toISOString(); let exitCode = 0; const output: string[] = [];
  for (const command of selected) {
    try {
      const result = await run(command.command, command.args, { cwd: path.resolve(root, command.cwd), timeout: 120_000, maxBuffer: 1024 * 1024 });
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
    if (state.lifecycle !== "active") throw new DevFlowError("INVALID_LIFECYCLE", "only active features can verify");
    assertCurrentStep(state, "verification");
    await assertRequirementsGrillSatisfied(root, id, state);
    const kinds = state.classification.riskLabels.length ? deriveRiskRequirements(state.classification.riskLabels).verification : ["targeted"];
    const attempt: Attempt = { id: state.verification.attempts.length + 1, commandIds: selected.map((item) => item.id), kinds, startedAt, finishedAt, exitCode, output: output.join("\n").slice(-32_000), fingerprint, host };
    state.verification.attempts.push(attempt);
    delete state.verification.satisfiedByAttemptId; delete state.verification.verifiedFingerprint;
    state.steps.verification = { status: "pending", evidence: { attemptId: attempt.id, exitCode } };
    if (exitCode === 0) {
      state.verification.satisfiedByAttemptId = attempt.id;
      state.verification.verifiedFingerprint = fingerprint;
      state.businessFingerprint = fingerprint;
      state.steps.verification = { status: "satisfied", evidence: { attemptId: attempt.id, commandIds: attempt.commandIds, kinds: attempt.kinds, fingerprint } };
    }
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  });
}

/** Invalidates downstream claims when protected business files changed after a successful verification. */
export async function invalidateStaleVerification(root: string, id: string, expectedRevision: number): Promise<FeatureState | undefined> {
  const config = await readProjectConfig(root); const current = await fingerprintProtectedRoots(root, config.protectedRoots);
  const state = await import("./state-store.js").then(({ readState }) => readState(root, id));
  if (!state.verification.verifiedFingerprint || state.verification.verifiedFingerprint === current) return undefined;
  if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  return mutate(root, id, expectedRevision, "verification-invalidated", (draft) => {
    delete draft.verification.satisfiedByAttemptId; delete draft.verification.verifiedFingerprint;
    draft.steps.verification = { status: "pending", evidence: { reason: "protected-files-changed", current } };
    draft.featureCheck = {}; delete draft.steps.feature_check;
    draft.logicComplete = false; delete draft.steps.finalize;
  });
}
