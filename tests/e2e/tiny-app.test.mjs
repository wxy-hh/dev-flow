import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const checks = await loadSource("plugins/dev-flow/src/core/feature-check.ts");
const verification = await loadSource("plugins/dev-flow/src/core/verification.ts");

test("light M validates a real fixture through its allowlisted verification command", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    let state = await store.startFeature(fixture.root, { featureId: "counter", host: "claude", level: "M", topology: "local", execution: "light" });
    state = await checks.recordStep(fixture.root, "counter", state.revision, "boundary_plan", { summary: "increment by two" });
    const counter = path.join(fixture.root, "src", "counter.js");
    await writeFile(counter, (await readFile(counter, "utf8")).replace("value + 1", "value + 2"));
    const counterTest = path.join(fixture.root, "test", "counter.test.js");
    await writeFile(counterTest, (await readFile(counterTest, "utf8")).replace("increment(1), 2", "increment(1), 3"));
    state = await checks.recordStep(fixture.root, "counter", state.revision, "implementation", { changed: ["src/counter.js"] });
    state = await checks.recordStep(fixture.root, "counter", state.revision, "code_review", { reviewType: "code" });
    state = await verification.runVerification(fixture.root, "counter", state.revision, "claude");
    state = await checks.finalize(fixture.root, "counter", state.revision);
    assert.equal(state.logicComplete, true);
  } finally { await fixture.dispose(); }
});
