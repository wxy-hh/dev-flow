import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const state = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const steps = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const gates = await loadSource("plugins/dev-flow/src/core/approval-interactions.ts");
const adapter = await loadSource("plugins/dev-flow/src/hosts/adapter-policy.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");

const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

test("高风险 XS 的确认义务在 implementation 写入前生效", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-adapter-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "feature.txt"), "baseline\n");
  await state.initProject(root, config);
  let current = await state.startFeature(root, {
    featureId: "security-xs",
    objective: "调整本地模块行为",
    scope: { inScope: ["src/feature.txt"], outOfScope: [] },
    host: "codex",
  });
  current = await state.lockClassification(root, "security-xs", current.revision, {
    level: "XS", topology: "local", requirements: "provided-confirmed",
    scopeFacts: ["只影响本地模块"], topologyFacts: ["无共享契约"], uncertaintyFacts: [],
    riskFacts: { security: ["权限边界会改变"] }, decisionRefs: [], riskLabels: ["security"],
  });
  current = await steps.recordStep(root, "security-xs", current.revision, "locate", undefined);
  const action = await next.nextAction(root, "security-xs");
  assert.equal(action.kind, "present-human-gate");
  assert.match(action.step, /^approval:/);
  const blocked = await adapter.preToolBlock(root, { tool_name: "write", tool_input: { file_path: "src/feature.txt" } });
  assert.equal(blocked?.code, "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED");

  const presentation = await gates.presentApproval(root, "security-xs", current.revision, action.step);
  current = await gates.resolveApprovalElicitation(root, "security-xs", presentation.revision, presentation.approvalInteraction.id, "confirm", undefined, "codex");
  const allowed = await adapter.preToolBlock(root, { tool_name: "write", tool_input: { file_path: "src/feature.txt" } });
  assert.equal(allowed, undefined);
});
