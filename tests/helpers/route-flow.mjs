import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSource } from "./load-source.mjs";
import { registerTraceFixture } from "./trace-fixtures.mjs";
import { promisify } from "node:util";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");
const gates = await loadSource("plugins/dev-flow/src/core/human-gates.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
const projection = await loadSource("plugins/dev-flow/src/core/review-projection.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");
const evidencePolicy = await loadSource("plugins/dev-flow/src/policy/evidence.ts");
const run = promisify(execFile);

export const routeFlowConfig = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

const TRACE_KINDS = new Set(["requirements", "implementation-plan", "coverage-matrix", "rollback-units"]);

function claimCapability(jobId, host = "route-flow") {
  return `claim-${jobId}-${host}-1234567890abcdef`;
}

async function assertNext(root, featureId, expected) {
  const action = await next.nextAction(root, featureId);
  if (typeof expected === "string") {
    assert.equal(action.kind, expected, `expected next kind ${expected}, got ${JSON.stringify(action)}`);
  } else if (typeof expected === "function") {
    expected(action);
  } else {
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(action[key], value, `expected next.${key} to match`);
    }
  }
  return action;
}

async function completeReviewJobs(root, featureId, state, batch, options = {}) {
  const hosts = options.jobHosts ?? {};
  const completions = options.completions ?? {};
  let current = state;
  const observed = [];
  for (const job of batch.jobs) {
    const host = hosts[job.role] ?? hosts["*"] ?? "route-flow";
    const capability = claimCapability(job.jobId, host);
    const pending = await assertNext(root, featureId, (action) => {
      assert.equal(action.kind, "review-jobs-pending");
      assert.equal(action.batchId, batch.batchId);
      assert.ok(action.jobs.some((candidate) => candidate.jobId === job.jobId && candidate.status !== "submitted"));
      for (const pendingJob of action.jobs) {
        assert.equal("findings" in pendingJob, false);
        assert.equal("submission" in pendingJob, false);
      }
    });
    observed.push(pending);
    const claimed = await reviewJobs.claimReviewJob(
      root, featureId, current.revision, batch.batchId, job.jobId, capability,
    );
    current = claimed.state;
    const completion = completions[job.role] ?? {
      coverageSummary: `${job.role} route review complete`,
      findings: [],
    };
    const submitted = await reviewJobs.submitReviewJob(
      root, featureId, current.revision, batch.batchId, job.jobId, capability, completion,
    );
    current = submitted.state;
    if (options.replaySubmit) {
      const replay = await reviewJobs.submitReviewJob(
        root, featureId, current.revision, batch.batchId, job.jobId, capability, completion,
      );
      assert.equal(replay.idempotent, true);
      assert.equal(replay.state.revision, current.revision);
    }
  }
  return { state: current, observedPending: observed };
}

async function satisfyHumanGate(root, featureId, state, step, options = {}) {
  await assertNext(root, featureId, { kind: "present-human-gate", step });
  const current = await gates.presentGate(root, featureId, state.revision, step);
  const reply = step === "requirement_confirmation" ? "确认需求" : "批准实现";
  const eventId = `${step}-prompt-${current.revision}`;
  const host = options.gateHosts?.[step] ?? options.host ?? "claude";
  await store.recordHostEvent(root, {
    eventId,
    type: "user-prompt",
    host,
    text: reply,
  });
  return gates.confirmGate(
    root,
    featureId,
    current.revision,
    step,
    reply,
    { promptEventId: eventId },
    host,
  );
}

async function materializeScaffold(root, featureId, state, kind, requirementsState) {
  let current = state;
  if (!current.artifacts[kind]) {
    current = await artifacts.scaffoldArtifact(root, featureId, current.revision, kind);
  }
  if (TRACE_KINDS.has(kind)) {
    return registerTraceFixture({
      root,
      featureId,
      state: current,
      kind,
      edit: kind === "requirements" && ["missing-or-unclear", "documented-unconfirmed"].includes(requirementsState)
        ? (markdown) => markdown.replace(/^  grill_status: pending$/m, "  grill_status: complete")
        : undefined,
    });
  }
  if (kind === "status" || kind === "plan-review") return current;
  return artifacts.recordArtifact(root, featureId, current.revision, kind);
}

/**
 * Core nextAction is the only scheduler. Each loop reads next, then executes the
 * matching Core/MCP operation. Never injects satisfied steps via store.mutate.
 */
