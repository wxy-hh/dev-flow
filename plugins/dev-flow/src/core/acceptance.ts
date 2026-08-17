import { createHash, randomUUID } from "node:crypto";
import type { AcceptanceDispositionState, AcceptanceEvidenceKind, AcceptanceEvidenceRecord, GovernanceCredential, RepositoryObservation } from "../policy/governance-records.js";
import { fingerprintFeatureOwned } from "./fingerprint.js";
import { readProjectConfig, readFeatureEvents, mutate, mutatePrepared, readState, type FeatureState } from "./state-store.js";
import { readTraceability } from "./traceability-store.js";
import { executeRepositoryObservation } from "./repository-fact-store.js";
import { storeScreenshotArtifact } from "./acceptance-store.js";
import { DevFlowError } from "./errors.js";
import { createInteraction, getInteraction, resolveResponseForAnswer, toPublicInteraction, type PresentedInteraction, type PublicInteraction } from "./user-interactions.js";
import type { InteractionResponse, UserInteraction } from "../policy/interaction.js";
import type { AnswerResolveContext, AnswerResolveResult } from "./interaction-answer.js";

const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export interface AcceptanceEvidenceInput {
  acceptanceCriterionId: string;
  evidence: {
    kind: AcceptanceEvidenceKind;
    eventId?: string;
    path?: string;
    sourceEventId?: string;
    observation?: RepositoryObservation;
    note?: string;
  };
  host: "claude" | "codex";
}

function currentHumanCriteria(state: FeatureState, trace: Awaited<ReturnType<typeof readTraceability>>): string[] {
  return Object.values(trace.nodes)
    .filter((node) => node.status === "current" && node.kind === "acceptance-criterion" && node.verificationDisposition?.kind === "human-acceptance")
    .map((node) => node.id)
    .sort();
}

async function currentBasis(root: string, state: FeatureState): Promise<{ fingerprint: string; trace: Awaited<ReturnType<typeof readTraceability>> }> {
  const config = await readProjectConfig(root);
  const fingerprint = await fingerprintFeatureOwned(root, config, state.workspace.ownership);
  const trace = await readTraceability(root, state);
  return { fingerprint, trace };
}

function ensureAcceptance(state: FeatureState): NonNullable<FeatureState["acceptance"]> {
  state.acceptance ??= { evidence: [], dispositions: [] };
  return state.acceptance;
}

function upsertDisposition(state: FeatureState, criterionId: `AC-${string}`, status: "pending" | "satisfied" | "stale", basisHash: string, evidenceRefs: string[]): void {
  const acceptance = ensureAcceptance(state);
  const existing = acceptance.dispositions.find((item) => item.acceptanceCriterionId === criterionId);
  const next: AcceptanceDispositionState = {
    acceptanceCriterionId: criterionId,
    dispositionKind: "human-acceptance",
    status,
    evidenceRefs: [...new Set(evidenceRefs)],
    basis: { kind: "content", sha256: basisHash },
  };
  if (existing) Object.assign(existing, next);
  else acceptance.dispositions.push(next);
}

async function browserEvent(root: string, id: string, eventId: string, host: "claude" | "codex"): Promise<void> {
  const events = await readFeatureEvents(root, id);
  const event = events.find((candidate) => candidate.type === "host-event" && (candidate.data as { eventId?: unknown }).eventId === eventId);
  const data = event?.data as { host?: unknown; type?: unknown; toolName?: unknown; executionId?: unknown; result?: unknown; resultSummary?: unknown } | undefined;
  if (!event || data?.host !== host || data.type !== "tool" || typeof data.toolName !== "string" || !/(browser|chrome|computer|playwright|screenshot)/iu.test(data.toolName)
    || typeof data.executionId !== "string" || !data.executionId || data.result !== "success" || typeof data.resultSummary !== "string" || !data.resultSummary) {
    throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "浏览器验收必须引用当前宿主捕获的真实浏览器工具事件。", { eventId });
  }
}

