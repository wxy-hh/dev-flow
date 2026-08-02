import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "../helpers/load-source.mjs";

const drift = await loadSource("plugins/dev-flow/src/core/drift-analysis.ts");
const repair = await loadSource("plugins/dev-flow/src/core/repair-loop.ts");

test("drift analysis distinguishes equivalent, planned, and material changes", () => {
  assert.equal(drift.analyzeDrift({ anticipatedFiles: ["src/a.ts"], actualFiles: ["src/a.ts"] }).recommendation, "continue");
  assert.equal(drift.analyzeDrift({ anticipatedFiles: ["src/a.ts"], actualFiles: ["src/a.ts", "src/b.ts"] }).recommendation, "revise-plan");
  assert.equal(drift.analyzeDrift({ anticipatedFiles: ["src/a.ts"], actualFiles: ["src/a.ts"], touchesSharedContract: true }).recommendation, "reclassify");
});

test("repair loop keeps failures and stops only on no progress or the cap", () => {
  let state = repair.startRepairLoop(3);
  state = repair.recordRepairAttempt(state, "E1", ["try-1"]);
  assert.equal(state.status, "active");
  state = repair.recordRepairAttempt(state, "E1", ["try-1"]);
  assert.equal(state.status, "waiting-user");
  assert.equal(state.attempts.length, 2);
});

