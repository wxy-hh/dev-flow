# Dev Flow Friendly Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make gate/grill interactions reliable and visible while keeping browser assistance and user acceptance optional, so routes always progress from code review through automated verification, feature check, and finalize without waiting for an optional reply.

**Architecture:** Core retains strict human gates and machine verification, but gate dependencies move to one shared map. The MCP boundary normalizes gate/grill results. Browser/user acceptance becomes optional audit evidence plus an advisory classification flag. A non-blocking attention sink emits MCP notifications and, on macOS, one local sound notification.

**Tech Stack:** Node.js 20, TypeScript, stdio JSON-RPC/MCP, Node test runner, esbuild, macOS osascript.

> **实施记录（2026-07-28）：** 已完成 1.7.0 实现；`npm test`、`npm run test:host-e2e` 与 `git diff --check` 均已通过。macOS 横幅/提示音采用 best-effort，实际显示受本机通知权限控制。

## Global Constraints

- Do not add a route step, lifecycle, gate, or finalize condition for browser assistance or user signoff.
- Keep manualAcceptanceRequired only as a legacy classify/start input; all newly created state writes acceptanceAssistSuggested.
- Keep money-risk behaviorCommands mandatory; optional browser or user evidence cannot replace a missing configured command.
- Native gate/grill elicitation may wait for a user; do not add a wall-clock timeout.
- Attention is advisory: it cannot mutate state, wait for input, change revision, or fail a workflow action.
- Preserve dev_flow_confirm_gate, Chinese artifact names, delivery snapshot behavior, and unrelated worktree changes.
- Release version is 1.7.0 in package, manifests, and dist.

---

### Task 1: Make acceptance assistance non-blocking

**Files:**

- Modify: plugins/dev-flow/src/policy/types.ts
- Modify: plugins/dev-flow/src/policy/validation.ts
- Modify: plugins/dev-flow/src/core/verification.ts
- Modify: plugins/dev-flow/src/core/status.ts
- Modify: plugins/dev-flow/src/mcp/server.ts
- Modify: plugins/dev-flow/skills/task/SKILL.md
- Modify: plugins/dev-flow/skills/verify/SKILL.md
- Modify: plugins/dev-flow/skills/finish/SKILL.md
- Test: tests/unit/feature-check.test.mjs
- Test: tests/unit/mcp-server.test.mjs
- Test: tests/unit/status-progress.test.mjs
- Test helper: tests/helpers/route-flow.mjs

**Interfaces:**

- Consumes legacy ClassificationInput.manualAcceptanceRequired?: boolean.
- Produces Classification.acceptanceAssistSuggested: boolean and optional progress.acceptanceAssist.
- Keeps ManualAcceptance optional audit evidence; its absence cannot prevent a successful machine verification.

- [ ] **Step 1: Write failing compatibility and flow tests.**

~~~js
const result = policy.normalizeClassification({
  level: "L", topology: "multi-chain", execution: "light",
  manualAcceptanceRequired: true,
});
assert.equal(result.acceptanceAssistSuggested, true);
assert.equal("manualAcceptanceRequired" in result, false);

let state = await startXs(root, { manualAcceptanceRequired: true });
state = await verification.runVerification(root, "f", state.revision, "codex", ["pass"]);
assert.equal(state.steps.verification.status, "satisfied");
~~~

- [ ] **Step 2: Run the focused tests before implementation.**

Run: node --test tests/unit/feature-check.test.mjs tests/unit/mcp-server.test.mjs tests/unit/status-progress.test.mjs

Expected: FAIL because current normalization persists manualAcceptanceRequired and verification throws MANUAL_ACCEPTANCE_REQUIRED.

- [ ] **Step 3: Replace the persisted hard flag with an advisory field.**

~~~ts
export interface ClassificationInput {
  level: Level;
  topology: Topology;
  execution?: Execution;
  requirements?: RequirementsState;
  riskLabels?: RiskLabel[];
  acceptanceAssistSuggested?: boolean;
  /** @deprecated Compatibility input; never persisted by 1.7. */
  manualAcceptanceRequired?: boolean;
}

