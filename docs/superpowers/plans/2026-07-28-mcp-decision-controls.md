# MCP Decision Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace phrase-only gate and grill responses with native MCP structured selections, while retaining a secure one-time text-token fallback.

**Architecture:** The MCP server becomes a bidirectional JSON-RPC dispatcher that records client elicitation capability during initialization and can await an `elicitation/create` response nested in a tool call. A core interaction module owns issued action IDs, fallback tokens, response provenance, and audit events; gates use it directly and the requirements skill uses it to collect grill answers.

**Tech Stack:** Node.js 20, TypeScript, stdio JSON-RPC/MCP, Node test runner, esbuild.

## Global Constraints

- Native controls are capability-gated; no client is assumed to render a literal button.
- Approval is only an explicit `confirm` action; arbitrary text and feedback can never approve a gate.
- A change request requires non-empty free-text feedback; cancel does not mutate workflow state.
- Existing `dev_flow_confirm_gate` phrase/provenance behavior remains compatible for existing clients.
- New code is dual-host and does not modify unrelated workflow, artifact, or Git-snapshot behavior.

---

### Task 1: Connection-level MCP elicitation transport

**Files:**
- Modify: `plugins/dev-flow/src/mcp/server.ts`
- Test: `tests/unit/mcp-server.test.mjs`

**Interfaces:**
- Produces `McpConnection.elicitForm(params): Promise<ElicitResult | undefined>`.
- Consumes the `initialize.params.capabilities.elicitation` declaration and only sends `elicitation/create` when form mode is supported.

- [ ] **Step 1: Add a streaming test that advertises elicitation, invokes a tool, receives the server request, and writes its matching response.**

```js
assert.equal(request.method, "elicitation/create");
child.stdin.write(JSON.stringify({
  jsonrpc: "2.0", id: request.id,
  result: { action: "accept", content: { action: "confirm" } },
}) + "\n");
```

- [ ] **Step 2: Replace the sequential `for await` request loop with a line dispatcher and a pending outgoing-request map.**

```ts
const pendingClientRequests = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
function sendClientRequest(method: string, params: unknown): Promise<unknown> {
  const id = `dev-flow-${++nextClientRequestId}`;
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => pendingClientRequests.set(id, { resolve, reject }));
}
```

- [ ] **Step 3: Parse and retain the form-mode capability from `initialize`; reject no request, but return `undefined` from `elicitForm` when unsupported.**

```ts
const formElicitationSupported = capabilities?.elicitation
  && (Object.keys(capabilities.elicitation).length === 0 || capabilities.elicitation.form !== undefined);
```

- [ ] **Step 4: Run `node --test tests/unit/mcp-server.test.mjs` and confirm both legacy request batching and nested elicitation pass.**

### Task 2: Auditable interaction state and secure fallback parser

**Files:**
- Create: `plugins/dev-flow/src/core/user-interactions.ts`
- Modify: `plugins/dev-flow/src/core/state-store.ts`
- Modify: `plugins/dev-flow/src/core/status.ts`
- Test: `tests/unit/user-interactions.test.mjs`

**Interfaces:**
- Produces `createInteraction`, `resolveNativeInteraction`, and `resolveTokenInteraction`.
- Persists `{ interactionId, kind, basisHash, options, fallbackToken, status, response? }` under the pending gate or grill interaction.

- [ ] **Step 1: Test that a generated token is unique, binds one feature/gate/question/options hash, cannot be replayed, and cannot resolve after its basis changes.**

```js
await assert.rejects(
  () => interactions.resolveTokenInteraction(root, "f", state.revision, { token, reply: "anything else", promptEventId: "p1" }),
  (error) => error.code === "INTERACTION_TOKEN_MISMATCH",
);
```

- [ ] **Step 2: Define the stable action contract.**

```ts
export type InteractionAction = "confirm" | "request-changes" | "other" | string;
export interface InteractionOption { id: string; label: string; description?: string; requiresComment?: boolean; }
export interface InteractionResponse { action: InteractionAction; comment?: string; source: "elicitation" | "text-token"; }
```

- [ ] **Step 3: Issue a cryptographically random interaction ID and fallback token, record presentation/resolution events, and validate the exact current token before accepting a host-event reply.**

```ts
const fallbackReply = `${interaction.fallbackToken} ${actionId}${comment ? ` ${comment}` : ""}`;
if (action.requiresComment && !comment?.trim()) throw new DevFlowError("INTERACTION_COMMENT_REQUIRED", action.id);
```

- [ ] **Step 4: Extend progress waits with interaction metadata only while unresolved; expose a human-readable fallback instruction but never the raw approval whitelist as the primary path.**

- [ ] **Step 5: Run `node --test tests/unit/user-interactions.test.mjs tests/unit/status-progress.test.mjs`.**

