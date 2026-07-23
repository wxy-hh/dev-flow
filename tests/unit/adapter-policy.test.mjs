import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const guard = await loadSource("plugins/dev-flow/src/hosts/adapter-policy.ts");

async function startStandard(root) {
  await store.initProject(root, strictProjectConfig);
  return store.startFeature(root, {
    featureId: "feature",
    host: "claude",
    level: "M",
    topology: "local",
    execution: "standard",
    requirements: "missing-or-unclear",
  });
}

test("adapter blocks direct and Bash apply_patch before implementation approval", async () => {
  const fixture = await createTinyApp();
  try {
    await startStandard(fixture.root);
    const patch = "*** Begin Patch\n*** Update File: src/counter.js\n@@\n-exports.increment = (value) => value + 1;\n+exports.increment = (value) => value + 2;\n*** End Patch";
    assert.match(await guard.preToolBlockReason(fixture.root, { tool_name: "apply_patch", tool_input: { patch } }), /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED|DEV_FLOW_WRITE_TARGET_UNRESOLVED/);
    assert.match(await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "apply_patch <<'PATCH'\n*** Update File: src/counter.js\nPATCH" } }), /DEV_FLOW_WRITE_TARGET_UNRESOLVED|DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/);
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
    assert.match(await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "git commit -m guarded" } }), /DEV_FLOW_GIT_GUARD/);
  } finally { await fixture.dispose(); }
});

test("heredoc to registered requirements with apps paths is allowed; control files blocked", async () => {
  const fixture = await createTinyApp();
  try {
    let state = await startStandard(fixture.root);
    state = await artifacts.scaffoldArtifact(fixture.root, "feature", state.revision, "requirements");
    const req = ".dev-flow/features/feature/requirements.md";
    const command = `cat > ${req} <<'EOF'\n# Requirements\napps/web/src/foo.tsx\nEOF`;
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command } }), undefined);
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: ".dev-flow/features/feature/state.json" } }),
      /DEV_FLOW_STATE_MUTATION_FORBIDDEN/,
    );
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: ".dev-flow/active.json" } }),
      /DEV_FLOW_STATE_MUTATION_FORBIDDEN/,
    );
  } finally { await fixture.dispose(); }
});

test("unregistered artifact path is blocked", async () => {
  const fixture = await createTinyApp();
  try {
    await startStandard(fixture.root);
    assert.match(
      await guard.preToolBlockReason(fixture.root, {
        tool_name: "Write",
        tool_input: { file_path: ".dev-flow/features/feature/requirements.md" },
      }),
      /DEV_FLOW_ARTIFACT_NOT_REGISTERED/,
    );
  } finally { await fixture.dispose(); }
});

test("protected write blocked; compound bash second target blocked; unresolved expansions blocked", async () => {
  const fixture = await createTinyApp();
  try {
    let state = await startStandard(fixture.root);
    state = await artifacts.scaffoldArtifact(fixture.root, "feature", state.revision, "requirements");
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "echo hi > src/foo.js" } }),
      /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/,
    );
    assert.match(
      await guard.preToolBlockReason(fixture.root, {
        tool_name: "Bash",
        tool_input: { command: "echo ok > .dev-flow/features/feature/requirements.md && echo hi > src/foo.js" },
      }),
      /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/,
    );
    for (const command of [
      "touch .dev-flow/features/feature/requirements.md src/bypass.js",
      "echo hi | tee .dev-flow/features/feature/requirements.md src/bypass.js",
      "rm .dev-flow/features/feature/requirements.md src/bypass.js",
      "mv src/counter.js .dev-flow/features/feature/requirements.md",
    ]) {
      assert.match(
        await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command } }),
        /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/,
        command,
      );
    }
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: 'out=src/x; echo x > "$out"' } }),
      /DEV_FLOW_WRITE_TARGET_UNRESOLVED/,
    );
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "sh -c 'echo x > src/x'" } }),
      /DEV_FLOW_WRITE_TARGET_UNRESOLVED/,
    );
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "rg apps/web" } }), undefined);
  } finally { await fixture.dispose(); }
});

