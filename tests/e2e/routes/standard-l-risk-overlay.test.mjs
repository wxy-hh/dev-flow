import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../../helpers/load-source.mjs";

const route = await loadSource("plugins/dev-flow/src/policy/route.ts");

test("standard L 风险覆盖层不增加专用路线", () => {
  const result = route.selectBaseRoute({
    level: "L", topology: "coordinated-rollback", execution: "standard", requirements: "documented-unconfirmed",
    scopeFacts: ["多个组件需要协调回滚"], topologyFacts: ["共享回滚事务"], uncertaintyFacts: ["验收边界已通过决策台账锁定"],
    riskFacts: { irreversible_consequence: ["失败后无法安全恢复原状态"] }, decisionRefs: ["DEC-rollback"], riskLabels: ["irreversible_consequence"],
  });
  assert.equal(result.route, "standard-l");
  assert.equal(new Set(result.obligations.map((obligation) => obligation.kind)).size, result.obligations.length);
});
