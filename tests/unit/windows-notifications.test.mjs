import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const windows = await loadSource("plugins/dev-flow/src/mcp/windows-notifications.ts");

const environment = { APPDATA: "C:\\Users\\A\\AppData\\Roaming" };

function decodedPowerShell(args) {
  return Buffer.from(args.at(-1), "base64").toString("utf16le");
}

test("Windows notification setup is explicit and registers the current-user AUMID shortcut", async () => {
  const calls = [];
  const result = await windows.enableWindowsNotifications({
    platform: "win32",
    environment,
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    execute: async (file, args) => { calls.push({ file, args }); },
  });

  assert.deepEqual(result, {
    status: "enabled",
    appId: "io.github.wxy_hh.dev_flow",
    shortcutPath: "C:\\Users\\A\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Dev Flow 通知.lnk",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "powershell.exe");
  assert.ok(calls[0].args.includes("-EncodedCommand"));
  const script = decodedPowerShell(calls[0].args);
  assert.match(script, /io\.github\.wxy_hh\.dev_flow/);
  assert.match(script, /System\.AppUserModel\.ID/);
  assert.match(script, /System\.AppUserModel\.PreventPinning/);
  assert.match(script, /C:\\Program Files\\nodejs\\node\.exe/);
  assert.ok(
    script.indexOf("properties.SetValue(ref PreventPinning") < script.indexOf("properties.SetValue(ref AppUserModelId"),
    "PreventPinning must be registered before AppUserModelId",
  );
});

test("Windows setup does not alter other operating systems", async () => {
  const calls = [];
  const result = await windows.enableWindowsNotifications({
    platform: "darwin",
    environment,
    execute: async (file, args) => { calls.push({ file, args }); },
  });
  assert.deepEqual(result, { status: "unsupported", platform: "darwin" });
  assert.equal(calls.length, 0);
});

test("Windows setup returns an actionable result when registration cannot run", async () => {
  const result = await windows.enableWindowsNotifications({
    platform: "win32",
    environment,
    execute: async () => { throw new Error("PowerShell is unavailable"); },
  });
  assert.equal(result.status, "failed");
  assert.match(result.reason, /PowerShell is unavailable/);
  assert.match(result.recoveryHint, /retry dev_flow_enable_windows_notifications/);
});

test("Windows Toast requires the opted-in shortcut and safely escapes text", async () => {
  const calls = [];
  await windows.emitWindowsToast("A & B", "<feature> \"quoted\"", {
    platform: "win32",
    environment,
    exists: async () => false,
    execute: async (file, args) => { calls.push({ file, args }); },
  });
  assert.equal(calls.length, 0);

  await windows.emitWindowsToast("A & B", "<feature> \"quoted\"", {
    platform: "win32",
    environment,
    exists: async () => true,
    execute: async (file, args) => { calls.push({ file, args }); },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "powershell.exe");
  const script = decodedPowerShell(calls[0].args);
  assert.match(script, /CreateToastNotifier\('io\.github\.wxy_hh\.dev_flow'\)/);
  assert.match(script, /A &amp; B/);
  assert.match(script, /&lt;feature&gt; &quot;quoted&quot;/);
  assert.match(script, /ms-winsoundevent:Notification\.Default/);
});
