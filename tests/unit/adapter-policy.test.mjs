import assert from "node:assert/strict";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const guard = await loadSource("plugins/dev-flow/src/hosts/adapter-policy.ts");

test("adapter blocks direct and Bash apply_patch before implementation approval", async () => {
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.startFeature(fixture.root, { featureId: "feature", host: "codex", level: "L", topology: "multi-chain", execution: "light" });
    const patch = "*** Begin Patch\n*** Update File: src/counter.js\n@@\n-exports.increment = (value) => value + 1;\n+exports.increment = (value) => value + 2;\n*** End Patch";
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "apply_patch", tool_input: { patch } }), "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED");
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "apply_patch <<'PATCH'\n*** Update File: src/counter.js\nPATCH" } }), "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED");
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Edit", tool_input: { file_path: "README.md" } }), undefined);
  } finally { await fixture.dispose(); }
});

test("adapter ignores tools that cannot write and preserves Git guard", async () => {
  assert.equal(guard.isRelevantPreToolUse({ tool_name: "Read" }), false);
  assert.equal(guard.isRelevantPreToolUse({ tool_name: "WebSearch" }), false);
  const fixture = await createTinyApp();
  try {
    await store.initProject(fixture.root, strictProjectConfig);
    await store.startFeature(fixture.root, { featureId: "feature", host: "claude", level: "XS", topology: "local" });
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "git commit -m guarded" } }), "DEV_FLOW_GIT_GUARD");
  } finally { await fixture.dispose(); }
});
