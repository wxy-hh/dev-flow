import type { HookEvent } from "./adapter-policy.js";
import type { HostId } from "../core/host-id.js";
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

type Host = HostId;

function eventId(event: HookEvent, assessment: RiskAssessment, kind: string): string {
  const value = (event as HookEvent & { event_id?: unknown; tool_use_id?: unknown; permission_request_id?: unknown; tool_call_id?: unknown });
  const supplied = [value.event_id, value.tool_use_id, value.permission_request_id, value.tool_call_id].find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
  return supplied ?? `${kind}:${assessment.commandFingerprint}`;
}

async function activeFeature(root: string): Promise<{ featureId: string; revision: number } | undefined> {
  const active = await readActive(root);
  if (!active) return undefined;
  const state = await readState(root, active.featureId);
  if (state.lifecycle !== "active" || state.revision !== active.revision) return undefined;
  return { featureId: active.featureId, revision: active.revision };
}

function sameFeatureRisk(record: HostAuthorizationRecord, featureId: string, assessment: RiskAssessment): boolean {
  return record.featureId === featureId
    && record.riskClass === assessment.riskClass;
}

function sameRequest(record: HostAuthorizationRecord, host: Host, featureId: string, assessment: RiskAssessment): boolean {
  return record.host === host
    && sameFeatureRisk(record, featureId, assessment)
    && record.commandFingerprint === assessment.commandFingerprint;
}

/** Defer to the native host unless a current feature grant already exists. */
export async function evaluatePermissionRequest(root: string, event: HookEvent, host: Host): Promise<HostPermissionOutcome | undefined> {
  if (event.hook_event_name !== "PermissionRequest") return undefined;
  const assessment = classifyRisk({ toolName: event.tool_name, toolInput: event.tool_input }, root);
  if (!assessment) return undefined;
  const feature = await activeFeature(root);
  if (!feature) return undefined;
  const events = await readHostAuthorizationEvents(root, feature.featureId);
  const granted = events.some((item) => item.type === "host-authorization-granted" && sameFeatureRisk(item.data, feature.featureId, assessment));
  if (granted) return { kind: "allow", assessment };

  const sourceToolEvent = eventId(event, assessment, "permission-request");
  await recordHostAuthorizationEvent(root, "host-authorization-pending", {
    host,
    featureId: feature.featureId,
    riskClass: assessment.riskClass,
    commandFingerprint: assessment.commandFingerprint,
    sourceToolEvent,
    requestedAt: new Date().toISOString(),
  });
  return { kind: "defer", assessment };
}

function postToolSucceeded(event: HookEvent): boolean {
  const value = event as HookEvent & { error?: unknown; tool_response?: unknown; tool_result?: unknown };
  if (value.error !== undefined && value.error !== null) return false;
  for (const response of [value.tool_response, value.tool_result]) {
    if (!response || typeof response !== "object") continue;
    const candidate = response as Record<string, unknown>;
    if (candidate.is_error === true || candidate.isError === true || candidate.success === false || candidate.error !== undefined) return false;
  }
  return true;
}

/** Convert a successful native permission flow into a feature-scoped grant. */
export async function recordPermissionPostToolUse(root: string, event: HookEvent, host: Host): Promise<void> {
  if (event.hook_event_name !== "PostToolUse" || !postToolSucceeded(event)) return;
  const assessment = classifyRisk({ toolName: event.tool_name, toolInput: event.tool_input }, root);
  if (!assessment || assessment.riskClass !== "task-reusable") return;
  const feature = await activeFeature(root);
  if (!feature) return;
  const events = await readHostAuthorizationEvents(root, feature.featureId);
  const pending = [...events].reverse().find((item) => item.type === "host-authorization-pending" && sameRequest(item.data, host, feature.featureId, assessment));
  if (!pending) return;
  const alreadyGranted = events.some((item) => item.type === "host-authorization-granted" && sameRequest(item.data, host, feature.featureId, assessment));
  if (alreadyGranted) return;
  await recordHostAuthorizationEvent(root, "host-authorization-granted", {
    host,
    featureId: feature.featureId,
    riskClass: assessment.riskClass,
    commandFingerprint: assessment.commandFingerprint,
    sourceToolEvent: pending.data.sourceToolEvent,
    grantedAt: new Date().toISOString(),
  });
}

function extractKimiPermissionDecision(event: HookEvent): "allowed" | "denied" | undefined {
  const value = event as HookEvent & Record<string, unknown>;
  for (const candidate of [value.decision, value.result, value.granted, value.allowed, value.permission_decision]) {
    if (candidate === true || candidate === "allow" || candidate === "allowed" || candidate === "approve" || candidate === "approved" || candidate === "granted") return "allowed";
    if (candidate === false || candidate === "deny" || candidate === "denied" || candidate === "reject" || candidate === "rejected") return "denied";
  }
  return undefined;
}

/**
 * Kimi's PermissionRequest/PermissionResult are observation-only events: hooks
 * cannot make the host's approval decision, so this path never emits an allow
 * and only persists the native request for audit.
 */
export async function recordKimiPermissionRequest(root: string, event: HookEvent): Promise<void> {
  if (event.hook_event_name !== "PermissionRequest") return;
  const assessment = classifyRisk({ toolName: event.tool_name, toolInput: event.tool_input }, root);
  if (!assessment) return;
  const feature = await activeFeature(root);
  if (!feature) return;
  await recordHostAuthorizationEvent(root, "host-authorization-pending", {
    host: "kimi",
    featureId: feature.featureId,
    riskClass: assessment.riskClass,
    commandFingerprint: assessment.commandFingerprint,
    sourceToolEvent: eventId(event, assessment, "kimi-permission-request"),
    requestedAt: new Date().toISOString(),
  });
}

/** Persist Kimi's real PermissionResult outcome as a write-only audit record. */
export async function recordKimiPermissionResult(root: string, event: HookEvent): Promise<void> {
  if (event.hook_event_name !== "PermissionResult") return;
  const assessment = classifyRisk({ toolName: event.tool_name, toolInput: event.tool_input }, root);
  if (!assessment) return;
  const feature = await activeFeature(root);
  if (!feature) return;
  await recordHostAuthorizationEvent(root, "host-authorization-result", {
    host: "kimi",
    featureId: feature.featureId,
    riskClass: assessment.riskClass,
    commandFingerprint: assessment.commandFingerprint,
    sourceToolEvent: eventId(event, assessment, "kimi-permission-result"),
    decision: extractKimiPermissionDecision(event),
    decidedAt: new Date().toISOString(),
  });
}
