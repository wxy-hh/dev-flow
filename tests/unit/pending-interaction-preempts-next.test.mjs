import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const next = await loadSource("plugins/dev-flow/src/core/next.ts");
const status = await loadSource("plugins/dev-flow/src/core/status.ts");
const projection = await loadSource("plugins/dev-flow/src/core/status-projection.ts");
const { createInteraction } = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");

const config = {
  schemaVersion: 2,
  verification: { commands: [{ id: "unit", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] },
  enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true },
  governedRoots: ["src"],
};

async function newRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dev-flow-preempt-"));
  await mkdir(path.join(root, "src"));
  await store.initProject(root, config);
  return root;
}

async function routedXS(root) {
  return store.startFeature(root, { featureId: "feature", host: "codex", level: "XS", topology: "local" });
}

async function routedL(root) {
  return store.startFeature(root, { featureId: "feature", host: "codex", level: "L", topology: "multi-chain" });
}

const PENDING_CASES = [
  {
    label: "归属 pending",
    question: "src/counter.js 属于当前任务吗？",
    interaction: { kind: "workspace-ownership", target: "workspace:own", options: [{ id: "adopt", label: "纳入当前任务" }, { id: "exclude", label: "排除并先处理" }] },
  },
  {
    label: "批准 pending",
    question: "请确认实施。",
    interaction: { kind: "approval", target: "approval:implementation", options: [{ id: "confirm", label: "确认" }, { id: "revise", label: "驳回并说明" }] },
  },
  {
    label: "路线确认 pending",
    question: "请确认这条路线。",
    interaction: { kind: "route-confirmation", target: "route-confirmation", options: [{ id: "confirm", label: "确认这条路线" }, { id: "adjust", label: "调整分类" }] },
  },
];

test("routed 存在待决交互时 nextAction 指向先回答，不返回 run-step/begin-unit/finalize", async () => {
  for (const { label, question, interaction } of PENDING_CASES) {
    const root = await newRoot();
    try {
      const state = await routedXS(root);
      const baseline = await next.nextAction(root, "feature");
      assert.equal(baseline.kind, "run-step", `${label}：无待决基线应是 run-step，得到 ${JSON.stringify(baseline)}`);
      await store.mutate(root, "feature", state.revision, "test-inject-pending", (draft) => {
        createInteraction(draft, { ...interaction, basisHash: "a".repeat(64), question });
      });
      const action = await next.nextAction(root, "feature");
      assert.equal(action.kind, "intake", `${label}：待决时应先回答，得到 ${JSON.stringify(action)}`);
      assert.equal(action.activity, "resolve-decision");
      // 胖 status 与 CompactStatus 说同一件事
      const view = await status.readStatusView(root, "feature");
      assert.equal(view.progress.nextAction.kind, "intake");
      const compact = await projection.readCompactStatus(root, "feature");
      assert.equal(compact.contentView["需要用户决定"], true, label);
      assert.match(compact.contentView["下一步"], /回答/, label);
      assert.equal(compact.contentView.pendingDecision.question, question, label);
      assert.equal(compact.structuredContentView.control.nextAction.kind, "intake", label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("待决解决后 01 的调度不被破坏：回到 run-step", async () => {
  const root = await newRoot();
  try {
    const state = await routedXS(root);
    await store.mutate(root, "feature", state.revision, "test-inject-pending", (draft) => {
      createInteraction(draft, { kind: "approval", target: "approval:implementation", basisHash: "a".repeat(64), question: "请选择一个方案。", options: [{ id: "confirm", label: "确认" }, { id: "revise", label: "驳回并说明" }] });
    });
    assert.equal((await next.nextAction(root, "feature")).kind, "intake");
    const withPending = await store.readState(root, "feature");
    await store.mutate(root, "feature", withPending.revision, "test-clear-pending", (draft) => {
      draft.interactions = {};
    });
    assert.deepEqual(await next.nextAction(root, "feature"), { kind: "run-step", step: "locate" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("待决也压过 scaffold-artifact 类基线（不限于 run-step）", async () => {
  const root = await newRoot();
  try {
    const state = await routedL(root);
    assert.deepEqual(await next.nextAction(root, "feature"), { kind: "scaffold-artifact", step: "requirements" });
    await store.mutate(root, "feature", state.revision, "test-inject-pending", (draft) => {
      createInteraction(draft, { kind: "route-confirmation", target: "route-confirmation", basisHash: "a".repeat(64), question: "请确认这条路线。", options: [{ id: "confirm", label: "确认这条路线" }, { id: "adjust", label: "调整分类" }] });
    });
    const action = await next.nextAction(root, "feature");
    assert.equal(action.kind, "intake");
    assert.equal(action.activity, "resolve-decision");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("intake 有待决交互时 nextAction 仍指向先回答", async () => {
  const root = await newRoot();
  try {
    const started = await store.startFeature(root, { featureId: "intake-pending", host: "codex" });
    await store.recordDecision(root, "intake-pending", started.revision, "范围是什么？", "全部解决一下", "覆盖全部问题", [], "codex");
    const action = await next.nextAction(root, "intake-pending");
    assert.equal(action.kind, "intake");
    assert.equal(action.activity, "resolve-decision");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
