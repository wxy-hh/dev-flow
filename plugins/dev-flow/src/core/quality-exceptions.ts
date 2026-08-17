import { createHash } from "node:crypto";
import { DevFlowError } from "./errors.js";
import { mutate, mutatePrepared, readProjectConfig, readState, type FeatureState } from "./state-store.js";
import { captureEvidenceBaseline } from "./evidence-baseline.js";
import { fingerprintFeatureOwned } from "./fingerprint.js";
import { EMPTY_GOVERNANCE_LEDGER } from "../policy/governance-records.js";
import {
  createInteraction,
  getInteraction,
  resolveResponseForAnswer,
  toPublicInteraction,
  type PresentedInteraction,
  type PublicInteraction,
} from "./user-interactions.js";
import type { InteractionResponse } from "../policy/interaction.js";
import type { QualityException } from "../policy/types.js";
import type { AnswerResolveContext, AnswerResolveResult } from "./interaction-answer.js";
import { satisfyObligations } from "../policy/obligations.js";
import { currentRiskAuthorizations } from "./governance-state.js";

export type QualityExceptionPresentation = PresentedInteraction;

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
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  const authorization = currentRiskAuthorizations(state, { contentFingerprint: state.businessFingerprint }).some((item) => item.target === kind
    && (!Number.isFinite(invalidatedAt) || !item.recordedAt || Date.parse(item.recordedAt) >= invalidatedAt));
  return authorization;
}

/**
 * 当前风险接受结论是否覆盖某个路线步骤（issue 22）：验证失败或审查阻塞
 * 被用户接受后，门禁与 next 使用同一结论放行，但 state.steps 中的步骤状态
 * 不会被改写为通过——显示上始终是“风险已接受”，失败检查仍是失败。
 */
export function qualityExceptionCoversStep(state: FeatureState, step: string): boolean {
  const kindForStep: Partial<Record<string, QualityException["kind"]>> = {
    verification: "verification",
    code_review: "review",
    planning: "review",
    implementation: "implementation-evidence",
  };
  const kind = kindForStep[step];
  return kind !== undefined && hasCurrentQualityException(state, kind);
}

