import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { mcpCall } from "../helpers/host-runner.mjs";

const server = path.resolve("plugins/dev-flow/dist/mcp-server.mjs");
const run = promisify(execFile);
const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

test("MCP status is compact and inspect exposes one explicit topic", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-status-v3-"));
  try {
    await mkdir(path.join(root, "src"));
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "baseline"], { cwd: root });
    await mcpCall(server, root, "dev_flow_init_project", { config });
    const started = await mcpCall(server, root, "dev_flow_start", {
      featureId: "capability", objective: "验证阶段能力合同", scope: { inScope: ["src"], outOfScope: [] }, host: "codex",
    });
    assert.equal("steps" in started, false);
    assert.equal(started.state.mode, "intake");
    const status = await mcpCall(server, root, "dev_flow_status", { featureId: "capability" });
    assert.equal(status.当前阶段, "需求了解");
    assert.equal("steps" in status, false);
    assert.equal(status.control.expectedRevision, started.state.revision);
    const classification = await mcpCall(server, root, "dev_flow_inspect", { featureId: "capability", topic: "classification" });
    assert.equal(classification.topic, "classification");
    await assert.rejects(() => mcpCall(server, root, "dev_flow_inspect", { featureId: "capability", topic: "all" }), (error) => error.code === "INVALID_TOOL_INPUT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
