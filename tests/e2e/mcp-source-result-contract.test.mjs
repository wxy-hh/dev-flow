import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { mcpCall } from "../helpers/host-runner.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverEntry = path.join(repositoryRoot, "plugins", "dev-flow", "src", "mcp", "server.ts");

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
    const recorded = await mcpCall(server, fixture.root, "dev_flow_record_decision", {
      featureId: "decisions", expectedRevision: state.control.expectedRevision,
      question: "是否保留兼容行为？", factRefs: ["fact-1"], host: "codex",
    });
    assert.match(recorded.decisionId, /^DEC-[0-9a-f]{16}$/);
    state = await mcpCall(server, fixture.root, "dev_flow_resolve_decision", {
      featureId: "decisions", expectedRevision: recorded.control.expectedRevision,
      decisionId: recorded.decisionId, evidence: "用户已确认", conclusion: "保留", host: "codex",
    });
    const locked = await mcpCall(server, fixture.root, "dev_flow_lock_classification", {
      featureId: "decisions", expectedRevision: state.control.expectedRevision,
      classification: {
        level: "M", topology: "local", execution: "light", requirements: "provided-confirmed",
        scopeFacts: ["只改一个模块"], topologyFacts: ["没有共享契约"], uncertaintyFacts: [],
        riskFacts: {}, decisionRefs: [recorded.decisionId],
      },
    });
    assert.equal(locked.control.stage, "planning");
  } finally {
    await fixture.dispose();
  }
});
