import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";
import { appendSecondTraceClosure, registerTraceFixture, twoClosureTraceDeltaFor } from "../helpers/trace-fixtures.mjs";
import { buildTestBundles } from "../helpers/test-bundle.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const units = await loadSource("plugins/dev-flow/src/core/implementation-units.ts");
const checkpoints = await loadSource("plugins/dev-flow/src/core/checkpoints.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
const distBefore = await Promise.all(["mcp-server.mjs", "claude-hook.mjs", "codex-hook.mjs"].map((name) => readFile(path.resolve("plugins/dev-flow/dist", name))));
const bundles = await buildTestBundles();
after(() => bundles.dispose());
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

function request(messages, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundles.pathFor("mcp-server")], { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DEV_FLOW_DISABLE_ATTENTION: "1" } });
    let stdout = "", stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(stdout.trim().split("\n").filter(Boolean).map(JSON.parse)) : reject(new Error(stderr)));
    child.stdin.end(messages.map((message) => JSON.stringify(message)).join("\n") + "\n");
  });
}

function requestWithElicitation(message, cwd, elicitationResult, captureRequests = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundles.pathFor("mcp-server")], { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DEV_FLOW_DISABLE_ATTENTION: "1" } });
    let stdout = "", stderr = "", settled = false;
    const requests = [];
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(captureRequests ? { response: value, requests } : value);
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const response = JSON.parse(line);
        if (response.method === "elicitation/create") {
          requests.push(response);
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: response.id, result: elicitationResult })}\n`);
        } else if (response.id === 2) {
          child.stdin.end();
          finish(response);
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!settled) reject(new Error(stderr || `MCP elicitation stream ended before tools/call response (exit ${code ?? "unknown"})`));
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: { form: {} } } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: message })}\n`);
  });
}

function requestWithSampling(message, cwd, samplingResult) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundles.pathFor("mcp-server")], { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DEV_FLOW_DISABLE_ATTENTION: "1" } });
    let stdout = "", stderr = "", settled = false;
    const requests = [];
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const response = JSON.parse(line);
        if (response.method === "sampling/createMessage") {
          requests.push(response);
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: response.id, result: samplingResult })}\n`);
        } else if (response.id === 2) {
          child.stdin.end();
          finish({ response, requests });
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!settled && code === 0) finish(undefined);
      else if (!settled) reject(new Error(stderr));
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { sampling: {} } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: message })}\n`);
  });
}

