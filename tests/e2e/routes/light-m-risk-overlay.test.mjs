import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../../helpers/load-source.mjs";

const route = await loadSource("plugins/dev-flow/src/policy/route.ts");

test("light M 风险覆盖层不升级基础路线", () => {
  const result = route.selectBaseRoute({
    level: "M", topology: "local", execution: "light", scopeFacts: ["局部模块"], topologyFacts: ["无共享契约"], uncertaintyFacts: [],
    riskFacts: { external: ["下游契约失败需要集成验证"] }, decisionRefs: [], riskLabels: ["external"],
  });
  assert.equal(result.route, "light-m");
  assert.ok(result.obligations.some((obligation) => obligation.kind === "review"));
});
