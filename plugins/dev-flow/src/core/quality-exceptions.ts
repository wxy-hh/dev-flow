import { resolveInteractionPromptEvent } from "./interaction-provenance.js";
import { DevFlowError } from "./errors.js";
import { mutate, readFeatureEvents, readState, type FeatureState } from "./state-store.js";
import {
  createInteraction,
  getInteraction,
  resolveNativeInteraction,
  resolveTextInteraction,
  toPublicInteraction,
  type PublicInteraction,
} from "./user-interactions.js";
import type { QualityException } from "../policy/types.js";
import { satisfyObligations } from "../policy/obligations.js";

export interface QualityExceptionPresentation {
  state: FeatureState;
  interaction: PublicInteraction;
  interactionId: string;
}

function validKind(kind: string): QualityException["kind"] {
  if (kind === "review" || kind === "verification" || kind === "checkpoint" || kind === "implementation-evidence") return kind;
  throw new DevFlowError("QUALITY_EXCEPTION_KIND_INVALID", "该条件不是可接受风险的流程质量问题。", {
    userMessage: "当前问题属于系统完整性阻塞，不能通过接受风险跳过。",
    cause: "质量例外只允许 review、verification、checkpoint 或 implementation evidence 条件。",
    impact: "系统不会伪装完整性问题为成功。",
    recoveryKind: "repair",
    recoveryInstruction: "运行 doctor，并按修复、暂停或终止路径处理。",
    retryOriginal: false,
  });
}

export function hasCurrentQualityException(state: FeatureState, kind: QualityException["kind"]): boolean {
  return state.qualityExceptions.some((exception) => exception.kind === kind && exception.status === "current");
}

export async function presentQualityException(
  root: string,
  featureId: string,
  expectedRevision: number,
  input: { kind: string; basisHash: string; fingerprint: string; riskSummary: string },
): Promise<QualityExceptionPresentation> {
  const kind = validKind(input.kind);
  if (!input.riskSummary.trim()) throw new DevFlowError("QUALITY_EXCEPTION_SUMMARY_REQUIRED", "风险说明不能为空。", { userMessage: "请先说明接受风险的具体影响。", recoveryKind: "retry", recoveryInstruction: "补充简明风险说明后重试。", retryOriginal: true });
  let interactionId = "";
  let interaction: ReturnType<typeof createInteraction> | undefined;
  const state = await mutate(root, featureId, expectedRevision, "quality-exception-presented", (draft) => {
    const existing = draft.qualityExceptions.find((exception) => exception.kind === kind && exception.basisHash === input.basisHash && exception.fingerprint === input.fingerprint && exception.status === "current");
    if (existing) throw new DevFlowError("QUALITY_EXCEPTION_ALREADY_ACCEPTED", "当前依据已经记录过风险接受。", { userMessage: "当前风险已经在同一依据下记录，无需重复接受。", recoveryKind: "refresh", recoveryInstruction: "刷新状态后继续后续流程。", retryOriginal: false });
    interaction = createInteraction(draft, {
      kind: "quality-exception",
      target: `quality-exception:${kind}`,
      basisHash: input.basisHash,
      question: `当前${kind}证据存在质量风险。是否接受这项已知风险并继续？`,
      options: [
        { id: "accept", label: "接受风险", requiresComment: true },
        { id: "decline", label: "先修复问题" },
      ],
    });
    interactionId = interaction.id;
  }, () => ({ kind, presentationEventId: interaction?.presentationEventId }));
  if (!interaction) throw new DevFlowError("INTERACTION_NOT_CREATED", kind);
  return { state, interaction: toPublicInteraction(interaction), interactionId };
}

export async function resolveQualityExceptionAnswer(
  root: string,
  featureId: string,
  expectedRevision: number,
  interactionId: string,
  userReply: string,
  host: "claude" | "codex",
): Promise<FeatureState> {
  const initial = await readState(root, featureId);
  const interaction = getInteraction(initial, interactionId);
  if (interaction.kind !== "quality-exception" || interaction.status !== "pending") throw new DevFlowError("INTERACTION_NOT_PENDING", "当前风险问题已经处理。", { interactionId });
  const match = resolveInteractionPromptEvent(await readFeatureEvents(root, featureId), initial, interaction, {
    host,
    userReply,
  });
  return resolveQualityExceptionResponse(root, featureId, expectedRevision, interactionId, host, {
    source: "text",
    userReply,
    promptEventId: match.eventId,
    promptText: match.text,
  });
}

/** 原生表单来源：用户选择即可信落账，不需要宿主 user-prompt 事件。 */
export async function resolveQualityExceptionElicitation(
  root: string,
  featureId: string,
  expectedRevision: number,
  interactionId: string,
  action: string,
  comment: string | undefined,
  host: "claude" | "codex",
): Promise<FeatureState> {
  return resolveQualityExceptionResponse(root, featureId, expectedRevision, interactionId, host, {
    source: "elicitation",
    action,
    comment,
  });
}

type QualityExceptionResolution =
  | { source: "text"; userReply: string; promptEventId: string; promptText?: string }
  | { source: "elicitation"; action: string; comment?: string };

async function resolveQualityExceptionResponse(
  root: string,
  featureId: string,
  expectedRevision: number,
  interactionId: string,
  host: "claude" | "codex",
  input: QualityExceptionResolution,
): Promise<FeatureState> {
  const initial = await readState(root, featureId);
  const interaction = getInteraction(initial, interactionId);
  if (interaction.kind !== "quality-exception" || interaction.status !== "pending") throw new DevFlowError("INTERACTION_NOT_PENDING", "当前风险问题已经处理。", { interactionId });
  return mutate(root, featureId, expectedRevision, "quality-exception-answered", (state) => {
    const response = input.source === "text"
      ? resolveTextInteraction(state, interactionId, input.promptText ?? input.userReply, host, { promptEventId: input.promptEventId })
      : resolveNativeInteraction(state, interactionId, input.action, input.comment, host);
    const kind = interaction.target.slice("quality-exception:".length) as QualityException["kind"];
    if (response.action === "accept") {
      state.qualityExceptions.push({
        kind,
        basisHash: interaction.basisHash,
        fingerprint: state.workspace.lastWorkspaceFingerprint,
        riskSummary: interaction.question ?? "已接受当前流程质量风险。",
        userEvidence: response.comment ?? (input.source === "text" ? (input.promptText ?? input.userReply) : input.action),
        at: response.respondedAt,
        status: "current",
      });
      if (kind === "review" || kind === "verification" || kind === "checkpoint") {
        state.obligations = satisfyObligations(state.obligations, [kind]);
      }
    }
    state.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
  }, { interactionId });
}