export interface Classification {
  level: Level;
  topology: Topology;
  execution?: Execution;
  requirements?: RequirementsState;
  riskLabels: RiskLabel[];
  acceptanceAssistSuggested: boolean;
}
~~~

- [ ] **Step 4: Normalize new and legacy inputs without coupling money risk to a human reply.**

~~~ts
const { manualAcceptanceRequired: legacyAcceptance, acceptanceAssistSuggested, ...rest } = input;
return {
  ...rest,
  riskLabels,
  acceptanceAssistSuggested: acceptanceAssistSuggested === true || legacyAcceptance === true,
};
~~~

Validate both optional inputs as booleans. Add acceptanceAssistSuggested to MCP classify/start schemas; retain the legacy schema property with deprecation text. Update task skill to send only the new name.

Update route-flow so it never fabricates browser acceptance from the legacy flag:

~~~js
if (step === "verification") {
  state = await verification.runVerification(root, "feature", state.revision, "claude");
}
~~~

- [ ] **Step 5: Remove only manual-acceptance blocking from verification.**

Delete manualAcceptanceRequired() and the MANUAL_ACCEPTANCE_REQUIRED branch. Keep validateManualAcceptance() and user-signoff provenance validation when a caller voluntarily supplies it. Keep assertMoneyBehaviorCommands() unchanged. Publish this read-only status data:

~~~ts
acceptanceAssist: {
  suggested: state.classification.acceptanceAssistSuggested
    ?? (state.classification as { manualAcceptanceRequired?: boolean }).manualAcceptanceRequired === true,
  blocking: false,
}
~~~

- [ ] **Step 6: Update agent instructions.**

verify skill must offer browser help only when the agent actually has browser tooling and progress.acceptanceAssist.suggested is true; it continues configured commands immediately. It runs browser tools only after a later explicit user request. finish skill stops only for failed/stale machine verification, incomplete required evidence, feature-check failure, or snapshot failure.

- [ ] **Step 7: Run focused tests.**

Run: node --test tests/unit/feature-check.test.mjs tests/unit/mcp-server.test.mjs tests/unit/status-progress.test.mjs

Expected: PASS; legacy manualAcceptanceRequired is advisory, while omitting a money behavior command returns MONEY_BEHAVIOR_COMMAND_REQUIRED.

- [ ] **Step 8: Commit the task.**

~~~bash
git add plugins/dev-flow/src/policy/types.ts plugins/dev-flow/src/policy/validation.ts plugins/dev-flow/src/core/verification.ts plugins/dev-flow/src/core/status.ts plugins/dev-flow/src/mcp/server.ts plugins/dev-flow/skills/task/SKILL.md plugins/dev-flow/skills/verify/SKILL.md plugins/dev-flow/skills/finish/SKILL.md tests/unit/feature-check.test.mjs tests/unit/mcp-server.test.mjs tests/unit/status-progress.test.mjs
git commit -m "feat: make acceptance assistance non-blocking"
~~~

### Task 2: Centralize gate basis and invalidate approval after every basis update

**Files:**

- Create: plugins/dev-flow/src/core/gate-basis.ts
- Modify: plugins/dev-flow/src/core/human-gates.ts
- Modify: plugins/dev-flow/src/core/artifacts.ts
- Test: tests/unit/artifacts.test.mjs
- Test: tests/unit/human-gates.test.mjs
- Test: tests/unit/adapter-policy.test.mjs

**Interfaces:**

- Produces gateBasis(state, gate) and gatesInvalidatedByArtifact(kind): GateId[].
- Recording risk-card removes implementation approval, its satisfied step, and its gate interaction.

- [ ] **Step 1: Add a failing risk-card regression.**

