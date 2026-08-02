import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../../helpers/load-source.mjs";

const route = await loadSource("plugins/dev-flow/src/policy/route.ts");

test("standard M 合并路线确认与风险义务", () => {
  const result = route.selectBaseRoute({
    level: "M", topology: "shared-contract", execution: "standard", requirements: "provided-confirmed",
    scopeFacts: ["共享接口与实现均在范围内"], topologyFacts: ["共享契约会影响两个调用方"], uncertaintyFacts: [],
    riskFacts: { security: ["权限边界会改变"] }, decisionRefs: [], riskLabels: ["security"],
  });
  assert.equal(result.route, "standard-m");
  assert.equal(result.obligations.filter((obligation) => obligation.kind === "approval").length, 1);
});
