import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";
import { registerTraceFixture, traceDeltaFor } from "../helpers/trace-fixtures.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const reviewStore = await loadSource("plugins/dev-flow/src/core/review-store.ts");
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
    const req = ".dev-flow/features/feature/需求文档.md";
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
    const snapshot = `.dev-flow/features/feature/traceability/snapshots/${"a".repeat(64)}.json`;
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: snapshot } }),
      /^DEV_FLOW_STATE_MUTATION_FORBIDDEN:/,
    );
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: `echo x > ${snapshot}` } }),
      /^DEV_FLOW_STATE_MUTATION_FORBIDDEN:/,
    );
  } finally { await fixture.dispose(); }
});

test("content-addressed review projections are valid state but never host-editable", async () => {
  const fixture = await createTinyApp();
  try {
    const state = await startStandard(fixture.root);
    const projection = `.dev-flow/features/feature/${state.artifacts["plan-review"].path}`;
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: projection } }),
      /DEV_FLOW_STATE_MUTATION_FORBIDDEN/,
    );
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } }),
      /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/,
    );
  } finally { await fixture.dispose(); }
});

test("corrupt current Trace keeps .dev-flow and protected roots fail-closed", async () => {
  const fixture = await createTinyApp();
  try {
    const state = await startStandard(fixture.root);
    await writeFile(path.join(fixture.root, ".dev-flow", "features", "feature", state.traceability.path), "corrupt snapshot\n");
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } }),
      /DEV_FLOW_WORKFLOW_STATE_UNREADABLE/,
    );
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: ".dev-flow/features/feature/需求文档.md" } }),
      /DEV_FLOW_WORKFLOW_STATE_UNREADABLE/,
    );
  } finally { await fixture.dispose(); }
});

