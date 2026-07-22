import { recordHostEvent } from "../core/state-store.js";
import { preToolBlockReason } from "./adapter-policy.js";
const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
let allow = true; let reason: string | undefined;
if (event.hook_event_name === "PreToolUse") { try {
  reason = await preToolBlockReason(event.cwd ?? process.cwd(), event); allow = !reason;
} catch { /* no initialized active workflow: allow */ } }
if (event.hook_event_name === "UserPromptSubmit" || event.hook_event_name === "Stop" || event.hook_event_name === "PostToolUse") {
  try { const text = event.prompt ?? event.user_prompt ?? event.tool_input?.prompt; await recordHostEvent(event.cwd ?? process.cwd(), { eventId: event.event_id ?? `${event.hook_event_name}-${Date.now()}`, type: event.hook_event_name === "UserPromptSubmit" ? "user-prompt" : event.hook_event_name === "Stop" ? "turn-boundary" : "tool", host: "claude", text: typeof text === "string" ? text : undefined }); } catch { /* hooks must not fail normal host operation */ }
}
process.stdout.write(JSON.stringify(allow ? { continue: true } : { continue: false, decision: "block", reason }) + "\n");
