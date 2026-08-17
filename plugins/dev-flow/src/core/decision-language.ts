import type { InteractionKind, InteractionOption } from "../policy/interaction.js";
import { normalizeReplyText } from "./text-normalization.js";

export interface NaturalOptionMatch {
  option: InteractionOption;
  comment?: string;
}

/**
 * 确认语义词：对存在唯一确认/接受类选项（confirm/accept）的交互，
 * 这些短答在单一待决问题的上下文中唯一指向确认。多意图问题
 * （如工作区归属的纳入/排除并列）没有确认类选项，因此不受影响。
 */
const confirmationTerms: readonly string[] = ["确认", "同意", "批准", "可以", "好的", "行", "没问题", "lgtm", "approved"];

function unique(matches: NaturalOptionMatch[]): NaturalOptionMatch | undefined {
  const byOption = new Map(matches.map((match) => [match.option.id, match]));
  return byOption.size === 1 ? [...byOption.values()][0] : undefined;
}

const optionAliases: Readonly<Record<string, readonly string[]>> = {
  "adopt-all": ["全部纳入", "都纳入", "全都纳入", "全部算当前任务", "都算当前任务", "这些都算当前任务的"],
  "exclude-all": ["全部排除", "都排除", "全都排除", "这些都不算当前任务", "都先排除"],
  "one-by-one": ["逐个确认", "一个个确认", "一个个来", "逐个来"],
  adopt: ["纳入当前任务", "纳入", "算当前任务"],
  include: ["纳入当前任务", "这个算当前任务", "算当前任务"],
  exclude: ["排除并先处理", "排除", "不算当前任务"],
  "request-changes": ["修改", "要修改", "提出修改意见", "调整", "需要调整"],
  accept: ["接受", "接受风险", "仍然继续"],
  decline: ["不接受", "拒绝", "暂不继续"],
};

const interactionAliases: Partial<Record<InteractionKind, Readonly<Record<string, readonly string[]>>>> = {
  "route-confirmation": {
    confirm: ["确认路线", "路线没问题", "就按这条路线", "按这条路线"],
  },
};

/**
 * Match user-facing language to exactly one option. This intentionally does
 * not interpret approval confirmations: approval.ts owns that stricter policy.
 */
export function matchNaturalDecision(
  kind: InteractionKind,
  options: InteractionOption[],
  userReply: string,
): NaturalOptionMatch | undefined {
  const raw = userReply.trim();
  const normalized = normalizeReplyText(raw);
  if (!normalized) return undefined;

  const editMatch = raw.match(/^修改(?:需求|意见|计划|方案|)?[:：]?\s*([\s\S]*)$/u);
  if (editMatch) {
    const option = options.find((candidate) => candidate.id === "request-changes");
    if (option) return { option, comment: editMatch[1]?.trim() || undefined };
  }

  const matches: NaturalOptionMatch[] = [];
  for (const option of options) {
    const label = normalizeReplyText(option.label);
    if (!label) continue;
    if (label === normalized) matches.push({ option });

    // A meaningful fragment of a single label is a safe abbreviation. Keep
    // confirmation outside this generic rule so conditional text cannot pass.
    if (kind !== "approval" && normalized.length >= 4 && label.includes(normalized)) {
      matches.push({ option });
    }

    if (option.id !== "confirm" && normalized.startsWith(label) && normalized.length > label.length) {
      matches.push({ option, comment: raw.slice(option.label.length).replace(/^[:：]\s*/, "").trim() });
    }

    // 纯展示后缀（如「（推荐）」）不改变回答指向，对 confirm 同样容忍；
    // 非展示后缀（如「确认，但要修改…」）仍被拒绝，防止条件文本伪装确认。
    if (normalized.startsWith(label) && normalized.length > label.length) {
      const tail = normalized.slice(label.length);
      if (tail === "推荐" || tail === "推荐选项" || tail === "recommended") matches.push({ option });
    }

    if (kind !== "approval" && (optionAliases[option.id] ?? []).some((alias) => normalizeReplyText(alias) === normalized)) {
      matches.push({ option });
    }
    if (kind !== "approval" && (interactionAliases[kind]?.[option.id] ?? []).some((alias) => normalizeReplyText(alias) === normalized)) {
      matches.push({ option });
    }
  }
  if (confirmationTerms.includes(normalized)) {
    for (const option of options) {
      if (option.id === "confirm" || option.id === "accept") matches.push({ option });
    }
  }
  return unique(matches);
}
