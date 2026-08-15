import { recordHostEvent, recordTrustedWriteIntent, recordTrustedWriteOwnership } from "../core/state-store.js";
import { evaluatePreToolUse, hostToolExecutionDetails } from "./adapter-policy.js";
import { trustedWriteTargets, type HookEvent } from "./bash-syntax.js";
import { formatPreToolBlock } from "./block-format.js";
import { evaluatePermissionRequest, postToolSucceeded, recordPermissionPostToolUse } from "./host-authorization.js";
import { recordAdapterHealth, recordNativePromptHealth } from "./host-health-adapter.js";
import { claudeNativeQuestionAnswers } from "./claude-native-question.js";
import { resolveDevFlowRoot } from "./project-root.js";
import { recordSubagentReviewOutput } from "./review-execution-adapter.js";

type HookHost = "claude" | "codex";

interface HookHostPreset {
  label: string;
  permissionAllow(): unknown;
  preToolBlock(reason: string): unknown;
  advisory(message: string): unknown;
  onPostToolUseSuccess?: (root: string, event: HookEvent) => Promise<void>;
}

const presets: Record<HookHost, HookHostPreset> = {
  claude: {
    label: "Claude",
    permissionAllow: () => ({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    }),
    preToolBlock: (reason) => ({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
    advisory: (message) => ({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: message,
      },
    }),
    onPostToolUseSuccess: async (root, event) => {
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
    },
  },
  codex: {
    label: "Codex",
    permissionAllow: () => ({ decision: "allow" }),
    preToolBlock: (reason) => ({ decision: "block", reason }),
    advisory: (message) => ({ hookSpecificOutput: { additionalContext: message } }),
  },
};

export async function runHookAdapter(host: HookHost): Promise<void> {
  const preset = presets[host];
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  // event.cwd 跟随 agent 的 shell cd 变化；宿主事件必须写入项目根账本。
  const root = await resolveDevFlowRoot(event.cwd ?? process.cwd());

  await recordAdapterHealth(root, event, host);

  if (event.hook_event_name === "PermissionRequest") {
    try {
      const outcome = await evaluatePermissionRequest(root, event, host);
      if (outcome?.kind === "allow") {
        process.stdout.write(JSON.stringify(preset.permissionAllow()) + "\n");
      }
    } catch (error) {
      // A failed grant lookup must not replace the host's native confirmation flow.
      process.stderr.write(`Dev Flow ${preset.label} permission evaluation failed: ${String(error)}\n`);
    }
  }

  if (event.hook_event_name === "PreToolUse") {
    try {
      const outcome = await evaluatePreToolUse(root, event);
      if (outcome.kind === "block") {
        process.stdout.write(JSON.stringify(preset.preToolBlock(formatPreToolBlock(outcome.block))) + "\n");
      } else if (outcome.advisory) {
        process.stdout.write(JSON.stringify(preset.advisory(outcome.advisory.message)) + "\n");
      } else {
        await recordTrustedWriteIntent(root, trustedWriteTargets(root, event), host, event.event_id ?? event.tool_use_id ?? `pre-${Date.now()}`);
      }
    } catch (error) {
      // An unexpected adapter failure is diagnostic only; host permissions remain authoritative.
      process.stderr.write(`Dev Flow ${preset.label} hook evaluation failed: ${String(error)}\n`);
    }
  }

  if (event.hook_event_name === "SubagentStop") {
    try {
      await recordSubagentReviewOutput(root, event, host);
    } catch (error) {
      // fail-closed：无法完成宿主证明时宁可没有隔离证明，也不能伪造。
      process.stderr.write(`Dev Flow ${preset.label} subagent review proof failed: ${String(error)}\n`);
    }
  }

  if (event.hook_event_name === "UserPromptSubmit" || event.hook_event_name === "Stop" || event.hook_event_name === "PostToolUse") {
    if (event.hook_event_name === "PostToolUse") {
      try { await recordPermissionPostToolUse(root, event, host); }
      catch { /* authorization memory must not suppress the audit event */ }
      if (postToolSucceeded(event)) {
        try { await recordTrustedWriteOwnership(root, trustedWriteTargets(root, event), host, event.event_id ?? event.tool_use_id ?? `post-${Date.now()}`); }
        catch { /* ownership can be recovered by reconcile */ }
        await preset.onPostToolUseSuccess?.(root, event);
      }
    }
    try {
      const text = event.prompt ?? event.user_prompt ?? event.tool_input?.prompt;
      const eventId = event.event_id ?? `${event.hook_event_name}-${Date.now()}`;
      await recordHostEvent(root, {
        eventId,
        type: event.hook_event_name === "UserPromptSubmit" ? "user-prompt" : event.hook_event_name === "Stop" ? "turn-boundary" : "tool",
        host,
        text: typeof text === "string" ? text : undefined,
        ...(event.hook_event_name === "PostToolUse" ? hostToolExecutionDetails(event, postToolSucceeded(event), eventId) : {}),
      });
    } catch { /* hooks must not fail normal host operation */ }
  }
}
