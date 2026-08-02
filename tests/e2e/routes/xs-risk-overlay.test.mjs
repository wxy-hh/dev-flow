import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../../helpers/load-source.mjs";

const route = await loadSource("plugins/dev-flow/src/policy/route.ts");

test("XS 风险覆盖层不创建第二条路线", () => {
  const result = route.selectBaseRoute({
    level: "XS", topology: "local", scopeFacts: ["只改一个本地文件"], topologyFacts: ["无共享契约"], uncertaintyFacts: [],
    riskFacts: { security: ["认证边界会改变"] }, decisionRefs: [], riskLabels: ["security"],
  });
  assert.equal(result.route, "xs");
  assert.ok(result.obligations.some((obligation) => obligation.kind === "approval"));
});
