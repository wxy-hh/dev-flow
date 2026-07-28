# Windows Local Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Windows user explicitly register Dev Flow's per-user native notification identity and then receive non-blocking Toast banners with sound for existing decision and completion events.

**Architecture:** A focused `windows-notifications.ts` module owns Windows-only shortcut registration, registration detection, and Toast creation. `attention.ts` preserves the MCP-first contract and delegates only the local Windows branch; `server.ts` exposes an explicit setup tool with no feature mutation or workflow state. Tests inject platform, filesystem detection, environment and process execution so no test touches a real Windows account.

**Tech Stack:** TypeScript, Node.js `child_process`, Node.js `fs/promises`, PowerShell 5+, Windows Runtime Toast API, COM shortcut property store, Node test runner, esbuild.

## Global Constraints

- Never modify a user's Windows profile unless they explicitly call `dev_flow_enable_windows_notifications`.
- Register only the current user's Start-menu shortcut and fixed AUMID `io.github.wxy_hh.dev_flow`; do not write registry keys or request elevation.
- Always emit MCP `notifications/message` before local OS work, and never let local notification failure affect a workflow tool result.
- Only macOS and an explicitly enabled Windows account may receive local OS alerts; other platforms remain MCP-only.
- `DEV_FLOW_DISABLE_ATTENTION=1`, `CI=true`/`CI=1`, and `NODE_ENV=test` disable every local OS alert.
- Do not stage or commit: the shared working tree contains user-owned pending changes.

---

### Task 1: Implement explicit Windows identity setup and Toast delivery

**Files:**
- Create: `plugins/dev-flow/src/mcp/windows-notifications.ts`
- Modify: `plugins/dev-flow/src/mcp/attention.ts:1-67`
- Test: `tests/unit/windows-notifications.test.mjs`
- Test: `tests/unit/attention.test.mjs`

**Interfaces:**
- Produces: `enableWindowsNotifications(options): Promise<WindowsNotificationSetupResult>`.
- Produces: `emitWindowsToast(title, body, options): Promise<void>`.
- Consumes: injected `{ platform, environment, execute, exists, nodeExecutable }` options in tests; defaults use `process`, `access`, and `execFile` in production.
- Consumed by: `emitAttention(event, options)`, which keeps its existing public signature and adds optional file-existence injection only for tests.

- [x] **Step 1: Write failing Windows unit tests**

Create tests that assert an unsupported platform launches no command, a Windows setup command is Base64 PowerShell and includes the AUMID and shortcut properties, and Toast delivery occurs only when the shortcut exists. Assert an enabled Windows Toast includes `CreateToastNotifier`, the fixed AUMID, XML-escaped text, and `ms-winsoundevent:Notification.Default`.

```js
const result = await windows.enableWindowsNotifications({
  platform: "win32", environment: { APPDATA: "C:\\Users\\A\\AppData\\Roaming" },
  nodeExecutable: "C:\\node.exe", execute: async (file, args) => calls.push({ file, args }),
});
assert.equal(result.status, "enabled");
assert.equal(calls[0].file, "powershell.exe");
assert.match(Buffer.from(calls[0].args.at(-1), "base64").toString("utf16le"), /io\.github\.wxy_hh\.dev_flow/);
```

- [x] **Step 2: Run focused tests to verify failure**

Run: `DEV_FLOW_DISABLE_ATTENTION=1 node --test tests/unit/windows-notifications.test.mjs tests/unit/attention.test.mjs`

Expected: FAIL because `windows-notifications.ts` and Windows attention delegation do not exist.

- [x] **Step 3: Implement `windows-notifications.ts`**

Define `WINDOWS_NOTIFICATION_APP_ID = "io.github.wxy_hh.dev_flow"` and the shortcut path `%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Dev Flow 通知.lnk`. Generate UTF-16LE Base64 PowerShell that compiles in-memory C# COM interop to create/refresh that shortcut, set `System.AppUserModel.ID` and `System.AppUserModel.PreventPinning`, and target the current Node executable with `-e "process.exit(0)"`.

Define `emitWindowsToast` to return without executing unless `platform === "win32"` and the shortcut exists. It must generate a Base64 PowerShell command that loads `Windows.UI.Notifications`, constructs an XML `<toast>` with escaped title/body and one `<audio src="ms-winsoundevent:Notification.Default"/>`, then calls `CreateToastNotifier(WINDOWS_NOTIFICATION_APP_ID).Show(...)`. Catch every process error and return normally.

- [x] **Step 4: Delegate the Windows branch from `attention.ts`**

