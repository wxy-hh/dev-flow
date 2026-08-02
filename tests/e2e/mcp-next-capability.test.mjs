import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mcpCall } from "../helpers/host-runner.mjs";

const server = path.resolve("plugins/dev-flow/dist/mcp-server.mjs");
const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("MCP dev_flow_next returns the public stage capability contract", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-mcp-next-v2-"));
  try {
    await mkdir(path.join(root, "src"));
    await mcpCall(server, root, "dev_flow_init_project", { config });
    await mcpCall(server, root, "dev_flow_start", {
      featureId: "capability", objective: "验证阶段能力合同", scope: { inScope: ["src"], outOfScope: [] }, host: "codex",
    });
    const capability = await mcpCall(server, root, "dev_flow_next", { featureId: "capability" });
    assert.equal(capability.stage, "intake");
    assert.ok(capability.allowedActions.includes("lock-classification"));
    assert.equal("kind" in capability, false);
    assert.equal("step" in capability, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
