// 回归：dev_flow_answer 必须在归属前验证宿主 hook 健康。
// 宿主 hook 停摆时（信号过期）应快速失败并给出明确恢复指引，
// 而不是让用户反复回答却得到误导性的 INTERACTION_PROVENANCE_UNAVAILABLE。
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { createTinyApp, strictProjectConfig } from "../helpers/fixture-repo.mjs";
import { mcpCall } from "../helpers/host-runner.mjs";
import { buildTestBundles } from "../helpers/test-bundle.mjs";
import { loadSource } from "../helpers/load-source.mjs";

const store = await loadSource("plugins/dev-flow/src/core/state-store.ts");
const bundles = await buildTestBundles();
const server = bundles.pathFor("mcp-server");
after(() => bundles.dispose());

const dirtyPaths = ["src/extra-a.ts", "src/extra-b.ts", "src/extra-c.ts"];

/** 把 host-health 全部信号回拨到 minutes 分钟前，模拟宿主 hook 停摆。 */
async function ageHostHealth(root, minutes = 20) {
  const file = path.join(root, ".dev-flow", "host-health.jsonl");
  const raw = await readFile(file, "utf8");
  const aged = raw.split("\n").filter(Boolean).map((line) => {
    const signal = JSON.parse(line);
    signal.at = new Date(Date.now() - minutes * 60_000).toISOString();
    return JSON.stringify(signal);
  }).join("\n");
  await writeFile(file, `${aged}\n`);
}

async function startWithOwnershipDecision() {
  const fixture = await createTinyApp();
  for (const file of dirtyPaths) {
    const target = path.join(fixture.root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `// ${file}\n`);
  }
  await mcpCall(server, fixture.root, "dev_flow_init_project", { config: strictProjectConfig });
  const started = await mcpCall(server, fixture.root, "dev_flow_start", {
    featureId: "issue-host-health", objective: "测试回答前置健康检查", host: "claude",
    scope: { inScope: ["src"], outOfScope: [] },
  });
  const status = await mcpCall(server, fixture.root, "dev_flow_status", { featureId: "issue-host-health" });
  return { fixture, started, status };
}

test("dev_flow_answer fails fast with HOOK_HEALTH_STALE and preserves the pending decision", async () => {
  const { fixture, status } = await startWithOwnershipDecision();
  try {
    const decision = status.pendingDecision;
    assert.ok(decision && JSON.stringify(decision.options ?? []).includes("全部纳入当前任务"), "应存在 workspace-ownership 待决问题");

    await ageHostHealth(fixture.root);
    await assert.rejects(
      () => mcpCall(server, fixture.root, "dev_flow_answer", {
        featureId: "issue-host-health",
        expectedRevision: status.control.expectedRevision,
        userReply: "全部纳入当前任务",
        host: "claude",
      }),
      (error) => {
        assert.equal(error.code, "HOOK_HEALTH_STALE");
        assert.match(error.message, /hook 的最近可信信号已过期/);
        return true;
      },
    );

    const unchanged = await mcpCall(server, fixture.root, "dev_flow_status", { featureId: "issue-host-health" });
    assert.ok(unchanged.pendingDecision, "hook 过期时回答不得改变待决状态");
    assert.equal(unchanged.control.expectedRevision, status.control.expectedRevision, "revision 不得推进");
  } finally {
    await fixture.dispose();
  }
});

test("dev_flow_answer recovers once fresh host health and a real user event exist", async () => {
  const { fixture, started, status } = await startWithOwnershipDecision();
  try {
    await ageHostHealth(fixture.root);
    await store.recordHostHealth(fixture.root, { host: "claude", kind: "tool", eventId: "fresh-signal" });
    await store.recordHostEvent(fixture.root, {
      eventId: "native-answer", type: "user-prompt", host: "claude", text: "全部纳入当前任务",
    });
    const answered = await mcpCall(server, fixture.root, "dev_flow_answer", {
      featureId: "issue-host-health",
      expectedRevision: status.control.expectedRevision,
      userReply: "全部纳入当前任务",
      host: "claude",
    });
    assert.match(answered.message, /纳入当前任务/);
    const resolved = await mcpCall(server, fixture.root, "dev_flow_status", { featureId: "issue-host-health" });
    assert.equal(resolved.pendingDecision, undefined, "回答成功后待决问题应消解");
    assert.ok(resolved.control.expectedRevision > started.control.expectedRevision, "revision 应推进");
  } finally {
    await fixture.dispose();
  }
});
