import assert from "node:assert/strict";
import test from "node:test";
import { runRoute } from "../../helpers/route-flow.mjs";

test("standard L closes with a complete Trace pointer and no status artifact", async () => {
  const state = await runRoute({ level: "L", topology: "coordinated-rollback", execution: "standard", requirements: "provided-confirmed" }, "standard-l");
  assert.ok(state.traceability);
  assert.equal(state.artifacts.status, undefined);
  assert.deepEqual(state.traceability.summary, { total: 5, current: 5, stale: 0, tombstoned: 0 });
});
