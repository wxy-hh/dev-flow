import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../helpers/load-source.mjs";

const { formatWriteGateBlock, formatPreToolBlock } = await loadSource("plugins/dev-flow/src/hosts/block-format.ts");

// 表驱动直测：合成 WriteGateBlock 字面量，覆盖 7 个门禁码 × variant 的文案分支，
// 不再需要为每条文案构造全套工作流状态。
const cases = [
  {
    name: "CONTROL_MUTATION_FORBIDDEN / control-area",
    input: { code: "CONTROL_MUTATION_FORBIDDEN", paths: [".dev-flow/features/f/state.json"], reason: "r", detail: { variant: "control-area" } },
    code: "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
    reason: /位于 Dev Flow 控制区/,
    recovery: { mode: "user-decision", retryOriginal: false },
  },
  {
    name: "CONTROL_MUTATION_FORBIDDEN / 默认",
    input: { code: "CONTROL_MUTATION_FORBIDDEN", paths: [".dev-flow/active.json"], reason: "r" },
    code: "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
    reason: /控制文件/,
    recovery: { mode: "user-decision", retryOriginal: false },
  },
  {
    name: "ARTIFACT_NOT_REGISTERED / 需求文档",
    input: { code: "ARTIFACT_NOT_REGISTERED", paths: [".dev-flow/features/f/需求文档.md"], reason: "r" },
    code: "DEV_FLOW_ARTIFACT_NOT_REGISTERED",
    reason: /requirements Markdown 资产/,
    recovery: { mode: "guided", retryOriginal: true },
  },
  {
    name: "ARTIFACT_NOT_REGISTERED / 实施计划",
    input: { code: "ARTIFACT_NOT_REGISTERED", paths: [".dev-flow/features/f/实施计划.md"], reason: "r" },
    code: "DEV_FLOW_ARTIFACT_NOT_REGISTERED",
    reason: /implementation-plan Markdown 资产/,
    recovery: { mode: "guided", retryOriginal: true },
  },
  {
    name: "IMPLEMENTATION_APPROVAL_REQUIRED / revokedKind",
    input: { code: "IMPLEMENTATION_APPROVAL_REQUIRED", paths: ["src/a.ts"], reason: "r", detail: { revokedKind: "implementation-plan" } },
    code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
    reason: /批准已作废/,
    recovery: { mode: "user-decision", retryOriginal: true },
  },
  {
    name: "IMPLEMENTATION_APPROVAL_REQUIRED / approval",
    input: { code: "IMPLEMENTATION_APPROVAL_REQUIRED", paths: ["src/a.ts"], reason: "r", detail: { variant: "approval" } },
    code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
    reason: /执行批准义务尚未满足/,
    recovery: { mode: "user-decision", retryOriginal: true },
  },
  {
    name: "IMPLEMENTATION_APPROVAL_REQUIRED / intake 默认",
    input: { code: "IMPLEMENTATION_APPROVAL_REQUIRED", paths: ["src/a.ts"], reason: "r" },
    code: "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
    reason: /仍处于 intake/,
    recovery: { mode: "user-decision", retryOriginal: true },
  },
  {
    name: "IMPLEMENTATION_UNIT_REQUIRED / 无 beginFailed",
    input: { code: "IMPLEMENTATION_UNIT_REQUIRED", paths: ["src/a.ts"], reason: "no active implementation unit" },
    code: "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED",
    reason: /没有活动的 implementation unit/,
    recovery: { mode: "automatic", retryOriginal: true },
  },
  {
    name: "IMPLEMENTATION_UNIT_REQUIRED / beginFailed 拼入诊断",
    input: { code: "IMPLEMENTATION_UNIT_REQUIRED", paths: ["src/a.ts"], reason: "no active implementation unit", detail: { beginFailed: "TRACE_STALE" } },
    code: "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED",
    reason: /自动准备 implementation unit 失败：TRACE_STALE/,
    recovery: { mode: "automatic", retryOriginal: true },
  },
  {
    name: "IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
    input: { code: "IMPLEMENTATION_UNIT_OUT_OF_SCOPE", paths: ["src/a.ts"], reason: "r" },
    code: "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
    reason: /在 Trace 中已失效/,
    recovery: { mode: "user-decision", retryOriginal: true },
  },
  {
    name: "GIT_GUARD / paths",
    input: { code: "GIT_GUARD", paths: ["src/a.ts"], reason: "r", detail: { variant: "paths" } },
    code: "DEV_FLOW_GIT_GUARD",
    reason: /未归属或已排除的路径/,
    recovery: { mode: "user-decision", retryOriginal: false },
  },
  {
    name: "GIT_GUARD / publish",
    input: { code: "GIT_GUARD", paths: [], reason: "r", detail: { variant: "publish" } },
    code: "DEV_FLOW_GIT_GUARD",
    reason: /外部发布仍然被禁止/,
    recovery: { mode: "guided", retryOriginal: true },
  },
  {
    name: "GIT_GUARD / 默认",
    input: { code: "GIT_GUARD", paths: ["src/a.ts"], reason: "r" },
    code: "DEV_FLOW_GIT_GUARD",
    reason: /不满足阶段、批准或路径归属条件/,
    recovery: { mode: "guided", retryOriginal: true },
  },
  {
    name: "WORKFLOW_STATE_UNREADABLE / unreadableReason",
    input: { code: "WORKFLOW_STATE_UNREADABLE", paths: ["src/a.ts"], reason: "r", detail: { unreadableReason: "events.jsonl invalid" } },
    code: "DEV_FLOW_WORKFLOW_STATE_UNREADABLE",
    reason: /events\.jsonl invalid/,
    recovery: { mode: "guided", retryOriginal: true },
  },
  {
    name: "GIT_STARTUP_EXCLUDED（审计结论）落到 unreadable 兜底文案",
    input: { code: "GIT_STARTUP_EXCLUDED", paths: ["src/a.ts"], reason: "audit-only" },
    code: "DEV_FLOW_WORKFLOW_STATE_UNREADABLE",
    reason: /audit-only/,
    recovery: { mode: "guided", retryOriginal: true },
  },
];

for (const { name, input, code, reason, recovery } of cases) {
  test(`formatWriteGateBlock: ${name}`, () => {
    const block = formatWriteGateBlock(input);
    assert.equal(block.code, code);
    assert.match(block.reason, reason);
    assert.equal(block.recovery.mode, recovery.mode);
    assert.equal(block.recovery.retryOriginal, recovery.retryOriginal);
    assert.ok(block.impact.length > 0);
    assert.ok(block.recovery.action.length > 0);
    // recoveryHint 死字段已删：序列化只认 recovery.action。
    assert.ok(!("recoveryHint" in block));
    const text = formatPreToolBlock(block);
    assert.ok(text.startsWith(`${code}\n`));
    assert.match(text, /原因：/);
    assert.match(text, /解决方案：/);
  });
}
