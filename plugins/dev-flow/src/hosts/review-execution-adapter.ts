import { readActive, readFeatureEvents, recordReviewExecutionEvent } from "../core/state-store.js";
import type { HookEvent } from "./bash-syntax.js";

const DECLARATION_MARKER = /dev-flow:isolated-review:([A-Za-z0-9-]+)/u;

export interface SubagentReviewRecordResult {
  recorded: boolean;
  reason?: "no-active-feature" | "missing-marker" | "unknown-declaration" | "missing-context-ids" | "same-context";
  declarationId?: string;
  eventId?: string;
}

function firstText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["prompt", "description", "text"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return "";
}

/**
 * 宿主接缝：只接受 SubagentOutput hook 自带的主/子上下文标识。
 * 拿不到独立且不同的 contextId 时不落 review-execution，fail-closed。
 */
export async function recordSubagentReviewOutput(
  root: string,
  event: HookEvent,
  host: "claude" | "codex",
): Promise<SubagentReviewRecordResult> {
  const active = await readActive(root);
  if (!active) return { recorded: false, reason: "no-active-feature" };

  const promptText = firstText(event.prompt)
    || firstText(event.tool_input)
    || firstText(event.tool_response)
    || firstText(event.tool_result);
  const marker = promptText.match(DECLARATION_MARKER);
  if (!marker) return { recorded: false, reason: "missing-marker" };

  const declarationId = marker[1]!;
  const events = await readFeatureEvents(root, active.featureId);
  const declaration = [...events].reverse().find((item) => {
    const data = item.data as { type?: unknown; declarationId?: unknown };
    return item.type === "review-execution-declared"
      && data?.type === "review-execution-declared"
      && data.declarationId === declarationId;
  });
  if (!declaration) return { recorded: false, reason: "unknown-declaration", declarationId };

  const data = declaration.data as {
    batchId?: unknown;
    jobId?: unknown;
    executionId?: unknown;
    host?: unknown;
  };
  if (typeof data.batchId !== "string" || typeof data.jobId !== "string" || typeof data.executionId !== "string") {
    return { recorded: false, reason: "unknown-declaration", declarationId };
  }

  const input = event.tool_input ?? {};
  const response = event.tool_response && typeof event.tool_response === "object" ? event.tool_response as Record<string, unknown> : {};
  const contextId = [
    input.subagent_session_id,
    input.subagent_context_id,
    response.subagent_session_id,
    response.session_id,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const implementationContextId = [
    input.parent_session_id,
    input.parent_context_id,
    response.parent_session_id,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!contextId || !implementationContextId) {
    return { recorded: false, reason: "missing-context-ids", declarationId };
  }
  if (contextId === implementationContextId) {
    return { recorded: false, reason: "same-context", declarationId };
  }

  const eventId = `${declarationId}:complete`;
  await recordReviewExecutionEvent(root, {
    eventId,
    type: "review-execution",
    host: typeof data.host === "string" && (data.host === "claude" || data.host === "codex") ? data.host : host,
    batchId: data.batchId,
    jobId: data.jobId,
    executionId: data.executionId,
    sourceId: `subagent:${contextId}`,
    contextId,
    implementationContextId,
    parentContextId: implementationContextId,
  });
  return { recorded: true, declarationId, eventId };
}
