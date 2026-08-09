import { observeHostRecovery } from "../core/host-recovery.js";

interface HostHealthEvent {
  hook_event_name?: string;
  event_id?: string;
}

/**
 * Translate a host event into a Core health observation. Any recovery
 * reconciliation is chosen and performed by Core, never by this adapter.
 */
export async function recordAdapterHealth(
  root: string,
  event: HostHealthEvent,
  host: "claude" | "codex",
): Promise<void> {
  const kind = event.hook_event_name === "SessionStart" ? "session-start"
    : event.hook_event_name === "UserPromptSubmit" ? "user-prompt-submit"
      : event.hook_event_name === "Stop" ? "turn-boundary"
        : event.hook_event_name === "PreToolUse" || event.hook_event_name === "PostToolUse" ? "tool"
          : undefined;
  if (!kind) return;
  try {
    await observeHostRecovery(root, {
      host,
      kind,
      eventId: event.event_id ?? `${event.hook_event_name}-${Date.now()}`,
    });
  } catch {
    // Health diagnostics must not block the host. Core gates remain fail-closed
    // when no trustworthy signal can be read.
  }
}
