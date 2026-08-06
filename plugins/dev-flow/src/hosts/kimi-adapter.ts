import { recordHostEvent } from "../core/state-store.js";
import { evaluatePreToolUse, formatPreToolBlock } from "./adapter-policy.js";
import { recordKimiPermissionRequest, recordKimiPermissionResult } from "./host-authorization.js";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
const cwd = event.cwd ?? process.cwd();

/** Kimi sends UserPromptSubmit.prompt as an array of {type,text} content blocks. */
function extractText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.flatMap((block) => {
      if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
        return [(block as { text: string }).text];
      }
      return [];
    });
    return parts.length ? parts.join("\n") : undefined;
  }
  return undefined;
}

if (event.hook_event_name === "PermissionRequest") {
  try { await recordKimiPermissionRequest(cwd, event); }
  catch (error) {
    // Observation-only: a failed ledger write must not interfere with Kimi's native flow.
    process.stderr.write(`Dev Flow Kimi permission observation failed: ${String(error)}\n`);
  }
}

if (event.hook_event_name === "PermissionResult") {
  try { await recordKimiPermissionResult(cwd, event); }
  catch (error) {
    process.stderr.write(`Dev Flow Kimi permission observation failed: ${String(error)}\n`);
  }
}

if (event.hook_event_name === "PreToolUse") {
  try {
    const outcome = await evaluatePreToolUse(cwd, event);
    if (outcome.kind === "block") {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: formatPreToolBlock(outcome.block),
        },
      }) + "\n");
    } else if (outcome.advisory) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          additionalContext: outcome.advisory.message,
        },
      }) + "\n");
    }
  } catch (error) {
    // An unexpected adapter failure is diagnostic only; host permissions remain authoritative.
    process.stderr.write(`Dev Flow Kimi hook evaluation failed: ${String(error)}\n`);
  }
}

if (event.hook_event_name === "UserPromptSubmit" || event.hook_event_name === "Stop" || event.hook_event_name === "PostToolUse") {
  try {
    await recordHostEvent(cwd, {
      eventId: event.event_id ?? event.tool_call_id ?? `${event.hook_event_name}-${Date.now()}`,
      type: event.hook_event_name === "UserPromptSubmit" ? "user-prompt" : event.hook_event_name === "Stop" ? "turn-boundary" : "tool",
      host: "kimi",
      text: extractText(event.prompt ?? event.user_prompt),
    });
  } catch { /* hooks must not fail normal host operation */ }
}