test("corrupt current Review snapshot keeps protected writes fail-closed", async () => {
  const fixture = await createTinyApp();
  try {
    let state = await startStandard(fixture.root);
    const pointer = await reviewStore.writeReviewSnapshot(fixture.root, reviewStore.emptyReviewLedger("feature", state.revision + 1));
    state = await store.mutate(fixture.root, "feature", state.revision, "review-pointer-fixture", (draft) => {
      draft.workflowCapabilities = { trace: 1, review: 1, checkpoints: 0, rollbackExecution: 0 };
      draft.review = pointer;
    });
    await writeFile(path.join(fixture.root, ".dev-flow", "features", "feature", state.review.path), "corrupt review snapshot\n");
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } }),
      /DEV_FLOW_WORKFLOW_STATE_UNREADABLE/,
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
        tool_input: { file_path: ".dev-flow/features/feature/需求文档.md" },
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
        tool_input: { command: "echo ok > .dev-flow/features/feature/需求文档.md && echo hi > src/foo.js" },
      }),
      /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/,
    );
    for (const command of [
      "touch .dev-flow/features/feature/需求文档.md src/bypass.js",
      "echo hi | tee .dev-flow/features/feature/需求文档.md src/bypass.js",
      "rm .dev-flow/features/feature/需求文档.md src/bypass.js",
      "mv src/counter.js .dev-flow/features/feature/需求文档.md",
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

test("approval confirmed allows business write on a checkpoints:0 feature but still blocks control files", async () => {
  const fixture = await createTinyApp();
  try {
    let state = await startStandard(fixture.root);
    const file = path.join(fixture.root, ".dev-flow", "features", "feature", "state.json");
    const raw = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));
    raw.workflowCapabilities = { trace: 1, review: 1, checkpoints: 0, rollbackExecution: 0 };
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

test("analyzeBashWriteTargets allows /dev/null and masks heredoc bodies", () => {
  assert.deepEqual(guard.analyzeBashWriteTargets("echo hi > /dev/null"), { kind: "read-only" });
  assert.deepEqual(guard.analyzeBashWriteTargets("npm test > /dev/null 2>&1"), { kind: "read-only" });
  assert.deepEqual(guard.analyzeBashWriteTargets("echo hi > /dev/null > log.txt"), { kind: "resolved", targets: ["log.txt"] });
  assert.deepEqual(
    guard.analyzeBashWriteTargets("cat > scratch/a.ts <<'EOF'\nconst x = a > b;\nEOF"),
    { kind: "resolved", targets: ["scratch/a.ts"] },
  );
  // 未闭合的 heredoc 无法确认正文边界 → fail closed
  assert.equal(guard.analyzeBashWriteTargets("cat > scratch/a.ts <<'EOF'\nconst x = a > b;").kind, "unresolved");
  assert.deepEqual(
    guard.analyzeBashWriteTargets("cat > scratch/a.ts <<-EOF\nconst x = a > b;\n\tEOF"),
    { kind: "resolved", targets: ["scratch/a.ts"] },
  );
  assert.deepEqual(
    guard.analyzeBashWriteTargets("cat <<EOF\nbody > not-a-target\nEOF"),
    { kind: "read-only" },
  );
  assert.deepEqual(
    guard.analyzeBashWriteTargets("printf '%s\\n' 'a <<b' > out.txt\necho x > real.txt"),
    { kind: "resolved", targets: ["out.txt", "real.txt"] },
  );
  assert.deepEqual(
    guard.analyzeBashWriteTargets("echo $((1 << 4)) > out.txt\necho x > real.txt"),
    { kind: "resolved", targets: ["out.txt", "real.txt"] },
  );
  // 非数据消费者（shell/解释器/变量展开）→ 正文可能是代码 → fail closed
  assert.equal(guard.analyzeBashWriteTargets("bash <<'EOF'\necho x > src/pwn\nEOF").kind, "unresolved");
  assert.equal(guard.analyzeBashWriteTargets("sh <<EOF\nmv src/a src/b\nEOF").kind, "unresolved");
  assert.equal(guard.analyzeBashWriteTargets("python <<EOF\nopen('src/pwn','w')\nEOF").kind, "unresolved");
  assert.equal(guard.analyzeBashWriteTargets("cd /tmp && bash <<EOF\necho x > src/pwn\nEOF").kind, "unresolved");
  assert.equal(guard.analyzeBashWriteTargets("$SHELL <<'EOF'\necho x > src/pwn\nEOF").kind, "unresolved");
  // 合法但复杂的 delimiter（引号含空格、反斜杠转义）→ 正确闭合，正文后的真实写命令仍被解析
  assert.deepEqual(
    guard.analyzeBashWriteTargets("cat <<'END MARK'\nbody\nEND MARK\necho x > src/pwn"),
    { kind: "resolved", targets: ["src/pwn"] },
  );
  assert.deepEqual(
    guard.analyzeBashWriteTargets("cat <<E\\OF\nbody\nEOF\necho x > src/pwn"),
    { kind: "resolved", targets: ["src/pwn"] },
  );
  assert.deepEqual(
    guard.analyzeBashWriteTargets("cat <<\"E\\OF\"\nbody\nE\\OF\necho x > src/pwn\nEOF"),
    { kind: "resolved", targets: ["src/pwn"] },
  );
  // 只支持可证明安全且目标可解析的 cat/tee；带输出文件参数的过滤器必须 fail closed。
  assert.equal(guard.analyzeBashWriteTargets("sort -o src/pwn <<'EOF'\nb\na\nEOF").kind, "unresolved");
  assert.equal(guard.analyzeBashWriteTargets("uniq - src/pwn <<'EOF'\na\nEOF").kind, "unresolved");
  assert.equal(guard.analyzeBashWriteTargets("diff --output=src/pwn /dev/null - <<'EOF'\na\nEOF").kind, "unresolved");
  assert.equal(guard.analyzeBashWriteTargets("grep bash <<'EOF'\nbash\nEOF").kind, "unresolved");
  assert.deepEqual(
    guard.analyzeBashWriteTargets("tee src/pwn <<'EOF'\na\nEOF"),
    { kind: "resolved", targets: ["src/pwn"] },
  );
  assert.deepEqual(guard.analyzeBashWriteTargets("/bin/cat <<'EOF'\na\nEOF"), { kind: "read-only" });
  assert.deepEqual(guard.analyzeBashWriteTargets("command cat <<'EOF'\na\nEOF"), { kind: "read-only" });
  assert.equal(guard.analyzeBashWriteTargets("cat <<A <<B\na\nA\nb\nB").kind, "unresolved");
});

test("Bash writes to /dev/null pass the hook while mixed commands stay blocked", async () => {
  const fixture = await createTinyApp();
  try {
    await startStandard(fixture.root);
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "echo hi > /dev/null" } }), undefined);
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "npm test > /dev/null 2>&1" } }), undefined);
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "echo hi > src/foo.js > /dev/null" } }),
      /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/,
    );
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "bash <<'EOF'\necho x > src/pwn\nEOF" } }),
      /DEV_FLOW_WRITE_TARGET_UNRESOLVED/,
    );
    // 复杂 delimiter 正确闭合后，正文之后的真实受保护写入仍被拦截
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "cat <<'END MARK'\nbody\nEND MARK\necho x > src/pwn" } }),
      /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/,
    );
  } finally { await fixture.dispose(); }
});

