import assert from "node:assert/strict";
import test from "node:test";
import { hostE2EEnabled, run } from "../helpers/host-runner.mjs";
import { exerciseNativeUpgrade, installNativeHosts } from "../helpers/native-hosts.mjs";

test("native marketplace install and upgrade exposes prebuilt skills, hooks and MCP", { skip: !hostE2EEnabled, timeout: 180_000 }, async () => {
  const hosts = await installNativeHosts();
  try {
    const claudeDetails = await run(hosts.claude, ["plugin", "details", "dev-flow"], { env: hosts.claudeEnv });
    assert.match(claudeDetails.stdout, /dev-flow/i);
    assert.match(claudeDetails.stdout, /MCP/i);
    assert.match(claudeDetails.stdout, /Hook/i);
    const codexPlugins = await run(hosts.codex, ["plugin", "list", "--marketplace", "dev-flow-marketplace", "--json"], { env: hosts.codexEnv });
    assert.match(codexPlugins.stdout, /dev-flow/i);
    await exerciseNativeUpgrade(hosts);
  } finally { await hosts.cleanup(); }
});
