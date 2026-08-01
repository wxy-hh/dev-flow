import { normalizeReplyText } from "./user-interactions.js";

export type GateId = "requirement_confirmation" | "implementation_approval";

export const gateApprovalPhrases: Record<GateId, readonly string[]> = {
  requirement_confirmation: [
    "确认",
    "确认需求",
    "需求已确认",
    "同意需求",
    "approved",
    "LGTM",
  ],
  implementation_approval: [
    "确认",
    "确认执行",
    "批准实现",
    "同意实现",
    "开始实现",
    "approved",
    "LGTM",
  ],
};

const normalizeGateReply = (value: string): string => normalizeReplyText(value);

export function gateReplyHint(gate: GateId): string {
  const verb = gate === "requirement_confirmation" ? "确认需求" : "批准实现";
  return `✅ 如需${verb}，直接回复：${gateApprovalPhrases[gate].join(" / ")}`;
}

export function isExplicitGateApproval(gate: GateId, userReply: string): boolean {
  const normalized = normalizeGateReply(userReply);
  return gateApprovalPhrases[gate].some((phrase) => normalizeGateReply(phrase) === normalized);
}
