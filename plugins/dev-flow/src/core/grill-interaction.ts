import { DevFlowError } from "./errors.js";
import type { GrillAnswerCode, GrillRecommendation } from "../policy/interaction.js";

export interface GrillOption {
  id: string;
  label: string;
  description?: string;
  requiresComment?: boolean;
}

export interface GrillPresentationOption extends GrillOption {
  answerCode: GrillAnswerCode;
  recommended: boolean;
}

export interface GrillPresentation {
  question: string;
  options: GrillPresentationOption[];
  recommendation: GrillRecommendation;
  text: string;
}

export type GrillReplyMatch =
  | {
    kind: "option";
    answerCode: GrillAnswerCode;
    selectedOptionId: string;
    rawReply: string;
    comment?: string;
  }
  | {
    kind: "other";
    rawReply: string;
    comment: string;
  };

const answerCodes = ["A", "B", "C"] as const;

function invalid(message: string): never {
  throw new DevFlowError("GRILL_PRESENTATION_INVALID", message, {
    userMessage: "当前 grill 问题不符合交互合同。",
    recoveryKind: "repair",
    recoveryInstruction: "提供 2-3 个带说明的选项，并明确一个推荐项及推荐理由。",
    retryOriginal: false,
  });
}

export function buildGrillPresentation(input: {
  question: string;
  options: GrillOption[];
  recommendation: GrillRecommendation;
}): GrillPresentation {
  const question = input.question.trim();
  if (!question) invalid("question must not be empty");
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 3) {
    invalid("grill must contain 2-3 options");
  }
  if (input.options.some((option) => option.id === "other" || !option.description?.trim())) {
    invalid("grill options require descriptions and cannot use the reserved other id");
  }
  const reason = input.recommendation.reason.trim();
  if (!reason) invalid("recommendation reason must not be empty");
  const recommendedIndex = input.options.findIndex((option) => option.id === input.recommendation.optionId);
  if (recommendedIndex < 0) invalid("recommendation must reference one current option");

  // 推荐提醒（高影响交互）：推荐一旦携带缺点或替代条件之一，就必须两者
  // 齐全且替代项引用当前的非推荐选项；普通低影响问题不携带这些字段，
  // 呈现保持简短。
  const drawback = input.recommendation.drawback?.trim();
  const alternative = input.recommendation.alternative;
  const hasReminder = drawback !== undefined || alternative !== undefined;
  if (hasReminder) {
    if (!drawback || !alternative || !alternative.condition.trim()) {
      invalid("high-impact recommendation requires both a drawback and an alternative condition");
    }
    if (alternative.optionId === input.recommendation.optionId) {
      invalid("alternative must reference a non-recommended option");
    }
    const alternativeIndex = input.options.findIndex((option) => option.id === alternative.optionId);
    if (alternativeIndex < 0) invalid("alternative must reference one current option");
  }

  const options = input.options.map((option, index): GrillPresentationOption => ({
    ...option,
    answerCode: answerCodes[index],
    recommended: index === recommendedIndex,
  }));
  const lines = [question];
  for (const option of options) {
    lines.push("");
    lines.push(`${option.answerCode}. ${option.label}${option.recommended ? "（推荐）" : ""}`);
    lines.push(`   ${option.recommended ? reason : option.description!.trim()}`);
  }
  if (hasReminder) {
    const alternativeOption = options.find((option) => option.id === alternative!.optionId)!;
    lines.push("");
    lines.push(`提醒：推荐方案的主要缺点是 ${drawback}。`);
    lines.push(`如果 ${alternative!.condition.trim()}，选项 ${alternativeOption.answerCode}（${alternativeOption.label}）可能更合适。`);
  }
  lines.push("");
  const codes = options.map((option) => option.answerCode);
  lines.push(`请回复 ${codes.slice(0, -1).join("、")} 或 ${codes.at(-1)}。`);
  lines.push("如果都不合适，请回复“其他：<你的方案和理由>”。");

  return {
    question,
    options,
    recommendation: { optionId: input.recommendation.optionId, reason },
    text: lines.join("\n"),
  };
}

function answerCodeFromReply(userReply: string): GrillAnswerCode | undefined {
  const normalized = userReply.normalize("NFKC").trim().toUpperCase();
  if (/^[ABC]$/u.test(normalized)) return normalized as GrillAnswerCode;
  const positiveCodes = new Set<GrillAnswerCode>();
  const negativeCodes = new Set<GrillAnswerCode>();
  for (const match of normalized.matchAll(/(?<![A-Z])([ABC])(?![A-Z])/gu)) {
    const code = match[1] as GrillAnswerCode;
    const before = normalized.slice(0, match.index);
    const after = normalized.slice((match.index ?? 0) + match[0].length);
    const negated = /(?:不选(?:择)?|不要|别选|排除|拒绝)\s*(?:方案|选项)?\s*$/u.test(before);
    if (negated) {
      negativeCodes.add(code);
      continue;
    }
    const selected = /(?:我?选(?:择)?|采用|使用|就用|按)\s*(?:方案|选项)?\s*$/u.test(before)
      || /(?:方案|选项)\s*$/u.test(before)
      || /^\s*(?:吧|来|更合适|就行|即可)(?:[。！!])?\s*$/u.test(after);
    if (selected) positiveCodes.add(code);
  }
  if (positiveCodes.size !== 1) return undefined;
  const selected = [...positiveCodes][0];
  return negativeCodes.has(selected) ? undefined : selected;
}

function normalizeMeaning(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[\s\u00A0\uFEFF]+/g, "")
    .replace(/[，。！？、；：,.!?;:()（）【】\[\]“”"']/g, "")
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchGrillReply(input: {
  options: GrillOption[];
  userReply: string;
}): GrillReplyMatch | undefined {
  const rawReply = input.userReply.trim();
  if (!rawReply || input.options.length < 2 || input.options.length > 3) return undefined;
  const otherMatch = rawReply.match(/^其他\s*[:：+＋]\s*([\s\S]+)$/u)
    ?? rawReply.match(/^(?:这些|这几个|以上)?(?:都|全都)?不(?:合适|适合|接受|选(?:择)?)[了]?\s*[，,:：]?\s*([\s\S]+)$/u);
  const otherComment = otherMatch?.[1]?.trim();
  if (otherComment && otherComment.length >= 2) {
    return { kind: "other", rawReply, comment: otherComment };
  }
  const answerCode = answerCodeFromReply(rawReply);
  let optionIndex = answerCode ? answerCodes.indexOf(answerCode) : -1;
  if (optionIndex < 0) {
    const normalizedReply = normalizeMeaning(rawReply);
    const labelMatches = input.options.flatMap((option, index) => {
      const label = normalizeMeaning(option.label);
      const selectedLabel = normalizedReply === label
        || new RegExp(`^(?:我)?(?:选|选择|采用|使用|就用|按(?:方案|选项)?)${escapeRegExp(label)}(?:吧|来)?$`, "u").test(normalizedReply);
      return selectedLabel ? [index] : [];
    });
    if (labelMatches.length !== 1) return undefined;
    [optionIndex] = labelMatches;
  }
  const option = input.options[optionIndex];
  if (!option) return undefined;
  return {
    kind: "option",
    answerCode: answerCodes[optionIndex],
    selectedOptionId: option.id,
    rawReply,
  };
}
