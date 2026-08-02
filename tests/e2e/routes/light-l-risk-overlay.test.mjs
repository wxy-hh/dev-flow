import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../../helpers/load-source.mjs";

const route = await loadSource("plugins/dev-flow/src/policy/route.ts");

test("light L 保留回滚与执行确认覆盖层", () => {
  const result = route.selectBaseRoute({
    level: "L", topology: "multi-chain", execution: "light", scopeFacts: ["多个调用链"], topologyFacts: ["跨链变更"], uncertaintyFacts: [],
    riskFacts: { availability: ["失败需要恢复与可观测性验证"] }, decisionRefs: [], riskLabels: ["availability"],
  });
  assert.equal(result.route, "light-l");
  assert.ok(result.obligations.some((obligation) => obligation.kind === "rollback"));
  assert.ok(result.obligations.some((obligation) => obligation.kind === "approval"));
});