~~~js
state = await approveImplementation(root, state);
state = await artifacts.recordArtifact(root, "f", state.revision, "risk-card");
assert.equal(state.humanGates.implementation_approval, undefined);
assert.equal(state.steps.implementation_approval, undefined);
assert.match(await preToolBlockReason(root, protectedWrite), /DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED/);
~~~

- [ ] **Step 2: Run the regression before implementation.**

Run: node --test tests/unit/artifacts.test.mjs tests/unit/human-gates.test.mjs tests/unit/adapter-policy.test.mjs

Expected: FAIL because the current invalidation list omits risk-card.

- [ ] **Step 3: Add one shared dependency map.**

~~~ts
export const gateBasisArtifacts: Record<GateId, readonly string[]> = {
  requirement_confirmation: ["requirements"],
  implementation_approval: [
    "implementation-plan", "coverage-matrix", "rollback-units", "rollback-safety",
    "risk-card", "boundary-card",
  ],
};

export function gatesInvalidatedByArtifact(kind: string): GateId[] {
  return (Object.keys(gateBasisArtifacts) as GateId[])
    .filter((gate) => gateBasisArtifacts[gate].includes(kind));
}
~~~

Keep route/scope/classification in the gate digest and derive only its artifact fields from the shared map.

- [ ] **Step 4: Revoke gates through the shared map.**

~~~ts
for (const gate of gatesInvalidatedByArtifact(kind)) {
  delete current.humanGates[gate];
  delete current.steps[gate];
  clearInteractionsForTarget(current, "gate:" + gate);
}
~~~

Retain requirements-only grill cleanup after this loop.

- [ ] **Step 5: Run focused tests.**

Run: node --test tests/unit/artifacts.test.mjs tests/unit/human-gates.test.mjs tests/unit/adapter-policy.test.mjs

Expected: PASS; a changed risk card requires a new implementation approval before protected writes.

- [ ] **Step 6: Commit the task.**

~~~bash
git add plugins/dev-flow/src/core/gate-basis.ts plugins/dev-flow/src/core/human-gates.ts plugins/dev-flow/src/core/artifacts.ts tests/unit/artifacts.test.mjs tests/unit/human-gates.test.mjs tests/unit/adapter-policy.test.mjs
git commit -m "fix: invalidate implementation approval when risk changes"
~~~

### Task 3: Normalize every gate and grill result at the MCP boundary

**Files:**

- Modify: plugins/dev-flow/src/core/user-interactions.ts
- Modify: plugins/dev-flow/src/mcp/server.ts
- Modify: plugins/dev-flow/skills/requirements/SKILL.md
- Modify: plugins/dev-flow/skills/plan/SKILL.md
- Modify: plugins/dev-flow/skills/plan-review/SKILL.md
- Test: tests/unit/user-interactions.test.mjs
- Test: tests/unit/mcp-server.test.mjs

**Interfaces:**

- Every new gate/grill call returns state, interaction, interactionOutcome, and optional response.
- interaction is PublicInteraction and response is immutable InteractionResponse.
- gateInteraction remains a temporary legacy alias in dev_flow_present_gate output only.

- [ ] **Step 1: Add failing envelope tests.**

~~~js
assert.equal(result.interactionOutcome, "pending");
assert.match(result.interaction.fallback.replies[0].reply, /^DF-/);

assert.equal(changed.interactionOutcome, "request-changes");
assert.equal(changed.response.comment, "补充离线场景");
~~~

- [ ] **Step 2: Run MCP tests before the repair.**

Run: node --test tests/unit/mcp-server.test.mjs tests/unit/user-interactions.test.mjs

Expected: FAIL because gate uses gateInteraction, skills reference stale progress paths, and gate resolution has no top-level response.

- [ ] **Step 3: Export a read-only response accessor.**

~~~ts
export function interactionResponse(state: FeatureState, interactionId: string): InteractionResponse | undefined {
  return getInteraction(state, interactionId).response;
}
~~~

- [ ] **Step 4: Use one server-side envelope helper.**

