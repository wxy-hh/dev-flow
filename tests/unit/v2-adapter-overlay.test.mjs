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
const syntax = await loadSource("plugins/dev-flow/src/hosts/bash-syntax.ts");
const format = await loadSource("plugins/dev-flow/src/hosts/block-format.ts");
const stepOrder = await loadSource("plugins/dev-flow/src/core/step-order.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");

// 生产 wrapper 已删：测试经 evaluatePreToolUse（双宿主 adapter 的真实 seam）取 block。
async function blockFor(root, event) {
  const outcome = await adapter.evaluatePreToolUse(root, event);
  return outcome.kind === "block" ? outcome.block : undefined;
}

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
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
  assert.equal(await blockFor(root, { tool_name: "write", tool_input: { file_path: "docs/notes.md" } }), undefined);
});

test("intake 状态写 protected 文件仍是实现批准门禁", async () => {
  const root = await startIntake("intake-protected");
  const blocked = await blockFor(root, { tool_name: "write", tool_input: { file_path: "src/feature.txt" } });
  assert.equal(blocked?.code, "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED");
  assert.notEqual(blocked?.code, "DEV_FLOW_WORKFLOW_STATE_UNREADABLE");
});

test("intake 状态允许记录中的确定性 printf 写入", async () => {
  const root = await startIntake("intake-printf");
  const allowed = await blockFor(root, {
    tool_name: "bash",
    tool_input: { command: "printf '%s\\n' '=== 验证 ===' >> docs/dev-flow/usage-experience.md" },
  });
  assert.equal(allowed, undefined);
});

test("解释器、管道和仓库外验证日志不产生 Dev Flow block", async () => {
  const root = await startIntake("intake-pipeline");
  const allowed = await blockFor(root, {
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
    assert.equal(syntax.analyzeBashWriteTargets(command).kind, "unresolved");
    assert.equal(await blockFor(root, { tool_name: "bash", tool_input: { command } }), undefined);
  }
});

test("明确写入 .dev-flow 控制文件仍被拒绝", async () => {
  const root = await startIntake("intake-control");
  const blocked = await blockFor(root, { tool_name: "write", tool_input: { file_path: ".dev-flow/active.json" } });
  assert.equal(blocked?.code, "DEV_FLOW_STATE_MUTATION_FORBIDDEN");
});

test("没有 active feature 时仍拒绝明确的 .dev-flow 控制文件写入", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-adapter-no-active-"));
  await state.initProject(root, config);
  const blocked = await blockFor(root, { tool_name: "write", tool_input: { file_path: ".dev-flow/active.json" } });
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
  const unregistered = await blockFor(root, { tool_name: "write", tool_input: { file_path: target } });
  assert.equal(unregistered?.code, "DEV_FLOW_ARTIFACT_NOT_REGISTERED");
  assert.match(format.formatPreToolBlock(unregistered), /scaffold\/register/);
  current = await artifacts.scaffoldArtifact(root, "artifact", current.revision, "requirements");
  assert.equal(await blockFor(root, { tool_name: "write", tool_input: { file_path: target } }), undefined);
});

test("intake 状态 protected 重定向仍被拦截", async () => {
  const root = await startIntake("intake-redirect-protected");
  const blocked = await blockFor(root, { tool_name: "bash", tool_input: { command: "printf ok > src/feature.txt" } });
  assert.equal(blocked?.code, "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED");
});

test("logic-complete 前 Git 写命令仍被拦截", async () => {
  const root = await startIntake("intake-git");
  const blocked = await blockFor(root, { tool_name: "bash", tool_input: { command: "git add src/feature.txt" } });
  assert.equal(blocked?.code, "DEV_FLOW_GIT_GUARD");
});

test("block outcome 稳定包含原因、影响、解决方案、确认和自动重试说明", async () => {
  const root = await startIntake("structured-block");
  const outcome = await adapter.evaluatePreToolUse(root, { tool_name: "write", tool_input: { file_path: "src/feature.txt" } });
  assert.equal(outcome.kind, "block");
  if (outcome.kind !== "block") return;
  assert.equal(outcome.block.recovery.retryOriginal, true);
  const formatted = format.formatPreToolBlock(outcome.block);
  assert.match(formatted, /^DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED\n/);
  assert.match(formatted, /原因：/);
  assert.match(formatted, /影响：/);
  assert.match(formatted, /解决方案：/);
  assert.match(formatted, /确认：/);
  assert.match(formatted, /继续方式：解决后自动重试原操作/);
});

