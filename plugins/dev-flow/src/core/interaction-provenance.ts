import { normalizeReplyText, textCompatible, type UserInteraction } from "./user-interactions.js";
import { DevFlowError } from "./errors.js";

export interface HostEventRecord {
  revision: number;
  type: string;
  at: string;
  data: unknown;
}

export interface ResolvedPromptEvent {
  eventId: string;
  revision: number;
  at: string;
  text: string;
  host: "claude" | "codex";
}

function presentationEventIndex(
  events: HostEventRecord[],
  input: { presentationEventId?: string; presentedAt: string; presentedRevision: number },
): number | undefined {
  const index = events.findIndex((record) => {
    if (record.type === "host-event") return false;
    if (input.presentationEventId) {
      if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) return false;
      return (record.data as Record<string, unknown>).presentationEventId === input.presentationEventId;
    }
    return record.revision >= input.presentedRevision
      && Date.parse(record.at) >= Date.parse(input.presentedAt);
  });
  return index >= 0 ? index : undefined;
}

function promptFrom(record: HostEventRecord): { eventId: string; text: string; host: "claude" | "codex"; at: string; question?: string } | undefined {
  if (record.type !== "host-event" || !record.data || typeof record.data !== "object" || Array.isArray(record.data)) return undefined;
  const data = record.data as { eventId?: unknown; type?: unknown; text?: unknown; host?: unknown; at?: unknown; question?: unknown };
  if (data.type !== "user-prompt" || typeof data.eventId !== "string" || typeof data.text !== "string" || (data.host !== "claude" && data.host !== "codex")) return undefined;
  const at = typeof data.at === "string" ? data.at : record.at;
  if (Number.isNaN(Date.parse(at))) return undefined;
  const question = typeof data.question === "string" && data.question.trim() ? data.question : undefined;
  return { eventId: data.eventId, text: data.text, host: data.host, at, ...(question ? { question } : {}) };
}

/**
 * 事件与本次回答的关系判定：事件文本与 userReply 语义兼容，
 * 或事件携带的问题文本与当前交互问题兼容（结构化凭证——表单选中
 * 与 agent 转述无关，转述不参与归属）。
 */
function eventMatchesPrompt(
  prompt: { text: string; question?: string },
  input: { userReply: string; question?: string },
): boolean {
  if (textCompatible(prompt.text, input.userReply)) return true;
  return Boolean(input.question && prompt.question && textCompatible(prompt.question, input.question));
}