async function driveUntil(root, featureId, state, options = {}) {
  const stopAt = options.stopAt;
  const input = options.input ?? {};
  let current = state;
  const reviewObservations = {
    roles: [],
    assuranceLevel: undefined,
    batchId: undefined,
    basisHash: undefined,
    projectionSha256: undefined,
    reviewPointer: undefined,
    createSeen: false,
    pendingSeen: false,
  };

  for (let guard = 0; guard < 64; guard += 1) {
    const action = await next.nextAction(root, featureId);
    if (stopAt?.(action, current)) return { state: current, review: reviewObservations, action };
    if (action.kind === "done") return { state: current, review: reviewObservations, action };

    if (action.kind === "scaffold-artifact") {
      assert.notEqual(
        action.step === "plan-review" && current.workflowCapabilities?.review === 1,
        true,
        "review:1 plan-review must be Core-generated",
      );
      current = await materializeScaffold(root, featureId, current, action.step, input.requirements);
      continue;
    }

    if (action.kind === "create-review-batch") {
      reviewObservations.createSeen = true;
      const created = await reviewJobs.createReviewBatch(root, featureId, current.revision);
      current = created.state;
      reviewObservations.roles = created.batch.jobs.map((job) => job.role);
      reviewObservations.assuranceLevel = created.batch.assuranceLevel;
      reviewObservations.batchId = created.batch.batchId;
      reviewObservations.basisHash = created.batch.basisHash;
      assert.equal(created.batch.assuranceLevel, "multi-perspective");
      if (options.expectedReviewRoles) {
        assert.deepEqual(reviewObservations.roles, options.expectedReviewRoles);
      }
      const completed = await completeReviewJobs(root, featureId, current, created.batch, {
        jobHosts: options.jobHosts,
        completions: options.reviewCompletions,
        replaySubmit: options.replaySubmit,
      });
      current = completed.state;
      reviewObservations.pendingSeen = completed.observedPending.length > 0;
      current = await store.readState(root, featureId);
      continue;
    }

    if (action.kind === "review-jobs-pending") {
      throw new Error(`review jobs still pending: ${JSON.stringify(action.jobs)}`);
    }
    if (action.kind === "present-human-gate") {
      current = await satisfyHumanGate(root, featureId, current, action.step, options);
      continue;
    }
    if (action.kind === "wait-human-gate") {
      throw new Error(`unexpected wait-human-gate for ${action.step}`);
    }
    if (action.kind === "repair-trace") {
      throw new Error(`unexpected repair-trace: ${action.code}`);
    }

    if (action.kind === "begin-implementation-unit") {
      current = await units.beginImplementationUnit(root, featureId, current.revision, action.unitId);
      if (!options.unitFilesWritten) {
        const files = options.implementationFiles ?? { "src/main.js": "export const m = 1;\n" };
        for (const [file, contents] of Object.entries(files)) {
          await mkdir(path.dirname(path.join(root, file)), { recursive: true });
          await writeFile(path.join(root, file), contents);
        }
        options.unitFilesWritten = true;
      }
      continue;
    }
    if (action.kind === "checkpoint-implementation-unit") {
      current = (await checkpoints.checkpointImplementationUnit(root, featureId, current.revision, action.unitId)).state;
      continue;
    }

    if (action.kind === "run-step") {
      if (action.step === "plan_review" && current.workflowCapabilities?.review === 1) {
        assert.equal(action.requiredEvidence?.fields?.reviewBatch, true);
        const currentProjection = await projection.readReviewProjection(root, current);
        assert.equal(currentProjection.model.assurance.level, "multi-perspective");
        assert.equal(currentProjection.model.batch.visibility, "complete");
        assert.equal(currentProjection.model.batch.batchId, reviewObservations.batchId);
        reviewObservations.projectionSha256 = currentProjection.artifact.sha256;
        reviewObservations.reviewPointer = { ...current.review };
        current = await checks.recordStep(root, featureId, current.revision, "plan_review", {});
        assert.deepEqual(current.steps.plan_review.evidence, {
          batchId: reviewObservations.batchId,
          basisHash: reviewObservations.basisHash,
          assuranceLevel: "multi-perspective",
        });
        continue;
      }
      if (action.step === "verification") {
        current = await verification.runVerification(root, featureId, current.revision, options.host ?? "claude");
        continue;
      }
      const required = evidencePolicy.requiredEvidenceForStep(
        current.route,
        current.classification.riskLabels,
        action.step,
        current.workflowCapabilities,
      );
      if (action.step === "implementation") {
        const files = options.implementationFiles ?? { "src/main.js": "export const m = 1;\n" };
        if (!contract.checkpointsEnforcementRequired(current.route, current.workflowCapabilities)) {
          for (const [file, contents] of Object.entries(files)) {
            await mkdir(path.dirname(path.join(root, file)), { recursive: true });
            await writeFile(path.join(root, file), contents);
          }
        }
        current = await checks.recordStep(root, featureId, current.revision, "implementation", {
          ...required.fields,
          ...(required.checks.length ? { checks: required.checks } : {}),
          files: Object.keys(files),
        });
        continue;
      }
      current = await checks.recordStep(root, featureId, current.revision, action.step, {
        ...required.fields,
        ...(required.checks.length ? { checks: required.checks } : {}),
      });
      continue;
    }

    if (action.kind === "feature-check") {
      current = await checks.featureCheck(root, featureId, current.revision);
      continue;
    }
    if (action.kind === "finalize") {
      current = await checks.finalize(root, featureId, current.revision);
      continue;
    }
    throw new Error(`unsupported next action: ${JSON.stringify(action)}`);
  }
  throw new Error("route driver exceeded progress guard");
}

