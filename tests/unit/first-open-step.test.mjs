import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const stages = await loadSource("plugins/dev-flow/src/policy/stages.ts");

const ORDERED = ["requirements_alignment", "planning", "implementation", "verification", "finalize"];

// xs 路线最简控制：编译出的 orderedSteps 为 [locate, implementation, verification, finalize]。
const xsControls = {
  requirements: false,
  plan: "locate",
  trace: false,
  planReview: false,
  reviewRoles: [],
  executionApproval: false,
  checkpoints: "baseline",
  recovery: [],
  codeReview: "none",
  verification: [],
};

test("firstOpenStep 按 orderedSteps 顺序找第一个未满足步骤", () => {
  assert.equal(stages.firstOpenStep(ORDERED, {}), "requirements_alignment");
  assert.equal(stages.firstOpenStep(ORDERED, { requirements_alignment: { status: "satisfied" } }), "planning");
});

test("firstOpenStep 只信 orderedSteps 顺序，账本键序乱序不影响结果", () => {
  // 投影分叉反例：verification 先插入不代表它是当前步骤。
  assert.equal(
    stages.firstOpenStep(ORDERED, {
      verification: { status: "pending" },
      requirements_alignment: { status: "satisfied" },
      planning: { status: "pending" },
    }),
    "planning",
  );
});

test("firstOpenStep 全部满足返回 undefined，且忽略 orderedSteps 之外的账本键", () => {
  const steps = Object.fromEntries(ORDERED.map((step) => [step, { status: "satisfied" }]));
  assert.equal(stages.firstOpenStep(ORDERED, steps), undefined);
  assert.equal(
    stages.firstOpenStep(["a", "b"], { a: { status: "satisfied" }, "approval:x": { status: "pending" }, b: { status: "satisfied" } }),
    undefined,
  );
});

test("effectiveStage：routed 空 steps 回到路线首步（删除 currentStage 回落）", () => {
  assert.equal(
    stages.effectiveStage({ mode: "routed", route: "xs", lifecycle: "active", steps: {}, classification: { controls: xsControls } }),
    "locate",
  );
});

test("effectiveStage：乱序键序下与执行门禁给出同一答案", () => {
  assert.equal(
    stages.effectiveStage({
      mode: "routed",
      route: "xs",
      lifecycle: "active",
      steps: { verification: { status: "pending" }, locate: { status: "satisfied" }, implementation: { status: "pending" } },
      classification: { controls: xsControls },
    }),
    "implementation",
  );
});

test("effectiveStage：全部满足而未 finalized 的过渡态落在路线末步", () => {
  assert.equal(
    stages.effectiveStage({
      mode: "routed",
      route: "xs",
      lifecycle: "active",
      steps: { locate: { status: "satisfied" }, implementation: { status: "satisfied" }, verification: { status: "satisfied" }, finalize: { status: "satisfied" } },
      classification: { controls: xsControls },
    }),
    "finalize",
  );
});

test("effectiveStage：intake 与 finalized 特判保持", () => {
  assert.equal(stages.effectiveStage({ mode: "intake" }), "intake");
  assert.equal(
    stages.effectiveStage({ mode: "routed", route: "xs", lifecycle: "finalized", steps: {}, classification: { controls: xsControls } }),
    "complete",
  );
});
