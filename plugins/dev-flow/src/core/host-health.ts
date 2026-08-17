import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { DevFlowError } from "./errors.js";

export type HostHealthKind = "session-start" | "user-prompt-submit" | "turn-boundary" | "tool";

export interface HostHealthSignal {
  host: "claude" | "codex";
  kind: HostHealthKind;
  eventId: string;
  at: string;
  adapterVersion?: string;
  capabilities?: string[];
}

const healthWindowMs = 15 * 60 * 1000;
const hostHealthPath = (root: string): string => path.join(root, ".dev-flow", "host-health.jsonl");

export async function readHostHealth(root: string): Promise<HostHealthSignal[]> {
  try {
    const raw = await readFile(hostHealthPath(root), "utf8");
    return raw.split("\n").filter(Boolean).flatMap((line) => {
      try {
        const signal = JSON.parse(line) as Partial<HostHealthSignal>;
        return (signal.host === "claude" || signal.host === "codex")
          && typeof signal.kind === "string" && typeof signal.eventId === "string" && typeof signal.at === "string"
          ? [{
              ...signal,
              ...(signal.adapterVersion !== undefined ? { adapterVersion: String(signal.adapterVersion) } : {}),
              ...(Array.isArray(signal.capabilities)
                ? { capabilities: signal.capabilities.filter((value): value is string => typeof value === "string") }
                : {}),
            } as HostHealthSignal] : [];
      } catch { return []; }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Record adapter health independently of any active feature. */
export async function recordHostHealth(
  root: string,
  signal: Omit<HostHealthSignal, "at"> & { at?: string },
): Promise<{ recovered: boolean; latest?: HostHealthSignal }> {
  const before = await readHostHealth(root);
  const latest = [...before].reverse().find((entry) => entry.host === signal.host);
  const now = signal.at ?? new Date().toISOString();
  await mkdir(path.dirname(hostHealthPath(root)), { recursive: true });
  const handle = await open(hostHealthPath(root), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ ...signal, at: now })}\n`);
    await handle.sync();
  } finally { await handle.close(); }
  return { recovered: Boolean(latest && Date.parse(now) - Date.parse(latest.at) > healthWindowMs), latest };
}

/** Fail closed before a host-driven mutation when its trusted hook has gone stale. */
export async function assertHostHealth(
  root: string,
  host: "claude" | "codex",
  operation: string,
): Promise<HostHealthSignal> {
  const latest = [...await readHostHealth(root)].reverse().find((signal) => signal.host === host);
  const ageMs = latest ? Date.now() - Date.parse(latest.at) : Number.POSITIVE_INFINITY;
  if (!latest) {
    throw new DevFlowError("HOOK_HEALTH_REQUIRED", `${host} hook health is required before ${operation}`, {
      userMessage: `开始${operation}前没有发现 ${host} 宿主的可信 hook 健康信号。`,
      cause: "宿主接线尚未证明当前会话能够捕获用户回合和写入归属。",
      impact: "操作没有改变 feature、ownership 或证据状态。",
      recoveryKind: "refresh",
      recoveryInstruction: `确认 ${host} manifest、MCP 与 hook 已共同安装，重新开启宿主会话后重试。`,
      retryOriginal: true,
      host,
      operation,
    });
  }
  if (!Number.isFinite(ageMs) || ageMs > healthWindowMs) {
    throw new DevFlowError("HOOK_HEALTH_STALE", `${host} hook health is stale before ${operation}`, {
      userMessage: `${host} 宿主 hook 的最近可信信号已过期，已安全暂停当前操作。`,
      cause: `最近信号距现在约 ${Math.round(ageMs / 60000)} 分钟，超过 15 分钟健康窗口。`,
      impact: "操作没有改变 feature、ownership 或证据状态。",
      recoveryKind: "refresh",
      recoveryInstruction: `恢复 ${host} hook 并重新开启会话后重试原操作；若发现未知路径，再调用 dev_flow_reconcile_workspace。`,
      retryOriginal: true,
      host,
      operation,
      latestAt: latest.at,
    });
  }
  return latest;
}
