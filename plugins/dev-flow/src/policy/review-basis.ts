import type { RiskLabel } from "./types.js";
import type { TraceArtifactKind, TraceNode } from "./traceability.js";
import type { ReviewBasis, ReviewBasisArtifact, ReviewRole } from "./review.js";

/**
 * Phase 3 basis layering. Every v5 ReviewBasis field is assigned here; the
 * `satisfies` map makes adding a new field without assigning it a typecheck
 * failure. Role hashes only consume role-semantic fields; orchestration and
 * capture-freshness fields never leak into reuse decisions.
 */

export type ReviewBasisLayer = "role-semantic" | "orchestration" | "capture-freshness";

export interface ReviewBasisFieldOwnership {
  layers: ReviewBasisLayer[];
  /** Only set when the field is projected into specific role semantic hashes. */
  roles?: ReviewRole[];
  note: string;
}

export const REVIEW_BASIS_FIELD_OWNERSHIP: Record<keyof ReviewBasis, ReviewBasisFieldOwnership> = {
  featureId: { layers: ["orchestration"], note: "写入 package/envelope identity，禁止跨 feature 复用" },
  route: { layers: ["orchestration"], note: "决定 required jobs；真正影响审查的 level/topology 进入具体 role" },
  workflowCapabilities: { layers: ["orchestration"], note: "决定 phase、隔离和门禁，不以整对象污染 role hash" },
  classification: { layers: ["orchestration", "role-semantic"], roles: ["requirements-coverage", "architecture-testability", "rollback-operability", "security", "data-irreversibility", "money-safety", "contract-failure", "recovery-observability", "critical-correctness"], note: "level/topology/requirements 只进入职责相关 role；riskLabels 决定专项角色" },
  artifacts: { layers: ["capture-freshness", "role-semantic"], roles: ["requirements-coverage", "architecture-testability", "rollback-operability", "requirement-fidelity"], note: "raw SHA 用于捕获漂移；各角色只绑定所需 artifact semantic SHA" },
  traceability: { layers: ["capture-freshness"], note: "role 绑定规范化 Trace slice，不绑定 ledger pointer/revision" },
  projectConfigSha256: { layers: ["capture-freshness"], note: "整体 SHA 只防捕获漂移；角色绑定实际引用的 command/config slice" },
  verificationCommandHashes: { layers: ["role-semantic"], roles: ["architecture-testability", "rollback-operability"], note: "仅被相应 Trace slice 引用的 command hash 进入对应角色" },
  scopeManifestSha256: { layers: ["role-semantic", "capture-freshness"], roles: ["architecture-testability", "rollback-operability"], note: "架构/回撤绑定规范化 scope；原始 manifest SHA 负责漂移检查" },
  governedRootsFingerprint: { layers: ["capture-freshness"], note: "不触发任何 plan role 重审" },
  featureOwnedFingerprint: { layers: ["role-semantic"], roles: ["code-quality", "requirement-fidelity"], note: "v6 将替换为 contentSliceRef；当前仅两个 feature 级 code role 绑定" },
};

export interface ReviewRoleSemanticSpec {
  phase: "plan" | "code";
  artifactKinds: ReviewBasisArtifact["kind"][];
  traceKinds: TraceNode["kind"][];
  riskLabels?: RiskLabel[];
  bindReferencedCommandHashes: boolean;
  bindNonBehaviorDispositions: boolean;
  bindFeatureOwnedContent: boolean;
}

const allPlanTraceKinds: TraceNode["kind"][] = [
  "requirement",
  "acceptance-criterion",
  "task",
  "test",
  "implementation-unit",
  "recovery",
];

export const REVIEW_ROLE_SEMANTIC_SPECS: Record<ReviewRole, ReviewRoleSemanticSpec> = {
  "requirements-coverage": {
    phase: "plan",
    artifactKinds: ["requirements", "implementation-plan"],
    traceKinds: ["requirement", "acceptance-criterion", "task", "test", "implementation-unit"],
    bindReferencedCommandHashes: false,
    bindNonBehaviorDispositions: true,
    bindFeatureOwnedContent: false,
  },
  "architecture-testability": {
    phase: "plan",
    artifactKinds: ["implementation-plan"],
    traceKinds: ["task", "test", "implementation-unit"],
    bindReferencedCommandHashes: true,
    bindNonBehaviorDispositions: false,
    bindFeatureOwnedContent: false,
  },
  "rollback-operability": {
    phase: "plan",
    artifactKinds: ["implementation-plan"],
    traceKinds: ["task", "implementation-unit", "recovery"],
    bindReferencedCommandHashes: true,
    bindNonBehaviorDispositions: false,
    bindFeatureOwnedContent: false,
  },
  security: {
    phase: "plan",
    artifactKinds: [],
    traceKinds: allPlanTraceKinds,
    riskLabels: ["security"],
    bindReferencedCommandHashes: false,
    bindNonBehaviorDispositions: false,
    bindFeatureOwnedContent: false,
  },
  "data-irreversibility": {
    phase: "plan",
    artifactKinds: [],
    traceKinds: allPlanTraceKinds,
    riskLabels: ["data", "irreversible_consequence"],
    bindReferencedCommandHashes: false,
    bindNonBehaviorDispositions: false,
    bindFeatureOwnedContent: false,
  },
  "money-safety": {
    phase: "plan",
    artifactKinds: [],
    traceKinds: allPlanTraceKinds,
    riskLabels: ["money"],
    bindReferencedCommandHashes: false,
    bindNonBehaviorDispositions: false,
    bindFeatureOwnedContent: false,
  },
  "contract-failure": {
    phase: "plan",
    artifactKinds: [],
    traceKinds: allPlanTraceKinds,
    riskLabels: ["external"],
    bindReferencedCommandHashes: false,
    bindNonBehaviorDispositions: false,
    bindFeatureOwnedContent: false,
  },
  "recovery-observability": {
    phase: "plan",
    artifactKinds: [],
    traceKinds: allPlanTraceKinds,
    riskLabels: ["availability"],
    bindReferencedCommandHashes: false,
    bindNonBehaviorDispositions: false,
    bindFeatureOwnedContent: false,
  },
  "critical-correctness": {
    phase: "plan",
    artifactKinds: [],
    traceKinds: allPlanTraceKinds,
    riskLabels: ["critical_correctness"],
    bindReferencedCommandHashes: false,
    bindNonBehaviorDispositions: false,
    bindFeatureOwnedContent: false,
  },
  "code-quality": {
    phase: "code",
    artifactKinds: ["requirements", "implementation-plan"],
    traceKinds: allPlanTraceKinds,
    bindReferencedCommandHashes: false,
    bindNonBehaviorDispositions: false,
    bindFeatureOwnedContent: true,
  },
  "requirement-fidelity": {
    phase: "code",
    artifactKinds: ["requirements", "implementation-plan"],
    traceKinds: allPlanTraceKinds,
    bindReferencedCommandHashes: false,
    bindNonBehaviorDispositions: false,
    bindFeatureOwnedContent: true,
  },
};

export function reviewBasisFieldLayers(field: keyof ReviewBasis): ReviewBasisLayer[] {
  return [...REVIEW_BASIS_FIELD_OWNERSHIP[field].layers];
}

/** Trace artifact kinds reachable in the current v6 editable contract. */
export const V6_TRACE_ARTIFACT_KINDS: TraceArtifactKind[] = ["requirements", "implementation-plan"];