test("MCP server initializes, advertises the complete public interface, and maps errors", async () => {
  const responses = await request([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "not_a_tool", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "dev_flow_classify", arguments: { level: "L", topology: "multi-chain", execution: "light", riskLabels: ["security", "critical_correctness"] } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "dev_flow_enable_windows_notifications", arguments: {} } },
  ]);
  // initialize / tools/list must be bare protocol results (not tools/call content wrappers)
  assert.equal(responses[0].result.serverInfo.name, "dev-flow");
  assert.equal(responses[0].result.capabilities.tools !== undefined, true);
  assert.equal(responses[0].result.content, undefined);
  assert.ok(Array.isArray(responses[1].result.tools));
  assert.equal(responses[1].result.content, undefined);
  const names = responses[1].result.tools.map((tool) => tool.name);
  for (const name of ["dev_flow_init_project", "dev_flow_classify", "dev_flow_start", "dev_flow_next", "dev_flow_verify", "dev_flow_confirm_gate", "dev_flow_respond_interaction", "dev_flow_request_grill_decision", "dev_flow_resolve_grill_decision", "dev_flow_enable_windows_notifications", "dev_flow_finalize", "dev_flow_recover_corrupt_feature", "dev_flow_status", "dev_flow_record_artifact_with_trace", "dev_flow_get_traceability", "dev_flow_create_review_batch", "dev_flow_get_review_job", "dev_flow_claim_review_job", "dev_flow_submit_review_job", "dev_flow_sample_review_job", "dev_flow_present_review_risk_acceptance", "dev_flow_resolve_review_risk_acceptance"]) {
    assert.ok(names.includes(name), `missing tool ${name}`);
  }
  const contract = JSON.parse(await readFile(path.resolve("plugins/dev-flow/policy/contract.json"), "utf8"));
  const allowedRiskLabels = Object.keys(contract.riskEnhancements);
  for (const toolName of ["dev_flow_classify", "dev_flow_start"]) {
    const properties = responses[1].result.tools.find((tool) => tool.name === toolName).inputSchema.properties;
    assert.deepEqual(properties.riskLabels.items.enum, allowedRiskLabels);
    assert.equal(properties.riskLabels.uniqueItems, true);
    assert.equal(properties.acceptanceAssistSuggested.type, "boolean");
    assert.equal(properties.manualAcceptanceRequired.type, "boolean");
  }
  const verifySchema = responses[1].result.tools.find((tool) => tool.name === "dev_flow_verify").inputSchema;
  assert.equal(verifySchema.properties.manualAcceptance.properties.scenarios.minItems, 1);
  assert.deepEqual(verifySchema.properties.manualAcceptance.properties.mode.enum, ["browser", "user-signoff", "code-path-audit"]);
  assert.equal(verifySchema.properties.manualAcceptance.properties.promptEventId.type, "string");
  assert.equal(verifySchema.properties.manualAcceptance.additionalProperties, false);
  const scaffoldTool = responses[1].result.tools.find((tool) => tool.name === "dev_flow_scaffold_artifact");
  assert.match(scaffoldTool.description, /Generated status artifacts are read-only/);
  const traceRecord = responses[1].result.tools.find((tool) => tool.name === "dev_flow_record_artifact_with_trace");
  assert.deepEqual(traceRecord.inputSchema.properties.kind.enum, ["requirements", "implementation-plan", "coverage-matrix", "rollback-units"]);
  assert.equal(traceRecord.inputSchema.additionalProperties, false);
  const traceNodes = traceRecord.inputSchema.properties.traceDelta.properties.nodes.items.oneOf;
  assert.equal(traceNodes.length, 5);
  for (const node of traceNodes) {
    assert.equal(node.additionalProperties, false);
    for (const forbidden of ["edges", "status", "sourceSha256", "sourceAnchor", "sourceBlockSha256", "verificationConfigSha256"]) {
      assert.equal(forbidden in node.properties, false);
    }
  }
  const traceGet = responses[1].result.tools.find((tool) => tool.name === "dev_flow_get_traceability");
  assert.deepEqual(traceGet.inputSchema.required, ["featureId"]);
  assert.equal(traceGet.annotations.readOnlyHint, true);
  const reviewGet = responses[1].result.tools.find((tool) => tool.name === "dev_flow_get_review_job");
  assert.deepEqual(reviewGet.inputSchema.required, ["featureId", "batchId", "jobId", "capability"]);
  assert.equal(reviewGet.annotations.readOnlyHint, true);
  const reviewSubmit = responses[1].result.tools.find((tool) => tool.name === "dev_flow_submit_review_job");
  assert.equal("basisHash" in reviewSubmit.inputSchema.properties, false);
  assert.equal("assuranceLevel" in reviewSubmit.inputSchema.properties, false);
  assert.equal("roles" in reviewSubmit.inputSchema.properties, false);
  const reviewFinding = reviewSubmit.inputSchema.properties.completion.properties.findings.items;
  assert.deepEqual(reviewFinding.required, ["severity", "category", "targets", "evidence", "claim", "recommendation"]);
  assert.equal(reviewFinding.additionalProperties, false);
  assert.equal("basisHash" in reviewFinding.properties, false);
  assert.equal(reviewSubmit.inputSchema.properties.completion.properties.resolutions.items.additionalProperties, false);
  const reviewSampling = responses[1].result.tools.find((tool) => tool.name === "dev_flow_sample_review_job");
  assert.deepEqual(reviewSampling.inputSchema.required, ["featureId", "expectedRevision", "batchId", "jobId"]);
  for (const forbidden of ["capability", "claimRequestId", "completion", "basisHash", "assuranceLevel", "roles"]) {
    assert.equal(forbidden in reviewSampling.inputSchema.properties, false);
  }

  // tools/call keeps CallToolResult content shape
  assert.equal(responses[2].error.data.code, "UNKNOWN_TOOL");
  assert.equal(responses[3].result.structuredContent.route, "light-l");
  assert.deepEqual(responses[3].result.structuredContent.riskRequirements, {
    checks: ["full-code-review", "security"],
    verification: ["behavior", "full"],
  });
  assert.deepEqual(responses[4].result.structuredContent, { status: "unsupported", platform: process.platform });
});