~~~ts
function interactionEnvelope(
  state: FeatureState,
  interaction: PublicInteraction,
  interactionOutcome: string,
  response?: InteractionResponse,
) {
  return { ...state, interaction, interactionOutcome, ...(response ? { response } : {}) };
}
~~~

Use it for pending/selected grill paths, pending/confirm/request-changes gate paths, and dev_flow_respond_interaction. Do not call status internally and do not add an elicitation timeout.

- [ ] **Step 5: Replace every stale skills path.**

Use result.interaction.fallback for fallback replies and result.response for grill decisions and change comments. The wait copy must include: “已打开选择卡片；如未看到，请直接说明‘没有看到选择卡片’，我会展示文字回复。” On that request, the agent reads status and shows the existing token; it does not create a new interaction.

- [ ] **Step 6: Run focused interaction regressions.**

Run: node --test tests/unit/mcp-server.test.mjs tests/unit/user-interactions.test.mjs tests/unit/human-gates.test.mjs tests/unit/requirements-grill.test.mjs

Expected: PASS; native choice, token fallback, mandatory comments, and legacy dev_flow_confirm_gate preserve provenance rules.

- [ ] **Step 7: Commit the task.**

~~~bash
git add plugins/dev-flow/src/core/user-interactions.ts plugins/dev-flow/src/mcp/server.ts plugins/dev-flow/skills/requirements/SKILL.md plugins/dev-flow/skills/plan/SKILL.md plugins/dev-flow/skills/plan-review/SKILL.md tests/unit/user-interactions.test.mjs tests/unit/mcp-server.test.mjs
git commit -m "fix: normalize interactive workflow responses"
~~~

### Task 4: Emit single-shot, non-blocking attention notifications

**Files:**

- Create: plugins/dev-flow/src/mcp/attention.ts
- Modify: plugins/dev-flow/src/mcp/server.ts
- Test: tests/unit/attention.test.mjs
- Test: tests/unit/mcp-server.test.mjs
- Test: tests/e2e/native-cross-host.test.mjs

**Interfaces:**

- Produces emitAttention(send, event, platform, run): Promise<void>.
- Sends a JSON-RPC notifications/message notification with no id.
- On macOS only, best-effort invokes osascript for one notification with the Glass sound; command errors resolve successfully.

- [ ] **Step 1: Add failing attention tests.**

~~~js
const sent = [];
await attention.emitAttention((message) => sent.push(message), event, "darwin", fakeRun);
assert.equal(sent[0].method, "notifications/message");
assert.equal(sent[0].params.data.kind, "decision-required");
assert.equal(fakeRun.calls[0].command, "osascript");
assert.match(fakeRun.calls[0].args[1], /sound name "Glass"/);
~~~

Also assert non-macOS and rejected fakeRun leave workflow callers successful.

- [ ] **Step 2: Run the new test before implementation.**

Run: node --test tests/unit/attention.test.mjs

Expected: FAIL because plugins/dev-flow/src/mcp/attention.ts does not exist.

- [ ] **Step 3: Implement the sink with no shell interpolation.**

~~~ts
export type AttentionEvent = {
  kind: "decision-required" | "workflow-finalized";
  featureId: string;
  title: string;
  message: string;
};

export async function emitAttention(send, event, platform = process.platform, run = promisify(execFile)) {
  send({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: event } });
  if (platform !== "darwin" || process.env.CI) return;
  await run("osascript", ["-e", buildAppleScript(event)])
    .catch(() => undefined);
}
~~~

buildAppleScript must serialize the event message/title as AppleScript string literals; it must never concatenate unescaped data into a shell command. Do not await this sink from a state mutator and do not add background music.

- [ ] **Step 4: Wire exactly two trigger classes.**

After gate/grill presentation commits and before optional native elicitation, call void emitAttention with decision-required. After successful dev_flow_finalize, call it once with workflow-finalized. Never trigger from status, automatic verification, browser-assistance copy, or failed finalize.

- [ ] **Step 5: Add server-stream tests and run them.**

