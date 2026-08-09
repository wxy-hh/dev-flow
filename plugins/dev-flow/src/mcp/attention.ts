import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emitWindowsToast, type NotificationCommandExecutor, type NotificationPathExists } from "./windows-notifications.js";

const run = promisify(execFile);

export type AttentionEvent =
  | { kind: "decision-required"; featureId: string; decision: "approval" | "grill" | "rollback-confirmation" | "quality-exception" | "review-risk" | "route-confirmation"; approvalId?: string }
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
    return { title: "Dev Flow 已完成", body: "当前功能已完成并生成交付快照。" };
  }
  const decision = event.decision === "approval"
    ? "确认开始执行"
    : event.decision === "rollback-confirmation"
      ? "回撤确认"
      : event.decision === "quality-exception"
        ? "质量风险确认"
      : event.decision === "review-risk"
          ? "审查风险确认"
      : event.decision === "route-confirmation"
          ? "路线确认"
      : "需求选择";
  return { title: "Dev Flow 需要决策", body: `当前功能正在等待你的${decision}。` };
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