test("corrupt active state fail-closes protected and control writes", async () => {
  const fixture = await createTinyApp();
  try {
    await startStandard(fixture.root);
    await writeFile(path.join(fixture.root, ".dev-flow", "features", "feature", "state.json"), "{not-json");
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } }),
      /DEV_FLOW_WORKFLOW_STATE_UNREADABLE/,
    );
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: ".dev-flow/features/feature/state.json" } }),
      /DEV_FLOW_WORKFLOW_STATE_UNREADABLE/,
    );
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "rg foo" } }), undefined);
  } finally { await fixture.dispose(); }
});

test("corrupt project.json fail-closes all writes", async () => {
  const fixture = await createTinyApp();
  try {
    await startStandard(fixture.root);
    await writeFile(path.join(fixture.root, ".dev-flow", "project.json"), "{bad");
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "README.md" } }),
      /DEV_FLOW_WORKFLOW_STATE_UNREADABLE/,
    );
  } finally { await fixture.dispose(); }
});

test("schema-invalid workflow fails closed for protected writes but preserves safe work", async () => {
  const fixture = await createTinyApp();
  try {
    await startStandard(fixture.root);
    await writeFile(path.join(fixture.root, ".dev-flow", "project.json"), JSON.stringify({ protectedRoots: [] }));
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/bypass.js" } }),
      /DEV_FLOW_WORKFLOW_STATE_UNREADABLE/,
    );

    await store.initProject(fixture.root, strictProjectConfig);
    await writeFile(path.join(fixture.root, ".dev-flow", "features", "feature", "state.json"), JSON.stringify({ artifacts: {} }));
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/bypass.js" } }),
      /DEV_FLOW_WORKFLOW_STATE_UNREADABLE/,
    );
    assert.equal(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "notes.md" } }),
      undefined,
    );
  } finally { await fixture.dispose(); }
});

test("Bash remains unrestricted when no active workflow exists", async () => {
  const fixture = await createTinyApp();
  try {
    assert.equal(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "touch src/normal-dialogue.js" } }),
      undefined,
    );
  } finally { await fixture.dispose(); }
});

test("open recovery journal keeps protected writes fail-closed even after active is cleared", async () => {
  const fixture = await createTinyApp();
  try {
    await startStandard(fixture.root);
    await writeFile(path.join(fixture.root, ".dev-flow", "recovery-transaction.json"), JSON.stringify({
      schemaVersion: 1, transactionId: "journal-test", phase: "active-cleared", featureId: "feature", stateSha256: "digest",
      recoveredTo: path.join(fixture.root, ".dev-flow", "recovered", "feature-journal"), reason: "r", userEvidence: "e", host: "claude", at: new Date().toISOString(),
    }));
    await (await import("node:fs/promises")).rm(path.join(fixture.root, ".dev-flow", "active.json"));
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/bypass.js" } }),
      /DEV_FLOW_WORKFLOW_STATE_UNREADABLE/,
    );
    assert.equal(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "notes.md" } }),
      undefined,
    );
  } finally { await fixture.dispose(); }
});

test("approval confirmed allows business write but still blocks control files", async () => {
  const fixture = await createTinyApp();
  try {
    let state = await startStandard(fixture.root);
    const file = path.join(fixture.root, ".dev-flow", "features", "feature", "state.json");
    const raw = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));
    raw.humanGates = { implementation_approval: { status: "confirmed" } };
    await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } }), undefined);
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: ".dev-flow/active.json" } }),
      /DEV_FLOW_STATE_MUTATION_FORBIDDEN/,
    );
  } finally { await fixture.dispose(); }
});

test("analyzeBashWriteTargets resolves redirects and rejects expansions", () => {
  assert.deepEqual(guard.analyzeBashWriteTargets("echo x > a.txt"), { kind: "resolved", targets: ["a.txt"] });
  assert.equal(guard.analyzeBashWriteTargets("rg foo").kind, "read-only");
  assert.equal(guard.analyzeBashWriteTargets('echo x > "$out"').kind, "unresolved");
});
