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
const stepOrder = await loadSource("plugins/dev-flow/src/core/step-order.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");

const config = {
  schemaVersion: 1,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: "." }], behaviorCommands: [] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  protectedRoots: ["src"],
};

async function startIntake(featureId) {
  const root = await mkdtemp(path.join(os.tmpdir(), `dev-flow-v2-adapter-${featureId}-`));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  await state.startFeature(root, {
    featureId,
    objective: "验证 hook 写入策略",
    scope: { inScope: ["src/feature.txt"], outOfScope: [] },
    host: "codex",
  });
  return root;
}

test("currentOpenStep 对 intake state 不读取 route contract", () => {
  assert.equal(stepOrder.currentOpenStep({ mode: "intake" }), undefined);
});

test("intake 状态写普通 docs 文件允许且不抛异常", async () => {
  const root = await startIntake("intake-docs");
  assert.equal(await adapter.preToolBlock(root, { tool_name: "write", tool_input: { file_path: "docs/notes.md" } }), undefined);
});

test("intake 状态写 protected 文件仍是实现批准门禁", async () => {
  const root = await startIntake("intake-protected");
  const blocked = await adapter.preToolBlock(root, { tool_name: "write", tool_input: { file_path: "src/feature.txt" } });
  assert.equal(blocked?.code, "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED");
  assert.notEqual(blocked?.code, "DEV_FLOW_WORKFLOW_STATE_UNREADABLE");
});

test("intake 状态允许记录中的确定性 printf 写入", async () => {
  const root = await startIntake("intake-printf");
  const allowed = await adapter.preToolBlock(root, {
    tool_name: "bash",
    tool_input: { command: "printf '%s\\n' '=== 验证 ===' >> docs/dev-flow/usage-experience.md" },
  });
  assert.equal(allowed, undefined);
});

test("解释器、管道和仓库外验证日志不产生 Dev Flow block", async () => {
  const root = await startIntake("intake-pipeline");
  const allowed = await adapter.preToolBlock(root, {
    tool_name: "bash",
    tool_input: { command: "node some-check.mjs | tee /tmp/dev-flow-check.log" },
  });
  assert.equal(allowed, undefined);
});

test("未解析 wrapper、xargs 和变量重定向只保留分析结果，不中断工具", async () => {
  const root = await startIntake("intake-unresolved");
  const commands = [
    "bash -c 'printf ok > docs/result.md'",
    "printf ok | xargs -I{} sh -c 'printf {} > docs/result.md'",
    "printf ok > $OUTPUT_FILE",
  ];
  for (const command of commands) {
    assert.equal(adapter.analyzeBashWriteTargets(command).kind, "unresolved");
    assert.equal(await adapter.preToolBlock(root, { tool_name: "bash", tool_input: { command } }), undefined);
  }
});

test("明确写入 .dev-flow 控制文件仍被拒绝", async () => {
  const root = await startIntake("intake-control");
  const blocked = await adapter.preToolBlock(root, { tool_name: "write", tool_input: { file_path: ".dev-flow/active.json" } });
  assert.equal(blocked?.code, "DEV_FLOW_STATE_MUTATION_FORBIDDEN");
});

test("没有 active feature 时仍拒绝明确的 .dev-flow 控制文件写入", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-adapter-no-active-"));
  await state.initProject(root, config);
  const blocked = await adapter.preToolBlock(root, { tool_name: "write", tool_input: { file_path: ".dev-flow/active.json" } });
  assert.equal(blocked?.code, "DEV_FLOW_STATE_MUTATION_FORBIDDEN");
});

test("未登记 artifact 给出具体 scaffold/register 动作，已登记 artifact 允许", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-adapter-artifact-"));
  await state.initProject(root, config);
  let current = await state.startFeature(root, {
    featureId: "artifact",
    objective: "验证资产门禁",
    level: "M",
    topology: "local",
    execution: "standard",
    requirements: "provided-confirmed",
    host: "codex",
  });
  const target = ".dev-flow/features/artifact/需求文档.md";
  const unregistered = await adapter.preToolBlock(root, { tool_name: "write", tool_input: { file_path: target } });
  assert.equal(unregistered?.code, "DEV_FLOW_ARTIFACT_NOT_REGISTERED");
  assert.match(adapter.formatPreToolBlock(unregistered), /scaffold\/register/);
  current = await artifacts.scaffoldArtifact(root, "artifact", current.revision, "requirements");
  assert.equal(await adapter.preToolBlock(root, { tool_name: "write", tool_input: { file_path: target } }), undefined);
});

test("intake 状态 protected 重定向仍被拦截", async () => {
  const root = await startIntake("intake-redirect-protected");
  const blocked = await adapter.preToolBlock(root, { tool_name: "bash", tool_input: { command: "printf ok > src/feature.txt" } });
  assert.equal(blocked?.code, "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED");
});

test("logic-complete 前 Git 写命令仍被拦截", async () => {
  const root = await startIntake("intake-git");
  const blocked = await adapter.preToolBlock(root, { tool_name: "bash", tool_input: { command: "git add src/feature.txt" } });
  assert.equal(blocked?.code, "DEV_FLOW_GIT_GUARD");
});

test("block outcome 稳定包含原因、影响、解决方案、确认和自动重试说明", async () => {
  const root = await startIntake("structured-block");
  const outcome = await adapter.evaluatePreToolUse(root, { tool_name: "write", tool_input: { file_path: "src/feature.txt" } });
  assert.equal(outcome.kind, "block");
  if (outcome.kind !== "block") return;
  assert.equal(outcome.block.recovery.retryOriginal, true);
  const formatted = adapter.formatPreToolBlock(outcome.block);
  assert.match(formatted, /^DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED\n/);
  assert.match(formatted, /原因：/);
  assert.match(formatted, /影响：/);
  assert.match(formatted, /解决方案：/);
  assert.match(formatted, /确认：/);
  assert.match(formatted, /继续方式：解决后自动重试原操作/);
});

test("unresolved 分析默认是无提示 allow outcome", async () => {
  const root = await startIntake("unresolved-outcome");
  assert.deepEqual(
    await adapter.evaluatePreToolUse(root, { tool_name: "bash", tool_input: { command: "bash -c 'printf ok > docs/result.md'" } }),
    { kind: "allow" },
  );
});

test("批准增强信息的事件账本损坏时保持 state unreadable，不 fail-open protected 写入", async () => {
  const root = await startIntake("corrupt-events");
  await writeFile(path.join(root, ".dev-flow", "features", "corrupt-events", "events.jsonl"), "{not-json\n");
  const outcome = await adapter.evaluatePreToolUse(root, { tool_name: "write", tool_input: { file_path: "src/feature.txt" } });
  assert.equal(outcome.kind, "block");
  if (outcome.kind !== "block") return;
  assert.equal(outcome.block.code, "DEV_FLOW_WORKFLOW_STATE_UNREADABLE");
  assert.match(outcome.block.reason, /events\.jsonl/);
});

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
  current = await gates.resolveApprovalElicitation(root, "security-xs", presentation.revision, presentation.interactionId, "confirm", undefined, "codex");
  const allowed = await adapter.preToolBlock(root, { tool_name: "write", tool_input: { file_path: "src/feature.txt" } });
  assert.equal(allowed, undefined);
});
