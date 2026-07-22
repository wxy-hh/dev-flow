import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const { collectDoctorReport } = await loadSource("plugins/dev-flow/src/mcp/doctor.ts");
const pluginRoot = path.resolve("plugins/dev-flow");

test("doctor reports project, active state, bundles and wiring without mutating state", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.startFeature(fixture.root, { featureId: "feature", host: "claude", level: "XS", topology: "local" });
    const report = await collectDoctorReport(fixture.root, pluginRoot, "1.0.0", ["dev_flow_doctor"]);
    assert.equal(report.project.valid, true);
    assert.deepEqual(report.activeFeature, { present: true, featureId: "feature", valid: true });
    assert.equal(report.mcp.server, "running");
    assert.ok(report.diagnostics.some((item) => item.code === "PLUGIN_WIRING_VALID" && item.status === "ok"));
  } finally { await fixture.dispose(); }
});