~~~js
assert.equal(messages[0].method, "notifications/message");
assert.equal(messages.at(-1).result.structuredContent.logicComplete, true);
~~~

Run: node --test tests/unit/attention.test.mjs tests/unit/mcp-server.test.mjs tests/e2e/native-cross-host.test.mjs

Expected: PASS; one event per presentation/finalize, and notification failure cannot fail finalization.

- [ ] **Step 6: Perform a required macOS manual host check.**

Run one Claude or Codex feature through a gate and finalize it. Confirm one system notification/sound for the gate and one for finalize, and confirm no sound on status or automatic verification. Record host, macOS version, time, and result in release notes.

- [ ] **Step 7: Commit the task.**

~~~bash
git add plugins/dev-flow/src/mcp/attention.ts plugins/dev-flow/src/mcp/server.ts tests/unit/attention.test.mjs tests/unit/mcp-server.test.mjs tests/e2e/native-cross-host.test.mjs
git commit -m "feat: add non-blocking workflow attention alerts"
~~~

### Task 5: Document and test optional browser assistance

**Files:**

- Modify: plugins/dev-flow/skills/verify/SKILL.md
- Modify: plugins/dev-flow/skills/finish/SKILL.md
- Modify: plugins/dev-flow/skills/status/SKILL.md
- Modify: tests/unit/skills.test.mjs
- Modify: tests/e2e/routes/light-l-strict-acceptance.test.mjs

**Interfaces:**

- Consumes progress.acceptanceAssist.suggested and actual browser-tool availability in the host agent.
- Produces optional browser/signoff evidence only after a real action; its absence is valid.

- [ ] **Step 1: Add failing skills and route tests.**

~~~js
assert.match(verifySkill, /非阻塞/);
assert.match(verifySkill, /明确请求后/);
assert.doesNotMatch(verifySkill, /没有浏览器验收.*停止/);

const state = await finishRoute(root, {
  manualAcceptanceRequired: true,
  implementationFiles: { "src/feature.js": "export const delivered = true;\n" },
});
assert.equal(state.lifecycle, "finalized");
~~~

- [ ] **Step 2: Run focused tests before skill updates.**

Run: node --test tests/unit/skills.test.mjs tests/e2e/routes/light-l-strict-acceptance.test.mjs

Expected: FAIL because current copy and fixture still require manual acceptance.

- [ ] **Step 3: Write the exact browser-assistance decision table.**

~~~text
有浏览器能力且 acceptanceAssistSuggested=true：说明可协助真实验收，然后立即继续已配置自动验证。
用户本回合或后续明确要求协助：才使用浏览器，按已登记场景检查功能和 UI；记录真实观察。
用户拒绝、不回复或没有浏览器：不写失败、不等待、不改变 next；继续 verification / feature_check / finalize。
feature 已 finalized 后才收到协助请求：执行为交付后检查；发现问题后由用户决定是否新建修复 feature。
~~~

Do not call a gate, grill, or waiting elicitation tool for this recommendation.

- [ ] **Step 4: Update finish/status copy and route fixture.**

Finish may stop only for failed/stale machine verification, incomplete required evidence, feature-check failure, or snapshot failure. Status labels assistance “可选建议，不影响流程”. Rename the light-L E2E description to assert finalization without optional browser/signoff evidence.

- [ ] **Step 5: Run focused tests.**

Run: node --test tests/unit/skills.test.mjs tests/e2e/routes/light-l-strict-acceptance.test.mjs

Expected: PASS; an assistance-suggested route completes with no browser response.

- [ ] **Step 6: Commit the task.**

~~~bash
git add plugins/dev-flow/skills/verify/SKILL.md plugins/dev-flow/skills/finish/SKILL.md plugins/dev-flow/skills/status/SKILL.md tests/unit/skills.test.mjs tests/e2e/routes/light-l-strict-acceptance.test.mjs
git commit -m "feat: make browser assistance advisory"
~~~

### Task 6: Release and full acceptance

**Files:**

