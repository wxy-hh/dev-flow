import assert from "node:assert/strict";
import test from "node:test";
import { runRoute } from "../../helpers/route-flow.mjs";

test("light L acceptance assistance remains non-blocking and finalizes with a delivery snapshot", async () => {
  const state = await runRoute(
  { level: "L", topology: "multi-chain", execution: "light", manualAcceptanceRequired: true },
  "light-l",
  { gitBaseline: true, implementationFiles: { "src/feature.js": "export const delivered = true;\n" }, expectSnapshot: true },
  );
  assert.equal(state.classification.acceptanceAssistSuggested, true);
});