async function unitGateFeature(root, { fileScope = ["src"], activeUnit = true, checkpoints = 1, confirmed = true } = {}) {
  await store.initProject(root, strictProjectConfig);
  let state = await store.startFeature(root, {
    featureId: "feature", host: "claude", level: "M", topology: "local", execution: "standard", requirements: "provided-confirmed",
  });
  state = await store.mutate(root, "feature", state.revision, "unit-gate-capabilities", (draft) => {
    draft.workflowCapabilities = { trace: 1, review: 0, checkpoints, rollbackExecution: 0 };
  });
  state = await registerTraceFixture({ root, featureId: "feature", state, kind: "requirements" });
  state = await store.mutate(root, "feature", state.revision, "unit-gate-requirements", (draft) => {
    draft.steps.requirements = { status: "satisfied" };
    draft.steps.requirement_confirmation = { status: "satisfied" };
  });
  const planDelta = {
    nodes: traceDeltaFor("implementation-plan", "standard-m").nodes.map((node) => node.kind === "rollback" ? { ...node, fileScope } : node),
  };
  state = await registerTraceFixture({ root, featureId: "feature", state, kind: "implementation-plan", delta: planDelta });
  state = await store.mutate(root, "feature", state.revision, "unit-gate-plan", (draft) => {
    draft.steps.implementation_plan = { status: "satisfied" };
  });
  state = await registerTraceFixture({ root, featureId: "feature", state, kind: "coverage-matrix" });
  state = await store.mutate(root, "feature", state.revision, "unit-gate-coverage", (draft) => {
    draft.steps.coverage_review = { status: "satisfied" };
  });
  return store.mutate(root, "feature", state.revision, "unit-gate-state", (draft) => {
    for (const step of ["rollback_unit", "plan_review", "implementation_approval"]) {
      draft.steps[step] = { status: "satisfied" };
    }
    if (confirmed) draft.humanGates = { implementation_approval: { status: "confirmed" } };
    if (activeUnit) {
      draft.implementationUnits = [{ unitId: "RU-001", status: "active", basisHash: "a".repeat(64), startedFingerprint: "b".repeat(64) }];
    }
  });
}

test("checkpoints:1 hook blocks protected writes until a rollback unit is active", async () => {
  const fixture = await createTinyApp();
  try {
    await unitGateFeature(fixture.root, { activeUnit: false });
    for (const event of [
      { tool_name: "Write", tool_input: { file_path: "src/counter.js" } },
      { tool_name: "Bash", tool_input: { command: "echo x > src/counter.js" } },
    ]) {
      assert.match(await guard.preToolBlockReason(fixture.root, event), /DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED/);
    }
    // Approval takes precedence: without it the classic approval block applies.
    const unapproved = await createTinyApp();
    try {
      await unitGateFeature(unapproved.root, { activeUnit: false, confirmed: false });
      assert.match(
        await guard.preToolBlockReason(unapproved.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } }),
        /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/,
      );
    } finally { await unapproved.dispose(); }
  } finally { await fixture.dispose(); }
});