- Modify: package.json
- Modify: plugins/dev-flow/.claude-plugin/plugin.json
- Modify: plugins/dev-flow/.codex-plugin/plugin.json
- Modify: plugins/dev-flow/README.md
- Regenerate: plugins/dev-flow/dist/mcp-server.mjs
- Regenerate: plugins/dev-flow/dist/claude-hook.mjs
- Regenerate: plugins/dev-flow/dist/codex-hook.mjs
- Modify: docs/plans/2026-07-28-dev-flow-friendly-automation-design.md
- Modify: docs/superpowers/plans/2026-07-28-dev-flow-friendly-automation.md

**Interfaces:**

- Produces version-consistent 1.7.0 package/manifests/bundles.
- Verifies both hosts can complete an assistance-suggested route without optional input.

- [ ] **Step 1: Add version consistency assertions.**

~~~js
assert.equal(packageJson.version, "1.7.0");
assert.equal(codexManifest.version, packageJson.version);
assert.equal(claudeManifest.version, packageJson.version);
~~~

- [ ] **Step 2: Synchronize and build release assets.**

~~~bash
npm run version:sync
npm run build
~~~

- [ ] **Step 3: Run all automated checks.**

~~~bash
npm test
npm run test:host-e2e
git diff --check
~~~

Expected: all enabled tests pass and git diff --check has no output.

- [ ] **Step 4: Execute release scenarios.**

1. A no-control gate exposes interaction.fallback; request-changes returns response.comment and re-presentation uses a new token.
2. A risk-card edit after implementation approval blocks protected writes until fresh approval.
3. An acceptanceAssistSuggested light-L feature with no browser response runs commands, feature check, snapshot, and finalize.
4. A money feature missing a configured behavior command fails verification despite optional browser/user evidence.
5. macOS receives one attention alert for a decision and one for finalize; non-macOS or notifier failure completes the same route without state changes.

- [ ] **Step 5: Commit only after release acceptance passes.**

~~~bash
git add package.json plugins/dev-flow/.claude-plugin/plugin.json plugins/dev-flow/.codex-plugin/plugin.json plugins/dev-flow/README.md plugins/dev-flow/dist/mcp-server.mjs plugins/dev-flow/dist/claude-hook.mjs plugins/dev-flow/dist/codex-hook.mjs docs/plans/2026-07-28-dev-flow-friendly-automation-design.md docs/superpowers/plans/2026-07-28-dev-flow-friendly-automation.md
git commit -m "release: dev-flow 1.7.0"
~~~

## Acceptance Criteria

- [ ] New gate/grill callers consume only interaction and optional response; no new skill reads stale progress.wait paths from a present/resolve result.
- [ ] A change request never approves a gate; its required comment is returned and a modified basis requires fresh approval.
- [ ] Every implementation-approval artifact, including 风险文档.md, revokes existing approval and protected-root write permission when re-recorded.
- [ ] Optional browser assistance and optional user signoff never alter next, wait for input, or prevent finalize; money machine checks remain mandatory.
- [ ] Old manualAcceptanceRequired values remain readable but are non-blocking assistance hints; no legacy feature is forced to reverify solely by this release.
- [ ] Every gate/grill presentation and successful finalize sends exactly one best-effort attention event; notification failures cannot change state or return an MCP error.
- [ ] npm test, npm run test:host-e2e, and git diff --check pass before release.

## Plan Self-Review

- **Coverage:** Task 1 implements non-blocking acceptance migration; Task 2 fixes risk-card invalidation; Task 3 fixes response-contract dead ends; Task 4 adds decision/finalize attention; Task 5 makes browser help advisory; Task 6 verifies release behavior.
- **Compatibility:** Legacy classification input/state and legacy gate confirmation remain readable; no task changes Chinese assets, snapshot behavior, or adds commit confirmation.
- **Testability:** OS toast/audio is verified through an injected unit sink plus a required macOS manual check; all workflow behavior has deterministic Node/MCP/E2E coverage.
