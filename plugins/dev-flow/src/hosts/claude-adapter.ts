import { recordHostEvent, recordTrustedWriteIntent, recordTrustedWriteOwnership } from "../core/state-store.js";
import { evaluatePreToolUse, formatPreToolBlock, hostToolExecutionDetails, trustedWriteTargets } from "./adapter-policy.js";
import { evaluatePermissionRequest, postToolSucceeded, recordPermissionPostToolUse } from "./host-authorization.js";
import { recordAdapterHealth, recordNativePromptHealth } from "./host-health-adapter.js";
import { claudeNativeQuestionAnswers } from "./claude-native-question.js";
import { resolveDevFlowRoot } from "./project-root.js";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
// event.cwd 跟随 agent 的 shell cd 变化；宿主事件必须写入项目根账本。
const root = await resolveDevFlowRoot(event.cwd ?? process.cwd());

await recordAdapterHealth(root, event, "claude");

if (event.hook_event_name === "PermissionRequest") {
  try {
    const outcome = await evaluatePermissionRequest(root, event, "claude");
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
    const outcome = await evaluatePreToolUse(root, event);
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
      await recordTrustedWriteIntent(root, trustedWriteTargets(root, event), "claude", event.event_id ?? event.tool_use_id ?? `pre-${Date.now()}`);
    }
  } catch (error) {
    // An unexpected adapter failure is diagnostic only; host permissions remain authoritative.
    process.stderr.write(`Dev Flow Claude hook evaluation failed: ${String(error)}\n`);
  }
}

if (event.hook_event_name === "UserPromptSubmit" || event.hook_event_name === "Stop" || event.hook_event_name === "PostToolUse") {
  if (event.hook_event_name === "PostToolUse") {
    try { await recordPermissionPostToolUse(root, event, "claude"); }
    catch { /* authorization memory must not suppress the audit event */ }
    if (postToolSucceeded(event)) {
      try { await recordTrustedWriteOwnership(root, trustedWriteTargets(root, event), "claude", event.event_id ?? event.tool_use_id ?? `post-${Date.now()}`); }
      catch { /* ownership can be recovered by reconcile */ }
      const sourceEventId = event.event_id ?? event.tool_use_id ?? `native-question-${Date.now()}`;
      const nativeAnswers = claudeNativeQuestionAnswers(event);
      if (nativeAnswers.length) await recordNativePromptHealth(root, { ...event, event_id: sourceEventId }, "claude");
      for (const [index, answer] of nativeAnswers.entries()) {
        try {
          await recordHostEvent(root, {
            eventId: `${sourceEventId}:answer:${index}`,
            type: "user-prompt",
            host: "claude",
            text: answer.answer,
            ...(answer.question ? { question: answer.question } : {}),
          });
        } catch { /* native user answers must not fail normal host operation */ }
      }
    }
  }
  try {
    const text = event.prompt ?? event.user_prompt ?? event.tool_input?.prompt;
    const eventId = event.event_id ?? `${event.hook_event_name}-${Date.now()}`;
    await recordHostEvent(root, {
      eventId,
      type: event.hook_event_name === "UserPromptSubmit" ? "user-prompt" : event.hook_event_name === "Stop" ? "turn-boundary" : "tool",
      host: "claude",
      text: typeof text === "string" ? text : undefined,
      ...(event.hook_event_name === "PostToolUse" ? hostToolExecutionDetails(event, postToolSucceeded(event), eventId) : {}),
    });
  } catch { /* hooks must not fail normal host operation */ }
}
