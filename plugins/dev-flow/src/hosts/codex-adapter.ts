import { lstat } from "node:fs/promises";
import path from "node:path";
import { recordHostEvent } from "../core/state-store.js";
import { preToolBlockReason } from "./adapter-policy.js";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
const cwd = event.cwd ?? process.cwd();
let allow = true;
let reason: string | undefined;

if (event.hook_event_name === "PreToolUse") {
  try {
    reason = await preToolBlockReason(cwd, event);
    allow = !reason;
  } catch {
    try {
      await lstat(path.join(cwd, ".dev-flow", "active.json"));
      allow = false;
      reason = "DEV_FLOW_WORKFLOW_STATE_UNREADABLE: Active workflow cannot be read safely; run dev_flow_doctor and recover if corrupt";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        allow = true;
        reason = undefined;
      } else {
        allow = false;
        reason = "DEV_FLOW_WORKFLOW_STATE_UNREADABLE: Active workflow path cannot be inspected safely; run dev_flow_doctor";
      }
    }
  }
}

if (event.hook_event_name === "UserPromptSubmit" || event.hook_event_name === "Stop" || event.hook_event_name === "PostToolUse") {
  try {
    const text = event.prompt ?? event.user_prompt ?? event.tool_input?.prompt;
    await recordHostEvent(cwd, {
      eventId: event.event_id ?? `${event.hook_event_name}-${Date.now()}`,
      type: event.hook_event_name === "UserPromptSubmit" ? "user-prompt" : event.hook_event_name === "Stop" ? "turn-boundary" : "tool",
      host: "codex",
      text: typeof text === "string" ? text : undefined,
    });
  } catch { /* hooks must not fail normal host operation */ }
}

process.stdout.write(JSON.stringify(allow ? { continue: true } : { continue: false, decision: "block", reason }) + "\n");
