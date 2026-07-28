import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const attention = await loadSource("plugins/dev-flow/src/mcp/attention.ts");

test("attention emits the MCP message and uses one best-effort macOS notification", async () => {
  const emitted = [];
  const executed = [];
  await attention.emitAttention(
    { kind: "decision-required", featureId: "checkout", decision: "implementation_approval" },
    {
      platform: "darwin",
      environment: {},
      emit: (message) => emitted.push(message),
      execute: async (file, args) => { executed.push({ file, args }); },
    },
  );
  assert.deepEqual(emitted, [{
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level: "info", data: { kind: "decision-required", featureId: "checkout", decision: "implementation_approval" } },
  }]);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].file, "osascript");
  assert.match(executed[0].args[1], /确认执行/);
  assert.match(executed[0].args[1], /sound name "Glass"/);
});

test("attention suppresses local failures without suppressing the MCP notification", async () => {
  const emitted = [];
  await assert.doesNotReject(() => attention.emitAttention(
    { kind: "workflow-finalized", featureId: "checkout" },
    {
      platform: "darwin",
      environment: {},
      emit: (message) => emitted.push(message),
      execute: async () => { throw new Error("notification service unavailable"); },
    },
  ));
  assert.equal(emitted[0].method, "notifications/message");
});

test("attention stays protocol-visible but locally silent in an automated environment", async () => {
  for (const environment of [{ NODE_ENV: "test" }, { CI: "true" }]) {
    const emitted = [];
    const executed = [];
    await attention.emitAttention(
      { kind: "workflow-finalized", featureId: "checkout" },
      {
        platform: "darwin",
        environment,
        emit: (message) => emitted.push(message),
        execute: async () => { executed.push(true); },
      },
    );
    assert.equal(emitted[0].method, "notifications/message");
    assert.equal(executed.length, 0);
  }
});

test("attention keeps the MCP event and delegates an opted-in Windows Toast", async () => {
  const emitted = [];
  const executed = [];
  await attention.emitAttention(
    { kind: "workflow-finalized", featureId: "checkout" },
    {
      platform: "win32",
      environment: { APPDATA: "C:\\Users\\A\\AppData\\Roaming" },
      exists: async () => true,
      emit: (message) => emitted.push(message),
      execute: async (file, args) => { executed.push({ file, args }); },
    },
  );
  assert.equal(emitted[0].method, "notifications/message");
  assert.equal(executed[0].file, "powershell.exe");
  assert.match(Buffer.from(executed[0].args.at(-1), "base64").toString("utf16le"), /CreateToastNotifier/);
});

test("attention transport failures never reject the workflow caller", async () => {
  await assert.doesNotReject(() => attention.emitAttention(
    { kind: "workflow-finalized", featureId: "checkout" },
    { platform: "linux", emit: () => { throw new Error("client stream closed"); } },
  ));
});