### Task 3: Gate controls, feedback, and legacy compatibility

**Files:**
- Modify: `plugins/dev-flow/src/core/human-gates.ts`
- Modify: `plugins/dev-flow/src/core/gate-approval.ts`
- Modify: `plugins/dev-flow/src/mcp/server.ts`
- Modify: `plugins/dev-flow/skills/requirements/SKILL.md`
- Modify: `plugins/dev-flow/skills/plan/SKILL.md`
- Modify: `plugins/dev-flow/skills/plan-review/SKILL.md`
- Test: `tests/unit/human-gates.test.mjs`
- Test: `tests/e2e/native-cross-host.test.mjs`

**Interfaces:**
- `dev_flow_present_gate` returns a resolved confirmation, returned-for-changes state, cancel state, or pending token fallback.
- Gate control schema: `confirm` labelled `确认需求`/`确认执行`; `request-changes` labelled `提出修改意见` with required comment.

- [ ] **Step 1: Add failing tests for native confirmation, mandatory change feedback, cancellation, fallback confirmation, replay rejection, and unchanged legacy exact phrase confirmation.**

```js
assert.equal(state.humanGates.requirement_confirmation.confirmation.source, "elicitation");
assert.equal(state.humanGates.requirement_confirmation.lastResponse.action, "request-changes");
await assert.rejects(() => resolve({ action: "request-changes" }), /INTERACTION_COMMENT_REQUIRED/);
```

- [ ] **Step 2: Have `presentGate` create a two-action interaction after the gate presentation is committed; native `confirm` is accepted as direct user provenance and `request-changes` records feedback without satisfying the step.**

```ts
const options = [
  { id: "confirm", label: gate === "requirement_confirmation" ? "确认需求" : "确认执行" },
  { id: "request-changes", label: "提出修改意见", requiresComment: true },
];
```

- [ ] **Step 3: Preserve the old `confirmGate(userReply, promptEventId)` path unchanged for legacy hosts; route only a matching one-time fallback token through the new interaction resolver.**

- [ ] **Step 4: Update gate-stop instructions: a resolved confirmation may proceed; a change request must update the supplied artifacts and re-present the invalidated gate; cancel/token fallback must stop.**

- [ ] **Step 5: Run `node --test tests/unit/human-gates.test.mjs tests/e2e/native-cross-host.test.mjs`.**

### Task 4: Grill option collection

**Files:**
- Modify: `plugins/dev-flow/src/core/requirements-grill.ts`
- Modify: `plugins/dev-flow/src/mcp/server.ts`
- Modify: `plugins/dev-flow/skills/grillme/SKILL.md`
- Modify: `plugins/dev-flow/skills/requirements/SKILL.md`
- Test: `tests/unit/requirements-grill.test.mjs`
- Test: `tests/unit/mcp-server.test.mjs`

**Interfaces:**
- Adds `dev_flow_request_grill_decision(featureId, expectedRevision, questionId, question, options)` and `dev_flow_resolve_grill_decision(featureId, expectedRevision, userReply, promptEventId?)`.
- Options are stable IDs; an `other` choice requires a comment and is returned to the agent to write into the existing Decision Log.

- [ ] **Step 1: Test native option selection, required `other` text, token fallback with an exact later user event, stale question rejection, and single-use resolution.**

```js
const result = await grill.resolveNative(root, "f", state.revision, interactionId, { action: "other", comment: "支持离线同步" });
assert.deepEqual(result.response, { action: "other", comment: "支持离线同步", source: "elicitation" });
```

- [ ] **Step 2: Permit only the two dedicated decision tools while a grill question is outstanding; verify its `questionId` against the recorded requirements front matter before issuing or resolving an interaction.**

- [ ] **Step 3: Change skill flow so grillme writes the question/options, requirements records the artifact, requests/resolves the interaction, then grillme writes the selected option and free-text comment to `Decision Log`.**

- [ ] **Step 4: Run `node --test tests/unit/requirements-grill.test.mjs tests/unit/mcp-server.test.mjs`.**

### Task 5: Release build and full regression

**Files:**
- Modify: `package.json`
- Modify: `plugins/dev-flow/.codex-plugin/plugin.json`
- Modify: `plugins/dev-flow/.claude-plugin/plugin.json`
- Regenerate: `plugins/dev-flow/dist/*`

- [ ] **Step 1: Bump the plugin version from `1.5.0` to `1.6.0` and synchronize manifests.**

```bash
npm run version:sync
```

- [ ] **Step 2: Build the distributable MCP server and hooks.**

```bash
npm run build
```

- [ ] **Step 3: Run all checks and the host integration suite.**

```bash
npm test
npm run test:host-e2e
git diff --check
```

- [ ] **Step 4: Confirm only the planned interaction, version, generated-dist, test, and plan files changed; preserve the pre-existing untracked retrospective export.**
