import { recordHostEvent, recordTrustedWriteIntent, recordTrustedWriteOwnership } from "../core/state-store.js";
import { evaluatePreToolUse, formatPreToolBlock, trustedWriteTargets } from "./adapter-policy.js";
import { evaluatePermissionRequest, postToolSucceeded, recordPermissionPostToolUse } from "./host-authorization.js";
import { recordAdapterHealth } from "./host-health-adapter.js";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
const cwd = event.cwd ?? process.cwd();

await recordAdapterHealth(cwd, event, "claude");

if (event.hook_event_name === "PermissionRequest") {
  try {
    const outcome = await evaluatePermissionRequest(cwd, event, "claude");
    if (outcome?.kind === "allow") {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: { behavior: "allow" },
        },
      }) + "\n");
    }
  } catch (error) {
    // A failed grant lookup must not replace the host's native confirmation flow.
    process.stderr.write(`Dev Flow Claude permission evaluation failed: ${String(error)}\n`);
  }
}

if (event.hook_event_name === "PreToolUse") {
  try {
    const outcome = await evaluatePreToolUse(cwd, event);
    if (outcome.kind === "block") {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: formatPreToolBlock(outcome.block),
        },
      }) + "\n");
    } else if (outcome.advisory) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: outcome.advisory.message,
        },
      }) + "\n");
    } else {
      await recordTrustedWriteIntent(cwd, trustedWriteTargets(cwd, event), "claude", event.event_id ?? event.tool_use_id ?? `pre-${Date.now()}`);
    }
  } catch (error) {
    // An unexpected adapter failure is diagnostic only; host permissions remain authoritative.
    process.stderr.write(`Dev Flow Claude hook evaluation failed: ${String(error)}\n`);
  }
}

if (event.hook_event_name === "UserPromptSubmit" || event.hook_event_name === "Stop" || event.hook_event_name === "PostToolUse") {
  if (event.hook_event_name === "PostToolUse") {
    try { await recordPermissionPostToolUse(cwd, event, "claude"); }
    catch { /* authorization memory must not suppress the audit event */ }
    if (postToolSucceeded(event)) {
      try { await recordTrustedWriteOwnership(cwd, trustedWriteTargets(cwd, event), "claude", event.event_id ?? event.tool_use_id ?? `post-${Date.now()}`); }
      catch { /* ownership can be recovered by reconcile */ }
    }
  }
  try {
    const text = event.prompt ?? event.user_prompt ?? event.tool_input?.prompt;
    await recordHostEvent(cwd, {
      eventId: event.event_id ?? `${event.hook_event_name}-${Date.now()}`,
      type: event.hook_event_name === "UserPromptSubmit" ? "user-prompt" : event.hook_event_name === "Stop" ? "turn-boundary" : "tool",
      host: "claude",
      text: typeof text === "string" ? text : undefined,
    });
  } catch { /* hooks must not fail normal host operation */ }
}
