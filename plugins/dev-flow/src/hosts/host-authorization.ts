import type { HookEvent } from "./bash-syntax.js";
import { classifyRisk, type RiskAssessment } from "./risk-policy.js";
import {
  readActive,
  readHostAuthorizationEvents,
  readState,
  recordHostAuthorizationEvent,
  type HostAuthorizationRecord,
} from "../core/state-store.js";

export interface HostPermissionOutcome {
  kind: "allow" | "defer";
  assessment: RiskAssessment;
}

type Host = "claude" | "codex";

function eventId(event: HookEvent, assessment: RiskAssessment, kind: string): string {
  const value = (event as HookEvent & { event_id?: unknown; tool_use_id?: unknown; permission_request_id?: unknown });
  const supplied = [value.event_id, value.tool_use_id, value.permission_request_id].find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
  return supplied ?? `${kind}:${assessment.commandFingerprint}`;
}

/** 同一次执行的稳定标识：宿主通常让 PermissionRequest 与 PostToolUse 共享 tool_use_id。 */
function executionKey(event: HookEvent): string | undefined {
  const value = event as HookEvent & { event_id?: unknown; tool_use_id?: unknown; permission_request_id?: unknown };
  return [value.tool_use_id, value.permission_request_id, value.event_id].find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
}

async function activeFeature(root: string): Promise<{ featureId: string; revision: number } | undefined> {
  const active = await readActive(root);
  if (!active) return undefined;
  const state = await readState(root, active.featureId);
  if (state.lifecycle !== "active" || state.revision !== active.revision) return undefined;
  return { featureId: active.featureId, revision: active.revision };
}

function sameRequest(record: HostAuthorizationRecord, host: Host, featureId: string, assessment: RiskAssessment): boolean {
  return record.host === host
    && record.featureId === featureId
    && record.riskClass === assessment.riskClass
    && record.commandFingerprint === assessment.commandFingerprint;
}

/**
 * 危险操作每次执行都重新确认（ADR-0004）：授权只覆盖"本次执行"。
 * - 同一次执行的重复 PermissionRequest 通知只产生一次 pending 审计，
 *   后续重复通知静默忽略（返回 undefined，不重复确认、不新增审计）；
 * - 完全相同的命令或目标再次执行时仍重新 defer 到宿主确认，不复用任何
 *   历史授权（granted 记录只作审计闭环，不参与判定）。
 */
export async function evaluatePermissionRequest(root: string, event: HookEvent, host: Host): Promise<HostPermissionOutcome | undefined> {
  if (event.hook_event_name !== "PermissionRequest") return undefined;
  const assessment = classifyRisk({ toolName: event.tool_name, toolInput: event.tool_input }, root);
  if (!assessment) return undefined;
  const feature = await activeFeature(root);
  if (!feature) return undefined;
  const events = await readHostAuthorizationEvents(root, feature.featureId);
  const key = executionKey(event);
  if (key !== undefined && events.some((item) => item.type === "host-authorization-pending" && item.data.executionKey === key)) {
    // 同一次执行的重复通知：已 defer 过，不重复确认也不追加审计。
    return undefined;
  }
  const sourceToolEvent = eventId(event, assessment, "permission-request");
  await recordHostAuthorizationEvent(root, "host-authorization-pending", {
    host,
    featureId: feature.featureId,
    riskClass: assessment.riskClass,
    commandFingerprint: assessment.commandFingerprint,
    sourceToolEvent,
    ...(key !== undefined ? { executionKey: key } : {}),
    requestedAt: new Date().toISOString(),
  });
  return { kind: "defer", assessment };
}

export function postToolSucceeded(event: HookEvent): boolean {
  const value = event as HookEvent & { error?: unknown; tool_response?: unknown; tool_result?: unknown };
  if (value.error !== undefined && value.error !== null) return false;
  for (const response of [value.tool_response, value.tool_result]) {
    if (!response || typeof response !== "object") continue;
    const candidate = response as Record<string, unknown>;
    if (candidate.is_error === true || candidate.isError === true || candidate.success === false || candidate.error !== undefined) return false;
  }
  return true;
}

/** Convert a successful native permission flow into an audit-closed record for this execution. */
export async function recordPermissionPostToolUse(root: string, event: HookEvent, host: Host): Promise<void> {
  if (event.hook_event_name !== "PostToolUse" || !postToolSucceeded(event)) return;
  const assessment = classifyRisk({ toolName: event.tool_name, toolInput: event.tool_input }, root);
  if (!assessment || assessment.riskClass !== "task-reusable") return;
  const feature = await activeFeature(root);
  if (!feature) return;
  const events = await readHostAuthorizationEvents(root, feature.featureId);
  const key = executionKey(event);
  const pending = [...events].reverse().find((item) => {
    if (item.type !== "host-authorization-pending") return false;
    if (item.data.executionKey !== undefined) {
      // 新记录按执行键精确配对，防止把不同执行的相同命令配错。
      return key !== undefined && item.data.executionKey === key;
    }
    // 旧 pending（迁移期数据，无执行键）：按命令级配对兼容。
    return sameRequest(item.data, host, feature.featureId, assessment);
  });
  if (!pending) return;
  // granted 只表示"本次执行已确认"（审计闭环）；evaluatePermissionRequest
  // 不再消费它，后续执行必须重新 defer 到宿主确认。
  await recordHostAuthorizationEvent(root, "host-authorization-granted", {
    host,
    featureId: feature.featureId,
    riskClass: assessment.riskClass,
    commandFingerprint: assessment.commandFingerprint,
    sourceToolEvent: pending.data.sourceToolEvent,
    ...(pending.data.executionKey !== undefined ? { executionKey: pending.data.executionKey } : {}),
    grantedAt: new Date().toISOString(),
  });
}
