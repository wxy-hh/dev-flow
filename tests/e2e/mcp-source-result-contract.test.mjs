import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { mcpCall, run } from "../helpers/host-runner.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverEntry = path.join(repositoryRoot, "plugins", "dev-flow", "src", "mcp", "server.ts");
const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");

// Bundle the MCP server from source so these contract tests exercise the
// current src without depending on the committed dist bundle.
async function bundleSourceServer(directory) {
  const outfile = path.join(directory, "mcp-server-source.mjs");
  await build({
    entryPoints: [serverEntry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    define: { __DEV_FLOW_VERSION__: JSON.stringify("test") },
  });
  return outfile;
}

const staging = await mkdtemp(path.join(os.tmpdir(), "dev-flow-source-server-"));
const server = await bundleSourceServer(staging);
after(() => rm(staging, { recursive: true, force: true }));

async function rawListTools(cwd) {
  const response = await run(process.execPath, [server], {
    cwd,
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`,
  });
  const message = response.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((candidate) => candidate.id === 1);
  if (!message) throw new Error(`MCP did not return a response for tools/list: ${response.stdout}`);
  return message.result.tools;
}

test("dev_flow_init_project returns a well-formed result (P2)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-p2-init-"));
  try {
    const result = await mcpCall(server, root, "dev_flow_init_project", { config: strictProjectConfig }, { raw: true });
    assert.equal(result.isError, undefined);
    assert.ok(Array.isArray(result.content) && result.content.length > 0);
    assert.equal(typeof result.content[0].text, "string");
    assert.ok(result.content[0].text.length > 0, "content[0].text must be a non-empty string");
    assert.ok(result.structuredContent, "structuredContent must be present");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dev_flow_record_decision exposes a decisionId usable end-to-end (P5)", async () => {
  const fixture = await createTinyApp();
  try {
    await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
    let state = await mcpCall(server, fixture.root, "dev_flow_start", {
      featureId: "decisions", objective: "澄清一个决策", host: "codex",
      scope: { inScope: ["src/counter.js"], outOfScope: [] },
    });
    await store.recordHostEvent(fixture.root, { eventId: "known-conclusion", type: "user-prompt", host: "codex", text: "保留" });
    const recorded = await mcpCall(server, fixture.root, "dev_flow_record_decision", {
      featureId: "decisions", expectedRevision: state.control.expectedRevision,
      question: "是否保留兼容行为？", evidence: "用户已有明确结论", conclusion: "保留", factRefs: ["fact-1"], host: "codex",
    });
    assert.match(recorded.decisionId, /^DEC-[0-9a-f]{16}$/);
    const pending = await mcpCall(server, fixture.root, "dev_flow_lock_classification", {
      featureId: "decisions", expectedRevision: recorded.control.expectedRevision,
      classification: {
        level: "M", topology: "local", requirements: "provided-confirmed",
        classificationBasis: {
          scopeFacts: ["只改一个模块"], topologyFacts: ["没有共享契约"], uncertaintyFacts: [],
          riskFacts: {}, decisionRefs: [recorded.decisionId],
          signals: { changeSurface: "multi-component", behaviorChange: "new-capability", topology: "local", unitCount: 1, requirements: "provided-confirmed", operationalRecovery: false, executableRollback: false },
        },
      },
      boundaryAudit: { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] },
    });
    await store.recordHostEvent(fixture.root, { eventId: "route-confirm", type: "user-prompt", host: "codex", text: "确认这条路线" });
    const locked = await mcpCall(server, fixture.root, "dev_flow_answer", { featureId: "decisions", expectedRevision: pending.control.expectedRevision, userReply: "确认这条路线", host: "codex" });
    assert.equal(locked.control.stage, "requirements_alignment");
  } finally {
    await fixture.dispose();
  }
});

test("dev_flow_classify uses a properties-based schema, not top-level oneOf (P3)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-p3-schema-"));
  try {
    const tools = await rawListTools(root);
    const classify = tools.find((tool) => tool.name === "dev_flow_classify");
    assert.ok(classify, "dev_flow_classify must be advertised in tools/list");
    const schema = classify.inputSchema;
    assert.equal(schema.oneOf, undefined, "classify schema must not use top-level oneOf");
    assert.ok(schema.properties, "classify schema must have properties at root");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dev_flow_classify rejects empty args with CLASSIFICATION_ARGS_INVALID (P3)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-p3-args-"));
  try {
    await assert.rejects(
      () => mcpCall(server, root, "dev_flow_classify", {}),
      (error) => error.code === "CLASSIFICATION_ARGS_INVALID",
    );
    const preview = await mcpCall(server, root, "dev_flow_classify", { level: "M", topology: "local", requirements: "provided-confirmed" });
    assert.equal(preview.route, "m");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
