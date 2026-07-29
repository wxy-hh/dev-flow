import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createTinyApp,
  strictProjectConfig,
} from "../helpers/fixture-repo.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const artifacts = await loadSource("plugins/dev-flow/src/core/artifacts.ts");
const anchors = await loadSource(
  "plugins/dev-flow/src/core/traceability-anchors.ts",
);
const templates = await loadSource("plugins/dev-flow/src/core/artifact-templates.ts");

test("standard M scaffold comes from the runtime renderer", async (t) => {
  const fixture = await createTinyApp();
  t.after(fixture.dispose);
  const { root } = fixture;
  await store.initProject(root, strictProjectConfig);
  let state = await store.startFeature(root, {
    featureId: "m",
    level: "M",
    topology: "local",
    execution: "standard",
    requirements: "provided-confirmed",
    host: "codex",
  });
  state = await artifacts.scaffoldArtifact(root, "m", state.revision, "requirements");
  const text = await readFile(
    path.join(root, ".dev-flow/features/m/需求文档.md"),
    "utf8",
  );
  assert.match(text, /dev-flow:id=REQ-001 kind=requirement/);
  assert.match(text, /dev-flow:id=AC-001 kind=acceptance-criterion/);
});

test("anchor parser hashes exact adjacent blocks and rejects duplicate ids", () => {
  const blocks = anchors.parseTraceSourceBlocks([
    "<!-- dev-flow:id=REQ-001 kind=requirement -->",
    "### first",
    "<!-- dev-flow:id=AC-001 kind=acceptance-criterion -->",
    "### second",
  ].join("\n"));
  assert.deepEqual(blocks.map(({ id, kind }) => ({ id, kind })), [
    { id: "REQ-001", kind: "requirement" },
    { id: "AC-001", kind: "acceptance-criterion" },
  ]);
  const changed = anchors.parseTraceSourceBlocks([
    "<!-- dev-flow:id=REQ-001 kind=requirement -->",
    "### first edited",
    "<!-- dev-flow:id=AC-001 kind=acceptance-criterion -->",
    "### second",
  ].join("\n"));
  assert.notEqual(changed[0].sourceBlockSha256, blocks[0].sourceBlockSha256);
  assert.equal(changed[1].sourceBlockSha256, blocks[1].sourceBlockSha256);
  assert.throws(
    () => anchors.parseTraceSourceBlocks(
      "<!-- dev-flow:id=REQ-001 kind=requirement -->\n"
      + "<!-- dev-flow:id=REQ-001 kind=requirement -->\n",
    ),
    /TRACE_SOURCE_ANCHOR_INVALID/,
  );
  assert.throws(() => anchors.parseTraceSourceBlocks("# no declarations\n"), /TRACE_SOURCE_ANCHOR_INVALID/);
  assert.throws(
    () => anchors.parseTraceSourceBlocks("<!-- dev-flow:id=REQ-001 kind=task -->\n"),
    /TRACE_SOURCE_ANCHOR_INVALID/,
  );
});

test("runtime templates declare the route-specific Trace source blocks", () => {
  const standardM = { featureId: "m", route: "standard-m", requirementsState: "provided-confirmed" };
  const standardL = { featureId: "l", route: "standard-l", requirementsState: "provided-confirmed" };
  assert.deepEqual(
    anchors.parseTraceSourceBlocks(templates.renderArtifactTemplate(standardM, "implementation-plan"))
      .map(({ id }) => id),
    ["TASK-001", "RU-001"],
  );
  assert.deepEqual(
    anchors.parseTraceSourceBlocks(templates.renderArtifactTemplate(standardL, "implementation-plan"))
      .map(({ id }) => id),
    ["TASK-001"],
  );
  assert.deepEqual(
    anchors.parseTraceSourceBlocks(templates.renderArtifactTemplate(standardM, "coverage-matrix"))
      .map(({ id }) => id),
    ["TEST-001"],
  );
  assert.deepEqual(
    anchors.parseTraceSourceBlocks(templates.renderArtifactTemplate(standardL, "rollback-units"))
      .map(({ id }) => id),
    ["RU-001"],
  );
});

test("generated artifacts use the effective route contract", async (t) => {
  const fixture = await createTinyApp();
  t.after(fixture.dispose);
  const { root } = fixture;
  await store.initProject(root, strictProjectConfig);

  let standard = await store.startFeature(root, {
    featureId: "standard",
    level: "M",
    topology: "local",
    execution: "standard",
    requirements: "provided-confirmed",
    host: "codex",
  });
  standard = await store.mutate(root, "standard", standard.revision, "test-ready-for-status", (draft) => {
    draft.steps = Object.fromEntries([
      "requirements",
      "requirement_confirmation",
      "implementation_plan",
      "coverage_review",
      "rollback_unit",
      "plan_review",
    ].map((step) => [step, { status: "satisfied" }]));
  });
  standard = await artifacts.scaffoldArtifact(root, "standard", standard.revision, "status");
  const initialHash = standard.artifacts.status.sha256;
  standard = await store.mutate(root, "standard", standard.revision, "test-status-refresh", () => {});
  assert.notEqual(standard.artifacts.status.sha256, initialHash);
  await assert.rejects(
    () => artifacts.recordArtifact(root, "standard", standard.revision, "status"),
    /GENERATED_ARTIFACT_READ_ONLY/,
  );

  let risk = await store.startFeature(root, {
    featureId: "risk",
    activation: "paused",
    level: "M",
    topology: "local",
    execution: "light",
    riskLabels: ["money"],
    host: "codex",
  });
  risk = await store.mutate(root, "risk", risk.revision, "test-ready-for-risk-status", (draft) => {
    draft.steps.risk_review = { status: "satisfied" };
  });
  await store.switchActive(root, "standard", "risk", "test-risk-status");
  risk = await store.readState(root, "risk");
  risk = await artifacts.scaffoldArtifact(root, "risk", risk.revision, "status");
  assert.ok(risk.artifacts.status.sha256);

  await store.startFeature(root, {
    featureId: "l",
    activation: "paused",
    level: "L",
    topology: "multi-chain",
    execution: "standard",
    requirements: "provided-confirmed",
    host: "codex",
  });
  await store.switchActive(root, "risk", "l", "test-standard-l-status");
  const activeStandardL = await store.readState(root, "l");
  await assert.rejects(
    () => artifacts.scaffoldArtifact(root, "l", activeStandardL.revision, "status"),
    /ARTIFACT_NOT_REQUIRED/,
  );
});
