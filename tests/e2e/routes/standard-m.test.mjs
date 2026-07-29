import assert from "node:assert/strict";
import test from "node:test";
import { runRoute } from "../../helpers/route-flow.mjs";

test("standard M closes with a complete Trace pointer", async () => {
  const state = await runRoute({ level: "M", topology: "local", execution: "standard", requirements: "missing-or-unclear" }, "standard-m");
  assert.ok(state.traceability);
  assert.deepEqual(state.traceability.summary, { total: 5, current: 5, stale: 0, tombstoned: 0 });
});