test("MCP Trace tools reject Core-owned fields, preserve CAS errors, and keep get read-only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-trace-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const registration = {
      featureId: "f",
      expectedRevision: state.revision,
      kind: "requirements",
      traceDelta: {
        nodes: [
          { kind: "requirement", id: "REQ-001" },
          { kind: "acceptance-criterion", id: "AC-001", parentRequirement: "REQ-001" },
        ],
      },
    };
    const responses = await request([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dev_flow_record_artifact_with_trace", arguments: { ...registration, traceDelta: { nodes: [{ kind: "requirement", id: "REQ-001", status: "current" }] } } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dev_flow_record_artifact_with_trace", arguments: { ...registration, traceDelta: { nodes: [], edges: [] } } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dev_flow_record_artifact_with_trace", arguments: registration } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "dev_flow_record_artifact_with_trace", arguments: registration } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "dev_flow_get_traceability", arguments: { featureId: "f" } } },
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "dev_flow_record_artifact_with_trace", arguments: {
        featureId: "f", expectedRevision: state.revision, kind: "implementation-plan", traceDelta: { nodes: [
          { kind: "task", id: "TASK-001", covers: ["REQ-001"], rollbackUnit: "RU-001" },
          { kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["../x"], covers: ["REQ-001"], forwardVerification: ["unit"], rollbackVerification: ["unit"] },
        ] },
      } } },
    ], root);
    assert.equal(responses[0].error.data.code, "TRACE_GRAPH_INVALID");
    assert.equal(responses[1].error.data.code, "TRACE_GRAPH_INVALID");
    const winner = responses[2].result.structuredContent;
    assert.ok(winner.traceability);
    assert.equal(responses[3].error.data.code, "STATE_REVISION_CONFLICT");
    const trace = responses[4].result.structuredContent;
    assert.deepEqual(trace.pointer, winner.traceability);
    assert.equal(trace.ledger.featureId, "f");
    assert.deepEqual(trace.effectiveSummary, winner.traceability.summary);
    assert.deepEqual(trace.blockers, []);
    assert.equal((await store.readState(root, "f")).revision, winner.revision);
    // Pre-CAS input validation rejects unsafe fileScope without needing a current plan artifact.
    assert.equal(responses[5].error.data.code, "TRACE_GRAPH_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP rejects unsafe fileScope patterns without mutating revision, pointer, or snapshot set", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-file-scope-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await store.mutate(root, "f", state.revision, "ready-for-plan", (draft) => {
      draft.steps.requirements = { status: "satisfied" };
      draft.steps.requirement_confirmation = { status: "satisfied" };
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "implementation-plan");

    const before = await store.readState(root, "f");
    const snapDir = path.join(root, ".dev-flow", "features", "f", "traceability", "snapshots");
    const snapshotsBefore = new Set(await readdir(snapDir));
    const artifactBefore = before.artifacts["implementation-plan"];
    const planPath = path.join(root, ".dev-flow", "features", "f", artifactBefore.path);
    const planBytesBefore = await readFile(planPath);

    const legalNodes = [
      { kind: "task", id: "TASK-001", covers: ["REQ-001", "AC-001"], rollbackUnit: "RU-001" },
      {
        kind: "rollback", id: "RU-001", tasks: ["TASK-001"], dependsOn: [], fileScope: ["src"], covers: ["REQ-001", "AC-001"],
        forwardVerification: ["unit"], rollbackVerification: ["unit"],
      },
    ];
    const unsafeScopes = [["../x"], ["/abs"], ["C:/abs"], ["src\\x"], ["src/../../x"], ["src", "../x"]];
    for (const [index, fileScope] of unsafeScopes.entries()) {
      const nodes = structuredClone(legalNodes);
      nodes.find((node) => node.kind === "rollback").fileScope = fileScope;
      const [response] = await request([{
        jsonrpc: "2.0",
        id: index + 1,
        method: "tools/call",
        params: {
          name: "dev_flow_record_artifact_with_trace",
          arguments: {
            featureId: "f",
            expectedRevision: before.revision,
            kind: "implementation-plan",
            traceDelta: { nodes },
          },
        },
      }], root);
      assert.equal(response.error?.data?.code, "TRACE_GRAPH_INVALID", JSON.stringify(fileScope));
    }

    const after = await store.readState(root, "f");
    assert.deepEqual(after, before);
    assert.deepEqual(after.traceability, before.traceability);
    assert.equal(after.artifacts["implementation-plan"].sha256, artifactBefore.sha256);
    assert.deepEqual(await readFile(planPath), planBytesBefore);
    assert.deepEqual(new Set(await readdir(snapDir)), snapshotsBefore);
    // Referenced snapshot file set is unchanged; orphans are not required to appear.
    assert.ok(snapshotsBefore.has(`${before.traceability.sha256}.json`));
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function reviewReadyMcpFeature(root) {
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
  await store.initProject(root, config);
  let state = await store.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed", riskLabels: ["security"],
  });
  const pointer = await reviewStore.writeReviewSnapshot(root, reviewStore.emptyReviewLedger("f", state.revision + 1));
  state = await store.mutate(root, "f", state.revision, "review-mcp-pointer", (draft) => {
    draft.workflowCapabilities = { trace: 1, review: 1, checkpoints: 0, rollbackExecution: 0 };
    draft.review = pointer;
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await store.mutate(root, "f", state.revision, "review-mcp-requirements", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
  state = await store.mutate(root, "f", state.revision, "review-mcp-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  return registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
}

test("MCP review tools enforce Core-owned inputs, isolate capabilities, and preserve retry semantics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-review-"));
  try {
    const initial = await reviewReadyMcpFeature(root);
    const create = { name: "dev_flow_create_review_batch", arguments: { featureId: "f", expectedRevision: initial.revision } };
    let responses = await request([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { ...create, arguments: { ...create.arguments, basisHash: "forged", assuranceLevel: "multi-agent-verified", roles: ["security"], depth: "full", scope: { inScope: ["src"], outOfScope: [] }, protectedRoots: ["src"] } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: create },
    ], root);
    assert.equal(responses[0].error.data.code, "INVALID_TOOL_INPUT");
    const created = responses[1].result.structuredContent;
    assert.equal(created.created, true);
    assert.equal(created.batch.executionMode, "isolated-sequential");
    assert.equal(created.batch.assuranceLevel, "multi-perspective");
    const firstJob = created.batch.jobs[0];
    const secondJob = created.batch.jobs[1];
    const claimRequestId = "claim-1234567890-mcp-isolated-capability-abcdef";
    responses = await request([
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dev_flow_claim_review_job", arguments: { featureId: "f", expectedRevision: created.state.revision, batchId: created.batch.batchId, jobId: firstJob.jobId, claimRequestId, executorId: "forged", contextId: "forged" } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "dev_flow_claim_review_job", arguments: { featureId: "f", expectedRevision: created.state.revision, batchId: created.batch.batchId, jobId: firstJob.jobId, claimRequestId } } },
    ], root);
    assert.equal(responses[0].error.data.code, "INVALID_TOOL_INPUT");
    const claimed = responses[1].result.structuredContent;
    assert.equal(claimed.capability, claimRequestId);
    responses = await request([
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "dev_flow_get_review_job", arguments: { featureId: "f", batchId: created.batch.batchId, jobId: secondJob.jobId, capability: claimRequestId } } },
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "dev_flow_get_review_job", arguments: { featureId: "f", batchId: created.batch.batchId, jobId: firstJob.jobId, capability: claimRequestId } } },
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "dev_flow_claim_review_job", arguments: { featureId: "f", expectedRevision: claimed.state.revision, batchId: created.batch.batchId, jobId: firstJob.jobId, claimRequestId } } },
    ], root);
    assert.equal(responses[0].error.data.code, "REVIEW_JOB_CAPABILITY_INVALID");
    assert.equal(responses[1].result.structuredContent.package.jobId, firstJob.jobId);
    assert.equal(responses[2].result.structuredContent.idempotent, true);
    const retried = responses[2].result.structuredContent;
    responses = await request([
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "dev_flow_submit_review_job", arguments: { featureId: "f", expectedRevision: retried.state.revision, batchId: created.batch.batchId, jobId: firstJob.jobId, capability: claimRequestId, completion: { coverageSummary: "Complete", findings: [], assuranceLevel: "multi-agent-verified" } } } },
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "dev_flow_submit_review_job", arguments: { featureId: "f", expectedRevision: retried.state.revision, batchId: created.batch.batchId, jobId: firstJob.jobId, capability: claimRequestId, completion: { coverageSummary: "Complete", findings: [] } } } },
    ], root);
    assert.equal(responses[0].error.data.code, "INVALID_TOOL_INPUT");
    const firstSubmission = responses[1].result.structuredContent;
    assert.equal(firstSubmission.job.status, "submitted");
    assert.equal("submission" in firstSubmission.batch.jobs.find((job) => job.jobId === firstJob.jobId), false);
    const secondCapability = "claim-1234567890-second-reviewer-capability";
    responses = await request([
      { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "dev_flow_claim_review_job", arguments: { featureId: "f", expectedRevision: firstSubmission.state.revision, batchId: created.batch.batchId, jobId: secondJob.jobId, claimRequestId: secondCapability } } },
    ], root);
    const secondClaim = responses[0].result.structuredContent;
    responses = await request([
      { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "dev_flow_submit_review_job", arguments: { featureId: "f", expectedRevision: secondClaim.state.revision, batchId: created.batch.batchId, jobId: secondJob.jobId, capability: secondCapability, completion: { coverageSummary: "Second review complete", findings: [] } } } },
    ], root);
    const secondSubmission = responses[0].result.structuredContent;
    assert.equal(secondSubmission.batch.progress, "open");
    assert.equal(secondSubmission.job.jobId, secondJob.jobId);
    assert.equal(secondSubmission.job.submission.coverageSummary, "Second review complete");
    assert.equal("submission" in secondSubmission.batch.jobs.find((job) => job.jobId === firstJob.jobId), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP sampling uses only one frozen target package, requires negotiated support, and burns malformed responses", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-sampling-"));
  try {
    const initial = await reviewReadyMcpFeature(root);
    const [createdResponse] = await request([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dev_flow_create_review_batch", arguments: { featureId: "f", expectedRevision: initial.revision } } },
    ], root);
    const created = createdResponse.result.structuredContent;
    const [firstJob, secondJob] = created.batch.jobs;

    const forgedRequest = await request([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { sampling: {} } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dev_flow_sample_review_job", arguments: { featureId: "f", expectedRevision: created.state.revision, batchId: created.batch.batchId, jobId: firstJob.jobId, requestId: "caller-controlled-request" } } },
    ], root);
    assert.equal(forgedRequest[1].error.data.code, "INVALID_TOOL_INPUT");
    assert.equal((await store.readState(root, "f")).revision, created.state.revision);

    const unsupported = await request([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dev_flow_sample_review_job", arguments: { featureId: "f", expectedRevision: created.state.revision, batchId: created.batch.batchId, jobId: firstJob.jobId } } },
    ], root);
    assert.equal(unsupported[1].error.data.code, "REVIEW_SAMPLING_UNSUPPORTED");
    assert.equal((await store.readState(root, "f")).revision, created.state.revision);

    const sampled = await requestWithSampling({
      name: "dev_flow_sample_review_job",
      arguments: { featureId: "f", expectedRevision: created.state.revision, batchId: created.batch.batchId, jobId: firstJob.jobId },
    }, root, { content: [{ type: "text", text: JSON.stringify({ coverageSummary: "sampled requirements review", findings: [] }) }] });
    assert.equal(sampled.requests.length, 1);
    const requestContents = sampled.requests[0].params.messages[0].content;
    assert.equal(requestContents.includes(firstJob.jobId), true);
    assert.equal(requestContents.includes(secondJob.jobId), false, "sampling request must not include a sibling job or its output");
    const successful = sampled.response.result.structuredContent;
    assert.equal(successful.job.status, "submitted");
    assert.equal(successful.batch.executionMode, "mcp-sampling");
    assert.equal("submission" in successful.batch.jobs.find((job) => job.jobId === secondJob.jobId), false);

    const malformed = await requestWithSampling({
      name: "dev_flow_sample_review_job",
      arguments: { featureId: "f", expectedRevision: successful.state.revision, batchId: created.batch.batchId, jobId: secondJob.jobId },
    }, root, { content: [{ type: "text", text: "not-json" }] });
    assert.equal(malformed.response.error.data.code, "REVIEW_SAMPLING_FAILED");
    const ledger = await reviewStore.readReviewLedger(root, await store.readState(root, "f"));
    const pending = ledger.batches.at(-1).jobs.find((job) => job.jobId === secondJob.jobId);
    assert.equal(pending.status, "pending");
    assert.equal(pending.samplingAttempts.at(-1).failureCode, "invalid-response");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP source-bundle tests never change the checked-in dist", async () => {
  const distAfter = await Promise.all(["mcp-server.mjs", "claude-hook.mjs", "codex-hook.mjs"].map((name) => readFile(path.resolve("plugins/dev-flow/dist", name))));
  assert.deepEqual(distAfter, distBefore);
});