test("unresolved 分析给出 allow 与归属提示 advisory", async () => {
  const root = await startIntake("unresolved-outcome");
  const outcome = await adapter.evaluatePreToolUse(root, { tool_name: "bash", tool_input: { command: "bash -c 'printf ok > docs/result.md'" } });
  assert.equal(outcome.kind, "allow");
  if (outcome.kind !== "allow") return;
  assert.equal(outcome.advisory?.code, "DEV_FLOW_HOOK_UNRESOLVED_WRITE");
  assert.match(outcome.advisory?.message ?? "", /没有自动把这些文件记入当前任务/);
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
  await state.initProject(root, config);
  let current = await state.startFeature(root, {
    featureId: "security-xs",
    objective: "调整本地模块行为",
    scope: { inScope: ["src/feature.txt"], outOfScope: [] },
    level: "XS",
    topology: "local",
    requirements: "provided-confirmed",
    riskLabels: ["security"],
    host: "codex",
  });
  current = await steps.recordStep(root, "security-xs", current.revision, "locate", undefined);
  const action = await next.nextAction(root, "security-xs");
  assert.equal(action.kind, "present-human-gate");
  assert.match(action.step, /^approval:/);
  const blocked = await blockFor(root, { tool_name: "write", tool_input: { file_path: "src/feature.txt" } });
  assert.equal(blocked?.code, "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED");

  const presentation = await gates.presentApproval(root, "security-xs", current.revision);
  current = (await state.answer({ root, featureId: "security-xs", expectedRevision: presentation.state.revision, host: "codex", credential: { source: "elicitation", action: "confirm" } })).state;
  const allowed = await blockFor(root, { tool_name: "write", tool_input: { file_path: "src/feature.txt" } });
  assert.equal(allowed, undefined);
});

test("implementation 阶段 git 门禁：startup-excluded 预存脏文件提示不拦，未知/显式排除路径仍拦", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-adapter-gitguard-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/pre-existing.js"), "export const old = 1;\n", "utf8");
  await state.initProject(root, config);
  let current = await state.startFeature(root, {
    featureId: "git-guard",
    objective: "验证 git 门禁收窄",
    scope: { inScope: ["src/feature.txt"], outOfScope: [] },
    level: "XS",
    topology: "local",
    requirements: "provided-confirmed",
    riskLabels: ["security"],
    host: "codex",
  });
  assert.equal(current.workspace.ownership["src/pre-existing.js"], "excluded");
  assert.equal(current.workspace.ownershipSource["src/pre-existing.js"], "startup-excluded");

  current = await steps.recordStep(root, "git-guard", current.revision, "locate", undefined);
  const action = await next.nextAction(root, "git-guard");
  const presentation = await gates.presentApproval(root, "git-guard", current.revision);
  current = (await state.answer({ root, featureId: "git-guard", expectedRevision: presentation.state.revision, host: "codex", credential: { source: "elicitation", action: "confirm" } })).state;

  const startupExcluded = await adapter.evaluatePreToolUse(root, { tool_name: "bash", tool_input: { command: "git add src/pre-existing.js" } });
  assert.equal(startupExcluded.kind, "allow");
  if (startupExcluded.kind !== "allow") return;
  assert.equal(startupExcluded.advisory?.code, "DEV_FLOW_GIT_STARTUP_EXCLUDED");
  assert.match(startupExcluded.advisory?.message ?? "", /不会进入交付快照/);

  await writeFile(path.join(root, "src/unknown.js"), "export const u = 1;\n", "utf8");
  const unknownBlocked = await blockFor(root, { tool_name: "bash", tool_input: { command: "git add src/unknown.js" } });
  assert.equal(unknownBlocked?.code, "DEV_FLOW_GIT_GUARD");

  await writeFile(path.join(root, "src/user-excluded.js"), "export const e = 1;\n", "utf8");
  await state.mutate(root, "git-guard", current.revision, "test-ownership", (draft) => {
    draft.workspace.ownership["src/user-excluded.js"] = "excluded";
  });
  const excludedBlocked = await blockFor(root, { tool_name: "bash", tool_input: { command: "git add src/user-excluded.js" } });
  assert.equal(excludedBlocked?.code, "DEV_FLOW_GIT_GUARD");
});

test("git commit -a/-am/--all 无法安全枚举，即使实现阶段已批准也按 unbounded 拦下", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-v2-adapter-commitall-"));
  await mkdir(path.join(root, "src"));
  await state.initProject(root, config);
  let current = await state.startFeature(root, {
    featureId: "commit-all",
    objective: "验证 commit -a 门禁",
    scope: { inScope: ["src/feature.txt"], outOfScope: [] },
    level: "XS",
    topology: "local",
    requirements: "provided-confirmed",
    riskLabels: ["security"],
    host: "codex",
  });
  current = await steps.recordStep(root, "commit-all", current.revision, "locate", undefined);
  const action = await next.nextAction(root, "commit-all");
  const presentation = await gates.presentApproval(root, "commit-all", current.revision);
  current = (await state.answer({ root, featureId: "commit-all", expectedRevision: presentation.state.revision, host: "codex", credential: { source: "elicitation", action: "confirm" } })).state;

  for (const command of ['git commit -a -m "x"', 'git commit -am "x"', "git commit --all -m x"]) {
    const blocked = await blockFor(root, { tool_name: "bash", tool_input: { command } });
    assert.equal(blocked?.code, "DEV_FLOW_GIT_GUARD", command);
  }
  // --amend 不是 all 形态：已批准实现阶段下按具名 staged paths 处理（空暂存放行）
  assert.equal(await blockFor(root, { tool_name: "bash", tool_input: { command: 'git commit --amend -m "x"' } }), undefined);
});