export async function recordAcceptanceEvidence(root: string, id: string, expectedRevision: number, input: AcceptanceEvidenceInput): Promise<FeatureState> {
  if (input.evidence.kind === "agent-self-check") {
    if (!input.evidence.note?.trim()) throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "智能体自检必须说明检查内容。", { recoveryHint: "自检只能作为参考，不能完成人工验收。" });
  }
  const initial = await readState(root, id);
  const { fingerprint, trace } = await currentBasis(root, initial);
  const criterion = trace.nodes[input.acceptanceCriterionId];
  if (!criterion || criterion.status !== "current" || criterion.kind !== "acceptance-criterion" || criterion.verificationDisposition?.kind !== "human-acceptance") {
    throw new DevFlowError("ACCEPTANCE_CRITERION_NOT_HUMAN", "该验收条件当前没有人工验收处置。", { acceptanceCriterionId: input.acceptanceCriterionId });
  }
  if (input.evidence.kind === "browser-operation") {
    if (!input.evidence.eventId) throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "浏览器验收必须提供 eventId。");
    await browserEvent(root, id, input.evidence.eventId, input.host);
  }
  let sourceEventId: string | undefined;
  let artifactPath: string | undefined;
  let artifactSha256: string | undefined;
  if (input.evidence.kind === "screenshot") {
    sourceEventId = input.evidence.sourceEventId;
    if (!sourceEventId || !input.evidence.path) throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "截图验收必须同时提供截图路径和浏览器事件。");
    await browserEvent(root, id, sourceEventId, input.host);
    const artifact = await storeScreenshotArtifact(root, id, input.evidence.path);
    artifactPath = artifact.artifactPath;
    artifactSha256 = artifact.artifactSha256;
  }
  if (input.evidence.kind === "file-inspection") {
    if (!input.evidence.observation) throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "文件核对必须提供结构化 observation。");
    const result = await executeRepositoryObservation(root, input.evidence.observation);
    if (!result.confirmed) throw new DevFlowError("INVALID_ACCEPTANCE_EVIDENCE", "文件核对没有得到预期结果。", { summary: result.summary });
    artifactSha256 = result.observedFingerprint;
  }
  const evidenceId = `AC-EVIDENCE-${randomUUID()}`;
  return mutate(root, id, expectedRevision, "acceptance-evidence-recorded", (state) => {
    const acceptance = ensureAcceptance(state);
    const record: AcceptanceEvidenceRecord = {
      recordId: evidenceId,
      kind: "acceptance-evidence",
      evidenceKind: input.evidence.kind,
      acceptanceCriterionId: input.acceptanceCriterionId as `AC-${string}`,
      basis: { kind: "content", sha256: fingerprint },
      ...(artifactPath ? { artifactPath } : {}),
      ...(artifactSha256 ? { artifactSha256 } : {}),
      ...(input.evidence.eventId ? { eventId: input.evidence.eventId } : {}),
      ...(sourceEventId ? { eventId: sourceEventId } : {}),
      ...(input.evidence.observation ? { observation: input.evidence.observation } : {}),
      ...(input.evidence.note?.trim() ? { note: input.evidence.note.trim() } : {}),
      recordedAt: new Date().toISOString(),
    };
    acceptance.evidence.push(record);
    upsertDisposition(state, record.acceptanceCriterionId, input.evidence.kind === "agent-self-check" ? "pending" : "satisfied", fingerprint, [...(acceptance.dispositions.find((item) => item.acceptanceCriterionId === record.acceptanceCriterionId)?.evidenceRefs ?? []), evidenceId]);
    state.lastUpdatedBy = { host: input.host, pluginVersion: __DEV_FLOW_VERSION__ };
  });
}

function dispositionHash(state: FeatureState, criterionIds: string[], fingerprint: string): string {
  const entries = (state.acceptance?.dispositions ?? []).filter((item) => criterionIds.includes(item.acceptanceCriterionId)).map((item) => ({ id: item.acceptanceCriterionId, kind: item.dispositionKind, status: item.status, refs: item.evidenceRefs, basis: item.basis })).sort((a, b) => a.id.localeCompare(b.id));
  return digest(JSON.stringify({ criterionIds, fingerprint, entries }));
}

export async function presentAcceptanceConfirmation(root: string, id: string, expectedRevision: number, acceptanceCriterionIds: string[]): Promise<PresentedInteraction> {
  const initial = await readState(root, id);
  const { fingerprint, trace } = await currentBasis(root, initial);
  const criteria = currentHumanCriteria(initial, trace);
  const selected = [...new Set(acceptanceCriterionIds)].sort();
  if (!selected.length || selected.some((criterion) => !criteria.includes(criterion))) throw new DevFlowError("ACCEPTANCE_CRITERION_NOT_HUMAN", "只能为当前需要人工验收的 AC 请求用户确认。", { criteria });
  const hash = dispositionHash(initial, selected, fingerprint);
  let created: UserInteraction | undefined;
  const state = await mutate(root, id, expectedRevision, "acceptance-confirmation-presented", (draft) => {
    const current = draft.acceptance?.dispositions ?? [];
    const currentHash = dispositionHash(draft, selected, fingerprint);
    if (currentHash !== hash) throw new DevFlowError("ACCEPTANCE_CONFIRMATION_STALE", "验收依据已变化，请重新呈现。", { retryOriginal: true });
    created = createInteraction(draft, {
      kind: "acceptance-confirmation",
      target: `acceptance-confirmation:${selected.join(",")}`,
      basisHash: digest(JSON.stringify({ fingerprint, hash, selected })),
      question: `请确认以下验收条件在当前交付内容上已经达到预期：${selected.join("、")}`,
      options: [{ id: "confirm", label: "确认验收" }, { id: "decline", label: "暂不确认" }],
      acceptanceConfirmation: { acceptanceCriterionIds: selected, deliveryFingerprint: fingerprint, dispositionHash: hash },
    });
  });
  if (!created) throw new DevFlowError("INTERACTION_NOT_CREATED", "验收确认问题未创建");
  return { state, interaction: toPublicInteraction(created), interactionId: created.id };
}

