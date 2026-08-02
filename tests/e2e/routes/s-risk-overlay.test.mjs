import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../../helpers/load-source.mjs";

const route = await loadSource("plugins/dev-flow/src/policy/route.ts");

test("S 风险覆盖层保留 S 基础路线", () => {
  const result = route.selectBaseRoute({
    level: "S", topology: "local", scopeFacts: ["局部行为"], topologyFacts: ["无共享契约"], uncertaintyFacts: [],
    riskFacts: { data: ["写入数据需要完整性验证"] }, decisionRefs: [], riskLabels: ["data"],
  });
  assert.equal(result.route, "s");
  assert.ok(result.obligations.some((obligation) => obligation.kind === "verification"));
});
