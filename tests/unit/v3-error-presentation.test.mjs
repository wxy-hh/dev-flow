import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const errors = await loadSource("plugins/dev-flow/src/core/errors.ts");
const presentation = await loadSource("plugins/dev-flow/src/policy/presentation.ts");

test("failure envelope is Chinese by default and keeps technical data separate", () => {
  const error = new errors.DevFlowError("STATE_REVISION_CONFLICT", "revision mismatch", { currentRevision: 4 });
  const failure = error.toFailure();
  assert.equal(failure.code, "STATE_REVISION_CONFLICT");
  assert.match(failure.userMessage, /当前动作/);
  assert.match(failure.recovery.instruction, /刷新/);
  assert.equal(failure.technical.currentRevision, 4);
  assert.equal(failure.technical.basisChanged, false);
  assert.equal(failure.technical.safeToRefresh, true);
  assert.doesNotMatch(failure.userMessage, /STATE_REVISION_CONFLICT|revision/);
});

test("route and stage presentation never leaks internal route codes as the only label", () => {
  assert.equal(presentation.routeLabel("l"), "L：大型变更（动态治理）");
  assert.equal(presentation.stageLabel("implementation"), "开发实现");
  assert.equal(presentation.lifecycleLabel("paused"), "已暂停");
});
