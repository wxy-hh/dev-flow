import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const warnings = await loadSource("plugins/dev-flow/src/policy/rollback-warnings.ts");

test("implementation-unit split warning is based only on fileScope and dependsOn", () => {
  const result = warnings.detectRollbackSplitWarning([
    { kind: "implementation-unit", id: "UNIT-001", status: "current", fileScope: ["tests/**"] , dependsOn: [] },
    { kind: "implementation-unit", id: "UNIT-002", status: "current", fileScope: ["src/**"], dependsOn: ["UNIT-001"] },
  ]);

  assert.equal(result.length, 1);
  assert.match(result[0], /测试与实现拆为不同实现单元/);
});

test("mixed test and implementation scopes do not warn", () => {
  assert.deepEqual(warnings.detectRollbackSplitWarning([
    { kind: "implementation-unit", id: "UNIT-001", status: "current", fileScope: ["tests/**", "src/**"], dependsOn: [] },
    { kind: "implementation-unit", id: "UNIT-002", status: "current", fileScope: ["src/**"], dependsOn: ["UNIT-001"] },
  ]), []);
});