test("checkpoints:1 hook allows in-scope writes and blocks out-of-scope writes, including glob scopes", async () => {
  const fixture = await createTinyApp();
  try {
    await unitGateFeature(fixture.root, { fileScope: ["src"] });
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } }), undefined);
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "test/counter.test.js" } }),
      /DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE/,
    );
    assert.match(
      await guard.preToolBlockReason(fixture.root, { tool_name: "Bash", tool_input: { command: "echo x > test/other.js" } }),
      /DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE/,
    );
    const outOfScope = await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "test/counter.test.js" } });
    assert.match(outOfScope, /scratch/);
  } finally { await fixture.dispose(); }

  const glob = await createTinyApp();
  try {
    await unitGateFeature(glob.root, { fileScope: ["src/api/**"] });
    assert.equal(await guard.preToolBlockReason(glob.root, { tool_name: "Write", tool_input: { file_path: "src/api/handler.js" } }), undefined);
    assert.equal(await guard.preToolBlockReason(glob.root, { tool_name: "Write", tool_input: { file_path: "src/api/nested/deep.js" } }), undefined);
    assert.match(
      await guard.preToolBlockReason(glob.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } }),
      /DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE/,
    );
  } finally { await glob.dispose(); }
});

test("checkpoints:0 features keep the approval-only write contract", async () => {
  const fixture = await createTinyApp();
  try {
    await unitGateFeature(fixture.root, { activeUnit: false, checkpoints: 0 });
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } }), undefined);
    assert.equal(await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "test/counter.test.js" } }), undefined);
  } finally { await fixture.dispose(); }
});

test("revoked implementation approval explains the plan change in the block reason", async () => {
  const fixture = await createTinyApp();
  try {
    const state = await unitGateFeature(fixture.root);
    // 事件账本追加真实的确认记录，再重登记计划依据 → 批准按设计作废
    const eventsPath = path.join(fixture.root, ".dev-flow", "features", "feature", "events.jsonl");
    const at = new Date().toISOString();
    await writeFile(eventsPath, JSON.stringify({ revision: state.revision + 1, type: "gate-confirmed", at, data: { gate: "implementation_approval" } }) + "\n", { flag: "a" });
    await registerTraceFixture({ root: fixture.root, featureId: "feature", state, kind: "implementation-plan" });
    const reason = await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } });
    assert.match(reason, /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/);
    assert.match(reason, /implementation-plan/);
    assert.match(reason, /作废/);
    assert.match(reason, /scratch/);
  } finally { await fixture.dispose(); }
});

test("never-confirmed features keep the generic approval hint", async () => {
  const fixture = await createTinyApp();
  try {
    const state = await unitGateFeature(fixture.root, { confirmed: false });
    await registerTraceFixture({ root: fixture.root, featureId: "feature", state, kind: "implementation-plan" });
    const reason = await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } });
    assert.match(reason, /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/);
    assert.doesNotMatch(reason, /已在批准后变更/);
    assert.match(reason, /scratch/);
  } finally { await fixture.dispose(); }
});

test("block reasons are user-visible Chinese and /tmp redirects get a project-relative hint", async () => {
  const fixture = await createTinyApp();
  try {
    await startStandard(fixture.root);
    const reason = await guard.preToolBlockReason(fixture.root, { tool_name: "Write", tool_input: { file_path: "src/counter.js" } });
    assert.match(reason, /[一-鿿]/);
    const redirect = await guard.preToolBlockReason(fixture.root, {
      tool_name: "Bash", tool_input: { command: "pnpm vitest run > /tmp/full-vitest.log" },
    });
    assert.match(redirect, /DEV_FLOW_WRITE_TARGET_UNRESOLVED/);
    assert.match(redirect, /vitest\.log/);
  } finally { await fixture.dispose(); }
});
