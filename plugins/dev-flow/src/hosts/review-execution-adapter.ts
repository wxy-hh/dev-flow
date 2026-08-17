import { readFile } from "node:fs/promises";
import { readActive, readFeatureEvents, recordReviewExecutionEvent } from "../core/state-store.js";
import { captureHostReviewEnvelope, recordCapturedEnvelope } from "../core/review-execution.js";
import type { HookEvent } from "./bash-syntax.js";

const DECLARATION_MARKER = /dev-flow:isolated-review:([A-Za-z0-9-]+)/u;

export interface SubagentReviewRecordResult {
  recorded: boolean;
  reason?: "no-active-feature" | "missing-marker" | "unknown-declaration" | "missing-context-ids" | "same-context" | "invalid-completion";
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
 * SubagentStop 不携带子代理输出文本（宿主 hook schema 里不存在提供输出的
 * 事件），声明 marker 只能从宿主给出的 transcript 文件恢复。读不到或找不到
 * marker 时返回空串，由调用方 fail-closed（missing-marker），绝不伪造证明。
 */
async function transcriptText(event: HookEvent): Promise<string> {
  const transcriptPath = event.agent_transcript_path;
  if (typeof transcriptPath !== "string" || !transcriptPath.trim()) return "";
  let contents: string;
  try {
    contents = await readFile(transcriptPath, "utf8");
  } catch {
    return "";
  }
  const marker = contents.match(DECLARATION_MARKER);
  if (!marker) return "";
  return marker[0];
}

/**
 * 宿主接缝：只接受 SubagentStop hook 自带的主/子上下文标识。
 * 拿不到独立且不同的 contextId 时不落 review-execution，fail-closed。
 */
export async function recordSubagentReviewOutput(
  root: string,
  event: HookEvent,
  host: "claude" | "codex",
): Promise<SubagentReviewRecordResult> {
  const active = await readActive(root);
  if (!active) return { recorded: false, reason: "no-active-feature" };

  const promptText = firstText(event.last_assistant_message)
    || firstText(event.prompt)
    || firstText(event.tool_input)
    || firstText(event.tool_response)
    || firstText(event.tool_result)
    || await transcriptText(event);
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
    executionRequestId?: unknown;
    capabilityHash?: unknown;
    packageSha256?: unknown;
    role?: unknown;
    leaseGeneration?: unknown;
    declaredAt?: unknown;
    host?: unknown;
  };
  if (typeof data.batchId !== "string" || typeof data.jobId !== "string"
    || (typeof data.executionId !== "string" && typeof data.executionRequestId !== "string")) {
    return { recorded: false, reason: "unknown-declaration", declarationId };
  }
  const executionId = typeof data.executionId === "string" ? data.executionId : String(data.executionRequestId);

  const input = event.tool_input ?? {};
  const response = event.tool_response && typeof event.tool_response === "object" ? event.tool_response as Record<string, unknown> : {};
  // Real Claude SubagentStop shape: session_id identifies the implementation
  // session and agent_id identifies the isolated subagent context. There is no
  // parent_session_id; accepting synthetic parent fields was the v5 bug.
  const contextId = [
    event.agent_id,
    input.agent_id,
    response.agent_id,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const implementationContextId = [
    event.session_id,
    input.session_id,
    response.session_id,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!contextId || !implementationContextId) {
    return { recorded: false, reason: "missing-context-ids", declarationId };
  }
  if (contextId === implementationContextId) {
    return { recorded: false, reason: "same-context", declarationId };
  }

  const eventId = `${declarationId}:complete`;
  const rawText = typeof event.last_assistant_message === "string"
    ? event.last_assistant_message
    : promptText;
  const rawResult = (() => {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const candidate = rawText.slice(start, end + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        return rawText;
      }
    }
    return rawText;
  })();
  await recordReviewExecutionEvent(root, {
    eventId,
    type: "review-execution",
    host: typeof data.host === "string" && (data.host === "claude" || data.host === "codex") ? data.host : host,
    batchId: data.batchId,
    jobId: data.jobId,
    executionId,
    sourceId: `subagent:${contextId}`,
    contextId,
    implementationContextId,
    parentContextId: implementationContextId,
    text: typeof event.last_assistant_message === "string" ? event.last_assistant_message : undefined,
  });
  // Phase 5 envelope: freeze the raw subagent output under the execution
  // lease. Old declarations without executionRequestId keep the v5 proof-only
  // behavior until their callers are removed.
  if (typeof data.executionRequestId === "string"
    && typeof data.capabilityHash === "string"
    && typeof data.packageSha256 === "string"
    && typeof data.role === "string"
    && typeof data.leaseGeneration === "number"
    && typeof data.declaredAt === "string") {
    try {
      const captured = await captureHostReviewEnvelope(root, {
        featureId: active.featureId,
        batchId: data.batchId as string,
        jobId: data.jobId as string,
        role: data.role as import("../policy/review.js").ReviewRole,
        packageSha256: data.packageSha256,
        capabilityHash: data.capabilityHash,
        executionRequestId: data.executionRequestId,
        leaseGeneration: data.leaseGeneration,
        declarationId,
        source: "claude-subagent",
        host: typeof data.host === "string" && (data.host === "claude" || data.host === "codex") ? data.host : host,
        hostEventId: eventId,
        parentContext: implementationContextId,
        childContext: contextId,
        agentId: contextId,
        startedAt: data.declaredAt,
        completedAt: new Date().toISOString(),
        rawResult,
      });
      await recordCapturedEnvelope(root, active.featureId, data.executionRequestId, captured.ref);
    } catch {
      return { recorded: false, reason: "invalid-completion", declarationId, eventId };
    }
  }
  return { recorded: true, declarationId, eventId };
}