/**
 * Drive one full route using Core next actions as the only scheduling authority.
 * Review:1 features must walk create → pending → complete → run-step(plan_review).
 */
export async function runRoute(input, expectedRoute, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-route-"));
  try {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "baseline"], { cwd: root });
    if (options.seedFiles) {
      for (const [file, contents] of Object.entries(options.seedFiles)) {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), contents);
      }
    } else {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src", "main.js"), "export {}\n");
    }
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed protected roots"], { cwd: root });
    await store.initProject(root, options.config ?? routeFlowConfig);
    let state = await store.startFeature(root, {
      ...input,
      featureId: options.featureId ?? "feature",
      host: options.host ?? "claude",
    });
    const featureId = state.featureId;
    assert.equal(state.route, expectedRoute);
    const driven = await driveUntil(root, featureId, state, {
      ...options,
      input,
      stopAt: (action) => action.kind === "done",
    });
    state = driven.state;
    assert.equal(state.logicComplete, true);
    assert.equal(state.lifecycle, "finalized");
    if (options.expectSnapshot) assert.ok(state.deliverySnapshot);
    if (state.workflowCapabilities?.review === 1 && (expectedRoute === "standard-m" || expectedRoute === "standard-l")) {
      assert.equal(driven.review.createSeen, true);
      assert.equal(driven.review.pendingSeen, true);
      assert.equal(driven.review.assuranceLevel, "multi-perspective");
    }
    return options.returnObservations
      ? { state, review: driven.review, root, dispose: async () => undefined }
      : state;
  } finally {
    if (!options.keepRoot) await rm(root, { recursive: true, force: true });
  }
}

/**
 * Advance a standard M/L feature to create-review-batch via the real next driver.
 * Does not inject satisfied steps with store.mutate.
 */
export async function prepareReviewReadyFeature(root, input, options = {}) {
  if (options.seedProtectedRoots !== false) {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.js"), options.seedContents ?? "export {}\n");
    try {
      await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
    } catch {
      await run("git", ["init", "--quiet"], { cwd: root });
      await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "baseline"], { cwd: root });
    }
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "seed protected roots"], { cwd: root }).catch(() => undefined);
  }
  await store.initProject(root, options.config ?? routeFlowConfig);
  const state = await store.startFeature(root, {
    featureId: options.featureId ?? "feature",
    host: options.host ?? "claude",
    ...input,
  });
  const driven = await driveUntil(root, state.featureId, state, {
    ...options,
    input,
    stopAt: (action) => action.kind === "create-review-batch" && action.step === "plan_review",
  });
  assert.equal(driven.action.kind, "create-review-batch");
  return driven.state;
}

export async function readCurrentReview(root, state) {
  const ledger = await reviewStore.readReviewLedger(root, state);
  const current = await projection.readReviewProjection(root, state);
  return { ledger, projection: current };
}

export { claimCapability, assertNext, completeReviewJobs };