/** 验收确认经统一回答入口落账（ADR-0019）：confirm 时写入治理凭证并满足各 AC 处置。 */
export async function resolveAcceptanceConfirmationForAnswer(ctx: AnswerResolveContext): Promise<AnswerResolveResult> {
  const { root, featureId, expectedRevision, host, credential, interaction, state } = ctx;
  if (interaction.kind !== "acceptance-confirmation" || interaction.status !== "pending" || !interaction.acceptanceConfirmation) {
    throw new DevFlowError("INTERACTION_NOT_PENDING", "当前没有待确认的验收问题。");
  }
  const { fingerprint } = await currentBasis(root, state);
  if (fingerprint !== interaction.acceptanceConfirmation.deliveryFingerprint || dispositionHash(state, interaction.acceptanceConfirmation.acceptanceCriterionIds, fingerprint) !== interaction.acceptanceConfirmation.dispositionHash) {
    throw new DevFlowError("ACCEPTANCE_CONFIRMATION_STALE", "交付内容已变化，旧验收确认不能继续使用。", { retryOriginal: true });
  }
  let promptEventId: string | undefined;
  let promptText: string | undefined;
  if (credential.source === "text") {
    promptEventId = credential.promptEventId;
    promptText = credential.promptText;
  }
  let response: InteractionResponse | undefined;
  const next = await mutatePrepared(root, featureId, expectedRevision, "acceptance-confirmation-resolved", async (current) => {
    const live = getInteraction(current as FeatureState, interaction.id);
    if (live.kind !== "acceptance-confirmation" || live.status !== "pending") {
      throw new DevFlowError("INTERACTION_NOT_PENDING", "当前没有待确认的验收问题。");
    }
    return {
      mutate: (draft) => {
        const draftLive = getInteraction(draft, interaction.id);
        response = resolveResponseForAnswer(draft, interaction, {
          source: credential.source,
          action: credential.source === "elicitation" ? credential.action : undefined,
          comment: credential.source === "elicitation" ? credential.comment : undefined,
          userReply: credential.source === "text" ? (credential.promptText) : undefined,
          promptText,
          promptEventId,
          host,
        });
        if (response.action !== "confirm") return;
        const credentialId = `CRED-ACCEPTANCE-${randomUUID()}`;
        const credentials = [...(draft.governance?.credentials ?? [])];
        const record: GovernanceCredential = {
          recordId: credentialId,
          kind: "credential",
          source: credential.source === "elicitation" ? "native-form" : "text",
          host,
          interactionId: interaction.id,
          optionId: "confirm",
          ...(promptEventId ? { basis: { kind: "event", eventId: promptEventId } } : draftLive.presentationEventId ? { basis: { kind: "event", eventId: draftLive.presentationEventId } } : {}),
          recordedAt: new Date().toISOString(),
        };
        credentials.push(record);
        draft.governance = { ...(draft.governance ?? { decisions: [], claims: [], authorizations: [], credentials: [], repositoryFacts: [] }), credentials };
        const confirmation = draftLive.acceptanceConfirmation;
        if (!confirmation) throw new DevFlowError("ACCEPTANCE_CONFIRMATION_STALE", "验收确认上下文缺失，请重新呈现。");
        for (const criterionId of confirmation.acceptanceCriterionIds) {
          const refs = draft.acceptance?.dispositions.find((item) => item.acceptanceCriterionId === criterionId)?.evidenceRefs ?? [];
          upsertDisposition(draft, criterionId as `AC-${string}`, "satisfied", confirmation.deliveryFingerprint, [...refs, credentialId]);
        }
      },
    };
  });
  if (!response) throw new DevFlowError("INTERACTION_NOT_RESOLVED", interaction.id);
  return { state: next, action: response.action, ...(response.comment ? { comment: response.comment } : {}) };
}

export function acceptanceDispositionHash(state: FeatureState, criterionIds: string[], fingerprint: string): string {
  return dispositionHash(state, criterionIds, fingerprint);
}
