import { createHash } from "node:crypto";
import type {
  DecisionRecord,
  QualityException,
} from "../policy/types.js";
import type {
  GovernanceAuthorization,
  GovernanceCredential,
  GovernanceDecision,
  GovernanceLedger,
} from "../policy/governance-records.js";
import { DevFlowError } from "./errors.js";
import type { FeatureState } from "./state-store.js";

/**
 * 状态 schema 迁移（Issue 01：旧状态转换入口）。
 *
 * - schemaVersion 5：新状态，原样返回；
 * - schemaVersion 4：确定、幂等地转换到 v5，不产生兼容双写（只保留 v5
 *   单格式；v4 顶层字段在新模型中渐进替换，删除由 Issue 23 收口）；
 * - schemaVersion 1–3（Dev Flow 4.x 及更早）：稳定 unsupported 错误。
 *
 * 转换是纯函数：同输入必得同输出（不引入随机、时间或环境状态），因此
 * Claude 与 Codex 读取同一 v4 状态得到一致的记录类型与当前性结论。
 *
 * 保守原则：v4 记录缺少 v5 的语义切片依据时，不根据非空字段猜测有效——
 * 迁移记录不携带 basis（派生为 unconfirmed），质量例外保留指纹内容依据
 * （由依据模块按当前工作区指纹派生 current/stale），v4 自带的 status 结论
 * 一律不被信任。
 */

export function migrateFeatureState(raw: unknown): FeatureState {
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version === 5) return raw as FeatureState;
  if (version === 4) return migrateV4ToV5(raw as FeatureStateV4);
  throw new DevFlowError("UNSUPPORTED_FEATURE_SCHEMA", `不支持的 feature state schema v${String(version)}。`, {
    userMessage: `检测到不支持的旧状态 schema（v${String(version)}）。`,
    cause: "本版本支持 schema v4（自动转换）与 v5；更早的 schema 不迁移。",
    impact: "旧 feature 不会被读取、覆盖或猜测。",
    recoveryKind: "repair",
    recoveryInstruction: "回到产生该状态的 Dev Flow 版本完成或放弃该 feature，备份 .dev-flow 后重新初始化。",
    retryOriginal: false,
    schemaVersion: version as number,
  });
}

/** v4 形状：与 v5 相同的字段，但 schemaVersion 为 4 且无治理记录层。 */
export type FeatureStateV4 = Omit<FeatureState, "schemaVersion" | "governance"> & {
  schemaVersion: 4;
  decisionLedger?: DecisionRecord[];
  qualityExceptions?: QualityException[];
};

export function migrateV4ToV5(v4: FeatureStateV4): FeatureState {
  const ledger: GovernanceLedger = {
    decisions: migrateDecisions(v4),
    claims: [],
    authorizations: migrateAuthorizations(v4),
    credentials: migrateCredentials(v4),
    repositoryFacts: [],
  };
  // Do not carry the removed v4 ledgers into the v5 persisted shape. They are
  // converted once into the typed governance ledger and never projected back.
  const { decisionLedger: _decisionLedger, qualityExceptions: _qualityExceptions, ...rest } = v4;
  void _decisionLedger;
  void _qualityExceptions;
  return { ...rest, schemaVersion: 5, governance: ledger } as FeatureState;
}

function migrateDecisions(v4: FeatureStateV4): GovernanceDecision[] {
  // v4 决策没有呈现事件或内容依据，转换后 basis 缺失 → 派生为 unconfirmed。
  return (v4.decisionLedger ?? [])
    .filter((record) => record.status === "resolved" && (record.conclusion ?? record.evidence ?? "").trim().length > 0)
    .map((record) => ({
      recordId: record.id,
      kind: "decision" as const,
      question: record.question,
      conclusion: (record.conclusion ?? record.evidence ?? "").trim(),
    }));
}

function migrateAuthorizations(v4: FeatureStateV4): GovernanceAuthorization[] {
  // 质量例外 = 风险接受授权。basis 绑定接受时的工作区指纹，由依据模块
  // 按当前指纹派生 current/stale；v4 自带的 status 字段不被信任。
  return (v4.qualityExceptions ?? []).map((item) => ({
    recordId: `AUTH-${createHash("sha256").update(`${item.kind}|${item.fingerprint}|${item.at}`).digest("hex").slice(0, 16)}`,
    kind: "authorization" as const,
    authorizationType: "risk-acceptance" as const,
    target: item.riskSummary,
    basis: item.fingerprint ? { kind: "content" as const, sha256: item.fingerprint } : undefined,
    recordedAt: item.at,
  }));
}

function migrateCredentials(v4: FeatureStateV4): GovernanceCredential[] {
  const hostIsValid = (host: unknown): host is "claude" | "codex" => host === "claude" || host === "codex";
  const credentials: GovernanceCredential[] = [];
  for (const raw of Object.values(v4.interactions ?? {})) {
    const interaction = raw as {
      id?: string;
      status?: string;
      presentationEventId?: string;
      response?: {
        host?: unknown;
        source?: string;
        promptEventId?: string;
        selectedOptionId?: string;
        rawReply?: string;
        userReply?: string;
        respondedAt?: string;
      };
    } | undefined;
    const response = interaction?.response;
    if (interaction?.status !== "resolved" || !response) continue;
    if (!hostIsValid(response.host)) continue; // 宿主未知的旧记录不猜测，保守跳过
    if (!interaction.id) continue; // 缺少交互 id 的旧记录无法成为凭证引用，保守跳过
    const eventId = response.promptEventId ?? interaction.presentationEventId;
    credentials.push({
      recordId: `CRED-${interaction.id}`,
      kind: "credential",
      source: response.source === "elicitation" ? "native-form" : "text",
      host: response.host,
      interactionId: interaction.id,
      ...(response.selectedOptionId ? { optionId: response.selectedOptionId } : {}),
      ...((response.rawReply ?? response.userReply) ? { rawText: response.rawReply ?? response.userReply } : {}),
      ...(eventId ? { basis: { kind: "event" as const, eventId } } : {}),
      ...(response.respondedAt ? { recordedAt: response.respondedAt } : {}),
    });
  }
  return credentials;
}
