import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const { validateProjectConfig } = await loadSource("plugins/dev-flow/src/core/project-config.ts");
const valid = { schemaVersion: 1, verification: { commands: [{ id: "unit", command: "node", args: ["--test"], cwd: "." }], behaviorCommands: [] }, enforcement: { mode: "strict", gitWriteRequiresLogicComplete: true, oneActiveFeature: true, requireExplicitHumanReply: true }, protectedRoots: ["src", "test"] };

test("accepts strict v1 project configuration", () => assert.doesNotThrow(() => validateProjectConfig(valid)));
test("rejects invalid project configuration", () => {
  assert.throws(() => validateProjectConfig({ ...valid, enforcement: { ...valid.enforcement, mode: "advisory" } }), /INVALID_PROJECT_CONFIG/);
  assert.throws(() => validateProjectConfig({ ...valid, protectedRoots: ["../src"] }), /INVALID_PROJECT_CONFIG/);
  assert.throws(() => validateProjectConfig({ ...valid, verification: { ...valid.verification, commands: [{ ...valid.verification.commands[0], cwd: "/tmp" }] } }), /INVALID_PROJECT_CONFIG/);
});