export async function presentQualityException(
  root: string,
  featureId: string,
  expectedRevision: number,
  input: { kind: string; basisHash: string; fingerprint: string; riskSummary: string },
): Promise<QualityExceptionPresentation> {
  const kind = validKind(input.kind);
  // 风险接受只绑定当时的交付内容（issue 22）：验证已对相同内容通过时，
  // 没有真实风险可接受，拒绝创建交互，避免把失败检查改写为通过。
  if (kind === "verification") {
    const initial = await readState(root, featureId);
    if (initial.verification.verifiedFingerprint === input.fingerprint) {
      throw new DevFlowError("QUALITY_EXCEPTION_NOT_NEEDED", "当前交付内容已通过验证，无需接受风险。", {
        recoveryHint: "验证已对当前内容通过，直接继续后续流程；只有验证再次失败或内容再次变化后才需要接受风险。",
      });
    }
  }
  if (!input.riskSummary.trim()) throw new DevFlowError("QUALITY_EXCEPTION_SUMMARY_REQUIRED", "风险说明不能为空。", { userMessage: "请先说明接受风险的具体影响。", recoveryKind: "retry", recoveryInstruction: "补充简明风险说明后重试。", retryOriginal: true });
  let interactionId = "";
  let interaction: ReturnType<typeof createInteraction> | undefined;
  const state = await mutate(root, featureId, expectedRevision, "quality-exception-presented", (draft) => {
    const existing = currentRiskAuthorizations(draft, { contentFingerprint: input.fingerprint }).find((authorization) => authorization.target === kind);
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

/** 质量例外（风险接受）经统一回答入口落账（ADR-0019）：accept 时追加风险授权账本。 */
export async function resolveQualityExceptionForAnswer(ctx: AnswerResolveContext): Promise<AnswerResolveResult> {
  const { root, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "quality-exception" || interaction.status !== "pending") {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "当前风险问题已经处理。", { interactionId: interaction.id });
  }
  let promptEventId: string | undefined;
  let promptText: string | undefined;
  if (credential.source === "text") {
    promptEventId = credential.promptEventId;
    promptText = credential.promptText;
  }
  let response: InteractionResponse | undefined;
  const next = await mutatePrepared(root, featureId, expectedRevision, "quality-exception-answered", async (current) => {
    const live = getInteraction(current as FeatureState, interaction.id);
    if (live.kind !== "quality-exception" || live.status !== "pending") {
      throw new DevFlowError("INTERACTION_NOT_PENDING", "当前风险问题已经处理。", { interactionId: interaction.id });
    }
    return {
      mutate: async (draft) => {
        response = resolveResponseForAnswer(draft, interaction, {
          source: credential.source,
          action: credential.source === "elicitation" ? credential.action : undefined,
          comment: credential.source === "elicitation" ? credential.comment : undefined,
          userReply: credential.source === "text" ? (credential.promptText) : undefined,
          promptText,
          promptEventId,
          host,
        });
        const kind = interaction.target.slice("quality-exception:".length) as QualityException["kind"];
        if (response.action === "accept") {
          const config = await readProjectConfig(root);
          const baseline = await captureEvidenceBaseline(root, draft, config, {
            kind: "risk-acceptance",
            target: kind,
            recordId: `AUTH-qe-${interaction.id}`,
            at: response.respondedAt,
          });
          const fingerprint = await fingerprintFeatureOwned(root, config, draft.workspace.ownership);
          draft.businessFingerprint = fingerprint;
          draft.evidenceStore = baseline.pointer;
          // 治理账本：风险接受是"授权"记录，追加到不可变 authorizations 账本并
          // 绑定本次交互凭证（spec §202；与 recordDecision 的账本模式一致）。
          const gov = draft.governance ?? EMPTY_GOVERNANCE_LEDGER;
          const credentialId = `CRED-qe-${interaction.id}`;
          const authorizationId = `AUTH-${createHash("sha256").update(`${kind}|${fingerprint}|${response.respondedAt}`).digest("hex").slice(0, 16)}`;
          const authorizations = [...gov.authorizations];
          if (!authorizations.some((authorization) => authorization.recordId === authorizationId)) {
            authorizations.push({
              recordId: authorizationId,
              kind: "authorization",
              authorizationType: "risk-acceptance",
              target: kind,
              credentialId,
              basis: { kind: "content", sha256: fingerprint },
              baselineRef: baseline.ref,
              recordedAt: response.respondedAt,
            });
          }
          const credentials = [...gov.credentials];
          if (!credentials.some((existing) => existing.recordId === credentialId)) {
            credentials.push({
              recordId: credentialId,
              kind: "credential",
              source: credential.source === "elicitation" ? "native-form" : "text",
              host,
              interactionId: interaction.id,
              ...(response.selectedOptionId ? { optionId: response.selectedOptionId } : {}),
              // Native forms do not have a raw user-prompt reply. Preserve the
              // supplied comment as the credential's user-visible text so the
              // acceptance record remains auditable after legacy projections are
              // rebuilt from the governance ledger.
              ...((response.rawReply ?? response.comment) ? { rawText: response.rawReply ?? response.comment } : {}),
              basis: interaction.presentationEventId ? { kind: "event", eventId: interaction.presentationEventId } : undefined,
              recordedAt: response.respondedAt,
            });
          }
          draft.governance = { ...gov, authorizations, credentials };
          if (kind === "review" || kind === "verification" || kind === "checkpoint") {
            draft.obligations = satisfyObligations(draft.obligations, [kind]);
          }
        }
        draft.lastUpdatedBy = { host, pluginVersion: __DEV_FLOW_VERSION__ };
      },
      eventData: { interactionId: interaction.id },
    };
  });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...(response.comment ? { comment: response.comment } : {}) };
}