test("MCP dev_flow_next returns the same enriched evidence as the core action", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-next-"));
  const config = {
    schemaVersion: 1,
    verification: { commands: [{ id: "unit", command: "node", args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
    enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
    protectedRoots: ["src"],
  };
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
    await request([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dev_flow_init_project", arguments: { config } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dev_flow_start", arguments: { featureId: "f", host: "codex", level: "L", topology: "multi-chain", execution: "light", riskLabels: ["security"] } } },
    ], root);
    const stateFile = path.join(root, ".dev-flow", "features", "f", "state.json");
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    state.steps = Object.fromEntries(["boundary", "rollback_safety", "implementation_approval", "implementation"].map((step) => [step, { status: "satisfied" }]));
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    const [response] = await request([
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dev_flow_next", arguments: { featureId: "f" } } },
    ], root);
    assert.deepEqual(response.result.structuredContent, {
      kind: "run-step",
      step: "code_review",
      requiredEvidence: { fields: { reviewType: "code" }, checks: ["security"], verificationKinds: [] },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MCP nests a native confirmation control and records its structured user decision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-elicit-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const requirements = path.join(root, ".dev-flow", "features", "f", "需求文档.md");
    await writeFile(requirements, (await readFile(requirements, "utf8")).replace(/^  grill_status: pending$/m, "  grill_status: complete"));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});

    const response = await requestWithElicitation({
      name: "dev_flow_present_gate",
      arguments: { featureId: "f", expectedRevision: state.revision, gate: "requirement_confirmation", host: "codex" },
    }, root, { action: "accept", content: { action: "confirm" } });
    assert.equal(response.result.structuredContent.interactionOutcome, "confirm");
    assert.equal(response.result.structuredContent.interaction.kind, "gate");
    assert.equal(response.result.structuredContent.response.action, "confirm");
    assert.equal(response.result.structuredContent.gateInteraction, undefined);
    const current = await store.readState(root, "f");
    assert.equal(current.steps.requirement_confirmation.status, "satisfied");
    assert.equal(current.humanGates.requirement_confirmation.confirmation.source, "elicitation");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP nests native grill choices and returns a free-text other response", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-grill-elicit-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    const requirements = path.join(root, ".dev-flow", "features", "f", "需求文档.md");
    await writeFile(requirements, (await readFile(requirements, "utf8")).replace(
      /^  grill_status: pending$/m,
      "  grill_status: in_progress\n  grill_question_id: Q-001\n  grill_response_hint: \"请选择一个方案\"\n  grill_question_limit: 3",
    ));
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });

    const response = await requestWithElicitation({
      name: "dev_flow_request_grill_decision",
      arguments: {
        featureId: "f", expectedRevision: state.revision, questionId: "Q-001", question: "选择同步方案", host: "codex",
        options: [{ id: "hosted", label: "托管同步" }, { id: "other", label: "其他 / 补充", requiresComment: true }],
      },
    }, root, { action: "accept", content: { action: "other", comment: "支持离线同步" } });
    assert.equal(response.result.structuredContent.interactionOutcome, "other");
    assert.equal(response.result.structuredContent.route, "standard-m");
    assert.equal(response.result.structuredContent.response.comment, "支持离线同步");
    const current = await store.readState(root, "f");
    assert.equal(Object.values(current.interactions).find((item) => item.response?.action === "other").response.source, "elicitation");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP emits one advisory attention event for a pending gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-gate-attention-"));
  try {
    await store.initProject(root, config);
    let state = await store.startFeature(root, {
      featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
    });
    state = await artifacts.scaffoldArtifact(root, "f", state.revision, "requirements");
    state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
    state = await checks.recordStep(root, "f", state.revision, "requirements", {});
    const messages = await request([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dev_flow_present_gate", arguments: { featureId: "f", expectedRevision: state.revision, gate: "requirement_confirmation", host: "codex" } } },
    ], root);
    assert.deepEqual(messages.filter((message) => message.method === "notifications/message").map((message) => message.params.data), [
      { kind: "decision-required", featureId: "f", decision: "requirement_confirmation" },
    ]);
    const pending = messages.find((message) => message.id === 1).result.structuredContent;
    assert.equal(pending.interactionOutcome, "pending");
    assert.equal(pending.interaction.kind, "gate");
    assert.equal(pending.gateInteraction.id, pending.interaction.id);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP emits one advisory attention event after successful finalize", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    let state = await store.startFeature(fixture.root, { featureId: "f", host: "codex", level: "XS", topology: "local" });
    state = await checks.recordStep(fixture.root, "f", state.revision, "locate", {});
    state = await checks.recordStep(fixture.root, "f", state.revision, "implementation", { files: [] });
    state = await (await loadSource("plugins/dev-flow/src/core/verification.ts")).runVerification(fixture.root, "f", state.revision, "codex");
    const messages = await request([
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dev_flow_finalize", arguments: { featureId: "f", expectedRevision: state.revision } } },
    ], fixture.root);
    assert.deepEqual(messages.filter((message) => message.method === "notifications/message").map((message) => message.params.data), [
      { kind: "workflow-finalized", featureId: "f" },
    ]);
    assert.equal(messages.find((message) => message.id === 2).result.structuredContent.logicComplete, true);
  } finally { await fixture.dispose(); }
});