/** Resolve a user reply to exactly one later, same-host prompt event. */
export function resolvePromptEvent(
  events: HostEventRecord[],
  input: {
    host: "claude" | "codex";
    userReply: string;
    presentedAt: string;
    presentedRevision: number;
    presentationEventId?: string;
    consumedEventIds?: Iterable<string>;
    question?: string;
  },
): ResolvedPromptEvent {
  const consumed = new Set(input.consumedEventIds ?? []);
  const presentationIndex = presentationEventIndex(events, input);
  const isAfterPresentation = (record: HostEventRecord, index: number): boolean => {
    if (presentationIndex !== undefined) return index > presentationIndex;
    return record.revision > input.presentedRevision && Date.parse(promptFrom(record)?.at ?? "") >= Date.parse(input.presentedAt);
  };
  const otherHost = events.flatMap((record, index) => {
    const prompt = promptFrom(record);
    if (!prompt || prompt.host === input.host || consumed.has(prompt.eventId)) return [];
    if (!isAfterPresentation(record, index)) return [];
    return eventMatchesPrompt(prompt, input) ? [prompt] : [];
  });
  if (otherHost.length) {
    throw new DevFlowError("HOST_EVENT_HOST_MISMATCH", "匹配到的用户回答来自另一个宿主。", {
      userMessage: "这次回答不是由当前宿主捕获的，当前问题仍保持待回答。",
      cause: "用户回答事件的宿主与当前回答宿主不一致。",
      impact: "系统没有消费跨宿主事件，避免重复或错误确认。",
      recoveryKind: "retry",
      recoveryInstruction: "请在当前宿主中重新发送一次完整回答。",
      retryOriginal: true,
      actualHost: otherHost[0].host,
    });
  }
  // 候选先经文本兼容匹配（可区分多问题表单的各自回答）；没有文本匹配时，
  // 信任带结构化问题字段的原生表单事件——选中即信任，展示问题的改写/精简
  // 不改变归属。文本匹配优先，避免多问题表单中非当前问题的回答误归属。
  const candidates = events.flatMap((record, index) => {
    const prompt = promptFrom(record);
    if (!prompt || prompt.host !== input.host || consumed.has(prompt.eventId)) return [];
    if (!isAfterPresentation(record, index)) return [];
    return [{ prompt, record, index }];
  });
  const textMatches = candidates.filter(({ prompt }) => textCompatible(prompt.text, input.userReply));
  const matches = (textMatches.length ? textMatches : candidates.filter(({ prompt }) => Boolean(prompt.question)))
    .map(({ prompt, record }) => ({ eventId: prompt.eventId, revision: record.revision, at: prompt.at, text: prompt.text, host: prompt.host }));
  if (matches.length === 0) {
    throw new DevFlowError("INTERACTION_PROVENANCE_UNAVAILABLE", "没有找到呈现问题之后、来自当前宿主的唯一用户回答。", {
      userMessage: "没有确认到这次回答属于当前问题。",
      cause: "当前宿主没有捕获到匹配的后续用户消息，或该消息已被消费。",
      impact: "当前问题仍保持待回答，系统不会猜测用户意图。",
      recoveryKind: "retry",
      recoveryInstruction: "当前宿主没有捕获这条用户消息。不要让用户改写或重复同一答案；先运行 dev_flow_doctor 恢复 UserPromptSubmit/AskUserQuestion hook，再只呈现当前问题一次。",
      retryOriginal: true,
    });
  }
  if (matches.length > 1) {
    throw new DevFlowError("INTERACTION_PROVENANCE_AMBIGUOUS", "同一回答匹配了多个未消费的用户事件。", {
      userMessage: "无法唯一确认这次回答，当前问题仍保持待回答。",
      cause: "存在多个相同文本的候选用户消息。",
      impact: "为避免误消费，系统没有任选一个事件。",
      recoveryKind: "retry",
      recoveryInstruction: "请重新发送一次完整回答，避免重复提交。",
      retryOriginal: true,
      matchCount: matches.length,
    });
  }
  return matches[0];
}

/**
 * Canonical interaction cursor adapter, including early 5.0 records that did
 * not persist a presentation id/revision on the interaction itself.
 */
export function resolveInteractionPromptEvent(
  events: HostEventRecord[],
  state: { revision: number; pendingDecision?: { target?: string; presentedRevision: number } },
  interaction: UserInteraction,
  input: {
    host: "claude" | "codex";
    userReply: string;
    consumedEventIds?: Iterable<string>;
  },
): ResolvedPromptEvent {
  const presentedRevision = Number.isInteger(interaction.presentedRevision)
    ? interaction.presentedRevision!
    : state.pendingDecision?.target === interaction.target
      ? state.pendingDecision.presentedRevision
      : Math.max(0, state.revision - 1);
  return resolvePromptEvent(events, {
    ...input,
    presentedAt: interaction.presentedAt,
    presentedRevision,
    ...(interaction.presentationEventId ? { presentationEventId: interaction.presentationEventId } : {}),
    ...(interaction.question ? { question: interaction.question } : {}),
  });
}

export function consumedPromptEventIds(events: HostEventRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) continue;
    const data = event.data as Record<string, unknown>;
    for (const key of ["promptEventId", "eventId"]) {
      if (key === "eventId") continue;
      if (typeof data[key] === "string") ids.add(data[key] as string);
    }
  }
  return ids;
}
