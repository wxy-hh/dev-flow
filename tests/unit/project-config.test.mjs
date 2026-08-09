import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const { validateProjectConfig } = await loadSource("plugins/dev-flow/src/core/project-config.ts");
const valid = { schemaVersion: 2, verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: ".", provides: ["targeted", "behavior", "integration", "full"] }] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, governedRoots: ["src", "test"] };

test("accepts strict v1 project configuration", () => assert.doesNotThrow(() => validateProjectConfig(valid)));
test("rejects invalid project configuration", () => {
  assert.throws(() => validateProjectConfig({ ...valid, enforcement: { ...valid.enforcement, mode: "advisory" } }), /INVALID_PROJECT_CONFIG/);
  assert.throws(() => validateProjectConfig({ ...valid, governedRoots: ["../src"] }), /INVALID_PROJECT_CONFIG/);
  assert.throws(() => validateProjectConfig({ ...valid, verification: { ...valid.verification, commands: [{ ...valid.verification.commands[0], cwd: "/tmp" }] } }), /INVALID_PROJECT_CONFIG/);
});

test("canonicalizes decomposed Unicode in protected roots", () => {
  const config = structuredClone(valid);
  config.governedRoots = ["src/需求a\u0301"];
  assert.doesNotThrow(() => validateProjectConfig(config));
  assert.deepEqual(config.governedRoots, ["src/需求á"]);
});

test("validates preflight command references and governed-root excludes", () => {
  const config = structuredClone(valid);
  config.verification.commands.push({ id: "preflight", command: "node", args: ["-e", "process.exit(0)"], cwd: ".", provides: ["targeted"] });
  config.verification.preflightCommands = ["preflight", "preflight"];
  config.governedRootsExclude = ["src/generated/**"];
  assert.doesNotThrow(() => validateProjectConfig(config));
  assert.deepEqual(config.verification.preflightCommands, ["preflight"]);
  assert.throws(() => validateProjectConfig({ ...valid, verification: { ...valid.verification, preflightCommands: ["missing"] } }), /INVALID_PROJECT_CONFIG/);
  assert.throws(() => validateProjectConfig({ ...valid, governedRootsExclude: ["../generated"] }), /INVALID_PROJECT_CONFIG/);
});

test("preflight-only configurations cannot satisfy the targeted guarantee", () => {
  const config = structuredClone(valid);
  config.verification.preflightCommands = ["unit"];
  assert.throws(() => validateProjectConfig(config), (error) => error.code === "VERIFICATION_GUARANTEE_UNCONFIGURED");
});

test("allows the repository root as a governed root while keeping control paths excluded", () => {
  const config = structuredClone(valid);
  config.governedRoots = ["."];
  assert.doesNotThrow(() => validateProjectConfig(config));
  assert.deepEqual(config.governedRoots, ["."]);
});
