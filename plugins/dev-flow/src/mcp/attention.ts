import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emitWindowsToast, type NotificationCommandExecutor, type NotificationPathExists } from "./windows-notifications.js";

const run = promisify(execFile);

export type AttentionEvent =
  | { kind: "decision-required"; featureId: string; decision: "requirement_confirmation" | "implementation_approval" | "grill" | "rollback-confirmation" }
  | { kind: "workflow-finalized"; featureId: string };

export interface AttentionOptions {
  emit?: (message: unknown) => void;
  platform?: NodeJS.Platform;
  execute?: NotificationCommandExecutor;
  exists?: NotificationPathExists;
  localAlertsEnabled?: boolean;
  environment?: NodeJS.ProcessEnv;
}

function messageFor(event: AttentionEvent): { title: string; body: string } {
  if (event.kind === "workflow-finalized") {
    return { title: "Dev Flow 已完成", body: `功能 ${event.featureId} 已完成并生成交付快照。` };
  }
  const decision = event.decision === "requirement_confirmation"
    ? "需求确认"
    : event.decision === "implementation_approval"
      ? "确认执行"
      : event.decision === "rollback-confirmation"
        ? "回撤确认"
        : "需求选择";
  return { title: "Dev Flow 需要决策", body: `功能 ${event.featureId} 正在等待你的${decision}。` };
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n")}"`;
}

/**
 * Sends an advisory MCP notification and, on supported opt-in platforms, a
 * best-effort local banner with one system sound. This is detached from state.
 */
export async function emitAttention(event: AttentionEvent, options: AttentionOptions = {}): Promise<void> {
  const { title, body } = messageFor(event);
  try {
    options.emit?.({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "info", data: event },
    });
  } catch {
    // The notification transport is advisory just like the OS-level alert.
  }
  const environment = options.environment ?? process.env;
  const automatedEnvironment = environment.CI === "true"
    || environment.CI === "1"
    || environment.NODE_ENV === "test";
  const localAlertsEnabled = options.localAlertsEnabled
    ?? (environment.DEV_FLOW_DISABLE_ATTENTION !== "1" && !automatedEnvironment);
  const platform = options.platform ?? process.platform;
  if (!localAlertsEnabled) return;
  if (platform === "win32") {
    await emitWindowsToast(title, body, { platform, environment, execute: options.execute, exists: options.exists });
    return;
  }
  if (platform !== "darwin") return;
  const script = `display notification ${appleScriptString(body)} with title ${appleScriptString(title)} sound name "Glass"`;
  try {
    await (options.execute ?? ((file, args) => run(file, args)))("osascript", ["-e", script]);
  } catch {
    // Native alerts are best-effort. An unavailable OS notification service must
    // not change workflow state, revisions, or whether a tool call succeeds.
  }
}
