// v6 review execution envelope tests. Phase 5 enables envelope freezing first;
// execution start/complete todos stay disabled until their ledger integration.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const execution = await loadSource("plugins/dev-flow/src/core/review-execution.ts");
const evidenceStore = await loadSource("plugins/dev-flow/src/core/evidence-store.ts");
const policy = await loadSource("plugins/dev-flow/src/policy/review-execution.ts");
const reviewAdapter = await loadSource("plugins/dev-flow/src/hosts/review-execution-adapter.ts");

test("captureHostReviewEnvelope freezes raw result and a strict v1 envelope that binds identity/job/execution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-envelope-"));
  try {
    await mkdir(path.join(root, ".dev-flow", "features", "f"), { recursive: true });
    const startedAt = "2026-08-17T00:00:00.000Z";
    const completedAt = "2026-08-17T00:05:00.000Z";
    const captured = await execution.captureHostReviewEnvelope(root, {
      featureId: "f",
      batchId: "batch-1",
      jobId: "job-1",
      role: "code-quality",
      packageSha256: "a".repeat(64),
      capabilityHash: "b".repeat(64),
      executionRequestId: "exec-1",
      leaseGeneration: 1,
      declarationId: "decl-1",
      source: "claude-subagent",
      host: "claude",
      hostEventId: "SubagentStop:1",
      parentContext: "implementation-session",
      childContext: "review-subagent-1",
      agentId: "review-subagent-1",
      startedAt,
      completedAt,
      rawResult: "raw review completion",
      parsedCompletion: JSON.stringify({ coverageSummary: "complete", findings: [] }),
    });
    const readBack = await execution.readHostReviewEnvelope(root, "f", captured.ref);
    assert.equal(readBack.executionRequestId, "exec-1");
    assert.equal(readBack.childContext, "review-subagent-1");
    assert.equal(readBack.parentContext, "implementation-session");
    assert.equal(readBack.rawResultSha256.length, 64);
    const raw = await evidenceStore.readEvidenceObject(root, "f", readBack.rawResultRef);
    assert.equal(raw.toString("utf8"), "raw review completion");
    assert.throws(() => policy.parseReviewResultEnvelope({ ...readBack, leaseGeneration: "bad" }), /invalid review result envelope/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("start claims all pending jobs once and complete submits only this execution's envelopes", async () => {
  const { createHash } = await import("node:crypto");
  const { prepareReviewReadyFeature } = await import("../helpers/route-flow.mjs");
  const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-exec-"));
  try {
    let state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["共享契约需求"],
      topologyFacts: ["共享契约"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "exec" });
    const created = await reviewJobs.createReviewBatch(root, state.featureId, state.revision);
    state = created.state;
    const requestId = "exec-request-1234567890abcdef";
    const started = await execution.startReviewExecution(root, state.featureId, state.revision, created.batch.batchId, "claude", requestId);
    assert.equal(started.idempotent, false);
    assert.ok(started.jobs.length > 0);
    for (const job of started.jobs) {
      const marker = `dev-flow:isolated-review:${job.declarationId}`;
      const completion = JSON.stringify({ coverageSummary: `${job.role} complete`, findings: [] });
      const adapterResult = await reviewAdapter.recordSubagentReviewOutput(root, {
        hook_event_name: "SubagentStop",
        session_id: "implementation-session",
        agent_id: `review-agent-${job.jobId}`,
        agent_transcript_path: "/nonexistent/transcript.jsonl",
        last_assistant_message: `${marker}\n${completion}`,
        prompt: marker,
        tool_input: {},
      }, "claude");
      assert.equal(adapterResult.recorded, true);
    }
    const completed = await execution.completeReviewExecution(root, state.featureId, started.state.revision, created.batch.batchId, requestId);
    assert.deepEqual(completed.submittedJobIds.sort(), started.jobs.map((job) => job.jobId).sort());
    assert.equal(completed.batch.progress, "complete");
    assert.ok(completed.batch.jobs.every((job) => job.status === "submitted"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("Codex review execution is explicitly unavailable until server sampling is wired", async () => {
  const { prepareReviewReadyFeature } = await import("../helpers/route-flow.mjs");
  const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-codex-blocked-"));
  try {
    const state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["共享契约需求"],
      topologyFacts: ["共享契约"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "codexblocked" });
    const created = await reviewJobs.createReviewBatch(root, state.featureId, state.revision);
    await assert.rejects(
      execution.startReviewExecution(root, state.featureId, created.state.revision, created.batch.batchId, "codex", "codex-request-1234567890abcdef"),
      (error) => error.code === "REVIEW_EXECUTION_UNAVAILABLE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex server sampling writes envelopes and complete submits the batch", async () => {
  const { prepareReviewReadyFeature } = await import("../helpers/route-flow.mjs");
  const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-codex-sample-"));
  try {
    let state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["共享契约需求"],
      topologyFacts: ["共享契约"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "codexsample" });
    const created = await reviewJobs.createReviewBatch(root, state.featureId, state.revision);
    const requestId = "codex-sample-1234567890abcdef";
    const started = await execution.startReviewExecution(
      root, state.featureId, created.state.revision, created.batch.batchId, "codex", requestId,
      {
        sampleReview: async (job) => ({ coverageSummary: `${job.role} sampled`, findings: [] }),
      },
    );
    assert.ok(started.jobs.length > 0);
    const completed = await execution.completeReviewExecution(root, state.featureId, started.state.revision, created.batch.batchId, requestId);
    assert.equal(completed.batch.progress, "complete");
    assert.ok(completed.batch.jobs.every((job) => job.status === "submitted"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


// ---- Phase 6 execution lifecycle tests ----

test("a stale execution's envelopes can never leak into a newer executionRequestId", async () => {
  const { prepareReviewReadyFeature } = await import("../helpers/route-flow.mjs");
  const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-exec-stale-"));
  try {
    let state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["共享契约需求"],
      topologyFacts: ["共享契约"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "stale" });
    const created = await reviewJobs.createReviewBatch(root, state.featureId, state.revision);
    state = created.state;
    const requestA = "exec-stale-a-1234567890abcdef";
    const startedA = await execution.startReviewExecution(root, state.featureId, state.revision, created.batch.batchId, "claude", requestA);
    assert.ok(startedA.jobs.length > 0);
    // Record ONE envelope under execution A.
    const jobA = startedA.jobs[0];
    const markerA = `dev-flow:isolated-review:${jobA.declarationId}`;
    const completionA = JSON.stringify({ coverageSummary: "stale A complete", findings: [] });
    await reviewAdapter.recordSubagentReviewOutput(root, {
      hook_event_name: "SubagentStop",
      session_id: "implementation-session",
      agent_id: `review-agent-${jobA.jobId}`,
      agent_transcript_path: "/nonexistent/transcript.jsonl",
      last_assistant_message: `${markerA}\n${completionA}`,
      prompt: markerA,
      tool_input: {},
    }, "claude");
    // Start a NEWER execution B on the same batch (same executionRequestId policy).
    const requestB = "exec-stale-b-1234567890abcdef";
    const startedB = await execution.startReviewExecution(root, state.featureId, startedA.state.revision, created.batch.batchId, "claude", requestB);
    assert.ok(startedB.jobs.length > 0);
    // Complete B with no envelopes: nothing may be submitted from execution A.
    const completedB = await execution.completeReviewExecution(root, state.featureId, startedB.state.revision, created.batch.batchId, requestB);
    assert.deepEqual(completedB.submittedJobIds, []);
    // Execution A's envelope still exists under A's record, not B's.
    // Execution A's envelope remains a GC root under A's execution record.
    const rootsA = await execution.reviewExecutionEvidenceRoots(root, state.featureId);
    assert.ok(rootsA.length > 0, "execution A envelopes stay rooted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed/expired job can be rerun in a new execution with same batchId and no reset of submitted siblings", async () => {
  const { prepareReviewReadyFeature } = await import("../helpers/route-flow.mjs");
  const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-exec-rerun-"));
  try {
    let state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["共享契约需求"],
      topologyFacts: ["共享契约"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "rerun" });
    const created = await reviewJobs.createReviewBatch(root, state.featureId, state.revision);
    state = created.state;
    const request1 = "exec-rerun-1-1234567890abcdef";
    const started1 = await execution.startReviewExecution(root, state.featureId, state.revision, created.batch.batchId, "claude", request1);
    const first = started1.jobs[0];
    const marker1 = `dev-flow:isolated-review:${first.declarationId}`;
    const completion1 = JSON.stringify({ coverageSummary: "first job complete", findings: [] });
    await reviewAdapter.recordSubagentReviewOutput(root, {
      hook_event_name: "SubagentStop",
      session_id: "implementation-session",
      agent_id: `review-agent-${first.jobId}`,
      agent_transcript_path: "/nonexistent/transcript.jsonl",
      last_assistant_message: `${marker1}\n${completion1}`,
      prompt: marker1,
      tool_input: {},
    }, "claude");
    const completed1 = await execution.completeReviewExecution(root, state.featureId, started1.state.revision, created.batch.batchId, request1);
    assert.ok(completed1.submittedJobIds.includes(first.jobId), "first job submitted in execution 1");
    // Rerun the remaining jobs in a new execution with the same batchId.
    const request2 = "exec-rerun-2-1234567890abcdef";
    const started2 = await execution.startReviewExecution(root, state.featureId, completed1.state.revision, created.batch.batchId, "claude", request2);
    const remaining = started2.jobs.filter((job) => !completed1.submittedJobIds.includes(job.jobId));
    for (const job of remaining) {
      const marker2 = `dev-flow:isolated-review:${job.declarationId}`;
      const completion2 = JSON.stringify({ coverageSummary: "rerun job complete", findings: [] });
      await reviewAdapter.recordSubagentReviewOutput(root, {
        hook_event_name: "SubagentStop",
        session_id: "implementation-session",
        agent_id: `review-agent-${job.jobId}`,
        agent_transcript_path: "/nonexistent/transcript.jsonl",
        last_assistant_message: `${marker2}\n${completion2}`,
        prompt: marker2,
        tool_input: {},
      }, "claude");
    }
    const completed2 = await execution.completeReviewExecution(root, state.featureId, started2.state.revision, created.batch.batchId, request2);
    assert.ok(completed2.submittedJobIds.length > 0, "remaining jobs submit in execution 2");
    assert.ok(!completed2.submittedJobIds.includes(first.jobId), "already-submitted sibling is not reset");
    assert.equal(completed2.batch.progress, "complete");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing marker/unknown declaration/missing context/same context/invalid completion fail closed with doctor-visible diagnostics", async () => {
  const { prepareReviewReadyFeature } = await import("../helpers/route-flow.mjs");
  const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-exec-failclosed-"));
  try {
    const state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["共享契约需求"],
      topologyFacts: ["共享契约"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "failclosed" });
    const created = await reviewJobs.createReviewBatch(root, state.featureId, state.revision);
    // no marker
    const noMarker = await reviewAdapter.recordSubagentReviewOutput(root, {
      hook_event_name: "SubagentStop",
      session_id: "implementation-session",
      agent_id: "review-agent-x",
      agent_transcript_path: "/nonexistent/transcript.jsonl",
      last_assistant_message: "no declaration here",
      prompt: "plain prompt",
      tool_input: {},
    }, "claude");
    assert.equal(noMarker.recorded, false);
    assert.equal(noMarker.reason, "missing-marker");
    // unknown declaration
    const unknown = await reviewAdapter.recordSubagentReviewOutput(root, {
      hook_event_name: "SubagentStop",
      session_id: "implementation-session",
      agent_id: "review-agent-y",
      agent_transcript_path: "/nonexistent/transcript.jsonl",
      last_assistant_message: "dev-flow:isolated-review:unknown-decl-1234567890",
      prompt: "dev-flow:isolated-review:unknown-decl-1234567890",
      tool_input: {},
    }, "claude");
    assert.equal(unknown.recorded, false);
    assert.equal(unknown.reason, "unknown-declaration");
    // missing context ids (no agent_id / session_id)
    const started = await execution.startReviewExecution(root, state.featureId, created.state.revision, created.batch.batchId, "claude", "exec-failclosed-1234567890abcdef");
    const job = started.jobs[0];
    const marker = `dev-flow:isolated-review:${job.declarationId}`;
    const missingContext = await reviewAdapter.recordSubagentReviewOutput(root, {
      hook_event_name: "SubagentStop",
      session_id: "",
      agent_id: "",
      agent_transcript_path: "/nonexistent/transcript.jsonl",
      last_assistant_message: `${marker}\n${JSON.stringify({ coverageSummary: "x", findings: [] })}`,
      prompt: marker,
      tool_input: {},
    }, "claude");
    assert.equal(missingContext.recorded, false);
    assert.equal(missingContext.reason, "missing-context-ids");
    // same context ids
    const sameContext = await reviewAdapter.recordSubagentReviewOutput(root, {
      hook_event_name: "SubagentStop",
      session_id: "same-context-id",
      agent_id: "same-context-id",
      agent_transcript_path: "/nonexistent/transcript.jsonl",
      last_assistant_message: `${marker}\n${JSON.stringify({ coverageSummary: "x", findings: [] })}`,
      prompt: marker,
      tool_input: {},
    }, "claude");
    assert.equal(sameContext.recorded, false);
    assert.equal(sameContext.reason, "same-context");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan phase and code phase share the execution module but only code phase requires isolation proof", async () => {
  const { prepareReviewReadyFeature } = await import("../helpers/route-flow.mjs");
  const reviewJobs = await loadSource("plugins/dev-flow/src/core/review-jobs.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v6-exec-phase-"));
  try {
    const state = await prepareReviewReadyFeature(root, {
      level: "M",
      topology: "shared-contract",
      requirements: "provided-confirmed",
      scopeFacts: ["共享契约需求"],
      topologyFacts: ["共享契约"],
      uncertaintyFacts: [],
      riskFacts: {},
      decisionRefs: [],
    }, { featureId: "phase" });
    const created = await reviewJobs.createReviewBatch(root, state.featureId, state.revision);
    // prepareReviewReadyFeature stops at planning -> the batch is a PLAN-phase batch.
    assert.equal(created.batch.phase, "plan");
    // Plan phase does not require isolation proof; completion submits envelopes as-is.
    const request = "exec-phase-1234567890abcdef";
    const started = await execution.startReviewExecution(root, state.featureId, created.state.revision, created.batch.batchId, "claude", request);
    for (const job of started.jobs) {
      const marker = `dev-flow:isolated-review:${job.declarationId}`;
      const completion = JSON.stringify({ coverageSummary: "plan review complete", findings: [] });
      await reviewAdapter.recordSubagentReviewOutput(root, {
        hook_event_name: "SubagentStop",
        session_id: "implementation-session",
        agent_id: `review-agent-${job.jobId}`,
        agent_transcript_path: "/nonexistent/transcript.jsonl",
        last_assistant_message: `${marker}\n${completion}`,
        prompt: marker,
        tool_input: {},
      }, "claude");
    }
    const completed = await execution.completeReviewExecution(root, state.featureId, started.state.revision, created.batch.batchId, request);
    assert.ok(completed.submittedJobIds.length > 0);
    // code phase requires isolation proof: without a matching review-execution event,
    // the envelope carries no isolation proof and the gate refuses it.
    assert.equal(reviewJobs.codeReviewIsolationRequired({ ...state, classification: { ...state.classification, controls: { ...state.classification.controls, codeReview: "independent" } } }), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});