const contract = await loadSource("plugins/dev-flow/src/policy/contract.ts");

function satisfyPreImplementation(draft) {
  const definition = contract.routeDefinitionForFeature(draft.route, draft.workflowCapabilities);
  for (const step of definition.orderedSteps.slice(0, definition.orderedSteps.indexOf("implementation"))) {
    draft.steps[step] = { status: "satisfied" };
  }
  draft.humanGates.implementation_approval = { status: "confirmed" };
}

/** standard-m feature with one RU scoped to src, approved and on the implementation step. */
async function unitReadyMcpFeature(root, { checkpoints = 1 } = {}) {
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
  await store.initProject(root, config);
  let state = await store.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  state = await store.mutate(root, "f", state.revision, "unit-mcp-capabilities", (draft) => {
    draft.workflowCapabilities = { trace: 1, review: 0, checkpoints, rollbackExecution: 0 };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "requirements" });
  state = await store.mutate(root, "f", state.revision, "unit-mcp-requirements", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "implementation-plan" });
  state = await store.mutate(root, "f", state.revision, "unit-mcp-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "f", state, kind: "coverage-matrix" });
  return store.mutate(root, "f", state.revision, "unit-mcp-approval", satisfyPreImplementation);
}

/** Two checkpointed units make CP-001 a valid rollback target for MCP tests. */
async function rollbackReadyMcpFeature(root) {
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "one.ts"), "export const one = 1;\n");
  await writeFile(path.join(root, "src", "two.ts"), "export const two = 1;\n");
  await store.initProject(root, config);
  let state = await store.startFeature(root, {
    featureId: "f", host: "codex", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  state = await store.mutate(root, "f", state.revision, "rollback-mcp-capabilities", (draft) => {
    draft.workflowCapabilities = { trace: 1, review: 0, checkpoints: 1, rollbackExecution: 1 };
  });
  const fixture = (kind) => ({
    root, featureId: "f", state, kind,
    delta: twoClosureTraceDeltaFor(kind, "standard-m"),
    edit: (markdown) => appendSecondTraceClosure(markdown, kind, "standard-m"),
  });
  state = await registerTraceFixture(fixture("requirements"));
  state = await store.mutate(root, "f", state.revision, "rollback-mcp-requirements", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  state = await registerTraceFixture(fixture("implementation-plan"));
  state = await store.mutate(root, "f", state.revision, "rollback-mcp-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture(fixture("coverage-matrix"));
  state = await store.mutate(root, "f", state.revision, "rollback-mcp-approval", satisfyPreImplementation);

  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-001");
  await writeFile(path.join(root, "src", "one.ts"), "export const one = 2;\n");
  state = (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-001")).state;
  state = await units.beginImplementationUnit(root, "f", state.revision, "RU-002");
  await writeFile(path.join(root, "src", "two.ts"), "export const two = 2;\n");
  return (await checkpoints.checkpointImplementationUnit(root, "f", state.revision, "RU-002")).state;
}

test("MCP exposes phase-4A rollback tools with strict schemas including gate and execution", async () => {
  const responses = await request([
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dev_flow_present_rollback_gate", arguments: {} } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dev_flow_execute_rollback", arguments: {} } },
  ], process.cwd());
  const names = responses[0].result.tools.map((tool) => tool.name);
  for (const name of ["dev_flow_begin_implementation_unit", "dev_flow_checkpoint_implementation_unit", "dev_flow_preview_rollback",
    "dev_flow_present_rollback_gate", "dev_flow_execute_rollback"]) {
    assert.ok(names.includes(name), `missing tool ${name}`);
  }
  // Both gate and execute tools must reject missing arguments with schema errors.
  assert.equal(responses[1].error.data.code, "INVALID_TOOL_INPUT");
  assert.equal(responses[2].error.data.code, "INVALID_TOOL_INPUT");

  const tools = responses[0].result.tools;
  for (const name of ["dev_flow_begin_implementation_unit", "dev_flow_checkpoint_implementation_unit"]) {
    const schema = tools.find((tool) => tool.name === name).inputSchema;
    assert.deepEqual(schema.required, ["featureId", "expectedRevision", "unitId"], name);
    assert.equal(schema.additionalProperties, false, name);
    assert.equal(schema.properties.unitId.pattern, "^RU-[0-9]{3,}$", name);
    for (const forbidden of ["fileScope", "basisHash", "status", "checkpointId", "files", "verificationAttempts"]) {
      assert.equal(forbidden in schema.properties, false, `${name} must not accept Core-owned ${forbidden}`);
    }
  }
  const preview = tools.find((tool) => tool.name === "dev_flow_preview_rollback").inputSchema;
  assert.deepEqual(preview.required, ["featureId", "targetCheckpointId"]);
  assert.equal(preview.additionalProperties, false);
  assert.equal("expectedRevision" in preview.properties, false);
  assert.equal(tools.find((tool) => tool.name === "dev_flow_preview_rollback").annotations.readOnlyHint, true);

  // Gate and execute tools require expectedRevision (feature-mutation contract).
  for (const name of ["dev_flow_present_rollback_gate", "dev_flow_execute_rollback"]) {
    const schema = tools.find((tool) => tool.name === name).inputSchema;
    assert.deepEqual(schema.required, ["featureId", "expectedRevision", "targetCheckpointId"], name);
    assert.equal(schema.additionalProperties, false, name);
    for (const forbidden of ["unitId", "fileScope", "basisHash", "status", "checkpointId", "files", "verificationAttempts"]) {
      assert.equal(forbidden in schema.properties, false, `${name} must not accept Core-owned ${forbidden}`);
    }
  }
});

test("MCP rollback gate returns its full preview and execution follows the confirmed elicitation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-rollback-"));
  try {
    const state = await rollbackReadyMcpFeature(root);
    const gateResult = await requestWithElicitation({
      name: "dev_flow_present_rollback_gate",
      arguments: { featureId: "f", expectedRevision: state.revision, targetCheckpointId: "CP-001" },
    }, root, { action: "accept", content: { action: "confirm" } }, true);
    assert.equal(gateResult.requests.length, 1);
    assert.match(gateResult.requests[0].params.message, /src\/two\.ts/);
    assert.match(gateResult.requests[0].params.message, /unit:/);
    const gate = gateResult.response;
    assert.ok(gate.result, JSON.stringify(gate));
    const presented = gate.result.structuredContent;
    assert.equal(presented.interaction.kind, "rollback-confirmation");
    assert.equal(presented.interaction.status, "resolved");
    assert.equal(presented.response.action, "confirm");
    assert.equal(presented.preview.targetCheckpointId, "CP-001");
    assert.deepEqual(presented.preview.undoOrder, ["RU-002"]);
    assert.equal(presented.preview.filePlan.some((action) => action.path === "src/two.ts"), true);
    assert.equal(presented.preview.verificationCommands.some((command) => command.commandId === "unit"), true);

    const [executed] = await request([{
      jsonrpc: "2.0", id: 1, method: "tools/call", params: {
        name: "dev_flow_execute_rollback",
        arguments: { featureId: "f", expectedRevision: presented.revision, targetCheckpointId: "CP-001" },
      },
    }], root);
    assert.equal(executed.result.structuredContent.outcome, "committed");
    assert.equal(await readFile(path.join(root, "src", "two.ts"), "utf8"), "export const two = 1;\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP drives the phase-3 unit lifecycle and rejects checkpoints:0 features", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-units-"));
  try {
    const state = await unitReadyMcpFeature(root);
    const responses = await request([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dev_flow_begin_implementation_unit", arguments: { featureId: "f", expectedRevision: state.revision, unitId: "RU-001", fileScope: ["src"] } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dev_flow_begin_implementation_unit", arguments: { featureId: "f", expectedRevision: state.revision, unitId: "RU-1" } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dev_flow_begin_implementation_unit", arguments: { featureId: "f", expectedRevision: state.revision, unitId: "RU-001" } } },
    ], root);
    assert.equal(responses[0].error.data.code, "INVALID_TOOL_INPUT");
    assert.equal(responses[1].error.data.code, "INVALID_TOOL_INPUT");
    const begun = responses[2].result.structuredContent;
    const activeUnit = begun.implementationUnits.find((unit) => unit.unitId === "RU-001");
    assert.equal(activeUnit.status, "active");

    await writeFile(path.join(root, "src", "app.js"), "export const value = 2;\n");
    const checkpointResponses = await request([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dev_flow_checkpoint_implementation_unit", arguments: { featureId: "f", expectedRevision: begun.revision, unitId: "RU-001" } } },
    ], root);
    const checkpointed = checkpointResponses[0].result.structuredContent;
    assert.equal(checkpointed.state.implementationUnits[0].status, "checkpointed");
    assert.equal(checkpointed.manifest.checkpointId, "CP-001");
    assert.equal(checkpointed.manifest.files[0].path, "src/app.js");

    const previewResponses = await request([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dev_flow_preview_rollback", arguments: { featureId: "f", targetCheckpointId: "CP-001" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dev_flow_preview_rollback", arguments: { featureId: "f", targetCheckpointId: "CP-009" } } },
    ], root);
    // The lone checkpoint is the live chain tip: there is nothing to undo.
    assert.equal(previewResponses[0].error.data.code, "ROLLBACK_TARGET_INVALID");
    assert.equal(previewResponses[1].error.data.code, "ROLLBACK_TARGET_INVALID");

    // A checkpoints:0 feature keeps the legacy recordStep contract.
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-units-legacy-"));
    try {
      const legacy = await unitReadyMcpFeature(legacyRoot, { checkpoints: 0 });
      const legacyResponses = await request([
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dev_flow_begin_implementation_unit", arguments: { featureId: "f", expectedRevision: legacy.revision, unitId: "RU-001" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dev_flow_checkpoint_implementation_unit", arguments: { featureId: "f", expectedRevision: legacy.revision, unitId: "RU-001" } } },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dev_flow_record_step", arguments: { featureId: "f", expectedRevision: legacy.revision, step: "implementation", evidence: { files: ["src/app.js"] } } } },
      ], legacyRoot);
      assert.equal(legacyResponses[0].error.data.code, "IMPLEMENTATION_UNITS_NOT_ENFORCED");
      assert.equal(legacyResponses[1].error.data.code, "IMPLEMENTATION_UNITS_NOT_ENFORCED");
      assert.equal(legacyResponses[2].result.structuredContent.steps.implementation.status, "satisfied");
    } finally { await rm(legacyRoot, { recursive: true, force: true }); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