Keep the existing MCP `emit` call and automated-environment decision first. Retain the macOS `osascript` branch unchanged, and add the Windows branch:

```ts
if (platform === "win32") {
  await emitWindowsToast(title, body, { platform, environment, execute: options.execute, exists: options.exists });
  return;
}
```

The same `localAlertsEnabled` guard must run before either native branch.

- [x] **Step 5: Run focused tests to verify success**

Run: `DEV_FLOW_DISABLE_ATTENTION=1 node --test tests/unit/windows-notifications.test.mjs tests/unit/attention.test.mjs`

Expected: PASS; tests demonstrate MCP notification remains present while the local branch is enabled only under the specified conditions.

### Task 2: Expose an explicit MCP setup action and document it

**Files:**
- Modify: `plugins/dev-flow/src/mcp/server.ts:24-150,300-430`
- Modify: `plugins/dev-flow/README.md:1-120`
- Modify: `tests/unit/mcp-server.test.mjs:60-120`

**Interfaces:**
- Consumes: `enableWindowsNotifications({ nodeExecutable: process.execPath })`.
- Produces: public MCP tool `dev_flow_enable_windows_notifications` with an empty input object and structured setup result.
- Consumed by: a user or host agent that explicitly requests Windows local notifications.

- [x] **Step 1: Extend the MCP tool-list regression test**

Add `dev_flow_enable_windows_notifications` to the expected tool names and make one `tools/call` request in the Linux test runtime. Assert it returns `{ status: "unsupported", platform: process.platform }`, proving the setup operation is safe and feature-independent outside Windows.

- [x] **Step 2: Run the MCP test to verify failure**

Run: `DEV_FLOW_DISABLE_ATTENTION=1 node --test tests/unit/mcp-server.test.mjs`

Expected: FAIL because the public tool is not yet listed or dispatched.

- [x] **Step 3: Add schema, dispatcher case, and user documentation**

Add the zero-input tool schema:

```ts
dev_flow_enable_windows_notifications: {
  description: "Explicitly enable per-user Windows Toast notifications for Dev Flow. Does not change feature state.",
  inputSchema: object([]),
}
```

Dispatch it through `enableWindowsNotifications({ nodeExecutable: process.execPath })`. In the README add a short Windows section: users may ask Dev Flow to enable Windows system notifications; it writes one current-user Start-menu shortcut, never blocks workflow, and can be retried after an update.

- [x] **Step 4: Run the MCP test to verify success**

Run: `DEV_FLOW_DISABLE_ATTENTION=1 node --test tests/unit/mcp-server.test.mjs`

Expected: PASS with the setup tool advertised and unsupported-platform response verified.

### Task 3: Build and verify release artifacts

**Files:**
- Modify: `plugins/dev-flow/dist/mcp-server.mjs` (generated by build)
- Test: all repository test scripts

**Interfaces:**
- Consumes: source and test changes from Tasks 1–2.
- Produces: a deterministic distribution bundle matching source code and manifests.

- [x] **Step 1: Run complete validation**

Run: `npm test && npm run test:host-e2e && git diff --check`

Expected: version checks, build, typecheck, unit tests, route/cross-host E2E, host E2E, and whitespace validation all pass. Test scripts retain `DEV_FLOW_DISABLE_ATTENTION=1`, so no local system banner or sound occurs during validation.

- [x] **Step 2: Inspect intended changed files only**

Run: `git status --short -- plugins/dev-flow/src/mcp/windows-notifications.ts plugins/dev-flow/src/mcp/attention.ts plugins/dev-flow/src/mcp/server.ts plugins/dev-flow/README.md plugins/dev-flow/dist/mcp-server.mjs tests/unit/windows-notifications.test.mjs tests/unit/attention.test.mjs tests/unit/mcp-server.test.mjs docs/plans/2026-07-28-windows-local-notifications-design.md docs/superpowers/plans/2026-07-28-windows-local-notifications.md`

Expected: only the planned source, generated bundle, documentation, and tests appear. Do not stage or commit shared worktree changes.

## Self-Review

- Spec coverage: Task 1 implements opt-in registration, Windows delivery, platform fallback, nonblocking errors, sound, XML safety and test-mode silence. Task 2 makes the setup operation intentionally user-triggered and discoverable. Task 3 confirms build output and all test classes.
- Placeholder scan: all commands, symbols, paths, AUMID, script behavior and expected outcomes are explicit.
- Type consistency: `enableWindowsNotifications` is the sole state-changing OS setup API; `emitWindowsToast` is best-effort and uses the same injected process executor contract as `emitAttention`.
