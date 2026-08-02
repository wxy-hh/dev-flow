import { normalizeReplyText } from "./user-interactions.js";

/**
 * An approval is addressed by the Core-derived obligation id. There is no
 * fixed route gate or business-specific confirmation name in v2.
 */
export type ApprovalId = string;

export const approvalPhrases: readonly string[] = [
  "确认",
  "确认需求",
  "需求已确认",
  "同意需求",
  "确认执行",
  "批准实现",
  "同意实现",
  "开始实现",
  "approved",
  "LGTM",
];

export function approvalReplyHint(): string {
  return `✅ 如需确认开始执行，直接回复：${approvalPhrases.join(" / ")}`;
}

export function isExplicitApproval(userReply: string): boolean {
  const normalized = normalizeReplyText(userReply);
  return approvalPhrases.some((phrase) => normalizeReplyText(phrase) === normalized);
}
