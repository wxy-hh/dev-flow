/* dev-flow 6.0.1; built from source, deterministic build */
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};

// plugins/dev-flow/policy/contract.json
var contract_default;
var init_contract = __esm({
  "plugins/dev-flow/policy/contract.json"() {
    contract_default = {
      schemaVersion: 6,
      routes: {
        xs: {
          orderedSteps: ["locate", "implementation", "verification", "finalize"],
          stages: ["locate", "implementation", "verification", "finalize"],
          requiredArtifacts: []
        },
        s: {
          orderedSteps: ["boundary", "implementation", "verification", "finalize"],
          stages: ["boundary", "implementation", "verification", "finalize"],
          requiredArtifacts: []
        },
        m: {
          orderedSteps: ["planning", "implementation", "code_review", "verification", "finalize"],
          stages: ["planning", "implementation", "code_review", "verification", "finalize"],
          requiredArtifacts: []
        },
        l: {
          orderedSteps: ["requirements_alignment", "planning", "plan_review", "execution_approval", "implementation", "code_review", "verification", "finalize"],
          stages: ["requirements_alignment", "planning", "plan_review", "execution_approval", "implementation", "code_review", "verification", "finalize"],
          requiredArtifacts: ["requirements", "implementation-plan"],
          artifactSteps: { requirements_alignment: ["requirements"], planning: ["implementation-plan"] }
        }
      },
      riskEnhancements: {
        security: { checks: ["security-boundary"], verification: "behavior" },
        data: { checks: ["data-integrity", "rollback"], verification: "integration" },
        money: { checks: ["idempotency", "reconciliation", "rollback"], verification: "integration" },
        external: { checks: ["contract-failure"], verification: "integration" },
        availability: { checks: ["degradation-recovery"], verification: "integration" },
        critical_correctness: { checks: ["full-code-review"], verification: "full" },
        irreversible_consequence: { checks: ["backup-preview-abort-compensation", "full-code-review"], verification: "full" }
      },
      topologyMinimumLevel: {
        local: "XS",
        "shared-contract": "M",
        "multi-chain": "L",
        "coordinated-rollback": "L"
      },
      topologyStrictOrder: ["local", "shared-contract", "multi-chain", "coordinated-rollback"]
    };
  }
});

// plugins/dev-flow/src/policy/types.ts
var ZERO_WORKFLOW_CAPABILITIES, SUPPORTED_WORKFLOW_CAPABILITIES;
var init_types = __esm({
  "plugins/dev-flow/src/policy/types.ts"() {
    "use strict";
    ZERO_WORKFLOW_CAPABILITIES = Object.freeze({
      trace: 0,
      review: 0,
      checkpoints: 0,
      rollbackExecution: 0
    });
    SUPPORTED_WORKFLOW_CAPABILITIES = Object.freeze({
      trace: 1,
      review: 1,
      checkpoints: 1,
      rollbackExecution: 1
    });
  }
});

// plugins/dev-flow/src/policy/contract.ts
function routeDefinition(route) {
  return contract.routes[route];
}
function cloneArtifactSteps(steps) {
  if (!steps) return void 0;
  return Object.fromEntries(Object.entries(steps).map(([step, artifacts]) => [step, [...artifacts]]));
}
function cloneRouteDefinition(definition) {
  return {
    ...definition,
    orderedSteps: [...definition.orderedSteps],
    requiredArtifacts: [...definition.requiredArtifacts],
    ...definition.generatedArtifacts ? { generatedArtifacts: [...definition.generatedArtifacts] } : {},
    ...definition.artifactSteps ? { artifactSteps: cloneArtifactSteps(definition.artifactSteps) } : {},
    ...definition.generatedArtifactSteps ? { generatedArtifactSteps: cloneArtifactSteps(definition.generatedArtifactSteps) } : {},
    ...definition.artifactTransitions ? {
      artifactTransitions: definition.artifactTransitions.map((transition) => ({ ...transition, steps: [...transition.steps] }))
    } : {}
  };
}
function validateArtifactModes(definition) {
  const generated = definition.generatedArtifacts ?? [];
  const overlap = definition.requiredArtifacts.find((artifact) => generated.includes(artifact));
  if (overlap) throw new Error(`route contract artifact ${overlap} cannot be both editable and generated`);
}
function normalizeWorkflowCapabilities(value) {
  const candidate = value ?? ZERO_WORKFLOW_CAPABILITIES;
  if (candidate.trace !== 0 && candidate.trace !== 1 || candidate.review !== 0 && candidate.review !== 1 || candidate.checkpoints !== 0 && candidate.checkpoints !== 1 || candidate.rollbackExecution !== 0 && candidate.rollbackExecution !== 1) {
    throw new Error("workflow capabilities must use 0 or 1");
  }
  return Object.freeze({ ...candidate });
}
function routeDefinitionForFeature(route, controls) {
  const definition = cloneRouteDefinition(routeDefinition(route));
  if (controls) {
    definition.orderedSteps = [];
    if (controls.requirements) definition.orderedSteps.push("requirements_alignment");
    definition.orderedSteps.push(controls.plan === "locate" ? "locate" : controls.plan === "brief" ? "boundary" : "planning");
    definition.orderedSteps.push("implementation");
    if (controls.codeReview !== "none") definition.orderedSteps.push("code_review");
    definition.orderedSteps.push("verification", "finalize");
    definition.requiredArtifacts = [];
    definition.artifactSteps = {};
    if (controls.requirements) {
      definition.requiredArtifacts.push("requirements");
      definition.artifactSteps.requirements_alignment = ["requirements"];
    }
    if (controls.plan === "formal") {
      definition.requiredArtifacts.push("implementation-plan");
      definition.artifactSteps.planning = ["implementation-plan"];
    }
    if (controls.planReview) {
      definition.generatedArtifacts = ["plan-review"];
      definition.generatedArtifactSteps = { planning: ["plan-review"] };
    }
  }
  validateArtifactModes(definition);
  return definition;
}
function traceEnforcementRequired(route, controls) {
  return controls?.trace ?? false;
}
function reviewEnforcementRequired(route, controls) {
  return controls?.planReview ?? false;
}
function reviewLedgerRequired(route, controls) {
  return controls ? controls.planReview || controls.codeReview !== "none" : false;
}
function checkpointsEnforcementRequired(route, controls) {
  return controls ? controls.checkpoints === "unit-chain" && controls.trace : false;
}
var contract, allowedRiskLabels;
var init_contract2 = __esm({
  "plugins/dev-flow/src/policy/contract.ts"() {
    "use strict";
    init_contract();
    init_types();
    contract = contract_default;
    if (contract.schemaVersion !== 6) {
      throw new Error(`unsupported contract schema ${String(contract.schemaVersion)}`);
    }
    allowedRiskLabels = Object.freeze(Object.keys(contract.riskEnhancements));
  }
});

// plugins/dev-flow/src/policy/evidence-store.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function parseEvidenceObjectKind(value) {
  if (typeof value !== "string" || !EVIDENCE_OBJECT_KINDS.includes(value)) {
    throw new TypeError(`invalid evidence object kind: ${String(value)}`);
  }
  return value;
}
function parseEvidenceObjectRef(value) {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "kind,sha256,size" || !isSha256(value.sha256) || !Number.isInteger(value.size) || value.size < 0) {
    throw new TypeError("invalid evidence object ref");
  }
  return {
    kind: parseEvidenceObjectKind(value.kind),
    sha256: value.sha256,
    size: value.size
  };
}
function parseEvidenceStoreEntry(value) {
  if (!isRecord(value) || !isSha256(value.sha256) || !Number.isInteger(value.size) || value.size < 0 || !isSha256(value.packSha256) || !Number.isInteger(value.offset) || value.offset < 0 || !Number.isInteger(value.compressedLength) || value.compressedLength <= 0) {
    throw new TypeError("invalid evidence store entry");
  }
  return {
    sha256: value.sha256,
    kind: parseEvidenceObjectKind(value.kind),
    size: value.size,
    packSha256: value.packSha256,
    offset: value.offset,
    compressedLength: value.compressedLength
  };
}
function parseEvidencePackDescriptor(value) {
  if (!isRecord(value) || !isSha256(value.packSha256) || !isSha256(value.indexSha256) || value.location !== "hot" && value.location !== "cold" || !Number.isInteger(value.objectCount) || value.objectCount < 0 || !Number.isInteger(value.totalRawSize) || value.totalRawSize < 0) {
    throw new TypeError("invalid evidence pack descriptor");
  }
  return {
    packSha256: value.packSha256,
    indexSha256: value.indexSha256,
    location: value.location,
    objectCount: value.objectCount,
    totalRawSize: value.totalRawSize
  };
}
function parseEvidenceStoreCatalog(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.featureId !== "string" || !value.featureId || !Number.isInteger(value.revision) || value.revision < 0 || !Array.isArray(value.objects) || !Array.isArray(value.packs)) {
    throw new TypeError("invalid evidence store catalog");
  }
  const objects = value.objects.map(parseEvidenceStoreEntry);
  const packs = value.packs.map(parseEvidencePackDescriptor);
  const packShas = new Set(packs.map((pack) => pack.packSha256));
  const seen = /* @__PURE__ */ new Set();
  for (const object of objects) {
    if (!packShas.has(object.packSha256)) throw new TypeError("catalog object references a missing pack");
    const key = `${object.kind}\0${object.sha256}`;
    if (seen.has(key)) throw new TypeError("catalog contains duplicate object ref");
    seen.add(key);
  }
  return {
    schemaVersion: 1,
    featureId: value.featureId,
    revision: value.revision,
    objects,
    packs
  };
}
function parseEvidenceStorePointer(value) {
  if (!isRecord(value) || !isSha256(value.catalogSha256) || !Number.isInteger(value.objectCount) || value.objectCount < 0 || !Number.isInteger(value.packCount) || value.packCount < 0) {
    throw new TypeError("invalid evidence store pointer");
  }
  return {
    catalogSha256: value.catalogSha256,
    objectCount: value.objectCount,
    packCount: value.packCount
  };
}
function parseWorkspaceSnapshotManifest(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.featureId !== "string" || !value.featureId || typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt)) || !Array.isArray(value.files)) {
    throw new TypeError("invalid workspace snapshot manifest");
  }
  const files = value.files.map((file) => {
    if (!isRecord(file) || typeof file.path !== "string" || !file.path || !isSha256(file.sha256) || typeof file.mode !== "string" || !/^[0-7]{3,4}$/.test(file.mode) || file.kind !== "file" && file.kind !== "symlink") {
      throw new TypeError("invalid workspace snapshot file record");
    }
    const record = {
      path: file.path,
      sha256: file.sha256,
      mode: file.mode,
      kind: file.kind
    };
    if (file.kind === "symlink") {
      if (typeof file.linkTarget !== "string") throw new TypeError("symlink snapshot requires linkTarget");
      record.linkTarget = file.linkTarget;
    } else if (file.linkTarget !== void 0) {
      throw new TypeError("file snapshot cannot contain linkTarget");
    }
    return record;
  });
  return {
    schemaVersion: 1,
    featureId: value.featureId,
    capturedAt: value.capturedAt,
    files
  };
}
var EVIDENCE_OBJECT_KINDS;
var init_evidence_store = __esm({
  "plugins/dev-flow/src/policy/evidence-store.ts"() {
    "use strict";
    EVIDENCE_OBJECT_KINDS = [
      "artifact-proposal",
      "trace",
      "review-ledger",
      "review-package",
      "review-execution",
      "review-result",
      "file-snapshot",
      "evidence-baseline",
      "checkpoint-pack",
      "verification-log",
      "repair-log",
      "workspace-lineage",
      "governance-ledger",
      "interaction-ledger",
      "event-segment"
    ];
  }
});

// plugins/dev-flow/src/core/errors.ts
function safeFailureDetails(details) {
  return Object.fromEntries(Object.entries(details).filter(([key, value]) => {
    if (key === "currentSha256") return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    return safeDetailKeys.has(key) && !/(?:capability|token|secret|hash|sha|fingerprint)/iu.test(key) && (typeof value !== "string" || value.length <= 2e3);
  }));
}
var chineseRecovery, safeDetailKeys, DevFlowError;
var init_errors = __esm({
  "plugins/dev-flow/src/core/errors.ts"() {
    "use strict";
    chineseRecovery = (code) => {
      if (code.includes("REVISION") || code.includes("CONFLICT")) {
        return { kind: "refresh", instruction: "\u5237\u65B0\u5F53\u524D\u72B6\u6001\u540E\u91CD\u8BD5\u539F\u64CD\u4F5C\u3002", requiresUserDecision: false, retryOriginal: true };
      }
      if (code.includes("INTEGRITY") || code.includes("CORRUPT") || code.includes("UNREADABLE")) {
        return { kind: "repair", instruction: "\u8FD0\u884C doctor \u68C0\u67E5\u5F53\u524D\u72B6\u6001\uFF1B\u4E0D\u8981\u624B\u52A8\u4FEE\u6539\u63A7\u5236\u6587\u4EF6\u3002", requiresUserDecision: false, retryOriginal: false };
      }
      if (code.includes("REQUIRED") || code.includes("INCOMPLETE") || code.includes("STALE")) {
        return { kind: "retry", instruction: "\u6309\u5F53\u524D\u72B6\u6001\u63D0\u793A\u8865\u9F50\u7F3A\u5931\u8BC1\u636E\u540E\u91CD\u8BD5\u3002", requiresUserDecision: false, retryOriginal: true };
      }
      return { kind: "ask-user", instruction: "\u8BF7\u786E\u8BA4\u662F\u5426\u6309\u63A8\u8350\u6062\u590D\u52A8\u4F5C\u7EE7\u7EED\u3002", requiresUserDecision: true, retryOriginal: false };
    };
    safeDetailKeys = /* @__PURE__ */ new Set([
      "path",
      "paths",
      "file",
      "files",
      "field",
      "allowed",
      "missing",
      "missingGuarantees",
      "command",
      "commandId",
      "currentRevision",
      "expectedRevision",
      "expectedStage",
      "schemaVersion",
      "decisionIds",
      "approvalIds",
      "incomplete",
      "conflicts",
      "issues",
      "recoveryHint",
      "itemId",
      "required"
    ]);
    DevFlowError = class extends Error {
      constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.code = code;
        this.details = details;
        this.name = "DevFlowError";
        this.userMessage = typeof details.userMessage === "string" ? details.userMessage : "\u5F53\u524D\u52A8\u4F5C\u672A\u5B8C\u6210\u3002";
        this.cause = typeof details.cause === "string" ? details.cause : /[\u3400-\u9fff]/u.test(message) ? message : `\u672A\u6EE1\u8DB3\u9519\u8BEF\u7801 ${code} \u5BF9\u5E94\u7684\u6D41\u7A0B\u6761\u4EF6\u3002`;
        this.impact = typeof details.impact === "string" ? details.impact : "\u6D41\u7A0B\u4FDD\u6301\u5728\u5F53\u524D\u9636\u6BB5\uFF0C\u5DF2\u6709\u7528\u6237\u6587\u4EF6\u4E0D\u4F1A\u88AB\u81EA\u52A8\u6539\u5199\u3002";
        this.recovery = {
          ...chineseRecovery(code),
          ...typeof details.recoveryKind === "string" ? { kind: details.recoveryKind } : {},
          ...typeof details.recoveryInstruction === "string" ? { instruction: details.recoveryInstruction } : {},
          ...typeof details.requiresUserDecision === "boolean" ? { requiresUserDecision: details.requiresUserDecision } : {},
          ...typeof details.retryOriginal === "boolean" ? { retryOriginal: details.retryOriginal } : {}
        };
      }
      userMessage;
      cause;
      impact;
      recovery;
      toFailure() {
        const technical = safeFailureDetails(this.details);
        if (this.code.includes("REVISION_CONFLICT")) {
          technical.basisChanged = false;
          technical.safeToRefresh = true;
        }
        return {
          code: this.code,
          userMessage: this.userMessage,
          cause: this.cause,
          impact: this.impact,
          recovery: { ...this.recovery },
          ...Object.keys(technical).length ? { technical } : {}
        };
      }
    };
  }
});

// plugins/dev-flow/src/policy/stable-json.ts
function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
var init_stable_json = __esm({
  "plugins/dev-flow/src/policy/stable-json.ts"() {
    "use strict";
  }
});

// plugins/dev-flow/src/policy/obligations.ts
function reopenObligations(obligations, kinds) {
  if (!obligations) return void 0;
  const selected = new Set(kinds);
  return obligations.map((obligation) => selected.has(obligation.kind) && obligation.status !== "pending" ? { ...obligation, status: "pending" } : obligation);
}
var init_obligations = __esm({
  "plugins/dev-flow/src/policy/obligations.ts"() {
    "use strict";
    init_stable_json();
  }
});

// plugins/dev-flow/src/policy/validation.ts
var init_validation = __esm({
  "plugins/dev-flow/src/policy/validation.ts"() {
    "use strict";
    init_contract2();
  }
});

// plugins/dev-flow/src/policy/route.ts
var init_route = __esm({
  "plugins/dev-flow/src/policy/route.ts"() {
    "use strict";
    init_contract2();
    init_obligations();
    init_validation();
  }
});

// plugins/dev-flow/src/policy/evidence.ts
var init_evidence = __esm({
  "plugins/dev-flow/src/policy/evidence.ts"() {
    "use strict";
    init_contract2();
    init_route();
  }
});

// plugins/dev-flow/src/policy/stages.ts
function firstOpenStep(orderedSteps, steps) {
  return orderedSteps.find((step) => steps[step]?.status !== "satisfied");
}
var init_stages = __esm({
  "plugins/dev-flow/src/policy/stages.ts"() {
    "use strict";
    init_contract2();
    init_evidence();
  }
});

// plugins/dev-flow/src/core/step-order.ts
function currentOpenStep(state) {
  if (state.mode !== "routed") return void 0;
  return firstOpenStep(routeDefinitionForFeature(state.route, state.classification.controls).orderedSteps, state.steps);
}
var init_step_order = __esm({
  "plugins/dev-flow/src/core/step-order.ts"() {
    "use strict";
    init_contract2();
    init_stages();
    init_errors();
  }
});

// plugins/dev-flow/src/core/path-normalization.ts
import path from "node:path";
function normalizeUnicode(value) {
  return value.normalize("NFC");
}
function normalizeProjectPath(value) {
  return path.posix.normalize(normalizeUnicode(value).replaceAll("\\", "/"));
}
var init_path_normalization = __esm({
  "plugins/dev-flow/src/core/path-normalization.ts"() {
    "use strict";
  }
});

// plugins/dev-flow/src/core/repository-fact-store.ts
var init_repository_fact_store = __esm({
  "plugins/dev-flow/src/core/repository-fact-store.ts"() {
    "use strict";
    init_errors();
  }
});

// plugins/dev-flow/src/policy/governance-records.ts
var EMPTY_GOVERNANCE_LEDGER;
var init_governance_records = __esm({
  "plugins/dev-flow/src/policy/governance-records.ts"() {
    "use strict";
    EMPTY_GOVERNANCE_LEDGER = Object.freeze({
      decisions: [],
      claims: [],
      authorizations: [],
      credentials: [],
      repositoryFacts: []
    });
  }
});

// plugins/dev-flow/src/core/repository-facts.ts
var init_repository_facts = __esm({
  "plugins/dev-flow/src/core/repository-facts.ts"() {
    "use strict";
    init_errors();
    init_path_normalization();
    init_repository_fact_store();
    init_governance_records();
    init_state_store();
  }
});

// plugins/dev-flow/src/policy/rollback.ts
function reopenImplementationUnit(unit) {
  if (unit.status === "pending") return;
  unit.status = "pending";
  delete unit.startedFingerprint;
  delete unit.beginNonce;
  delete unit.checkpointId;
}
function pathWithinFileScope(path26, fileScope) {
  return fileScope.some((pattern) => scopePatternMatches(pattern.normalize("NFC"), path26.normalize("NFC")));
}
function isSafeFileScopePattern(value) {
  if (typeof value !== "string" || !value || value.trim() !== value) return false;
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  if (value === ".") return true;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
function scopePatternMatches(pattern, target) {
  if (!isSafeFileScopePattern(pattern) || typeof target !== "string" || !target.trim()) return false;
  if (target.includes("\\") || target.startsWith("/")) return false;
  const segments = pattern.split("/");
  const parts = target.split("/");
  if (parts.some((part) => part === "..")) return false;
  if (/[*?]/.test(pattern)) return globSegmentsMatch(segments, parts);
  if (pattern === ".") return true;
  return target === pattern || target.startsWith(`${pattern}/`);
}
function globSegmentsMatch(pattern, target) {
  if (pattern.length === 0) return target.length === 0;
  const [head2, ...rest] = pattern;
  if (head2 === "**") {
    if (rest.length === 0) return true;
    for (let skip = 0; skip <= target.length; skip += 1) {
      if (globSegmentsMatch(rest, target.slice(skip))) return true;
    }
    return false;
  }
  if (target.length === 0 || !globSegmentMatches(head2, target[0])) return false;
  return globSegmentsMatch(rest, target.slice(1));
}
function globSegmentMatches(pattern, segment) {
  if (pattern === "") return segment === "";
  const [head2, ...rest] = pattern;
  if (head2 === "*") {
    for (let take = 0; take <= segment.length; take += 1) {
      if (globSegmentMatches(rest.join(""), segment.slice(take))) return true;
    }
    return false;
  }
  if (head2 === "?") return segment.length > 0 && globSegmentMatches(rest.join(""), segment.slice(1));
  return segment.startsWith(head2) && globSegmentMatches(rest.join(""), segment.slice(head2.length));
}
function invalid(message, code = "ROLLBACK_PROTOCOL_INVALID") {
  throw new RollbackProtocolError(code, message);
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isImplementationUnitId(value) {
  return typeof value === "string" && IMPLEMENTATION_UNIT_ID.test(value);
}
function isSha2562(value) {
  return typeof value === "string" && SHA256.test(value);
}
function isTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function parseFileRecord(value, index) {
  if (!isRecord2(value) || !hasOnlyKeys(value, ["path", "change", "renamedFrom", "beforeSha256", "afterSha256", "beforeBlobSha256", "afterBlobSha256", "beforeMode", "afterMode", "beforeKind", "afterKind"]) || !isNonEmptyString(value.path) || typeof value.change !== "string" || !fileChanges.includes(value.change)) {
    invalid(`checkpoint file record ${index} has an invalid shape`);
  }
  const label = `checkpoint file record ${index}`;
  const change = value.change;
  const beforeOk = change !== "added" ? isSha2562(value.beforeSha256) && isSha2562(value.beforeBlobSha256) && typeof value.beforeMode === "string" && FILE_MODE.test(value.beforeMode) && (value.beforeKind === "file" || value.beforeKind === "symlink") : value.beforeSha256 === void 0 && value.beforeBlobSha256 === void 0 && value.beforeMode === void 0;
  const afterOk = change !== "deleted" ? isSha2562(value.afterSha256) && isSha2562(value.afterBlobSha256) && typeof value.afterMode === "string" && FILE_MODE.test(value.afterMode) && (value.afterKind === "file" || value.afterKind === "symlink") : value.afterSha256 === void 0 && value.afterBlobSha256 === void 0 && value.afterMode === void 0;
  if (!beforeOk) invalid(`${label} has invalid before fields for change ${change}`);
  if (!afterOk) invalid(`${label} has invalid after fields for change ${change}`);
  if (change === "renamed" && !isNonEmptyString(value.renamedFrom)) invalid(`${label} renamed record requires renamedFrom`);
  if (change !== "renamed" && value.renamedFrom !== void 0) invalid(`${label} only renamed records may carry renamedFrom`);
  return {
    path: value.path,
    change,
    ...value.renamedFrom !== void 0 ? { renamedFrom: value.renamedFrom } : {},
    ...change !== "added" ? { beforeSha256: value.beforeSha256, beforeBlobSha256: value.beforeBlobSha256, beforeMode: value.beforeMode, beforeKind: value.beforeKind } : {},
    ...change !== "deleted" ? { afterSha256: value.afterSha256, afterBlobSha256: value.afterBlobSha256, afterMode: value.afterMode, afterKind: value.afterKind } : {}
  };
}
function parseVerificationAttempt(value, index) {
  if (!isRecord2(value) || !hasOnlyKeys(value, ["attemptId", "commandId", "command", "status", "startedAt", "completedAt", "phase", "cwd", "outputTail"]) || !isNonEmptyString(value.attemptId) || !isNonEmptyString(value.commandId) || !isNonEmptyString(value.command) || value.status !== "passed" && value.status !== "failed" || !isTimestamp(value.startedAt) || !isTimestamp(value.completedAt)) {
    invalid(`checkpoint verification attempt ${index} has an invalid shape`);
  }
  if (value.phase !== void 0 && value.phase !== "preflight" && value.phase !== "forward" || value.cwd !== void 0 && !isNonEmptyString(value.cwd) || value.outputTail !== void 0 && typeof value.outputTail !== "string") {
    invalid(`checkpoint verification attempt ${index} has invalid diagnostics`);
  }
  return {
    attemptId: value.attemptId,
    commandId: value.commandId,
    command: value.command,
    status: value.status,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    ...value.phase !== void 0 ? { phase: value.phase } : {},
    ...value.cwd !== void 0 ? { cwd: value.cwd } : {},
    ...value.outputTail !== void 0 ? { outputTail: value.outputTail } : {}
  };
}
function parseCheckpointManifest(value) {
  if (isRecord2(value) && value.schemaVersion === 1) {
    invalid("Dev Flow 4.x checkpoint manifest schema v1 is not supported by 5.0", "UNSUPPORTED_CHECKPOINT_SCHEMA");
  }
  if (!isRecord2(value) || !hasOnlyKeys(value, ["schemaVersion", "checkpointId", "unitId", "sequence", "basisHash", "startedFingerprint", "completedFingerprint", "startedAt", "completedAt", "files", "forwardPatchSha256", "reversePatchSha256", "verificationAttempts", "requirementsSha256", "planSha256", "traceabilitySha256", "approvalBasisHash", "projectConfigSha256", "verificationCommands", "verificationCommandHashes", "beginNonce", "blobRefs"]) || value.schemaVersion !== 2 && value.schemaVersion !== 3 || !isNonEmptyString(value.checkpointId) || !isImplementationUnitId(value.unitId) || typeof value.sequence !== "number" || !Number.isInteger(value.sequence) || value.sequence < 1 || !isSha2562(value.basisHash) || !isSha2562(value.startedFingerprint) || !isSha2562(value.completedFingerprint) || value.beginNonce !== void 0 && !isNonEmptyString(value.beginNonce) || !isTimestamp(value.startedAt) || !isTimestamp(value.completedAt) || !Array.isArray(value.files) || !isSha2562(value.forwardPatchSha256) || !isSha2562(value.reversePatchSha256) || !Array.isArray(value.verificationAttempts) || value.requirementsSha256 !== "" && !isSha2562(value.requirementsSha256) || value.planSha256 !== "" && !isSha2562(value.planSha256) || value.traceabilitySha256 !== "" && !isSha2562(value.traceabilitySha256) || !isSha2562(value.approvalBasisHash) || !isSha2562(value.projectConfigSha256) || !Array.isArray(value.verificationCommands)) {
    invalid("checkpoint manifest has an invalid shape");
  }
  const files = value.files.map((file, index) => parseFileRecord(file, index));
  const verificationAttempts = value.verificationAttempts.map((attempt, index) => parseVerificationAttempt(attempt, index));
  const verificationCommands = value.verificationCommands.map((command, index) => {
    if (!isRecord2(command) || !hasOnlyKeys(command, ["commandId", "command"]) || !isNonEmptyString(command.commandId) || !isNonEmptyString(command.command)) {
      invalid(`checkpoint verification command ${index} has an invalid shape`);
    }
    return { commandId: command.commandId, command: command.command };
  });
  const declaredCommandIds = new Set(verificationCommands.map((command) => command.commandId));
  if (value.verificationCommandHashes !== void 0 && (!isRecord2(value.verificationCommandHashes) || Object.entries(value.verificationCommandHashes).some(([id, hash2]) => !declaredCommandIds.has(id) || !isSha2562(hash2)))) {
    invalid("checkpoint verification command hashes have an invalid shape");
  }
  for (const attempt of verificationAttempts) {
    if (!declaredCommandIds.has(attempt.commandId)) {
      invalid(`checkpoint verification attempt ${attempt.attemptId} references undeclared command ${attempt.commandId}`);
    }
  }
  let blobRefs;
  if (value.blobRefs !== void 0) {
    if (value.schemaVersion !== 3 || !isRecord2(value.blobRefs)) invalid("checkpoint blob refs are only valid on schema v3");
    blobRefs = Object.fromEntries(Object.entries(value.blobRefs).map(([blobSha256, ref]) => {
      if (!isSha2562(blobSha256)) invalid("checkpoint blob ref key is not a sha256");
      const parsed = parseEvidenceObjectRef(ref);
      if (parsed.kind !== "checkpoint-pack" || parsed.sha256 !== blobSha256) {
        invalid("checkpoint blob ref does not match its content sha");
      }
      return [blobSha256, parsed];
    }));
  }
  return {
    schemaVersion: value.schemaVersion,
    checkpointId: value.checkpointId,
    unitId: value.unitId,
    sequence: value.sequence,
    basisHash: value.basisHash,
    startedFingerprint: value.startedFingerprint,
    completedFingerprint: value.completedFingerprint,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    files,
    forwardPatchSha256: value.forwardPatchSha256,
    reversePatchSha256: value.reversePatchSha256,
    verificationAttempts,
    requirementsSha256: value.requirementsSha256,
    planSha256: value.planSha256,
    traceabilitySha256: value.traceabilitySha256,
    approvalBasisHash: value.approvalBasisHash,
    projectConfigSha256: value.projectConfigSha256,
    verificationCommands,
    ...value.verificationCommandHashes !== void 0 ? { verificationCommandHashes: Object.fromEntries(Object.entries(value.verificationCommandHashes).map(([id, hash2]) => [id, hash2])) } : {},
    ...typeof value.beginNonce === "string" ? { beginNonce: value.beginNonce } : {},
    ...blobRefs ? { blobRefs } : {}
  };
}
var IMPLEMENTATION_UNIT_TRANSITIONS, fileChanges, IMPLEMENTATION_UNIT_ID, SHA256, FILE_MODE, RollbackProtocolError;
var init_rollback = __esm({
  "plugins/dev-flow/src/policy/rollback.ts"() {
    "use strict";
    init_evidence_store();
    IMPLEMENTATION_UNIT_TRANSITIONS = Object.freeze({
      pending: Object.freeze(["active"]),
      active: Object.freeze(["verified"]),
      verified: Object.freeze(["checkpointed", "active"]),
      checkpointed: Object.freeze(["rolled_back"]),
      rolled_back: Object.freeze(["active"])
    });
    fileChanges = ["added", "modified", "deleted", "renamed", "mode-changed"];
    IMPLEMENTATION_UNIT_ID = /^UNIT-[0-9]{3,}$/;
    SHA256 = /^[0-9a-f]{64}$/;
    FILE_MODE = /^[0-7]{3,4}$/;
    RollbackProtocolError = class extends Error {
      constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
      }
    };
  }
});

// plugins/dev-flow/src/core/fingerprint.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, readlink, realpath, lstat } from "node:fs/promises";
import path2 from "node:path";
import { promisify } from "node:util";
function controlPath(relative) {
  return relative === ".git" || relative.startsWith(".git/") || relative === ".dev-flow" || relative.startsWith(".dev-flow/") || relative === "node_modules" || relative.startsWith("node_modules/");
}
function configFor(input) {
  return Array.isArray(input) ? { governedRoots: input } : input;
}
async function collect(root, relative, files, excludes) {
  const absolute = path2.join(root, relative);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const child = normalizeProjectPath(path2.join(relative, entry.name));
    if (excludes?.some((pattern) => pathWithinFileScope(child, [pattern]))) continue;
    const target = path2.join(root, child);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${child}`);
    if (metadata.isDirectory()) await collect(root, child, files, excludes);
    else if (metadata.isFile()) files.push(child);
  }
}
async function hasGitMetadata(root) {
  let current = path2.resolve(root);
  while (true) {
    try {
      await lstat(path2.join(current, ".git"));
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") return true;
    }
    const parent = path2.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
async function gitOutput(root, args) {
  try {
    const result = await runFile("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    return String(result.stdout);
  } catch (error) {
    throw new DevFlowError("PROTECTED_ROOT_ENUMERATION_FAILED", "Git \u65E0\u6CD5\u679A\u4E3E governed roots\u3002", {
      command: ["git", ...args].join(" "),
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}
async function gitFiles(root, governedRoots) {
  const hasMetadata = await hasGitMetadata(root);
  let insideWorktree = false;
  try {
    insideWorktree = (await gitOutput(root, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch (error) {
    if (!hasMetadata) return void 0;
    throw error;
  }
  if (!insideWorktree) return void 0;
  const output = await gitOutput(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...governedRoots]);
  return output.split("\0").filter(Boolean).map(normalizeProjectPath);
}
async function gitTrackedFiles(root, governedRoots) {
  const output = await gitOutput(root, ["ls-files", "--cached", "-z", "--", ...governedRoots]);
  return new Set(output.split("\0").filter(Boolean).map(normalizeProjectPath));
}
function withinConfiguredRoot(file, governedRoots) {
  return governedRoots.some((root) => root === "." || file === root || file.startsWith(`${root}/`));
}
function applyExcludes(files, excludes) {
  return files.filter((file) => !excludes?.some((pattern) => pathWithinFileScope(file, [pattern])));
}
async function assertGovernedRootsSafe(root, governedRoots) {
  for (const relative of governedRoots) {
    try {
      const metadata = await lstat(path2.join(root, relative));
      if (metadata.isSymbolicLink()) throw new DevFlowError("UNSAFE_PROTECTED_ROOT", `symbolic link is not allowed: ${relative}`);
    } catch (error) {
      if (error instanceof DevFlowError) throw error;
      if (error.code !== "ENOENT") throw error;
    }
  }
}
async function enumerateProtectedFiles(root, input) {
  const config = configFor(input);
  const governedRoots = [...new Set(config.governedRoots.map(normalizeProjectPath))].sort();
  const fromGit = await gitFiles(root, governedRoots);
  if (!fromGit) {
    const rootsToValidate = governedRoots.filter((entry) => !config.governedRootsExclude?.some((pattern) => pathWithinFileScope(entry, [pattern])));
    await assertGovernedRootsSafe(root, rootsToValidate);
  }
  const files = fromGit ?? (() => {
    const collected = [];
    return Promise.all(governedRoots.map((item) => collect(root, item, collected, config.governedRootsExclude))).then(() => collected);
  })();
  const resolved = await files;
  const unique = applyExcludes([...new Set(resolved.map(normalizeProjectPath).filter((file) => !controlPath(file)).filter((file) => withinConfiguredRoot(file, governedRoots)))].sort(), config.governedRootsExclude);
  const tracked = fromGit ? await gitTrackedFiles(root, governedRoots) : /* @__PURE__ */ new Set();
  for (const relative of unique) {
    let metadata;
    try {
      metadata = await lstat(path2.join(root, relative));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      if (!tracked.has(relative)) throw new DevFlowError("UNSAFE_GOVERNED_SYMLINK", `symlink must be Git-tracked: ${relative}`, { path: relative, recoveryHint: "\u8DDF\u8E2A\u8BE5\u4ED3\u5185\u94FE\u63A5\uFF0C\u6216\u5C06\u5176\u6392\u9664\u5728 governedRoots \u4E4B\u5916" });
      const resolvedTarget = await realpath(path2.join(root, relative));
      const rootPath = await realpath(root);
      const targetRelative = normalizeProjectPath(path2.relative(rootPath, resolvedTarget));
      if (!targetRelative || targetRelative === ".." || targetRelative.startsWith("../") || path2.isAbsolute(targetRelative) || targetRelative === ".git" || targetRelative.startsWith(".git/") || targetRelative === ".dev-flow" || targetRelative.startsWith(".dev-flow/")) {
        throw new DevFlowError("UNSAFE_GOVERNED_SYMLINK", `symlink target escapes governed safety boundary: ${relative}`, { path: relative, linkTarget: await readlink(path2.join(root, relative)) });
      }
    }
  }
  const present = [];
  for (const relative of unique) {
    try {
      await lstat(path2.join(root, relative));
      present.push(relative);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return present;
}
async function fingerprintGovernedRoots(root, input) {
  const files = await enumerateProtectedFiles(root, input);
  const digest8 = createHash("sha256");
  for (const relative of files) {
    const absolute = path2.join(root, relative);
    const metadata = await lstat(absolute);
    digest8.update(relative);
    digest8.update("\0");
    if (metadata.isSymbolicLink()) {
      digest8.update("symlink\0");
      digest8.update(await readlink(absolute));
    } else {
      digest8.update("file\0");
      digest8.update(await readFile(absolute));
    }
    digest8.update("\0");
  }
  return digest8.digest("hex");
}
async function fingerprintFeatureOwned(root, input, ownership) {
  const files = (await enumerateProtectedFiles(root, input)).filter((file) => ownership[file] === "feature");
  const digest8 = createHash("sha256");
  for (const relative of files) {
    const absolute = path2.join(root, relative);
    const metadata = await lstat(absolute);
    digest8.update(relative);
    digest8.update("\0");
    if (metadata.isSymbolicLink()) {
      digest8.update("symlink\0");
      digest8.update(await readlink(absolute));
    } else {
      digest8.update("file\0");
      digest8.update(await readFile(absolute));
    }
    digest8.update("\0");
  }
  return digest8.digest("hex");
}
async function snapshotGovernedRoots(root, input) {
  const files = await enumerateProtectedFiles(root, input);
  const snapshots = [];
  for (const relative of files) {
    const absolute = path2.join(root, relative);
    const metadata = await lstat(absolute);
    const symbolic = metadata.isSymbolicLink();
    const bytes = symbolic ? Buffer.from(await readlink(absolute)) : await readFile(absolute);
    snapshots.push({
      path: relative,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mode: (metadata.mode & 511).toString(8).padStart(3, "0"),
      kind: symbolic ? "symlink" : "file",
      ...symbolic ? { linkTarget: bytes.toString("utf8") } : {}
    });
  }
  return snapshots;
}
var runFile, ignored;
var init_fingerprint = __esm({
  "plugins/dev-flow/src/core/fingerprint.ts"() {
    "use strict";
    init_rollback();
    init_errors();
    init_path_normalization();
    runFile = promisify(execFile);
    ignored = /* @__PURE__ */ new Set([".git", ".dev-flow", "node_modules"]);
  }
});

// plugins/dev-flow/src/core/project-config.ts
import path3 from "node:path";
import { createHash as createHash2 } from "node:crypto";
function verificationCommandHashes(config) {
  return Object.fromEntries(config.verification.commands.map((command) => [
    command.id,
    // `provides` is a governance declaration, not executable command
    // identity. Expanding guarantees must not invalidate evidence that ran
    // the same command bytes with the same cwd/args.
    createHash2("sha256").update(JSON.stringify({ id: command.id, command: command.command, args: command.args, cwd: command.cwd })).digest("hex")
  ]));
}
function verificationGuarantees(config) {
  const preflight = new Set(config.verification.preflightCommands ?? []);
  return new Set(config.verification.commands.filter((command) => !preflight.has(command.id)).flatMap((command) => command.provides));
}
function missingVerificationGuarantees(config, required) {
  const available = verificationGuarantees(config);
  return [...new Set(required)].filter((kind) => !available.has(kind));
}
function relativeDirectory(value) {
  return value.length > 0 && !path3.isAbsolute(value) && !value.split(/[\\/]+/).includes("..");
}
function normalizedRelativeDirectory(value) {
  if (!relativeDirectory(value)) return void 0;
  const normalized = normalizeProjectPath(value).replace(/\/+$/u, "");
  return normalized || ".";
}
function validateProjectConfig(value) {
  const config = value;
  if (value?.schemaVersion === 1) throw new DevFlowError("UNSUPPORTED_PROJECT_SCHEMA", "\u9879\u76EE\u4ECD\u4F7F\u7528 Dev Flow 4.x schema v1\u3002", {
    schemaVersion: 1,
    recoveryHint: "\u5148\u7528 4.x \u5B8C\u6210\u6216\u653E\u5F03 active feature\uFF0C\u5907\u4EFD .dev-flow\uFF0C\u518D\u4EE5 schema v2 \u91CD\u65B0\u521D\u59CB\u5316"
  });
  if (config?.schemaVersion !== 2 || config.enforcement?.mode !== "strict") throw new DevFlowError("INVALID_PROJECT_CONFIG", "only schema v2 strict configuration is supported");
  if (config.enforcement.gitWriteRequiresLogicComplete !== true || config.enforcement.oneActiveFeature !== true || config.enforcement.requireExplicitHumanReply !== true) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "all strict enforcement controls must be enabled");
  }
  if (!Array.isArray(config.governedRoots) || !config.governedRoots.length) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "governedRoots must contain project-relative files or directories outside .dev-flow");
  }
  const governedRoots = config.governedRoots.map(normalizedRelativeDirectory);
  if (governedRoots.some((root) => !root || root === ".git" || root.startsWith(".git/") || root === ".dev-flow" || root.startsWith(".dev-flow/"))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "governedRoots must contain project-relative files or directories outside control paths");
  }
  config.governedRoots = governedRoots;
  if (config.governedRootsExclude !== void 0) {
    if (!Array.isArray(config.governedRootsExclude) || config.governedRootsExclude.some((pattern) => typeof pattern !== "string" || !relativeDirectory(pattern))) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", "governedRootsExclude must contain non-empty relative patterns without ..");
    }
    config.governedRootsExclude = config.governedRootsExclude.map((pattern) => normalizeProjectPath(pattern));
  }
  const commands = config.verification?.commands;
  if (!Array.isArray(commands) || !commands.length) throw new DevFlowError("INVALID_PROJECT_CONFIG", "at least one verification command is required");
  const ids = /* @__PURE__ */ new Set();
  for (const command of commands) {
    if (!command?.id || !command.command || !Array.isArray(command.args) || !relativeDirectory(command.cwd) || !Array.isArray(command.provides) || command.provides.length === 0 || command.provides.some((kind) => !["targeted", "behavior", "integration", "full"].includes(kind))) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification commands require valid provides guarantees");
    }
    if (command.timeoutMs !== void 0 && (!Number.isInteger(command.timeoutMs) || command.timeoutMs < 1e3)) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", `verification command ${command.id} timeoutMs must be an integer of at least 1000ms`);
    }
    if (command.maxOutputBytes !== void 0 && (!Number.isInteger(command.maxOutputBytes) || command.maxOutputBytes < 1024)) {
      throw new DevFlowError("INVALID_PROJECT_CONFIG", `verification command ${command.id} maxOutputBytes must be an integer of at least 1024 bytes`);
    }
    if (ids.has(command.id)) throw new DevFlowError("INVALID_PROJECT_CONFIG", "verification command ids must be unique");
    ids.add(command.id);
  }
  const preflightCommands = config.verification?.preflightCommands;
  if (preflightCommands !== void 0 && (!Array.isArray(preflightCommands) || preflightCommands.some((id) => typeof id !== "string" || !ids.has(id)))) {
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "preflightCommands must reference configured command ids");
  }
  if (preflightCommands && config.verification) config.verification.preflightCommands = [...new Set(preflightCommands)];
  const missing = missingVerificationGuarantees(config, ["targeted"]);
  if (missing.length) {
    throw new DevFlowError("VERIFICATION_GUARANTEE_UNCONFIGURED", "\u9879\u76EE\u5FC5\u987B\u914D\u7F6E\u81F3\u5C11\u4E00\u4E2A\u975E preflight \u547D\u4EE4\u63D0\u4F9B targeted guarantee\u3002", {
      missingGuarantees: missing,
      userMessage: "\u9879\u76EE\u9A8C\u8BC1\u914D\u7F6E\u7F3A\u5C11\u6700\u7EC8\u9A8C\u8BC1\u6240\u9700\u7684 targeted guarantee\u3002",
      cause: "preflight \u547D\u4EE4\u53EA\u7528\u4E8E\u73AF\u5883\u51C6\u5907\u548C\u8BCA\u65AD\uFF0C\u4E0D\u80FD\u4F5C\u4E3A\u4E1A\u52A1\u9A8C\u8BC1\u8BC1\u636E\u3002",
      impact: "\u9879\u76EE\u65E0\u6CD5\u5B89\u5168\u521B\u5EFA\u4F1A\u8BDD\u6216\u9501\u5B9A\u8DEF\u7EBF\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u8865\u5145\u4E00\u4E2A\u975E preflight \u9A8C\u8BC1\u547D\u4EE4\u5E76\u91CD\u65B0\u521D\u59CB\u5316\u9879\u76EE\u3002",
      retryOriginal: false
    });
  }
}
var init_project_config = __esm({
  "plugins/dev-flow/src/core/project-config.ts"() {
    "use strict";
    init_errors();
    init_path_normalization();
  }
});

// plugins/dev-flow/src/core/traceability.ts
function invalid2(message, details = {}) {
  throw new DevFlowError("TRACE_GRAPH_INVALID", message, details);
}
function sliceError(code, message, details = {}) {
  throw new DevFlowError(code, message, details);
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringArray(value, allowEmpty = false) {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every((item) => typeof item === "string" && item.length > 0);
}
function isVerificationCommandRef(value) {
  return typeof value === "string" && value.length > 0;
}
function isVerificationCommandArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isVerificationCommandRef);
}
function assertId(kind, id) {
  if (typeof id !== "string" || !new RegExp(`^${idPrefix[kind]}-[0-9]{3,}$`).test(id)) {
    invalid2("node ID does not match its kind", { kind, id });
  }
}
function assertSafeFileScope(fileScope, id, persisted = false) {
  for (const pattern of fileScope) {
    if (persisted && pattern !== normalizeUnicode(pattern)) {
      invalid2("persisted rollback fileScope must use Unicode NFC", { id, field: "fileScope", pattern });
    }
    if (!isSafeFileScopePattern(pattern)) {
      invalid2(persisted ? "persisted rollback fileScope is unsafe" : "rollback fileScope is unsafe", { id, field: "fileScope", pattern });
    }
  }
}
function validateVerificationDisposition(value, id) {
  if (!isRecord3(value) || Object.keys(value).some((key) => !["kind", "reason", "target"].includes(key)) || typeof value.kind !== "string" || !dispositionKinds.has(value.kind)) {
    invalid2("acceptance-criterion verificationDisposition is invalid", { id });
  }
  if (value.kind !== "behavior-test") {
    if (typeof value.reason !== "string" || !value.reason.trim()) {
      invalid2("non-behavior verification disposition requires a non-empty reason", { id });
    }
    if (value.target !== void 0 && (typeof value.target !== "string" || !value.target.trim())) {
      invalid2("verification disposition target must be a non-empty string", { id });
    }
  } else if (value.reason !== void 0 && typeof value.reason !== "string") {
    invalid2("verification disposition reason must be a string", { id });
  }
}
function currentNodes(nodes) {
  return Object.values(nodes).filter((node) => node.status !== "tombstoned");
}
function nodeById(nodes, id) {
  const node = nodes[id];
  return node?.status === "tombstoned" ? void 0 : node;
}
function deriveTraceEdges(nodes) {
  const edges = [];
  for (const node of currentNodes(nodes)) {
    if (node.kind === "acceptance-criterion") edges.push({ from: node.id, type: "parent", to: node.parentRequirement });
    if (node.kind === "task") {
      for (const target of node.covers) edges.push({ from: node.id, type: "covers", to: target });
      edges.push({ from: node.id, type: "implementation-unit", to: node.implementationUnit });
    }
    if (node.kind === "test") for (const target of node.verifies) edges.push({ from: node.id, type: "verifies", to: target });
    if (node.kind === "rollback") {
      for (const target of node.tasks) edges.push({ from: node.id, type: "contains-task", to: target });
      for (const target of node.dependsOn) edges.push({ from: node.id, type: "depends-on", to: target });
      for (const target of node.covers) edges.push({ from: node.id, type: "covers", to: target });
    }
    if (node.kind === "implementation-unit") {
      for (const target of node.tasks) edges.push({ from: node.id, type: "contains-task", to: target });
      for (const target of node.dependsOn) edges.push({ from: node.id, type: "depends-on", to: target });
      for (const target of node.covers) edges.push({ from: node.id, type: "covers", to: target });
    }
  }
  return edges.sort((a, b) => `${a.from}\0${a.type}\0${a.to}`.localeCompare(`${b.from}\0${b.type}\0${b.to}`));
}
function traceSummary(nodes) {
  const values = Object.values(nodes);
  return {
    total: values.length,
    current: values.filter((node) => node.status === "current").length,
    stale: values.filter((node) => node.status === "stale").length,
    tombstoned: values.filter((node) => node.status === "tombstoned").length
  };
}
function assertReference(nodes, id, kinds, details) {
  const node = nodeById(nodes, id);
  if (!node || !kinds.includes(node.kind)) invalid2("graph reference is missing or has the wrong kind", { id, ...details });
  return node;
}
function assertRollbackDag(nodes) {
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) invalid2("rollback dependency graph contains a cycle", { id });
    visiting.add(id);
    const node = nodeById(nodes, id);
    if (node?.kind === "rollback") for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of currentNodes(nodes)) if (node.kind === "rollback") visit(node.id);
}
function assertImplementationDag(nodes) {
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) invalid2("implementation unit dependency graph contains a cycle", { id });
    visiting.add(id);
    const node = nodeById(nodes, id);
    if (node?.kind === "implementation-unit") for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of currentNodes(nodes)) if (node.kind === "implementation-unit") visit(node.id);
}
function sameEdges(left, right) {
  return left.length === right.length && left.every((edge, index) => {
    const candidate = right[index];
    return edge.from === candidate?.from && edge.type === candidate.type && edge.to === candidate.to;
  });
}
function sameSummary(left, right) {
  return left.total === right.total && left.current === right.current && left.stale === right.stale && left.tombstoned === right.tombstoned;
}
function assertPersistedNode(recordId, value, options) {
  if (!isRecord3(value)) invalid2("persisted node is not an object", { id: recordId });
  const kind = value.kind;
  if (typeof kind !== "string" || !(kind in idPrefix)) invalid2("persisted node has an unknown kind", { id: recordId, kind });
  assertId(kind, value.id);
  if (value.id !== recordId) invalid2("persisted node id does not match its record key", { id: recordId, nodeId: value.id });
  if (!statusValues.has(value.status)) invalid2("persisted node has an invalid status", { id: recordId, status: value.status });
  if (typeof value.sourceArtifact !== "string" || !sourceArtifacts.has(value.sourceArtifact)) {
    invalid2("persisted node has an invalid sourceArtifact", { id: recordId, sourceArtifact: value.sourceArtifact });
  }
  if (typeof value.sourceSha256 !== "string" || !hex64.test(value.sourceSha256)) {
    invalid2("persisted node has an invalid sourceSha256", { id: recordId });
  }
  if (typeof value.sourceAnchor !== "string" || !value.sourceAnchor.includes(`id=${value.id}`)) {
    invalid2("persisted node has an invalid sourceAnchor", { id: recordId });
  }
  if (typeof value.sourceBlockSha256 !== "string" || !hex64.test(value.sourceBlockSha256)) {
    invalid2("persisted node has an invalid sourceBlockSha256", { id: recordId });
  }
  if (kind === "acceptance-criterion") {
    assertId("requirement", value.parentRequirement);
    if (value.verificationDisposition !== void 0) validateVerificationDisposition(value.verificationDisposition, recordId);
  }
  if (kind === "task") {
    if (!isStringArray(value.covers)) invalid2("persisted task covers is invalid", { id: recordId });
    assertId("implementation-unit", value.implementationUnit);
    if (value.tdd !== void 0 && value.tdd !== "test-first" && value.tdd !== "direct") {
      invalid2("persisted task tdd is invalid", { id: recordId });
    }
  }
  if (kind === "test") {
    if (!isStringArray(value.verifies)) invalid2("persisted test verifies is invalid", { id: recordId });
  }
  if (kind === "recovery") {
    if (typeof value.stepRef !== "string" || !/^(?:UNIT|TASK)-[0-9]{3,}$/.test(value.stepRef)) invalid2("persisted recovery stepRef is invalid", { id: recordId });
    if (value.recoveryKind !== "rollback" && value.recoveryKind !== "compensation") invalid2("persisted recovery recoveryKind is invalid", { id: recordId });
    if (typeof value.method !== "string" || !value.method.trim()) invalid2("persisted recovery method is invalid", { id: recordId });
    if (typeof value.riskRef !== "string" || !value.riskRef.trim()) invalid2("persisted recovery riskRef is invalid", { id: recordId });
  }
  if (kind === "rollback") {
    invalid2("rollback nodes are not a v6 Trace kind; use recovery", { id: recordId });
  }
  if (kind === "implementation-unit") {
    if (!isStringArray(value.tasks) || !isStringArray(value.dependsOn, true) || !isStringArray(value.fileScope) || !isStringArray(value.covers) || !isVerificationCommandArray(value.forwardVerification)) {
      invalid2("persisted implementation unit fields are invalid", { id: recordId });
    }
    for (const taskId of value.tasks) assertId("task", taskId);
    for (const dependency of value.dependsOn) assertId("implementation-unit", dependency);
    assertSafeFileScope(value.fileScope, recordId, true);
    if (typeof value.verificationConfigSha256 !== "string" || !hex64.test(value.verificationConfigSha256)) invalid2("persisted implementation unit verification configuration is invalid", { id: recordId });
  }
}
function acceptanceCriterionCovered(nodes, node) {
  if (currentNodes(nodes).some((candidate) => candidate.kind === "test" && candidate.verifies.includes(node.id))) return true;
  const disposition = node.verificationDisposition;
  if (!disposition) return false;
  if (disposition.kind === "behavior-test") return false;
  return Boolean(disposition.reason?.trim());
}
function assertPersistedLedgerShape(ledger, options) {
  if (typeof ledger.featureId !== "string" || !ledger.featureId) invalid2("ledger featureId is invalid");
  if (!Number.isInteger(ledger.revision) || ledger.revision < 0) invalid2("ledger revision is invalid");
  if (!Number.isInteger(ledger.stateRevision) || ledger.stateRevision < 0) invalid2("ledger stateRevision is invalid");
  if (typeof ledger.projectConfigSha256 !== "string" || !hex64.test(ledger.projectConfigSha256)) {
    invalid2("ledger projectConfigSha256 is invalid");
  }
  if (ledger.verificationCommandHashes !== void 0 && (!isRecord3(ledger.verificationCommandHashes) || Object.values(ledger.verificationCommandHashes).some((value) => typeof value !== "string" || !hex64.test(value)))) {
    invalid2("ledger verification command hashes are invalid");
  }
  for (const [id, node] of Object.entries(ledger.nodes)) assertPersistedNode(id, node, options);
}
function validateTraceGraph(ledger, route, mode, options = {}) {
  if (!isRecord3(ledger) || ledger.schemaVersion !== 2 || !isRecord3(ledger.nodes) || !Array.isArray(ledger.edges)) invalid2("traceability ledger has an invalid shape");
  assertPersistedLedgerShape(ledger, options);
  const nodes = ledger.nodes;
  for (const node of currentNodes(nodes)) {
    if (node.kind === "acceptance-criterion") assertReference(nodes, node.parentRequirement, ["requirement"], { from: node.id });
    if (node.kind === "task") {
      if (node.covers.length === 0) invalid2("task cannot be orphaned", { id: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
      const unit = nodeById(nodes, node.implementationUnit);
      if (!unit && !(route === "l" && mode === "partial")) invalid2("task references a missing implementation unit", { id: node.id, implementationUnit: node.implementationUnit });
      if (unit && unit.kind !== "implementation-unit") invalid2("task implementation unit has the wrong kind", { id: node.id });
      if (unit?.kind === "implementation-unit" && !unit.tasks.includes(node.id)) {
        invalid2("implementation unit must list the task", { id: node.id, implementationUnit: node.implementationUnit });
      }
    }
    if (node.kind === "test") for (const verified of node.verifies) assertReference(nodes, verified, ["acceptance-criterion"], { from: node.id });
    if (node.kind === "rollback") {
      for (const taskId of node.tasks) {
        const task = assertReference(nodes, taskId, ["task"], { from: node.id });
        if (task.kind !== "task") invalid2("rollback arrangement task reference is invalid", { id: node.id, taskId });
      }
      for (const dependency of node.dependsOn) assertReference(nodes, dependency, ["rollback"], { from: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
    }
    if (node.kind === "implementation-unit") {
      for (const taskId of node.tasks) {
        const task = assertReference(nodes, taskId, ["task"], { from: node.id });
        if (task.kind !== "task" || task.implementationUnit !== node.id) invalid2("implementation unit tasks must be symmetric with task implementationUnit", { id: node.id, taskId });
      }
      for (const dependency of node.dependsOn) assertReference(nodes, dependency, ["implementation-unit"], { from: node.id });
      for (const covered of node.covers) assertReference(nodes, covered, ["requirement", "acceptance-criterion"], { from: node.id });
    }
    if (node.kind === "recovery") {
      assertReference(nodes, node.stepRef, ["implementation-unit", "task"], { from: node.id });
    }
  }
  assertRollbackDag(nodes);
  assertImplementationDag(nodes);
  const edges = deriveTraceEdges(nodes);
  if (!sameEdges(ledger.edges, edges)) invalid2("ledger edges do not match nodes");
  if (!sameSummary(ledger.summary, traceSummary(nodes))) invalid2("ledger summary does not match nodes");
  if (mode === "complete") {
    const kinds = new Set(currentNodes(nodes).map((node) => node.kind));
    for (const kind of ["requirement", "acceptance-criterion", "task", "implementation-unit"]) if (!kinds.has(kind)) invalid2("complete graph is missing a required node kind", { kind });
    if (currentNodes(nodes).some((node) => node.status !== "current")) invalid2("complete graph cannot contain stale nodes");
    for (const node of currentNodes(nodes)) {
      if (node.kind === "acceptance-criterion" && !acceptanceCriterionCovered(nodes, node)) {
        invalid2("every acceptance criterion requires a test or an explicit verification disposition", { id: node.id });
      }
    }
  }
}
function assertConfigCurrent(ledger, currentProjectConfigSha256, currentCommandHashes) {
  if (ledger.verificationCommandHashes && currentCommandHashes) {
    const referenced = /* @__PURE__ */ new Set();
    for (const node of currentNodes(ledger.nodes)) {
      if (node.kind === "implementation-unit") {
        for (const ref of node.forwardVerification) if (typeof ref === "string") referenced.add(ref);
      } else if (node.kind === "rollback") {
        for (const ref of [...node.forwardVerification, ...node.rollbackVerification]) if (typeof ref === "string") referenced.add(ref);
      }
    }
    for (const id of referenced) {
      if (ledger.verificationCommandHashes[id] !== currentCommandHashes[id]) sliceError("TRACE_SLICE_STALE", "referenced verification command changed", { commandId: id });
    }
  } else if (ledger.projectConfigSha256 !== currentProjectConfigSha256) {
    sliceError("TRACE_SLICE_STALE", "project configuration changed since Trace registration");
  }
  for (const node of currentNodes(ledger.nodes)) {
    if ((node.kind === "rollback" || node.kind === "implementation-unit") && !ledger.verificationCommandHashes && node.verificationConfigSha256 !== currentProjectConfigSha256) {
      sliceError("TRACE_SLICE_STALE", "rollback verification configuration is stale", { id: node.id });
    }
  }
}
function requireCurrentKinds(ledger, kinds) {
  for (const kind of kinds) {
    const nodes = currentNodes(ledger.nodes).filter((node) => node.kind === kind);
    if (nodes.length === 0) sliceError("TRACE_SLICE_INCOMPLETE", "Trace slice is missing a required node", { kind });
    if (nodes.some((node) => node.status === "stale")) sliceError("TRACE_SLICE_STALE", "Trace slice contains stale nodes", { kind });
  }
}
function assertTraceabilityComplete(ledger, route, currentProjectConfigSha256, currentCommandHashes) {
  assertConfigCurrent(ledger, currentProjectConfigSha256, currentCommandHashes);
  if (Object.values(ledger.nodes).some((node) => node.status === "stale")) {
    sliceError("TRACE_SLICE_STALE", "complete Trace graph contains stale nodes");
  }
  try {
    validateTraceGraph(ledger, route, "complete");
  } catch (error) {
    if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details);
    throw error;
  }
}
function assertTraceSliceCurrent(ledger, route, step, currentProjectConfigSha256, currentCommandHashes) {
  assertConfigCurrent(ledger, currentProjectConfigSha256, currentCommandHashes);
  const completeSteps = /* @__PURE__ */ new Set(["planning", "implementation", "finalize"]);
  if (completeSteps.has(step)) return assertTraceabilityComplete(ledger, route, currentProjectConfigSha256, currentCommandHashes);
  const requirements = ["requirement", "acceptance-criterion"];
  if (["requirements"].includes(step)) {
    requireCurrentKinds(ledger, [...requirements]);
    try {
      validateTraceGraph(ledger, route, "partial");
    } catch (error) {
      if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details);
      throw error;
    }
    return;
  }
  const kinds = step === "implementation_plan" ? [...requirements, "task", "implementation-unit"] : step === "coverage_review" ? [...requirements, "task", "test"] : step === "rollback_unit" ? [...requirements, "task", "test", "rollback"] : [...requirements, "task", "test", "implementation-unit"];
  requireCurrentKinds(ledger, kinds);
  try {
    validateTraceGraph(ledger, route, step === "rollback_unit" ? "complete" : "partial");
    if (step === "coverage_review") {
      for (const node of currentNodes(ledger.nodes)) if (node.kind === "acceptance-criterion" && !acceptanceCriterionCovered(ledger.nodes, node)) {
        sliceError("TRACE_SLICE_INCOMPLETE", "coverage review requires a test or an explicit verification disposition for every acceptance criterion", { id: node.id });
      }
    }
  } catch (error) {
    if (error instanceof DevFlowError) sliceError("TRACE_SLICE_INCOMPLETE", error.message, error.details);
    throw error;
  }
}
var idPrefix, dispositionKinds, statusValues, sourceArtifacts, hex64;
var init_traceability = __esm({
  "plugins/dev-flow/src/core/traceability.ts"() {
    "use strict";
    init_errors();
    init_rollback();
    init_path_normalization();
    idPrefix = {
      requirement: "REQ",
      "acceptance-criterion": "AC",
      task: "TASK",
      test: "TEST",
      "implementation-unit": "UNIT",
      rollback: "RU",
      recovery: "REC"
    };
    dispositionKinds = /* @__PURE__ */ new Set(["behavior-test", "type-check", "rule-check", "file-check", "human-acceptance"]);
    statusValues = /* @__PURE__ */ new Set(["current", "stale", "tombstoned"]);
    sourceArtifacts = /* @__PURE__ */ new Set(["requirements", "implementation-plan"]);
    hex64 = /^[a-f0-9]{64}$/;
  }
});

// plugins/dev-flow/src/core/traceability-store.ts
import { createHash as createHash3, randomUUID } from "node:crypto";
import { mkdir, open, readFile as readFile2, readdir as readdir2, rename } from "node:fs/promises";
import path4 from "node:path";
function digest(contents) {
  return createHash3("sha256").update(contents).digest("hex");
}
function integrity(message, details = {}) {
  throw new DevFlowError("TRACEABILITY_INTEGRITY_FAILED", message, details);
}
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertSupportedTraceSchema(ledger) {
  if (!isRecord4(ledger)) integrity("Trace snapshot has an invalid shape");
  if (ledger.schemaVersion === 1) {
    throw new DevFlowError("UNSUPPORTED_TRACE_SCHEMA", "\u68C0\u6D4B\u5230\u65E7 Trace ledger schema\u3002", {
      recoveryHint: "\u7528\u4EA7\u751F\u8BE5\u72B6\u6001\u7684\u65E7\u63D2\u4EF6\u6536\u5C3E\uFF0C\u5907\u4EFD .dev-flow \u540E\u7528 6.0 \u91CD\u65B0\u521D\u59CB\u5316"
    });
  }
  if (ledger.schemaVersion !== 2) integrity("Trace snapshot has an invalid schemaVersion");
}
function safeSnapshotPath(pointer) {
  if (!/^traceability\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path) || pointer.path !== `traceability/snapshots/${pointer.sha256}.json`) {
    integrity("Trace pointer path is invalid");
  }
  return pointer.path;
}
function sameEdges2(left, right) {
  return left.length === right.length && left.every((edge, index) => {
    const candidate = right[index];
    return edge.from === candidate?.from && edge.type === candidate.type && edge.to === candidate.to;
  });
}
async function readTraceabilityWithOptions(root, state, options = {}) {
  if (!state.traceability) integrity("Trace pointer is missing", { featureId: state.featureId });
  const pointer = state.traceability;
  const relative = safeSnapshotPath(pointer);
  const file = path4.join(root, ".dev-flow", "features", state.featureId, relative);
  let contents;
  try {
    contents = await readFile2(file, "utf8");
  } catch {
    integrity("Trace snapshot cannot be read", { featureId: state.featureId, path: relative });
  }
  if (digest(contents) !== pointer.sha256) integrity("Trace snapshot digest does not match pointer", { featureId: state.featureId });
  let ledger;
  try {
    ledger = JSON.parse(contents);
  } catch {
    integrity("Trace snapshot is not valid JSON", { featureId: state.featureId });
  }
  assertSupportedTraceSchema(ledger);
  try {
    validateTraceGraph(ledger, state.route, "partial", options);
  } catch (error) {
    integrity("Trace snapshot graph is invalid", { cause: error instanceof Error ? error.message : String(error) });
  }
  if (ledger.featureId !== state.featureId || ledger.revision !== pointer.revision || ledger.stateRevision > state.revision) {
    integrity("Trace pointer and ledger revisions do not match", { featureId: state.featureId });
  }
  if (ledger.summary.total !== pointer.summary.total || ledger.summary.current !== pointer.summary.current || ledger.summary.stale !== pointer.summary.stale || ledger.summary.tombstoned !== pointer.summary.tombstoned || !sameEdges2(deriveTraceEdges(ledger.nodes), ledger.edges)) {
    integrity("Trace pointer summary or ledger edges do not match", { featureId: state.featureId });
  }
  return ledger;
}
async function readTraceability(root, state) {
  return readTraceabilityWithOptions(root, state);
}
async function readProjectConfigSnapshot(root) {
  const file = path4.join(root, ".dev-flow", "project.json");
  let raw;
  try {
    raw = await readFile2(file, "utf8");
  } catch {
    throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first", {
      userMessage: "\u9879\u76EE\u5C1A\u672A\u521D\u59CB\u5316\uFF0C\u8BF7\u5148\u8FD0\u884C dev_flow_init_project\u3002",
      cause: "\u5F53\u524D\u4E1A\u52A1\u76EE\u5F55\u7F3A\u5C11 .dev-flow/project.json\u3002",
      impact: "\u672A\u521D\u59CB\u5316\u9879\u76EE\u524D\u65E0\u6CD5\u8BFB\u53D6\u8FFD\u6EAF\u6295\u5F71\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u8FD0\u884C dev_flow_init_project \u521D\u59CB\u5316\u9879\u76EE\u540E\u91CD\u8BD5\u3002",
      retryOriginal: true,
      requiresUserDecision: false
    });
  }
  let config;
  try {
    config = JSON.parse(raw);
    validateProjectConfig(config);
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "project configuration is unreadable");
  }
  return { config, sha256: digest(raw), contents: raw };
}
var init_traceability_store = __esm({
  "plugins/dev-flow/src/core/traceability-store.ts"() {
    "use strict";
    init_errors();
    init_project_config();
    init_traceability();
  }
});

// plugins/dev-flow/src/core/traceability-anchors.ts
import { createHash as createHash4 } from "node:crypto";
function invalidAnchor(message, details = {}) {
  throw new DevFlowError("TRACE_SOURCE_ANCHOR_INVALID", message, details);
}
function parseTraceSourceBlocks(markdown) {
  const devFlowComments = markdown.match(/<!-- dev-flow:[\s\S]*?-->/g) ?? [];
  TRACE_ANCHOR.lastIndex = 0;
  const anchors = [];
  let match;
  while ((match = TRACE_ANCHOR.exec(markdown)) !== null) {
    const [, prefix, suffix, rawKind] = match;
    const kind = rawKind;
    if (expectedKind[prefix] !== kind) {
      invalidAnchor("anchor ID prefix does not match its kind", { prefix, kind });
    }
    const id = `${prefix}-${suffix}`;
    if (anchors.some((anchor) => anchor.id === id)) {
      invalidAnchor("anchor ID is declared more than once", { id });
    }
    anchors.push({ id, kind, sourceAnchor: match[0], index: match.index });
  }
  if (anchors.length === 0 || anchors.length !== devFlowComments.length) {
    invalidAnchor("trace artifacts require one or more exact declaration anchors");
  }
  return anchors.map((anchor, index) => {
    const end = anchors[index + 1]?.index ?? markdown.length;
    const sourceBlock = markdown.slice(anchor.index, end);
    return {
      id: anchor.id,
      kind: anchor.kind,
      sourceAnchor: anchor.sourceAnchor,
      sourceBlockSha256: createHash4("sha256").update(sourceBlock, "utf8").digest("hex")
    };
  });
}
var TRACE_ANCHOR, expectedKind;
var init_traceability_anchors = __esm({
  "plugins/dev-flow/src/core/traceability-anchors.ts"() {
    "use strict";
    init_errors();
    TRACE_ANCHOR = /<!-- dev-flow:id=(REQ|AC|TASK|TEST|UNIT|RU|REC)-([0-9]{3,}) kind=(requirement|acceptance-criterion|task|test|implementation-unit|rollback|recovery) -->/g;
    expectedKind = {
      REQ: "requirement",
      AC: "acceptance-criterion",
      TASK: "task",
      TEST: "test",
      UNIT: "implementation-unit",
      RU: "rollback",
      REC: "recovery"
    };
  }
});

// plugins/dev-flow/src/core/traceability-gates.ts
import { readFile as readFile3 } from "node:fs/promises";
import path5 from "node:path";
function traceSliceForWorkflowStep(step) {
  if (step === "requirements_alignment") return "requirements";
  if (step === "planning") return "implementation_plan";
  return step;
}
function traceIsEnforced(state) {
  return traceEnforcementRequired(state.route, state.classification.controls);
}
function blockerFor(step, error) {
  const value = error;
  if (value?.code === "TRACE_SLICE_STALE" || value?.code === "TRACE_SLICE_INCOMPLETE") {
    return {
      code: value.code,
      step,
      details: typeof value.details === "object" && value.details !== null && !Array.isArray(value.details) ? value.details : {}
    };
  }
  return {
    code: "TRACE_SLICE_INCOMPLETE",
    step,
    details: {
      cause: typeof value?.code === "string" ? value.code : "TRACEABILITY_UNREADABLE",
      ...typeof value?.message === "string" ? { message: value.message } : {}
    }
  };
}
async function inspectTraceGate(root, state, step) {
  if (!traceIsEnforced(state)) return { enforced: false };
  const traceStep = traceSliceForWorkflowStep(step);
  let ledger;
  try {
    ledger = await readTraceability(root, state);
    const { config, sha256: sha2564 } = await readProjectConfigSnapshot(root);
    assertTraceSliceCurrent(ledger, state.route, traceStep, sha2564, verificationCommandHashes(config));
    if (traceStep === "implementation_plan") await assertImplementationPlanTraceCurrent(root, state, ledger);
    return { enforced: true, ledger, effectiveSummary: ledger.summary };
  } catch (error) {
    return {
      enforced: true,
      ...ledger ? { ledger, effectiveSummary: ledger.summary } : {},
      blocker: blockerFor(traceStep, error)
    };
  }
}
async function assertImplementationPlanTraceCurrent(root, state, ledger) {
  const artifact = state.artifacts["implementation-plan"];
  if (!artifact) return;
  const planNodes = Object.values(ledger.nodes).filter((node) => node.sourceArtifact === "implementation-plan" && node.status !== "tombstoned");
  const currentPlanNodes = planNodes.filter((node) => node.status === "current");
  if (currentPlanNodes.length === 0) {
    if (planNodes.some((node) => node.status === "stale")) {
      throw new DevFlowError("TRACE_SLICE_STALE", "implementation-plan Trace slice has no current nodes and contains stale nodes", {
        stalePlanNodeIds: planNodes.filter((node) => node.status === "stale").map((node) => node.id).sort(),
        recoveryHint: "\u91CD\u65B0\u767B\u8BB0\u5F53\u524D\u5B9E\u65BD\u8BA1\u5212 Markdown \u5237\u65B0 Trace \u540E\u518D\u7EE7\u7EED\u3002"
      });
    }
    throw new DevFlowError("TRACE_SLICE_MISSING", "implementation-plan Trace slice has no current nodes", {
      recoveryHint: "\u767B\u8BB0\u5B9E\u65BD\u8BA1\u5212 Markdown \u751F\u6210 implementation-plan Trace slice \u540E\u518D\u7EE7\u7EED\u3002"
    });
  }
  const stalePlanNodes = currentPlanNodes.filter((node) => node.sourceSha256 !== artifact.sha256).map((node) => ({ id: node.id, traceSha256: node.sourceSha256, artifactSha256: artifact.sha256 }));
  if (stalePlanNodes.length) {
    throw new DevFlowError("TRACE_SLICE_STALE", "implementation plan artifact changed without re-registering its Trace slice", {
      stalePlanNodes,
      recoveryHint: "\u91CD\u65B0\u767B\u8BB0\u5F53\u524D\u5B9E\u65BD\u8BA1\u5212 Markdown\uFF1B\u4FEE\u8BA2\u786E\u8BA4\u5DF2\u539F\u5B50\u767B\u8BB0 Trace\uFF0C\u4E0D\u518D\u9700\u8981\u624B\u5DE5 record_artifact_with_trace\u3002"
    });
  }
  const contents = await readFile3(path5.join(root, ".dev-flow", "features", state.featureId, normalizeUnicode(artifact.path)), "utf8");
  const blocks = new Map(parseTraceSourceBlocks(contents).map((block2) => [`${block2.kind}:${block2.id}`, block2]));
  for (const node of currentPlanNodes) {
    const block2 = blocks.get(`${node.kind}:${node.id}`);
    if (!block2) {
      throw new DevFlowError("TRACE_SLICE_STALE", "implementation plan Markdown source manifest does not match Trace", {
        missingBlock: { id: node.id, kind: node.kind },
        recoveryHint: "\u91CD\u65B0\u767B\u8BB0\u5F53\u524D\u5B9E\u65BD\u8BA1\u5212 Markdown\u3002"
      });
    }
    if (block2.sourceBlockSha256 !== node.sourceBlockSha256) {
      throw new DevFlowError("TRACE_SLICE_STALE", "implementation plan block changed without re-registering Trace", {
        changedBlock: { id: node.id },
        recoveryHint: "\u91CD\u65B0\u767B\u8BB0\u5F53\u524D\u5B9E\u65BD\u8BA1\u5212 Markdown\u3002"
      });
    }
  }
  const referenced = /* @__PURE__ */ new Set();
  for (const node of currentPlanNodes) {
    if (node.kind === "task") for (const id of node.covers) referenced.add(id);
    if (node.kind === "test") for (const id of node.verifies) referenced.add(id);
    if (node.kind === "implementation-unit") {
      for (const id of [...node.tasks, ...node.dependsOn, ...node.covers]) referenced.add(id);
    }
    if (node.kind === "recovery") referenced.add(node.stepRef);
  }
  const missingReferences = [...referenced].filter((id) => ledger.nodes[id]?.status !== "current").sort();
  if (missingReferences.length) {
    throw new DevFlowError("TRACE_SLICE_STALE", "implementation-plan Trace slice references stale or missing nodes", {
      missingReferences,
      recoveryHint: "\u91CD\u65B0\u767B\u8BB0\u4E0A\u6E38 requirements \u6216\u8BA1\u5212 Markdown\uFF0C\u4F7F\u88AB\u5F15\u7528\u8282\u70B9\u6062\u590D current\u3002"
    });
  }
}
async function inspectCurrentTrace(root, state) {
  if (!traceIsEnforced(state)) return { enforced: false };
  const step = currentOpenStep(state);
  return step ? inspectTraceGate(root, state, step) : { enforced: true };
}
async function assertTraceGateCurrent(root, state, step) {
  const inspection = await inspectTraceGate(root, state, step);
  if (!inspection.blocker) return inspection.ledger;
  throw new DevFlowError(
    inspection.blocker.code,
    `Trace slice is not ready for ${step}`,
    {
      ...inspection.blocker.details,
      recoveryHint: inspection.blocker.code === "TRACE_SLICE_STALE" ? "\u9A8C\u8BC1\u914D\u7F6E\u6216 trace \u8BC1\u636E\u5DF2\u53D8\u66F4\uFF1A\u82E5\u5B58\u5728\u6D3B\u52A8\u5B9E\u73B0\u5355\u5143\uFF0C\u5148\u7528 dev_flow_abandon_implementation_unit \u53D6\u6D88\uFF0C\u518D\u91CD\u767B\u8BB0\u8BA1\u5212\u5237\u65B0 Trace \u57FA\u7EBF\u3002" : "\u6309\u5F53\u524D\u9636\u6BB5\u8865\u9F50 trace \u8BC1\u636E\u540E\u91CD\u8BD5\u3002"
    }
  );
}
var init_traceability_gates = __esm({
  "plugins/dev-flow/src/core/traceability-gates.ts"() {
    "use strict";
    init_contract2();
    init_errors();
    init_step_order();
    init_traceability_store();
    init_traceability();
    init_project_config();
    init_traceability_anchors();
    init_path_normalization();
  }
});

// plugins/dev-flow/src/policy/review.ts
function assuranceForReviewBatch(batch, verifier = defaultReviewIdentityVerifier) {
  const attested = batch.jobs.filter((job) => job.status === "submitted" && job.submission?.attestation);
  const trusted = attested.filter((job) => verifier.verify(job.submission.attestation).trusted);
  const trustedAgents = new Set(trusted.map((job) => job.submission.attestation.agentId));
  const trustedRaws = new Set(trusted.map((job) => job.submission.attestation.rawSha256));
  if (trusted.length >= 2 && trustedAgents.size >= 2 && trustedRaws.size >= 2) return "multi-agent-verified";
  const sampled = batch.jobs.filter((job) => job.status === "submitted" && job.submission?.samplingProvenance);
  const hashes = new Set(sampled.map((job) => job.submission.samplingProvenance.requestSha256));
  if (sampled.length >= 2 && hashes.size >= 2) return "independent-sampling";
  return "multi-perspective";
}
function evidenceSourcesForReviewBatch(batch) {
  if (!batch) return [];
  const sources = [];
  if (batch.jobs.some((job) => job.status === "submitted")) sources.push("role-jobs");
  if (batch.jobs.some((job) => job.submission?.samplingProvenance)) sources.push("server-sampling");
  if (batch.jobs.some((job) => job.submission?.attestation)) sources.push("host-attestation");
  return sources;
}
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function describeReviewJobCompletionIssues(value) {
  if (!isRecord5(value)) return [{ path: "$", message: "expected object" }];
  const issues = [];
  if (typeof value.coverageSummary !== "string" || !value.coverageSummary.trim()) {
    issues.push({ path: "$.coverageSummary", message: "required non-empty string" });
  }
  if (!Array.isArray(value.findings)) {
    issues.push({ path: "$.findings", message: "required array" });
  }
  if (value.resolutions !== void 0 && !Array.isArray(value.resolutions)) {
    issues.push({ path: "$.resolutions", message: "must be an array when present" });
  }
  for (const key of Object.keys(value)) {
    if (key !== "coverageSummary" && key !== "findings" && key !== "resolutions") {
      issues.push({ path: `$.${key}`, message: "unknown field" });
    }
  }
  return issues;
}
function deriveReviewJobRequirements(route, riskLabels, derivedRoles, phase = "plan") {
  if (phase === "code") {
    const reviewDepth2 = riskLabels.includes("critical_correctness") ? "full" : "standard";
    return ["code-quality", "requirement-fidelity"].map((role) => ({ role, reviewDepth: reviewDepth2 }));
  }
  if (route !== "m" && route !== "l") return [];
  const roles = derivedRoles?.length ? [...derivedRoles] : ["requirements-coverage", "architecture-testability", "rollback-operability"];
  if (!derivedRoles && riskLabels.includes("security")) roles.push("security");
  if (!derivedRoles && riskLabels.some((label) => label === "data" || label === "money" || label === "irreversible_consequence")) {
    roles.push("data-irreversibility");
  }
  const reviewDepth = riskLabels.includes("critical_correctness") ? "full" : "standard";
  return reviewRoles.filter((role) => roles.includes(role)).map((role) => ({ role, reviewDepth }));
}
var defaultReviewIdentityVerifier, reviewRoles;
var init_review = __esm({
  "plugins/dev-flow/src/policy/review.ts"() {
    "use strict";
    defaultReviewIdentityVerifier = {
      verify: () => ({ trusted: false })
    };
    reviewRoles = [
      "code-quality",
      "requirement-fidelity",
      "requirements-coverage",
      "architecture-testability",
      "rollback-operability",
      "security",
      "data-irreversibility",
      "money-safety",
      "contract-failure",
      "recovery-observability",
      "critical-correctness"
    ];
  }
});

// plugins/dev-flow/src/core/review-store.ts
import { createHash as createHash5, randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir2, open as open2, readFile as readFile4, readdir as readdir3, rename as rename2 } from "node:fs/promises";
import path6 from "node:path";
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}
function canonicalReviewValueJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}
`;
}
function semanticReviewBasisHash(basis) {
  const { projectConfigSha256: _projectConfigSha256, verificationCommandHashes: _verificationCommandHashes, ...semanticBasis } = basis;
  return digest2(canonicalReviewValueJson(semanticBasis));
}
function validBasisHash(basis, basisHash2) {
  return basisHash2 === digest2(canonicalReviewValueJson(basis)) || basisHash2 === semanticReviewBasisHash(basis);
}
function integrity2(message, details = {}) {
  throw new DevFlowError("REVIEW_INTEGRITY_FAILED", message, details);
}
function validateSummary(value) {
  return typeof value === "object" && value !== null && ["batches", "current", "stale", "open", "complete"].every((key) => {
    const candidate = value[key];
    return Number.isInteger(candidate) && candidate >= 0;
  });
}
function sameSummary2(left, right) {
  return left.batches === right.batches && left.current === right.current && left.stale === right.stale && left.open === right.open && left.complete === right.complete && (left.superseded ?? 0) === (right.superseded ?? 0) && (left.waived ?? 0) === (right.waived ?? 0);
}
function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validSamplingAttempt(value) {
  if (!isRecord6(value) || !validHash(value.requestSha256) || typeof value.issuedAt !== "string" || typeof value.leaseExpiresAt !== "string" || value.status !== "issued" && value.status !== "failed" && value.status !== "submitted") return false;
  if (value.status === "issued") {
    return value.completedAt === void 0 && value.payloadSha256 === void 0 && value.failureCode === void 0;
  }
  if (typeof value.completedAt !== "string") return false;
  if (value.status === "failed") {
    return value.payloadSha256 === void 0 && (value.failureCode === "client-error" || value.failureCode === "timeout" || value.failureCode === "invalid-response" || value.failureCode === "validation-failed" || value.failureCode === "quota");
  }
  return validHash(value.payloadSha256) && value.failureCode === void 0;
}
function validSamplingAttempts(value, status, submission) {
  if (value === void 0) return status !== "sampling" && !submission?.samplingProvenance;
  if (!Array.isArray(value) || !value.length || !value.every(validSamplingAttempt)) return false;
  const attempts = value;
  const issued = attempts.filter((attempt) => attempt.status === "issued");
  if (issued.length > 1 || status === "sampling" !== (issued.length === 1)) return false;
  if (status === "sampling" && submission) return false;
  if (status === "sampling") return attempts.every((attempt) => attempt.status === "failed" || attempt.status === "issued");
  if (status === "pending" || status === "claimed") return attempts.every((attempt) => attempt.status === "failed");
  if (!submission?.samplingProvenance) return attempts.every((attempt) => attempt.status === "failed");
  return attempts.every((attempt) => attempt.status === "failed" || attempt.status === "submitted") && attempts.filter((attempt) => attempt.status === "submitted").length === 1 && attempts.some((attempt) => attempt.status === "submitted" && attempt.requestSha256 === submission.samplingProvenance.requestSha256 && attempt.issuedAt === submission.samplingProvenance.issuedAt && attempt.completedAt === submission.samplingProvenance.completedAt && attempt.payloadSha256 === submission.payloadSha256);
}
function validAttestation(value) {
  return isRecord6(value) && (value.host === "claude" || value.host === "codex") && typeof value.agentId === "string" && value.agentId.trim().length > 0 && typeof value.issuedAt === "string" && !Number.isNaN(Date.parse(value.issuedAt)) && typeof value.raw === "string" && value.raw.trim().length > 0 && validHash(value.rawSha256) && typeof value.acceptedAt === "string" && digest2(value.raw) === value.rawSha256;
}
function validateBatch(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const batch = value;
  if (typeof batch.batchId !== "string" || !batch.batchId || !validHash(batch.basisHash) || batch.phase !== "plan" && batch.phase !== "code" || !batch.basis || batch.validity !== "current" && batch.validity !== "stale" || batch.progress !== "open" && batch.progress !== "complete" && batch.progress !== "superseded" && batch.progress !== "waived" || batch.executionMode !== "parallel-execution" || batch.assuranceLevel !== "multi-perspective" && batch.assuranceLevel !== "independent-sampling" && batch.assuranceLevel !== "multi-agent-verified" || !Array.isArray(batch.jobs)) return false;
  const ids = /* @__PURE__ */ new Set();
  const attestationRaws = /* @__PURE__ */ new Set();
  return batch.jobs.every((job) => {
    if (!job || typeof job !== "object" || typeof job.jobId !== "string" || !job.jobId || ids.has(job.jobId) || typeof job.role !== "string" || job.reviewDepth !== "standard" && job.reviewDepth !== "full" || !validHash(job.packageSha256) || !validHash(job.roleBasisHash) || job.status !== "pending" && job.status !== "claimed" && job.status !== "sampling" && job.status !== "submitted" && job.status !== "reused" && job.status !== "failed") return false;
    ids.add(job.jobId);
    if (job.status === "failed") {
      return !job.submission && (job.samplingAttempts === void 0 || validSamplingAttempts(job.samplingAttempts, "pending", void 0));
    }
    if (job.status === "reused") return !!job.reusedFrom && validHash(job.reusedFrom.submissionSha256) && !job.claim && !job.submission;
    if (!validSamplingAttempts(job.samplingAttempts, job.status, job.submission)) return false;
    if (job.status === "pending") return !job.claim && !job.submission;
    if (job.status === "sampling") return !job.claim && !job.submission?.attestation;
    if (job.status === "claimed") {
      return !job.submission && !!job.claim && validHash(job.claim.requestSha256) && typeof job.claim.claimedAt === "string" && typeof job.claim.leaseExpiresAt === "string";
    }
    const sampled = Boolean(job.submission?.samplingProvenance);
    const attested = Boolean(job.submission?.attestation);
    if (sampled && attested) return false;
    if (!sampled && (!job.claim || !validHash(job.claim.requestSha256) || typeof job.claim.claimedAt !== "string" || typeof job.claim.leaseExpiresAt !== "string")) return false;
    if (sampled && job.claim) return false;
    if (!job.submission || !validHash(job.submission.payloadSha256) || typeof job.submission.coverageSummary !== "string" || !Array.isArray(job.submission.findings) || typeof job.submission.submittedAt !== "string") return false;
    if (attested) {
      if (!validAttestation(job.submission.attestation)) return false;
      if (attestationRaws.has(job.submission.attestation.rawSha256)) return false;
      attestationRaws.add(job.submission.attestation.rawSha256);
    }
    return true;
  });
}
function validateLedger(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) integrity2("review snapshot has an invalid shape");
  const ledger = value;
  if (ledger.schemaVersion === 1 || ledger.schemaVersion === 2) {
    throw new DevFlowError("UNSUPPORTED_REVIEW_SCHEMA", "\u68C0\u6D4B\u5230\u65E7 review ledger schema\u3002", {
      recoveryHint: "\u7528\u4EA7\u751F\u8BE5\u72B6\u6001\u7684\u65E7\u63D2\u4EF6\u6536\u5C3E\uFF0C\u5907\u4EFD .dev-flow \u540E\u7528 6.0 \u91CD\u65B0\u521D\u59CB\u5316"
    });
  }
  if (ledger.schemaVersion !== 3 || typeof ledger.featureId !== "string" || !ledger.featureId || !Number.isInteger(ledger.revision) || (ledger.revision ?? -1) < 0 || !Number.isInteger(ledger.stateRevision) || (ledger.stateRevision ?? -1) < 0 || !Array.isArray(ledger.batches) || !ledger.batches.every(validateBatch) || !validateSummary(ledger.summary)) {
    integrity2("review snapshot has an invalid shape");
  }
  const batchIds = /* @__PURE__ */ new Set();
  const currentByPhase = /* @__PURE__ */ new Map();
  for (const batch of ledger.batches) {
    if (batch.validity === "current") {
      const phase = batch.phase ?? "plan";
      const existing = currentByPhase.get(phase);
      if (existing !== void 0 && existing !== batch.batchId) {
        integrity2("review ledger must keep at most one current batch per phase", { phase, first: existing, second: batch.batchId });
      }
      currentByPhase.set(phase, batch.batchId);
    }
    if (batchIds.has(batch.batchId) || batch.basis.featureId !== ledger.featureId || !validBasisHash(batch.basis, batch.basisHash) || batch.progress === "complete" && !batch.jobs.every((job) => job.status === "submitted" || job.status === "reused") || batch.progress === "open" && batch.jobs.every((job) => job.status === "submitted" || job.status === "reused")) {
      integrity2("review snapshot batch is inconsistent");
    }
    if (batch.assuranceLevel !== assuranceForReviewBatch(batch)) {
      integrity2("review batch assurance is not derived from persisted provenance", { batchId: batch.batchId });
    }
    if (batch.executionMode !== "parallel-execution") {
      integrity2("review batch executionMode must be parallel-execution", { batchId: batch.batchId });
    }
    batchIds.add(batch.batchId);
  }
  if (ledger.findingEvents !== void 0) {
    if (!Array.isArray(ledger.findingEvents)) integrity2("review finding event ledger is invalid");
    const origins = /* @__PURE__ */ new Set();
    for (const event of ledger.findingEvents) {
      if (!event || typeof event !== "object" || typeof event.type !== "string" || typeof event.at !== "string") integrity2("review finding event has an invalid shape");
      if (event.type === "origin") {
        if (!event.finding || typeof event.finding.findingId !== "string" || origins.has(event.finding.findingId)) integrity2("review finding origin is missing or duplicated");
        origins.add(event.finding.findingId);
      } else if (typeof event.findingId !== "string" || !origins.has(event.findingId)) {
        integrity2("review finding event references an unknown origin", { findingId: event.findingId });
      }
    }
  }
  const attestationRaws = /* @__PURE__ */ new Set();
  for (const batch of ledger.batches) {
    for (const job of batch.jobs) {
      const rawSha256 = job.submission?.attestation?.rawSha256;
      if (!rawSha256) continue;
      if (attestationRaws.has(rawSha256)) {
        integrity2("host attestation raw hash is reused across the review ledger", {
          batchId: batch.batchId,
          jobId: job.jobId
        });
      }
      attestationRaws.add(rawSha256);
    }
  }
  if (!sameSummary2(ledger.summary, reviewSummary(ledger.batches))) integrity2("review snapshot summary is inconsistent");
}
function reviewSummary(batches) {
  return {
    batches: batches.length,
    current: batches.filter((batch) => batch.validity === "current").length,
    stale: batches.filter((batch) => batch.validity === "stale").length,
    open: batches.filter((batch) => batch.progress === "open" && batch.validity === "current").length,
    complete: batches.filter((batch) => batch.progress === "complete").length,
    superseded: batches.filter((batch) => batch.progress === "superseded").length,
    waived: batches.filter((batch) => batch.progress === "waived").length
  };
}
function safeSnapshotPath2(pointer) {
  if (!/^review\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path) || pointer.path !== `review/snapshots/${pointer.sha256}.json`) integrity2("review pointer path is invalid");
  return pointer.path;
}
async function readReviewLedger(root, state) {
  if (!state.review) integrity2("review pointer is missing", { featureId: state.featureId });
  const pointer = state.review;
  const relative = safeSnapshotPath2(pointer);
  let contents;
  try {
    contents = await readFile4(path6.join(root, ".dev-flow", "features", state.featureId, relative), "utf8");
  } catch {
    integrity2("review snapshot cannot be read", { featureId: state.featureId, path: relative });
  }
  if (digest2(contents) !== pointer.sha256) integrity2("review snapshot digest does not match pointer", { featureId: state.featureId });
  let ledger;
  try {
    ledger = JSON.parse(contents);
  } catch {
    integrity2("review snapshot is not valid JSON", { featureId: state.featureId });
  }
  validateLedger(ledger);
  if (ledger.featureId !== state.featureId || ledger.revision !== pointer.revision || ledger.stateRevision > state.revision || !sameSummary2(ledger.summary, pointer.summary)) {
    integrity2("review pointer and ledger revisions do not match", { featureId: state.featureId });
  }
  return ledger;
}
var digest2;
var init_review_store = __esm({
  "plugins/dev-flow/src/core/review-store.ts"() {
    "use strict";
    init_review();
    init_errors();
    digest2 = (contents) => createHash5("sha256").update(contents).digest("hex");
  }
});

// plugins/dev-flow/src/policy/event-segment.ts
function isRecord7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseFeatureEventSegment(value) {
  if (!isRecord7(value) || value.schemaVersion !== 1 || typeof value.featureId !== "string" || !value.featureId || !Number.isInteger(value.firstSequence) || value.firstSequence < 0 || !Number.isInteger(value.lastSequence) || value.lastSequence < value.firstSequence || value.previousSegmentSha256 !== void 0 && typeof value.previousSegmentSha256 !== "string" || !Number.isInteger(value.recordCount) || value.recordCount < 0 || value.codec !== "jsonl" || !Array.isArray(value.records)) {
    throw new TypeError("invalid feature event segment");
  }
  const records = value.records.map((record) => {
    if (!isRecord7(record) || !Number.isInteger(record.eventSequence) || !Number.isInteger(record.revision) || typeof record.type !== "string" || !record.type || typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) {
      throw new TypeError("invalid feature event segment record");
    }
    return {
      eventSequence: Number(record.eventSequence),
      revision: Number(record.revision),
      type: String(record.type),
      at: String(record.at),
      data: record.data
    };
  });
  return {
    schemaVersion: 1,
    featureId: String(value.featureId),
    firstSequence: Number(value.firstSequence),
    lastSequence: Number(value.lastSequence),
    ...value.previousSegmentSha256 !== void 0 ? { previousSegmentSha256: String(value.previousSegmentSha256) } : {},
    recordCount: Number(value.recordCount),
    codec: "jsonl",
    records
  };
}
function parseFeatureEventSegmentIndex(value) {
  if (!isRecord7(value) || value.schemaVersion !== 1 || typeof value.featureId !== "string" || !value.featureId || !Array.isArray(value.entries)) {
    throw new TypeError("invalid feature event segment index");
  }
  return {
    schemaVersion: 1,
    featureId: String(value.featureId),
    entries: value.entries.map((entry) => {
      if (!isRecord7(entry) || !Number.isInteger(entry.firstSequence) || !Number.isInteger(entry.lastSequence) || entry.previousSegmentSha256 !== void 0 && typeof entry.previousSegmentSha256 !== "string") {
        throw new TypeError("invalid feature event segment index entry");
      }
      return {
        ref: parseEvidenceObjectRef(entry.ref),
        firstSequence: Number(entry.firstSequence),
        lastSequence: Number(entry.lastSequence),
        ...entry.previousSegmentSha256 !== void 0 ? { previousSegmentSha256: String(entry.previousSegmentSha256) } : {}
      };
    })
  };
}
var init_event_segment = __esm({
  "plugins/dev-flow/src/policy/event-segment.ts"() {
    "use strict";
    init_evidence_store();
  }
});

// plugins/dev-flow/src/core/evidence-pack.ts
import { createHash as createHash6, randomUUID as randomUUID3 } from "node:crypto";
import { mkdir as mkdir3, open as open3, readFile as readFile5, rename as rename3 } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import path7 from "node:path";
function sha256(bytes) {
  return createHash6("sha256").update(bytes).digest("hex");
}
async function fsyncDirectory(directory) {
  const handle = await open3(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeFileAtomic(target, bytes) {
  await mkdir3(path7.dirname(target), { recursive: true });
  const temporary = path7.join(path7.dirname(target), `.${path7.basename(target)}.${randomUUID3()}.tmp`);
  const handle = await open3(temporary, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename3(temporary, target);
  await fsyncDirectory(path7.dirname(target));
}
function encodeEvidencePack(inputs) {
  if (inputs.length === 0) throw new TypeError("evidence pack requires at least one object");
  const chunks = [];
  const entries = [];
  let offset = 0;
  for (const input of inputs) {
    if (input.bytes.length === 0) throw new TypeError("evidence pack rejects empty objects");
    const framed = Buffer.concat([Buffer.from(`${input.kind}\0`, "utf8"), input.bytes]);
    const compressed = gzipSync(framed);
    chunks.push(Buffer.alloc(4));
    chunks[chunks.length - 1].writeUInt32BE(compressed.length, 0);
    chunks.push(compressed);
    entries.push({
      sha256: sha256(input.bytes),
      kind: input.kind,
      size: input.bytes.length,
      offset: offset + 4,
      compressedLength: compressed.length
    });
    offset += 4 + compressed.length;
  }
  return { pack: Buffer.concat(chunks), entries };
}
function decodeEvidencePackEntry(pack, entry) {
  if (entry.offset < 0 || entry.compressedLength <= 0 || entry.offset + entry.compressedLength > pack.length) {
    throw new TypeError("evidence pack index entry is outside pack bounds");
  }
  if (entry.offset < 4) throw new TypeError("evidence pack index entry overlaps the length prefix");
  const compressed = pack.subarray(entry.offset, entry.offset + entry.compressedLength);
  let framed;
  try {
    framed = gunzipSync(compressed);
  } catch {
    throw new TypeError("evidence pack entry cannot be decompressed");
  }
  const separator = framed.indexOf(0);
  if (separator <= 0 || framed.subarray(0, separator).toString("utf8") !== entry.kind) {
    throw new TypeError("evidence pack entry kind does not match its index");
  }
  const bytes = framed.subarray(separator + 1);
  if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) {
    throw new TypeError("evidence pack entry does not match its content address");
  }
  return bytes;
}
function canonicalPackIndexJson(index) {
  return `${JSON.stringify({
    schemaVersion: 1,
    packSha256: index.packSha256,
    objects: index.objects.map((entry) => ({ ...entry })).sort((left, right) => left.offset - right.offset || left.kind.localeCompare(right.kind) || left.sha256.localeCompare(right.sha256))
  }, null, 2)}
`;
}
function readPackIndexJson(contents, expectedPackSha256) {
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new TypeError("evidence pack index is not valid JSON");
  }
  const index = value;
  if (!index || typeof index !== "object" || index.schemaVersion !== 1 || index.packSha256 !== expectedPackSha256 || !Array.isArray(index.objects) || index.objects.length === 0) {
    throw new TypeError("evidence pack index has an invalid shape");
  }
  const entries = index.objects.map((entry) => {
    if (!entry || typeof entry !== "object") throw new TypeError("evidence pack index entry is invalid");
    return entry;
  });
  const sorted = [...entries].sort((left, right) => left.offset - right.offset);
  for (const [position, entry] of sorted.entries()) {
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.kind !== "string" || !Number.isInteger(entry.size) || entry.size <= 0 || !Number.isInteger(entry.offset) || entry.offset < 4 || !Number.isInteger(entry.compressedLength) || entry.compressedLength <= 0) {
      throw new TypeError("evidence pack index entry is invalid");
    }
    const previous = sorted[position - 1];
    if (previous && entry.offset < previous.offset + previous.compressedLength + 4) {
      throw new TypeError("evidence pack index entries overlap");
    }
  }
  return {
    schemaVersion: 1,
    packSha256: index.packSha256,
    objects: entries
  };
}
async function writeEvidencePack(directory, inputs, options = {}) {
  const { pack, entries } = encodeEvidencePack(inputs);
  const packSha256 = sha256(pack);
  const index = { schemaVersion: 1, packSha256, objects: entries };
  const indexJson = canonicalPackIndexJson(index);
  const indexSha256 = sha256(Buffer.from(indexJson));
  const packPath = path7.join(directory, `${packSha256}.pack`);
  const indexPath = path7.join(directory, `${packSha256}.index.json`);
  await mkdir3(directory, { recursive: true });
  try {
    const existingPack = await readFile5(packPath);
    if (!existingPack.equals(pack)) throw new TypeError("evidence pack path is occupied by different bytes");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await options.fault?.("before-pack-write");
    const packTemporary = path7.join(directory, `.${packSha256}.${randomUUID3()}.tmp`);
    const handle = await open3(packTemporary, "wx");
    try {
      await handle.writeFile(pack);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await options.fault?.("after-pack-fsync");
    try {
      await rename3(packTemporary, packPath);
    } catch (renameError) {
      if (renameError.code !== "EEXIST") throw renameError;
      const existingPack = await readFile5(packPath);
      if (!existingPack.equals(pack)) throw new TypeError("evidence pack path is occupied by different bytes");
    }
    await options.fault?.("before-pack-rename");
    await fsyncDirectory(directory);
  }
  try {
    const existingIndex = await readFile5(indexPath, "utf8");
    if (existingIndex !== indexJson) throw new TypeError("evidence pack index path is occupied by different bytes");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await options.fault?.("before-index-write");
    await writeFileAtomic(indexPath, Buffer.from(indexJson));
    await options.fault?.("after-index-fsync");
    await options.fault?.("before-index-rename");
  }
  return { packSha256, indexSha256, packBytes: pack.length, entries };
}
async function readEvidencePackEntry(directory, packSha256, entry) {
  const pack = await readFile5(path7.join(directory, `${packSha256}.pack`));
  if (sha256(pack) !== packSha256) throw new TypeError("evidence pack digest does not match its name");
  return decodeEvidencePackEntry(pack, entry);
}
var init_evidence_pack = __esm({
  "plugins/dev-flow/src/core/evidence-pack.ts"() {
    "use strict";
  }
});

// plugins/dev-flow/src/core/evidence-store.ts
import { createHash as createHash7, randomUUID as randomUUID4 } from "node:crypto";
import { copyFile, mkdir as mkdir4, open as open4, readFile as readFile6, readdir as readdir4, rename as rename4, stat, unlink } from "node:fs/promises";
import path8 from "node:path";
function evidenceDirectory(root, featureId) {
  return path8.join(root, ".dev-flow", "features", featureId, "evidence");
}
function hotDirectory(root, featureId) {
  return path8.join(evidenceDirectory(root, featureId), "packs", "hot");
}
function coldDirectory(root, featureId) {
  return path8.join(evidenceDirectory(root, featureId), "packs", "cold");
}
function catalogPath(root, featureId) {
  return path8.join(evidenceDirectory(root, featureId), "catalog.json");
}
function packDirectory(root, featureId, descriptor) {
  return descriptor.location === "cold" ? coldDirectory(root, featureId) : hotDirectory(root, featureId);
}
function emptyCatalog(featureId) {
  return { schemaVersion: 1, featureId, revision: 0, objects: [], packs: [] };
}
function digest3(contents) {
  return createHash7("sha256").update(contents).digest("hex");
}
function canonicalCatalogJson(catalog) {
  return `${stableJson(catalog)}
`;
}
function integrity3(message, details = {}) {
  throw new DevFlowError("EVIDENCE_STORE_INTEGRITY_FAILED", message, {
    recoveryKind: "repair",
    recoveryInstruction: "\u8FD0\u884C doctor \u68C0\u67E5 evidence store\uFF1B\u4E0D\u8981\u624B\u52A8\u4FEE\u6539 .dev-flow \u63A7\u5236\u6587\u4EF6\u3002",
    ...details
  });
}
async function fsyncDirectory2(directory) {
  const handle = await open4(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeFileAtomic2(target, contents) {
  await mkdir4(path8.dirname(target), { recursive: true });
  const temporary = path8.join(path8.dirname(target), `.${path8.basename(target)}.${randomUUID4()}.tmp`);
  const handle = await open4(temporary, "wx");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename4(temporary, target);
  await fsyncDirectory2(path8.dirname(target));
}
async function readEvidenceStoreCatalog(root, featureId) {
  let contents;
  try {
    contents = await readFile6(catalogPath(root, featureId), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return emptyCatalog(featureId);
    throw error;
  }
  let catalog;
  try {
    catalog = parseEvidenceStoreCatalog(JSON.parse(contents));
  } catch (error) {
    integrity3("evidence catalog is invalid", { featureId, cause: error instanceof Error ? error.message : String(error) });
  }
  if (catalog.featureId !== featureId) integrity3("evidence catalog featureId mismatch", { featureId, catalogFeatureId: catalog.featureId });
  return catalog;
}
async function writeEvidenceStoreCatalog(root, featureId, catalog, options = {}) {
  const contents = canonicalCatalogJson(catalog);
  const sha2564 = digest3(contents);
  await mkdir4(evidenceDirectory(root, featureId), { recursive: true });
  await options.fault?.("before-catalog-write");
  await writeFileAtomic2(catalogPath(root, featureId), contents);
  await options.fault?.("after-catalog-write");
  return { catalog, sha256: sha2564 };
}
function evidenceStorePointer(catalog, catalogSha256) {
  return {
    catalogSha256,
    objectCount: catalog.objects.length,
    packCount: catalog.packs.length
  };
}
function objectKey(ref) {
  return `${ref.kind}\0${ref.sha256}`;
}
async function putEvidenceObjects(root, featureId, inputs, options = {}) {
  if (inputs.length === 0) throw new TypeError("at least one evidence object is required");
  const normalized = [];
  const seen = /* @__PURE__ */ new Set();
  for (const input of inputs) {
    if (!Buffer.isBuffer(input.bytes)) throw new TypeError("evidence object bytes must be a Buffer");
    const sha2564 = digest3(input.bytes);
    const key = objectKey({ kind: input.kind, sha256: sha2564 });
    if (seen.has(key)) throw new TypeError("duplicate evidence object in one pack");
    seen.add(key);
    normalized.push({ kind: input.kind, bytes: Buffer.from(input.bytes) });
  }
  const current = await readEvidenceStoreCatalog(root, featureId);
  const existingByKey = new Map(current.objects.map((entry) => [objectKey(entry), entry]));
  const missing = normalized.filter((input) => !existingByKey.has(objectKey({ kind: input.kind, sha256: digest3(input.bytes) })));
  const refs = normalized.map((input) => {
    const sha2564 = digest3(input.bytes);
    return { kind: input.kind, sha256: sha2564, size: input.bytes.length };
  });
  if (missing.length === 0) {
    const sha2564 = digest3(canonicalCatalogJson(current));
    return { refs, pointer: evidenceStorePointer(current, sha2564), catalog: current };
  }
  const pack = await writeEvidencePack(hotDirectory(root, featureId), missing, options);
  const descriptor = {
    packSha256: pack.packSha256,
    indexSha256: pack.indexSha256,
    location: "hot",
    objectCount: pack.entries.length,
    totalRawSize: pack.entries.reduce((total, entry) => total + entry.size, 0)
  };
  const entries = pack.entries.map((entry) => ({
    ...entry,
    packSha256: pack.packSha256
  }));
  const next = {
    ...current,
    revision: current.revision + 1,
    packs: [
      ...current.packs.filter((candidate) => candidate.packSha256 !== descriptor.packSha256),
      descriptor
    ],
    objects: [
      ...current.objects.filter((entry) => entry.packSha256 !== descriptor.packSha256),
      ...entries
    ]
  };
  next.objects.sort((left, right) => left.kind.localeCompare(right.kind) || left.sha256.localeCompare(right.sha256));
  next.packs.sort((left, right) => left.packSha256.localeCompare(right.packSha256));
  const written = await writeEvidenceStoreCatalog(root, featureId, next, options);
  return { refs, pointer: evidenceStorePointer(written.catalog, written.sha256), catalog: written.catalog };
}
async function putEvidenceObject(root, featureId, kind, canonicalBytes, options = {}) {
  const bytes = Buffer.isBuffer(canonicalBytes) ? canonicalBytes : Buffer.from(canonicalBytes, "utf8");
  const result = await putEvidenceObjects(root, featureId, [{ kind, bytes }], options);
  return { ref: result.refs[0], ...result };
}
async function readEvidenceObject(root, featureId, ref) {
  parseEvidenceObjectRef(ref);
  const catalog = await readEvidenceStoreCatalog(root, featureId);
  const entry = catalog.objects.find((candidate) => objectKey(candidate) === objectKey(ref));
  if (!entry) integrity3("evidence object is missing from catalog", { featureId, ...ref });
  if (entry.size !== ref.size) integrity3("evidence object size does not match its ref", { featureId, expected: ref.size, actual: entry.size });
  const descriptor = catalog.packs.find((candidate) => candidate.packSha256 === entry.packSha256);
  if (!descriptor) integrity3("evidence object pack descriptor is missing", { featureId, packSha256: entry.packSha256 });
  const directory = packDirectory(root, featureId, descriptor);
  let indexJson;
  try {
    indexJson = await readFile6(path8.join(directory, `${descriptor.packSha256}.index.json`), "utf8");
  } catch {
    integrity3("evidence pack index cannot be read", { featureId, packSha256: descriptor.packSha256, location: descriptor.location });
  }
  const index = readPackIndexJson(indexJson, descriptor.packSha256);
  if (digest3(indexJson) !== descriptor.indexSha256) integrity3("evidence pack index digest does not match catalog", { featureId, packSha256: descriptor.packSha256 });
  const indexed = index.objects.find((candidate) => candidate.kind === entry.kind && candidate.sha256 === entry.sha256);
  if (!indexed || indexed.size !== entry.size || indexed.offset !== entry.offset || indexed.compressedLength !== entry.compressedLength) {
    integrity3("evidence catalog entry does not match pack index", { featureId, ...ref });
  }
  try {
    return await readEvidencePackEntry(directory, descriptor.packSha256, entry);
  } catch (error) {
    integrity3("evidence object cannot be read or verified", { featureId, cause: error instanceof Error ? error.message : String(error), ...ref });
  }
}
function packFileSha(packFile) {
  const match = /^([a-f0-9]{64})\.(?:pack|index\.json)$/.exec(packFile);
  return match?.[1];
}
async function deleteFileIfExists(file) {
  try {
    await unlink(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function collectEvidenceOrphans(root, featureId, rootSet, options = {}) {
  const current = await readEvidenceStoreCatalog(root, featureId);
  const known = new Map(current.objects.map((entry) => [objectKey(entry), entry]));
  for (const ref of rootSet) {
    const parsed = parseEvidenceObjectRef(ref);
    if (!known.has(objectKey(parsed))) integrity3("GC root set references an object missing from catalog", { featureId, ...parsed });
  }
  const rootPackShas = new Set(rootSet.map((ref) => known.get(objectKey(ref)).packSha256));
  const orphanPacks = current.packs.filter((pack) => !rootPackShas.has(pack.packSha256)).sort((left, right) => left.packSha256.localeCompare(right.packSha256));
  const packBudget = options.packBudget ?? DEFAULT_GC_PACK_BUDGET;
  const byteBudget = options.byteBudget ?? DEFAULT_GC_BYTE_BUDGET;
  const selected = [];
  let selectedBytes = 0;
  for (const pack of orphanPacks) {
    if (selected.length >= packBudget || selectedBytes >= byteBudget) break;
    selected.push(pack);
    selectedBytes += pack.totalRawSize;
  }
  const selectedShas = new Set(selected.map((pack) => pack.packSha256));
  let next = current;
  if (selected.length > 0) {
    next = {
      ...current,
      revision: current.revision + 1,
      objects: current.objects.filter((entry) => !selectedShas.has(entry.packSha256)),
      packs: current.packs.filter((pack) => !selectedShas.has(pack.packSha256))
    };
    await writeEvidenceStoreCatalog(root, featureId, next, options);
  }
  let deletedFiles = 0;
  let deletedBytes = 0;
  for (const pack of selected) {
    const directory = packDirectory(root, featureId, pack);
    for (const suffix of [`${pack.packSha256}.pack`, `${pack.packSha256}.index.json`]) {
      const file = path8.join(directory, suffix);
      const before = await stat(file).then((value) => value.size, () => 0);
      if (await deleteFileIfExists(file)) {
        deletedFiles += 1;
        deletedBytes += before;
      }
    }
  }
  const descriptors = new Set(next.packs.map((pack) => pack.packSha256));
  for (const directory of [hotDirectory(root, featureId), coldDirectory(root, featureId)]) {
    let files;
    try {
      files = await readdir4(directory);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const file of files) {
      const sha = packFileSha(file);
      if (!sha || descriptors.has(sha)) continue;
      const absolute = path8.join(directory, file);
      const before = await stat(absolute).then((value) => value.size, () => 0);
      if (await deleteFileIfExists(absolute)) {
        deletedFiles += 1;
        deletedBytes += before;
      }
    }
  }
  return { deletedPacks: selected.length, deletedFiles, deletedBytes, catalog: next };
}
var DEFAULT_GC_PACK_BUDGET, DEFAULT_GC_BYTE_BUDGET;
var init_evidence_store2 = __esm({
  "plugins/dev-flow/src/core/evidence-store.ts"() {
    "use strict";
    init_stable_json();
    init_evidence_store();
    init_errors();
    init_evidence_pack();
    DEFAULT_GC_PACK_BUDGET = 8;
    DEFAULT_GC_BYTE_BUDGET = 32 * 1024 * 1024;
  }
});

// plugins/dev-flow/src/core/event-segments.ts
import { mkdir as mkdir5, open as open5, readFile as readFile7, rename as rename5, writeFile } from "node:fs/promises";
import path9 from "node:path";
async function readIndex(root, featureId) {
  try {
    const raw = await readFile7(segmentIndexPath(root, featureId), "utf8");
    return parseFeatureEventSegmentIndex(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: 1, featureId, entries: [] };
    throw error;
  }
}
async function readHotRecords(root, featureId, options = {}) {
  let raw;
  try {
    raw = await readFile7(hotPath(root, featureId), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const startSequence = options.startSequence ?? 0;
  return raw.split("\n").filter(Boolean).map((line, index) => {
    const record = JSON.parse(line);
    if (typeof record.type !== "string" || typeof record.at !== "string") throw new TypeError("invalid hot event record");
    return {
      eventSequence: Number.isInteger(record.eventSequence) ? Number(record.eventSequence) : startSequence + index + 1,
      revision: Number.isInteger(record.revision) ? Number(record.revision) : 0,
      type: record.type,
      at: record.at,
      data: record.data
    };
  });
}
async function nextFeatureEventSequence(root, featureId) {
  const index = await readIndex(root, featureId);
  const previous = index.entries.at(-1)?.lastSequence ?? 0;
  const hot = await readHotRecords(root, featureId, { startSequence: previous });
  return (hot.at(-1)?.eventSequence ?? previous) + 1;
}
async function readSegmentedFeatureEvents(root, featureId, options = {}) {
  const index = await readIndex(root, featureId);
  const records = [];
  for (const entry of index.entries) {
    if (entry.lastSequence <= (options.afterSequence ?? 0)) continue;
    const bytes = await readEvidenceObject(root, featureId, entry.ref);
    const segment = parseFeatureEventSegment(JSON.parse(bytes.toString("utf8")));
    records.push(...segment.records);
  }
  const base = records.at(-1)?.eventSequence ?? (options.afterSequence ?? 0);
  const hot = await readHotRecords(root, featureId, { startSequence: base });
  records.push(...hot);
  const filtered = records.filter((record) => record.eventSequence > (options.afterSequence ?? 0));
  filtered.sort((left, right) => left.eventSequence - right.eventSequence);
  return { records: filtered, sealedSegments: index.entries.length };
}
async function eventSegmentRootRefs(root, featureId) {
  const index = await readIndex(root, featureId);
  return index.entries.map((entry) => entry.ref);
}
var featureDirectory, hotPath, segmentIndexPath;
var init_event_segments = __esm({
  "plugins/dev-flow/src/core/event-segments.ts"() {
    "use strict";
    init_stable_json();
    init_event_segment();
    init_evidence_store2();
    featureDirectory = (root, id) => path9.join(root, ".dev-flow", "features", id);
    hotPath = (root, id) => path9.join(featureDirectory(root, id), "events.jsonl");
    segmentIndexPath = (root, id) => path9.join(featureDirectory(root, id), "events", "segment-index.json");
  }
});

// plugins/dev-flow/src/policy/state-archive.ts
function isRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseFeatureStateArchivePointers(value) {
  if (!isRecord8(value) || value.schemaVersion !== 1 || typeof value.featureId !== "string" || !value.featureId) {
    throw new TypeError("invalid FeatureState archive pointers");
  }
  const parsed = {
    schemaVersion: 1,
    featureId: value.featureId,
    pointer: parseEvidenceStorePointer(value.pointer)
  };
  for (const key of ["workspaceLineage", "interactionLedger", "governanceLedger", "verificationLedger", "repairLedger"]) {
    if (value[key] === void 0) continue;
    parsed[key] = parseEvidenceObjectRef(value[key]);
  }
  return parsed;
}
function parseStringRecord(value, label) {
  if (!isRecord8(value) || Object.values(value).some((item) => typeof item !== "string")) {
    throw new TypeError(`${label} must be a string map`);
  }
  return value;
}
function parseWorkspaceLineage(value) {
  if (!isRecord8(value) || typeof value.baseHead !== "string" || typeof value.baseBranch !== "string" || typeof value.observedHead !== "string" || typeof value.lastWorkspaceFingerprint !== "string" || value.reconciliationStatus !== "current" && value.reconciliationStatus !== "required" && value.reconciliationStatus !== "blocked" || !isRecord8(value.startedDirty) || !isRecord8(value.ownership) || !isRecord8(value.ownershipSource) || !isRecord8(value.observedPathFingerprints) || !Array.isArray(value.observedCommits) || value.unownedPaths !== void 0 && (!Array.isArray(value.unownedPaths) || value.unownedPaths.some((item) => typeof item !== "string"))) {
    throw new TypeError("invalid workspace lineage archive");
  }
  return {
    baseHead: value.baseHead,
    baseBranch: value.baseBranch,
    observedHead: value.observedHead,
    startedDirty: value.startedDirty,
    ownership: parseStringRecord(value.ownership, "workspace.ownership"),
    ownershipSource: parseStringRecord(value.ownershipSource, "workspace.ownershipSource"),
    observedCommits: value.observedCommits,
    observedPathFingerprints: parseStringRecord(value.observedPathFingerprints, "workspace.observedPathFingerprints"),
    lastWorkspaceFingerprint: value.lastWorkspaceFingerprint,
    reconciliationStatus: value.reconciliationStatus,
    ...value.unownedPaths ? { unownedPaths: value.unownedPaths } : {}
  };
}
function parseGovernanceLedger(value) {
  if (!isRecord8(value) || !Array.isArray(value.decisions) || !Array.isArray(value.claims) || !Array.isArray(value.authorizations) || !Array.isArray(value.credentials) || !Array.isArray(value.repositoryFacts)) {
    throw new TypeError("invalid governance ledger archive");
  }
  return {
    decisions: value.decisions,
    claims: value.claims,
    authorizations: value.authorizations,
    credentials: value.credentials,
    repositoryFacts: value.repositoryFacts
  };
}
function parseInteractionLedger(value) {
  if (!isRecord8(value)) throw new TypeError("invalid interaction ledger archive");
  const parsed = {};
  for (const [id, item] of Object.entries(value)) {
    if (!isRecord8(item) || typeof item.id !== "string" || typeof item.status !== "string") {
      throw new TypeError("invalid interaction ledger entry");
    }
    parsed[id] = item;
  }
  return parsed;
}
function parseAttemptLog(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`invalid ${label} archive`);
  return value;
}
var init_state_archive = __esm({
  "plugins/dev-flow/src/policy/state-archive.ts"() {
    "use strict";
    init_evidence_store();
  }
});

// plugins/dev-flow/src/core/state-archive.ts
function hasEntries(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}
async function archiveLargeStateCollections(root, state) {
  let pointer = { catalogSha256: "0".repeat(64), objectCount: 0, packCount: 0 };
  const result = { schemaVersion: 1, featureId: state.featureId, pointer };
  const put = async (kind, value) => {
    const stored = await putEvidenceObject(
      root,
      state.featureId,
      kind,
      Buffer.from(`${stableJson(value)}
`, "utf8")
    );
    pointer = stored.pointer;
    return stored.ref;
  };
  if (hasEntries(state.workspace)) result.workspaceLineage = await put("workspace-lineage", state.workspace);
  const resolvedInteractions = Object.fromEntries(
    Object.entries(state.interactions ?? {}).filter(([, interaction]) => interaction.status === "resolved")
  );
  if (hasEntries(resolvedInteractions)) result.interactionLedger = await put("interaction-ledger", resolvedInteractions);
  if (hasEntries(state.governance)) result.governanceLedger = await put("governance-ledger", state.governance);
  if (hasEntries(state.verification.attempts)) result.verificationLedger = await put("verification-log", state.verification.attempts);
  const repairAttempts = state.repair?.attempts;
  if (hasEntries(repairAttempts)) result.repairLedger = await put("repair-log", repairAttempts);
  result.pointer = pointer;
  return result;
}
async function readArchivedJson(root, featureId, ref) {
  if (ref === void 0) return void 0;
  return JSON.parse((await readEvidenceObject(root, featureId, ref)).toString("utf8"));
}
async function hydrateFeatureState(root, raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("persisted state is invalid");
  }
  const persisted = raw;
  if (typeof persisted.featureId !== "string") throw new TypeError("persisted state featureId is invalid");
  const featureId = persisted.featureId;
  if (persisted.archivedCollections === void 0) {
    throw new TypeError("v6 persisted state is missing archivedCollections");
  }
  const pointers = parseFeatureStateArchivePointers(persisted.archivedCollections);
  if (pointers.featureId !== featureId) throw new TypeError("persisted archive featureId does not match state");
  const state = { ...persisted, schemaVersion: 6, archivedCollections: pointers };
  if (pointers.workspaceLineage) {
    state.workspace = parseWorkspaceLineage(await readArchivedJson(root, featureId, pointers.workspaceLineage));
  }
  if (pointers.governanceLedger) {
    state.governance = parseGovernanceLedger(await readArchivedJson(root, featureId, pointers.governanceLedger));
  }
  if (pointers.interactionLedger) {
    const resolvedInteractions = parseInteractionLedger(await readArchivedJson(root, featureId, pointers.interactionLedger));
    state.interactions = { ...state.interactions ?? {}, ...resolvedInteractions };
  }
  const verificationLedger = pointers.verificationLedger ? parseAttemptLog(await readArchivedJson(root, featureId, pointers.verificationLedger), "verification") : void 0;
  state.verification = {
    ...state.verification ?? { attempts: [] },
    attempts: verificationLedger ? verificationLedger : state.verification?.attempts ?? []
  };
  if (pointers.repairLedger) {
    const repairLedger = parseAttemptLog(await readArchivedJson(root, featureId, pointers.repairLedger), "repair");
    state.repair = { ...state.repair ?? { status: "completed", maxAttempts: 3 }, attempts: repairLedger };
  }
  return state;
}
async function persistableFeatureState(root, state) {
  const pointers = await archiveLargeStateCollections(root, state);
  const persisted = { ...state, schemaVersion: 6, archivedCollections: pointers };
  persisted.interactions = Object.fromEntries(Object.entries(state.interactions ?? {}).filter(([, interaction]) => interaction.status === "pending"));
  persisted.verification = { ...state.verification };
  delete persisted.verification.attempts;
  if (state.repair) {
    persisted.repair = { ...state.repair };
    delete persisted.repair.attempts;
  }
  delete persisted.workspace;
  delete persisted.governance;
  return persisted;
}
var init_state_archive2 = __esm({
  "plugins/dev-flow/src/core/state-archive.ts"() {
    "use strict";
    init_stable_json();
    init_state_archive();
    init_evidence_store2();
  }
});

// plugins/dev-flow/src/core/checkpoint-store.ts
import { readFile as readFile8, readdir as readdir5 } from "node:fs/promises";
import path10 from "node:path";
async function readCheckpointManifest(root, featureId, checkpointId) {
  const file = path10.join(root, ".dev-flow", "features", featureId, "checkpoints", "manifests", `${checkpointId}.json`);
  let raw;
  try {
    raw = await readFile8(file, "utf8");
  } catch {
    throw new DevFlowError("CHECKPOINT_NOT_FOUND", "checkpoint manifest does not exist", { checkpointId });
  }
  try {
    const manifest = parseCheckpointManifest(JSON.parse(raw));
    if (manifest.checkpointId !== checkpointId) {
      throw new DevFlowError("CHECKPOINT_INTEGRITY_FAILED", "checkpoint manifest id does not match its path", { checkpointId });
    }
    return manifest;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if (error instanceof RollbackProtocolError && error.code === "UNSUPPORTED_CHECKPOINT_SCHEMA") {
      throw new DevFlowError("UNSUPPORTED_CHECKPOINT_SCHEMA", "\u68C0\u6D4B\u5230 Dev Flow 4.x checkpoint manifest schema v1\u3002", {
        checkpointId,
        recoveryHint: "\u56DE\u5230 4.x \u5B8C\u6210\u6216\u653E\u5F03\u8BE5 feature\uFF0C\u5907\u4EFD .dev-flow \u540E\u7528 5.0 \u91CD\u65B0\u521D\u59CB\u5316"
      });
    }
    throw new DevFlowError("CHECKPOINT_INTEGRITY_FAILED", "checkpoint manifest is unreadable", { checkpointId });
  }
}
async function checkpointManifestRootRefs(root, featureId) {
  const directory = path10.join(root, ".dev-flow", "features", featureId, "checkpoints", "manifests");
  let files;
  try {
    files = (await readdir5(directory)).filter((file) => file.endsWith(".json"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const refs = [];
  for (const file of files) {
    const checkpointId = file.slice(0, -".json".length);
    const manifest = await readCheckpointManifest(root, featureId, checkpointId);
    for (const ref of Object.values(manifest.blobRefs ?? {})) {
      if (refs.some((candidate) => candidate.kind === ref.kind && candidate.sha256 === ref.sha256)) continue;
      refs.push(ref);
    }
  }
  return refs;
}
var init_checkpoint_store = __esm({
  "plugins/dev-flow/src/core/checkpoint-store.ts"() {
    "use strict";
    init_rollback();
    init_errors();
  }
});

// plugins/dev-flow/src/policy/review-execution.ts
function isRecord9(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSha2563(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function validRole(value) {
  const roles = [
    "code-quality",
    "requirement-fidelity",
    "requirements-coverage",
    "architecture-testability",
    "rollback-operability",
    "security",
    "data-irreversibility",
    "money-safety",
    "contract-failure",
    "recovery-observability",
    "critical-correctness"
  ];
  if (typeof value !== "string" || !roles.includes(value)) throw new TypeError("invalid review role");
  return value;
}
function validDate(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new TypeError("invalid review execution date");
  return value;
}
function parseReviewResultEnvelope(value) {
  if (!isRecord9(value) || value.schemaVersion !== 1 || typeof value.featureId !== "string" || !value.featureId || typeof value.batchId !== "string" || typeof value.jobId !== "string" || !isSha2563(value.packageSha256) || !isSha2563(value.capabilityHash) || typeof value.executionRequestId !== "string" || !value.executionRequestId || !Number.isInteger(value.leaseGeneration) || value.leaseGeneration < 0 || value.source !== "claude-subagent" && value.source !== "server-sampling" || value.host !== "claude" && value.host !== "codex" || value.declarationId !== void 0 && (typeof value.declarationId !== "string" || !value.declarationId) || value.hostEventId !== void 0 && typeof value.hostEventId !== "string" || value.parentContext !== void 0 && typeof value.parentContext !== "string" || value.childContext !== void 0 && typeof value.childContext !== "string" || value.agentId !== void 0 && typeof value.agentId !== "string" || !isSha2563(value.rawResultSha256) || value.parsedCompletionSha256 !== void 0 && !isSha2563(value.parsedCompletionSha256)) {
    throw new TypeError("invalid review result envelope");
  }
  const v = value;
  return {
    schemaVersion: 1,
    featureId: String(v.featureId),
    batchId: String(v.batchId),
    jobId: String(v.jobId),
    role: validRole(v.role),
    packageSha256: String(v.packageSha256),
    capabilityHash: String(v.capabilityHash),
    executionRequestId: String(v.executionRequestId),
    leaseGeneration: Number(v.leaseGeneration),
    ...v.declarationId !== void 0 ? { declarationId: String(v.declarationId) } : {},
    source: v.source,
    host: v.host,
    ...v.hostEventId !== void 0 ? { hostEventId: String(v.hostEventId) } : {},
    ...v.parentContext !== void 0 ? { parentContext: String(v.parentContext) } : {},
    ...v.childContext !== void 0 ? { childContext: String(v.childContext) } : {},
    ...v.agentId !== void 0 ? { agentId: String(v.agentId) } : {},
    startedAt: validDate(v.startedAt),
    completedAt: validDate(v.completedAt),
    rawResultSha256: String(v.rawResultSha256),
    ...v.parsedCompletionSha256 !== void 0 ? { parsedCompletionSha256: String(v.parsedCompletionSha256) } : {},
    rawResultRef: parseEvidenceObjectRef(v.rawResultRef)
  };
}
function parseReviewExecutionRecord(value) {
  if (!isRecord9(value) || value.schemaVersion !== 1 || typeof value.featureId !== "string" || !value.featureId || typeof value.batchId !== "string" || typeof value.executionRequestId !== "string" || value.source !== "claude-subagent" && value.source !== "server-sampling" || value.host !== "claude" && value.host !== "codex" || !Number.isInteger(value.generation) || value.generation < 0 || !Array.isArray(value.leases) || !Array.isArray(value.envelopes)) {
    throw new TypeError("invalid review execution record");
  }
  const v = value;
  const leases = v.leases.map((leaseValue) => {
    const lease = leaseValue;
    if (typeof lease.jobId !== "string" || typeof lease.capabilityHash !== "string" || typeof lease.packageSha256 !== "string" || !Number.isInteger(lease.leaseGeneration) || typeof lease.leasedAt !== "string" || typeof lease.leaseExpiresAt !== "string" || lease.state !== "pending" && lease.state !== "leased" && lease.state !== "envelope-captured" && lease.state !== "submitted" || lease.declarationId !== void 0 && typeof lease.declarationId !== "string") {
      throw new TypeError("invalid review execution lease");
    }
    return {
      jobId: String(lease.jobId),
      role: validRole(lease.role),
      capabilityHash: String(lease.capabilityHash),
      ...lease.declarationId !== void 0 ? { declarationId: String(lease.declarationId) } : {},
      packageSha256: String(lease.packageSha256),
      leaseGeneration: Number(lease.leaseGeneration),
      leasedAt: validDate(lease.leasedAt),
      leaseExpiresAt: validDate(lease.leaseExpiresAt),
      state: lease.state
    };
  });
  return {
    schemaVersion: 1,
    featureId: String(v.featureId),
    batchId: String(v.batchId),
    executionRequestId: String(v.executionRequestId),
    source: v.source,
    host: v.host,
    startedAt: validDate(v.startedAt),
    leases,
    envelopes: v.envelopes.map(parseEvidenceObjectRef),
    generation: Number(v.generation)
  };
}
var init_review_execution = __esm({
  "plugins/dev-flow/src/policy/review-execution.ts"() {
    "use strict";
    init_evidence_store();
  }
});

// plugins/dev-flow/src/policy/review-basis.ts
var allPlanTraceKinds, REVIEW_ROLE_SEMANTIC_SPECS;
var init_review_basis = __esm({
  "plugins/dev-flow/src/policy/review-basis.ts"() {
    "use strict";
    allPlanTraceKinds = [
      "requirement",
      "acceptance-criterion",
      "task",
      "test",
      "implementation-unit",
      "recovery"
    ];
    REVIEW_ROLE_SEMANTIC_SPECS = {
      "requirements-coverage": {
        phase: "plan",
        artifactKinds: ["requirements", "implementation-plan"],
        traceKinds: ["requirement", "acceptance-criterion", "task", "test", "implementation-unit"],
        bindReferencedCommandHashes: false,
        bindNonBehaviorDispositions: true,
        bindFeatureOwnedContent: false
      },
      "architecture-testability": {
        phase: "plan",
        artifactKinds: ["implementation-plan"],
        traceKinds: ["task", "test", "implementation-unit"],
        bindReferencedCommandHashes: true,
        bindNonBehaviorDispositions: false,
        bindFeatureOwnedContent: false
      },
      "rollback-operability": {
        phase: "plan",
        artifactKinds: ["implementation-plan"],
        traceKinds: ["task", "implementation-unit", "recovery"],
        bindReferencedCommandHashes: true,
        bindNonBehaviorDispositions: false,
        bindFeatureOwnedContent: false
      },
      security: {
        phase: "plan",
        artifactKinds: [],
        traceKinds: allPlanTraceKinds,
        riskLabels: ["security"],
        bindReferencedCommandHashes: false,
        bindNonBehaviorDispositions: false,
        bindFeatureOwnedContent: false
      },
      "data-irreversibility": {
        phase: "plan",
        artifactKinds: [],
        traceKinds: allPlanTraceKinds,
        riskLabels: ["data", "irreversible_consequence"],
        bindReferencedCommandHashes: false,
        bindNonBehaviorDispositions: false,
        bindFeatureOwnedContent: false
      },
      "money-safety": {
        phase: "plan",
        artifactKinds: [],
        traceKinds: allPlanTraceKinds,
        riskLabels: ["money"],
        bindReferencedCommandHashes: false,
        bindNonBehaviorDispositions: false,
        bindFeatureOwnedContent: false
      },
      "contract-failure": {
        phase: "plan",
        artifactKinds: [],
        traceKinds: allPlanTraceKinds,
        riskLabels: ["external"],
        bindReferencedCommandHashes: false,
        bindNonBehaviorDispositions: false,
        bindFeatureOwnedContent: false
      },
      "recovery-observability": {
        phase: "plan",
        artifactKinds: [],
        traceKinds: allPlanTraceKinds,
        riskLabels: ["availability"],
        bindReferencedCommandHashes: false,
        bindNonBehaviorDispositions: false,
        bindFeatureOwnedContent: false
      },
      "critical-correctness": {
        phase: "plan",
        artifactKinds: [],
        traceKinds: allPlanTraceKinds,
        riskLabels: ["critical_correctness"],
        bindReferencedCommandHashes: false,
        bindNonBehaviorDispositions: false,
        bindFeatureOwnedContent: false
      },
      "code-quality": {
        phase: "code",
        artifactKinds: ["requirements", "implementation-plan"],
        traceKinds: allPlanTraceKinds,
        bindReferencedCommandHashes: false,
        bindNonBehaviorDispositions: false,
        bindFeatureOwnedContent: true
      },
      "requirement-fidelity": {
        phase: "code",
        artifactKinds: ["requirements", "implementation-plan"],
        traceKinds: allPlanTraceKinds,
        bindReferencedCommandHashes: false,
        bindNonBehaviorDispositions: false,
        bindFeatureOwnedContent: true
      }
    };
  }
});

// plugins/dev-flow/src/core/artifact-templates.ts
var init_artifact_templates = __esm({
  "plugins/dev-flow/src/core/artifact-templates.ts"() {
    "use strict";
  }
});

// plugins/dev-flow/src/core/approval-basis.ts
function approvalIds(state) {
  return (state.obligations ?? []).filter((obligation) => obligation.kind === "approval").map((obligation) => obligation.id);
}
function confirmedApproval(state) {
  for (const approvalId of approvalIds(state)) {
    const record = state.humanGates[approvalId];
    if (record?.status === "confirmed") return { approvalId, record };
  }
  return void 0;
}
var approvalBasisArtifacts;
var init_approval_basis = __esm({
  "plugins/dev-flow/src/core/approval-basis.ts"() {
    "use strict";
    approvalBasisArtifacts = [
      "requirements",
      "implementation-plan"
    ];
  }
});

// plugins/dev-flow/src/core/plan-compiler.ts
var init_plan_compiler = __esm({
  "plugins/dev-flow/src/core/plan-compiler.ts"() {
    "use strict";
    init_traceability();
    init_errors();
  }
});

// plugins/dev-flow/src/core/traceability-markdown.ts
var init_traceability_markdown = __esm({
  "plugins/dev-flow/src/core/traceability-markdown.ts"() {
    "use strict";
    init_traceability();
  }
});

// plugins/dev-flow/src/core/plan-compile-context.ts
var init_plan_compile_context = __esm({
  "plugins/dev-flow/src/core/plan-compile-context.ts"() {
    "use strict";
    init_stable_json();
    init_errors();
    init_plan_compiler();
    init_path_normalization();
    init_project_config();
    init_state_store();
    init_traceability_anchors();
    init_traceability_markdown();
    init_traceability_store();
  }
});

// plugins/dev-flow/src/core/text-normalization.ts
var init_text_normalization = __esm({
  "plugins/dev-flow/src/core/text-normalization.ts"() {
    "use strict";
  }
});

// plugins/dev-flow/src/core/decision-language.ts
var init_decision_language = __esm({
  "plugins/dev-flow/src/core/decision-language.ts"() {
    "use strict";
    init_text_normalization();
  }
});

// plugins/dev-flow/src/core/grill-interaction.ts
function invalid3(message) {
  throw new DevFlowError("GRILL_PRESENTATION_INVALID", message, {
    userMessage: "\u5F53\u524D grill \u95EE\u9898\u4E0D\u7B26\u5408\u4EA4\u4E92\u5408\u540C\u3002",
    recoveryKind: "repair",
    recoveryInstruction: "\u63D0\u4F9B 2-3 \u4E2A\u5E26\u8BF4\u660E\u7684\u9009\u9879\uFF0C\u5E76\u660E\u786E\u4E00\u4E2A\u63A8\u8350\u9879\u53CA\u63A8\u8350\u7406\u7531\u3002",
    retryOriginal: false
  });
}
function buildGrillPresentation(input) {
  const question = input.question.trim();
  if (!question) invalid3("question must not be empty");
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 3) {
    invalid3("grill must contain 2-3 options");
  }
  if (input.options.some((option) => option.id === "other" || !option.description?.trim())) {
    invalid3("grill options require descriptions and cannot use the reserved other id");
  }
  const reason = input.recommendation.reason.trim();
  if (!reason) invalid3("recommendation reason must not be empty");
  const recommendedIndex = input.options.findIndex((option) => option.id === input.recommendation.optionId);
  if (recommendedIndex < 0) invalid3("recommendation must reference one current option");
  const drawback = input.recommendation.drawback?.trim();
  const alternative = input.recommendation.alternative;
  const hasReminder = drawback !== void 0 || alternative !== void 0;
  if (hasReminder) {
    if (!drawback || !alternative || !alternative.condition.trim()) {
      invalid3("high-impact recommendation requires both a drawback and an alternative condition");
    }
    if (alternative.optionId === input.recommendation.optionId) {
      invalid3("alternative must reference a non-recommended option");
    }
    const alternativeIndex = input.options.findIndex((option) => option.id === alternative.optionId);
    if (alternativeIndex < 0) invalid3("alternative must reference one current option");
  }
  const options = input.options.map((option, index) => ({
    ...option,
    answerCode: answerCodes[index],
    recommended: index === recommendedIndex
  }));
  const lines = [question];
  for (const option of options) {
    lines.push("");
    lines.push(`${option.answerCode}. ${option.label}${option.recommended ? "\uFF08\u63A8\u8350\uFF09" : ""}`);
    lines.push(`   ${option.recommended ? reason : option.description.trim()}`);
  }
  if (hasReminder) {
    const alternativeOption = options.find((option) => option.id === alternative.optionId);
    lines.push("");
    lines.push(`\u63D0\u9192\uFF1A\u63A8\u8350\u65B9\u6848\u7684\u4E3B\u8981\u7F3A\u70B9\u662F ${drawback}\u3002`);
    lines.push(`\u5982\u679C ${alternative.condition.trim()}\uFF0C\u9009\u9879 ${alternativeOption.answerCode}\uFF08${alternativeOption.label}\uFF09\u53EF\u80FD\u66F4\u5408\u9002\u3002`);
  }
  lines.push("");
  const codes = options.map((option) => option.answerCode);
  lines.push(`\u8BF7\u56DE\u590D ${codes.slice(0, -1).join("\u3001")} \u6216 ${codes.at(-1)}\u3002`);
  lines.push("\u5982\u679C\u90FD\u4E0D\u5408\u9002\uFF0C\u8BF7\u56DE\u590D\u201C\u5176\u4ED6\uFF1A<\u4F60\u7684\u65B9\u6848\u548C\u7406\u7531>\u201D\u3002");
  return {
    question,
    options,
    recommendation: { optionId: input.recommendation.optionId, reason },
    text: lines.join("\n")
  };
}
var answerCodes;
var init_grill_interaction = __esm({
  "plugins/dev-flow/src/core/grill-interaction.ts"() {
    "use strict";
    init_errors();
    answerCodes = ["A", "B", "C"];
  }
});

// plugins/dev-flow/src/core/user-interactions.ts
import { randomUUID as randomUUID5 } from "node:crypto";
function interactions(state) {
  if (!state.interactions) state.interactions = {};
  return state.interactions;
}
function validateOptions(options) {
  if (!Array.isArray(options) || options.length < 2 || options.length > 3) {
    throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "\u6BCF\u4E2A\u7528\u6237\u95EE\u9898\u5FC5\u987B\u53EA\u6709 2-3 \u4E2A\u9009\u9879\u3002", { userMessage: "\u5F53\u524D\u95EE\u9898\u7684\u9009\u9879\u6570\u91CF\u4E0D\u7B26\u5408\u4EA4\u4E92\u5408\u540C\u3002", recoveryKind: "repair", recoveryInstruction: "\u5C06\u9009\u9879\u6536\u655B\u4E3A 2-3 \u4E2A\u7B80\u660E\u9009\u62E9\uFF0C\u5E76\u4FDD\u7559\u4E00\u4E2A\u63A8\u8350\u7B54\u6848\u3002", retryOriginal: false });
  }
  const seen = /* @__PURE__ */ new Set();
  const seenLabels = /* @__PURE__ */ new Set();
  const invalidIds = [];
  const duplicateLabels = [];
  for (const option of options) {
    if (!option || !/^[a-z][a-z0-9-]{0,63}$/.test(option.id)) invalidIds.push(option?.id ?? "<missing>");
    const normalizedLabel = option?.label?.trim() ?? "";
    if (!option || !normalizedLabel || seen.has(option.id)) {
      throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "option ids must be unique lowercase action ids with labels", {
        pattern: "^[a-z][a-z0-9-]{0,63}$",
        examples: ["document-only", "inject-signal"],
        invalidIds,
        guidance: "A/B \u662F Core \u5206\u914D\u7684 answerCode\uFF0C\u4E0D\u662F\u8F93\u5165 option id\u3002",
        recoveryHint: "\u4E3A\u6BCF\u4E2A\u9009\u9879\u63D0\u4F9B\u552F\u4E00\u7684\u3001\u5339\u914D\u4E0A\u8FF0\u6B63\u5219\u7684 action id \u4E0E\u975E\u7A7A label\u3002"
      });
    }
    if (seenLabels.has(normalizedLabel)) duplicateLabels.push(option.label.trim());
    seen.add(option.id);
    seenLabels.add(normalizedLabel);
  }
  if (duplicateLabels.length > 0) {
    throw new DevFlowError("INTERACTION_OPTIONS_INVALID", "option labels must be unique after trimming", {
      duplicateLabels,
      recoveryHint: "\u4E3A\u6BCF\u4E2A\u9009\u9879\u63D0\u4F9B\u53EF\u533A\u5206\u3001\u53BB\u7A7A\u683C\u540E\u4E92\u4E0D\u76F8\u540C\u7684 label\uFF0C\u907F\u514D\u56DE\u7B54\u5339\u914D\u6B67\u4E49\u3002"
    });
  }
}
function createInteraction(state, input) {
  validateOptions(input.options);
  if (input.kind === "grill") {
    if (!input.recommendation) throw new DevFlowError("GRILL_RECOMMENDATION_REQUIRED", "grill requires one explicit recommendation");
    buildGrillPresentation({ question: input.question ?? "", options: input.options, recommendation: input.recommendation });
  }
  const pending = Object.values(state.interactions ?? {}).filter((value) => value.status === "pending");
  if (pending.length) throw new DevFlowError("MULTIPLE_PENDING_DECISIONS", "\u540C\u4E00 feature \u53EA\u80FD\u5B58\u5728\u4E00\u4E2A\u5F85\u51B3\u95EE\u9898\u3002", { userMessage: "\u5F53\u524D\u5DF2\u6709\u4E00\u4E2A\u95EE\u9898\u7B49\u5F85\u56DE\u7B54\u3002", cause: "\u7CFB\u7EDF\u62D2\u7EDD\u5E76\u884C\u521B\u5EFA\u7B2C\u4E8C\u4E2A pending decision\u3002", impact: "\u65B0\u95EE\u9898\u6CA1\u6709\u88AB\u521B\u5EFA\uFF0C\u539F\u95EE\u9898\u4ECD\u7B49\u5F85\u56DE\u7B54\u3002", recoveryKind: "refresh", recoveryInstruction: "\u5148\u56DE\u7B54\u5F53\u524D\u95EE\u9898\uFF0C\u4E0B\u4E00\u56DE\u5408\u518D\u5904\u7406\u65B0\u95EE\u9898\u3002", retryOriginal: false });
  const current = findInteractionForTarget(state, input.target);
  if (current?.status === "pending") {
    throw new DevFlowError("INTERACTION_ALREADY_PENDING", input.target, { interactionId: current.id });
  }
  const interaction = {
    id: randomUUID5(),
    kind: input.kind,
    target: input.target,
    basisHash: input.basisHash,
    ...input.binding ? {
      binding: {
        batchId: input.binding.batchId,
        findingIds: [...input.binding.findingIds],
        findingSetHash: input.binding.findingSetHash
      }
    } : {},
    question: input.question,
    options: input.options.map((option) => ({ ...option })),
    ...input.recommendation ? { recommendation: { ...input.recommendation } } : {},
    presentedAt: (/* @__PURE__ */ new Date()).toISOString(),
    presentedRevision: state.revision,
    ...input.presentationEventSequence !== void 0 ? { presentationEventSequence: input.presentationEventSequence } : {},
    presentationEventId: input.presentationEventId ?? randomUUID5(),
    ...input.workspacePaths ? { workspacePaths: [...input.workspacePaths] } : {},
    ...input.workspaceBatchPaths ? { workspaceBatchPaths: [...input.workspaceBatchPaths] } : {},
    ...input.workspaceRemainingPaths ? { workspaceRemainingPaths: [...input.workspaceRemainingPaths] } : {},
    ...input.ratification ? { ratification: { ...input.ratification, factRefs: [...input.ratification.factRefs] } } : {},
    ...input.revision ? { revision: { ...input.revision, affected: [...input.revision.affected] } } : {},
    ...input.planRevision ? { planRevision: { ...input.planRevision, affectedUnits: [...input.planRevision.affectedUnits], redoUnits: [...input.planRevision.redoUnits], sideEffectUnits: [...input.planRevision.sideEffectUnits] } } : {},
    ...input.planRevisionBasis ? { planRevisionBasis: { ...input.planRevisionBasis } } : {},
    ...input.planRevisionProposal ? { planRevisionProposal: { ...input.planRevisionProposal } } : {},
    ...input.sideEffectRerun ? { sideEffectRerun: { units: [...input.sideEffectRerun.units] } } : {},
    ...input.acceptanceConfirmation ? { acceptanceConfirmation: { ...input.acceptanceConfirmation, acceptanceCriterionIds: [...input.acceptanceConfirmation.acceptanceCriterionIds] } } : {},
    status: "pending"
  };
  interactions(state)[interaction.id] = interaction;
  return interaction;
}
function findInteractionForTarget(state, target) {
  return Object.values(state.interactions ?? {}).find(
    (interaction) => interaction.target === target && interaction.status === "pending"
  );
}
var init_user_interactions = __esm({
  "plugins/dev-flow/src/core/user-interactions.ts"() {
    "use strict";
    init_decision_language();
    init_errors();
    init_grill_interaction();
    init_text_normalization();
  }
});

// plugins/dev-flow/src/policy/rollback-warnings.ts
var init_rollback_warnings = __esm({
  "plugins/dev-flow/src/policy/rollback-warnings.ts"() {
    "use strict";
  }
});

// plugins/dev-flow/src/core/plan-graph.ts
function parsePlanBlocks(markdown) {
  TRACE_ANCHOR2.lastIndex = 0;
  const anchors = [];
  let match;
  while ((match = TRACE_ANCHOR2.exec(markdown)) !== null) {
    const [, prefix, suffix, kind] = match;
    anchors.push({ id: `${prefix}-${suffix}`, kind, index: match.index });
  }
  const blocks = /* @__PURE__ */ new Map();
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const end = anchors[index + 1]?.index ?? markdown.length;
    blocks.set(anchor.id, { kind: anchor.kind, text: markdown.slice(anchor.index, end) });
  }
  return blocks;
}
var TRACE_ANCHOR2;
var init_plan_graph = __esm({
  "plugins/dev-flow/src/core/plan-graph.ts"() {
    "use strict";
    TRACE_ANCHOR2 = /<!-- dev-flow:id=(REQ|AC|TASK|TEST|UNIT)-([0-9]{3,}) kind=(requirement|acceptance-criterion|task|test|implementation-unit) -->/g;
  }
});

// plugins/dev-flow/src/core/artifacts.ts
import { createHash as createHash8 } from "node:crypto";
import { readFile as readFile9, writeFile as writeFile2 } from "node:fs/promises";
import path11 from "node:path";
async function assertArtifactCurrent(root, id, state, kind) {
  const artifact = state.artifacts[kind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", kind);
  const contents = await readFile9(path11.join(featureDirectory2(root, id), normalizeUnicode(artifact.path)), "utf8");
  if (hash(contents) !== artifact.sha256) throw new DevFlowError("ARTIFACT_INTEGRITY_FAILED", kind);
  return contents;
}
var hash, featureDirectory2;
var init_artifacts = __esm({
  "plugins/dev-flow/src/core/artifacts.ts"() {
    "use strict";
    init_contract2();
    init_artifact_templates();
    init_errors();
    init_approval_basis();
    init_state_store();
    init_step_order();
    init_plan_compile_context();
    init_traceability_store();
    init_user_interactions();
    init_review_store();
    init_obligations();
    init_path_normalization();
    init_rollback_warnings();
    init_plan_graph();
    init_project_config();
    hash = (value) => createHash8("sha256").update(value).digest("hex");
    featureDirectory2 = (root, id) => path11.join(root, ".dev-flow", "features", id);
  }
});

// plugins/dev-flow/src/core/review-findings.ts
function eventsFor(ledger, findingId) {
  return (ledger.findingEvents ?? []).filter((event) => event.type === "origin" ? event.finding.findingId === findingId : event.findingId === findingId);
}
function originFor(ledger, findingId) {
  return (ledger.findingEvents ?? []).find((event) => event.type === "origin" && event.finding.findingId === findingId);
}
function latestEvent(events) {
  return events.filter((event) => event.type !== "origin").at(-1);
}
function effectiveFindingState(ledger, findingId, currentBasisHash) {
  const origin = originFor(ledger, findingId);
  if (!origin) return void 0;
  const latest = latestEvent(eventsFor(ledger, findingId));
  const expectedBasis = typeof currentBasisHash === "function" ? currentBasisHash(origin) : currentBasisHash;
  const basisCurrent = !expectedBasis || !latest || latest.basisHash === expectedBasis;
  const status = !basisCurrent ? "needs-revalidation" : latest?.type === "resolved" ? "resolved" : latest?.type === "still-blocking" ? "still-blocking" : latest?.type === "risk-accepted" ? "risk-accepted" : "unresolved";
  return {
    findingId,
    status,
    blocking: origin.finding.severity === "blocking" && status !== "resolved" && status !== "risk-accepted",
    origin,
    ...latest ? { latestEvent: latest } : {}
  };
}
function unresolvedBlockingFindings(ledger, currentBasisHash) {
  const ids = new Set((ledger.findingEvents ?? []).filter((event) => event.type === "origin" && event.finding.severity === "blocking").map((event) => event.finding.findingId));
  return [...ids].map((findingId) => effectiveFindingState(ledger, findingId, currentBasisHash)).filter((state) => Boolean(state?.blocking)).map((state) => state.origin.finding);
}
var init_review_findings = __esm({
  "plugins/dev-flow/src/core/review-findings.ts"() {
    "use strict";
  }
});

// plugins/dev-flow/src/core/review-projection.ts
import { createHash as createHash9, randomUUID as randomUUID6 } from "node:crypto";
import { mkdir as mkdir6, open as open6, readFile as readFile10, rename as rename6 } from "node:fs/promises";
import path12 from "node:path";
function projectionError(message, details = {}) {
  throw new DevFlowError("REVIEW_PROJECTION_INVALID", message, details);
}
function currentBatch(ledger, state) {
  const current = ledger.batches.filter((batch) => batch.validity === "current");
  if (current.length === 0) return void 0;
  if (current.length === 1) return current[0];
  const phase = currentOpenStep(state) === "code_review" ? "code" : "plan";
  return current.find((batch) => (batch.phase ?? "plan") === phase) ?? current[0];
}
function publicJob(job) {
  return { jobId: job.jobId, role: job.role, reviewDepth: job.reviewDepth, status: job.status };
}
function publicFinding(finding) {
  return {
    findingId: finding.findingId,
    jobId: finding.jobId,
    severity: finding.severity,
    category: finding.category,
    targets: [...finding.targets],
    evidence: finding.evidence.map((evidence) => ({ ...evidence })),
    claim: finding.claim,
    recommendation: finding.recommendation
  };
}
function unresolvedBlockingFindingIds(ledger) {
  if (ledger.findingEvents?.length) {
    const current = ledger.batches.find((batch) => batch.validity === "current");
    const roleBasis = (origin) => current?.jobs.find((job) => job.role === origin.role)?.roleBasisHash;
    return unresolvedBlockingFindings(ledger, roleBasis).map((finding) => finding.findingId).sort();
  }
  const dispositions = Object.fromEntries(ledger.batches.flatMap((batch) => Object.entries(batch.dispositions ?? {})));
  return ledger.batches.flatMap((batch) => batch.jobs.flatMap((job) => job.submission?.findings ?? [])).filter((finding) => finding.severity === "blocking" && !dispositions[finding.findingId]).map((finding) => finding.findingId).sort();
}
function supersededReusedFindingIds(ledger, batch) {
  if (!batch) return [];
  const ids = /* @__PURE__ */ new Set();
  for (const job of batch.jobs) {
    if (job.status !== "reused" || !job.reusedFrom) continue;
    const sourceBatch = ledger.batches.find((candidate) => candidate.batchId === job.reusedFrom.batchId);
    const sourceJob = sourceBatch?.jobs.find((candidate) => candidate.jobId === job.reusedFrom.jobId);
    for (const finding of sourceJob?.submission?.findings ?? []) {
      if (finding.severity !== "blocking") ids.add(finding.findingId);
    }
  }
  return [...ids].sort();
}
function reviewProjectionModel(state, ledger) {
  const batch = currentBatch(ledger, state);
  function phaseBatch(ledger2, phase) {
    return ledger2.batches.find((batch2) => batch2.validity === "current" && (batch2.phase ?? "plan") === phase);
  }
  function phaseSummary(state2, ledger2, phase, batch2) {
    const requiredRoles2 = batch2 ? batch2.jobs.map((job) => ({ role: job.role, reviewDepth: job.reviewDepth })) : deriveReviewJobRequirements(state2.route, state2.classification.riskLabels, state2.classification.controls.reviewRoles, phase).map((requirement) => ({ role: requirement.role, reviewDepth: requirement.reviewDepth }));
    return {
      status: batch2 ? batch2.validity : "not-created",
      ...batch2 ? { batchId: batch2.batchId, basisHash: batch2.basisHash, progress: batch2.progress, executionMode: batch2.executionMode } : {},
      requiredRoles: requiredRoles2,
      jobs: batch2 ? batch2.jobs.map(publicJob) : [],
      visibility: batch2?.progress === "complete" ? "complete" : "coarse"
    };
  }
  const staleBatches = ledger.batches.filter((candidate) => candidate.validity === "stale").map((candidate) => ({ batchId: candidate.batchId, basisHash: candidate.basisHash, progress: candidate.progress }));
  const requiredRoles = batch ? batch.jobs.map((job) => ({ role: job.role, reviewDepth: job.reviewDepth })) : deriveReviewJobRequirements(state.route, state.classification.riskLabels).map((requirement) => ({ role: requirement.role, reviewDepth: requirement.reviewDepth }));
  const complete = batch?.progress === "complete";
  const findings = complete ? batch.jobs.flatMap((job) => job.submission?.findings ?? []).map(publicFinding) : void 0;
  const supersededFindingIds = complete ? supersededReusedFindingIds(ledger, batch) : void 0;
  return {
    schemaVersion: 2,
    featureId: state.featureId,
    route: state.route,
    reviewPointer: {
      path: state.review.path,
      sha256: state.review.sha256,
      revision: state.review.revision
    },
    assurance: {
      ...batch ? { level: batch.assuranceLevel } : {},
      evidenceType: "core-derived-review-batch",
      evidenceSources: evidenceSourcesForReviewBatch(batch)
    },
    batch: {
      status: batch ? batch.validity : "not-created",
      ...batch ? {
        batchId: batch.batchId,
        basisHash: batch.basisHash,
        progress: batch.progress,
        executionMode: batch.executionMode
      } : {},
      requiredRoles,
      jobs: batch ? batch.jobs.map(publicJob) : [],
      visibility: complete ? "complete" : "coarse",
      ...complete ? {
        findings,
        supersededFindingIds,
        dispositions: { ...batch.dispositions },
        unresolvedBlockingFindingIds: unresolvedBlockingFindingIds(ledger)
      } : {}
    },
    phases: {
      plan: phaseSummary(state, ledger, "plan", phaseBatch(ledger, "plan")),
      code: phaseSummary(state, ledger, "code", phaseBatch(ledger, "code"))
    },
    staleBatches
  };
}
function renderReviewProjection(model) {
  const batch = model.batch;
  const lines = [
    "---",
    "dev_flow:",
    "  schema_version: 2",
    `  feature_id: ${model.featureId}`,
    `  route: ${model.route}`,
    "  kind: plan-review",
    "  generated: true",
    "---",
    "",
    "# Plan Review",
    "",
    "## Review Ledger",
    "",
    `- Pointer: ${model.reviewPointer.path}`,
    `- Revision: ${model.reviewPointer.revision}`,
    `- Batch status: ${batch.status}`,
    `- Plan phase: ${model.phases.plan.status}${model.phases.plan.batchId ? ` (${model.phases.plan.batchId}, ${model.phases.plan.progress ?? "unknown"})` : ""}`,
    `- Code phase: ${model.phases.code.status}${model.phases.code.batchId ? ` (${model.phases.code.batchId}, ${model.phases.code.progress ?? "unknown"})` : ""}`,
    `- Evidence type: ${model.assurance.evidenceType}`,
    ...model.assurance.level ? [`- Assurance: ${model.assurance.level}`] : [],
    ...model.assurance.evidenceSources.length ? [`- Evidence sources: ${model.assurance.evidenceSources.join(", ")}`] : [],
    ...model.assurance.level === "independent-sampling" ? ["- Note: independent-sampling is server sampling provenance, not multi-agent identity."] : [],
    ...batch.batchId ? [`- Batch ID: ${batch.batchId}`, `- Basis hash: ${batch.basisHash}`, `- Diagnostic execution: ${batch.executionMode}`, `- Progress: ${batch.progress}`] : [],
    "",
    "## Required Review Jobs",
    "",
    ...batch.requiredRoles.length ? batch.requiredRoles.map((required) => {
      const job = batch.jobs.find((candidate) => candidate.role === required.role);
      return `- ${required.role} (${required.reviewDepth}): ${job?.status ?? "pending"}`;
    }) : ["- No review batch has been created yet."],
    ""
  ];
  if (batch.visibility === "coarse") {
    lines.push(
      "## Visibility",
      "",
      "- Waiting for all required jobs. Findings and reviewer submissions remain isolated until the batch is complete.",
      ""
    );
  } else {
    lines.push("## Findings", "");
    if (batch.findings.length) {
      for (const finding of batch.findings) {
        lines.push(`- ${finding.findingId} [${finding.severity}] ${finding.category}: ${finding.claim}`);
      }
    } else lines.push("- No findings submitted.");
    lines.push("", "## Superseded Reused Findings", "");
    if (batch.supersededFindingIds?.length) {
      for (const findingId of batch.supersededFindingIds) lines.push(`- ${findingId}: superseded by content change`);
    } else lines.push("- None.");
    lines.push("", "## Dispositions", "");
    const dispositions = Object.entries(batch.dispositions ?? {});
    if (dispositions.length) {
      for (const [findingId, disposition] of dispositions) lines.push(`- ${findingId}: ${disposition.kind}`);
    } else lines.push("- No dispositions recorded.");
    lines.push("", "## Unresolved Blocking Findings", "");
    if (batch.unresolvedBlockingFindingIds.length) {
      for (const findingId of batch.unresolvedBlockingFindingIds) lines.push(`- ${findingId}`);
    } else lines.push("- None.");
    lines.push("");
  }
  if (model.staleBatches.length) {
    lines.push("## Stale / Superseded Batches", "");
    for (const stale of model.staleBatches) lines.push(`- ${stale.batchId}: ${stale.progress} (basis ${stale.basisHash})`);
    lines.push("");
  }
  return `${lines.join("\n")}
`;
}
function projectionDirectory(root, featureId) {
  return path12.join(root, ".dev-flow", "features", featureId, "review", "projections");
}
async function fsyncDirectory3(directory) {
  const handle = await open6(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writeProjection(root, featureId, markdown) {
  const sha2564 = digest4(markdown);
  const directory = projectionDirectory(root, featureId);
  const target = path12.join(directory, `${sha2564}.md`);
  await mkdir6(directory, { recursive: true });
  try {
    const existing = await readFile10(target, "utf8");
    if (existing !== markdown) projectionError("existing review projection does not match its content address");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = path12.join(directory, `.${sha2564}.${randomUUID6()}.tmp`);
    const handle = await open6(temporary, "wx");
    try {
      await handle.writeFile(markdown);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename6(temporary, target);
    } catch (renameError) {
      if (renameError.code !== "EEXIST") throw renameError;
      if (await readFile10(target, "utf8") !== markdown) projectionError("concurrent review projection does not match its content address");
    }
    await fsyncDirectory3(directory);
  }
  return { path: `review/projections/${sha2564}.md`, sha256: sha2564 };
}
async function prepareReviewProjection(root, state) {
  if (state.mode !== "routed" || !state.route || !state.classification) return;
  if (!reviewEnforcementRequired(state.route, state.classification.controls)) return;
  if (!state.review) projectionError("review-enabled feature has no review pointer", { featureId: state.featureId });
  const ledger = await readReviewLedger(root, state);
  const model = reviewProjectionModel(state, ledger);
  const artifact = await writeProjection(root, state.featureId, renderReviewProjection(model));
  state.artifacts["plan-review"] = artifact;
}
function validProjectionArtifact(artifact) {
  return Boolean(artifact) && /^review\/projections\/[a-f0-9]{64}\.md$/.test(artifact.path) && /^[a-f0-9]{64}$/.test(artifact.sha256) && artifact.path === `review/projections/${artifact.sha256}.md`;
}
async function readReviewProjection(root, state) {
  if (state.mode !== "routed" || !state.route || !state.classification) return void 0;
  if (!reviewEnforcementRequired(state.route, state.classification.controls)) return void 0;
  const artifact = state.artifacts["plan-review"];
  if (!validProjectionArtifact(artifact)) projectionError("review projection artifact pointer is missing or invalid", { featureId: state.featureId });
  let markdown;
  try {
    markdown = await readFile10(path12.join(root, ".dev-flow", "features", state.featureId, artifact.path), "utf8");
  } catch {
    projectionError("review projection artifact cannot be read", { featureId: state.featureId, path: artifact.path });
  }
  if (digest4(markdown) !== artifact.sha256) projectionError("review projection digest does not match artifact pointer", { featureId: state.featureId });
  const ledger = await readReviewLedger(root, state);
  const model = reviewProjectionModel(state, ledger);
  const expected = renderReviewProjection(model);
  if (markdown !== expected) projectionError("review projection does not match the current review ledger", { featureId: state.featureId });
  return { artifact, model, markdown: expected };
}
async function assertCurrentReviewProjection(root, state) {
  await readReviewProjection(root, state);
}
var digest4;
var init_review_projection = __esm({
  "plugins/dev-flow/src/core/review-projection.ts"() {
    "use strict";
    init_contract2();
    init_review();
    init_errors();
    init_review_store();
    init_step_order();
    init_review_findings();
    digest4 = (contents) => createHash9("sha256").update(contents).digest("hex");
  }
});

// plugins/dev-flow/src/policy/evidence-baseline.ts
function isRecord10(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSha2564(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function parseEvidenceBaselineManifest(value) {
  if (!isRecord10(value) || value.schemaVersion !== 1 || typeof value.featureId !== "string" || !value.featureId || typeof value.capturedAt !== "string" || Number.isNaN(Date.parse(value.capturedAt)) || !isSha2564(value.contentFingerprint) || !isSha2564(value.governedScopeHash) || !isSha2564(value.ownershipHash) || !isSha2564(value.planExecutionBasisHash) || !Array.isArray(value.checkpointIds) || value.checkpointIds.some((id) => typeof id !== "string") || !Array.isArray(value.fileToUnits) || !isRecord10(value.snapshotRef) || !isRecord10(value.origin) || value.origin.kind !== "review-complete" && value.origin.kind !== "verification-current" && value.origin.kind !== "risk-acceptance" || typeof value.origin.target !== "string" || typeof value.origin.recordId !== "string" || typeof value.origin.at !== "string") {
    throw new TypeError("invalid evidence baseline manifest");
  }
  const fileToUnits = value.fileToUnits.map((mapping) => {
    if (!isRecord10(mapping) || typeof mapping.path !== "string" || !mapping.path || !Array.isArray(mapping.unitIds) || mapping.unitIds.some((id) => typeof id !== "string")) {
      throw new TypeError("invalid evidence baseline file-unit mapping");
    }
    return { path: mapping.path, unitIds: [...new Set(mapping.unitIds)].sort() };
  });
  return {
    schemaVersion: 1,
    featureId: String(value.featureId),
    capturedAt: String(value.capturedAt),
    contentFingerprint: String(value.contentFingerprint),
    governedScopeHash: String(value.governedScopeHash),
    ownershipHash: String(value.ownershipHash),
    planExecutionBasisHash: String(value.planExecutionBasisHash),
    checkpointIds: [...new Set(value.checkpointIds)].sort(),
    fileToUnits,
    snapshotRef: parseEvidenceObjectRef(value.snapshotRef),
    origin: {
      kind: value.origin.kind,
      target: String(value.origin.target),
      recordId: String(value.origin.recordId),
      at: String(value.origin.at)
    }
  };
}
var init_evidence_baseline = __esm({
  "plugins/dev-flow/src/policy/evidence-baseline.ts"() {
    "use strict";
    init_evidence_store();
  }
});

// plugins/dev-flow/src/core/workspace-snapshot.ts
var init_workspace_snapshot = __esm({
  "plugins/dev-flow/src/core/workspace-snapshot.ts"() {
    "use strict";
    init_stable_json();
    init_evidence_store();
    init_evidence_store2();
    init_fingerprint();
  }
});

// plugins/dev-flow/src/core/evidence-baseline.ts
import { createHash as createHash10 } from "node:crypto";
function featureOwnedSnapshotHash(files, ownership) {
  return sha2562(stableJson({ files: files.filter((file) => ownership[file.path] === "feature") }));
}
var sha2562;
var init_evidence_baseline2 = __esm({
  "plugins/dev-flow/src/core/evidence-baseline.ts"() {
    "use strict";
    init_stable_json();
    init_evidence_baseline();
    init_evidence_store2();
    init_checkpoint_store();
    init_workspace_snapshot();
    sha2562 = (value) => createHash10("sha256").update(value).digest("hex");
  }
});

// plugins/dev-flow/src/core/basis-state.ts
function basisIsCurrent(basis, current) {
  switch (basis.kind) {
    case "content":
      return current.contentFingerprint !== void 0 && basis.sha256 === current.contentFingerprint;
    case "event":
      return current.eventIds?.has(basis.eventId) ?? false;
    case "slice": {
      return current.sliceBases?.[basis.sliceKey] === basis.sliceHash;
    }
  }
}
function deriveCurrency(record, current) {
  const basis = record.basis;
  if (!basis) return "unconfirmed";
  if (!basisIsCurrent(basis, current)) return currentKnown(basis, current) ? "stale" : "unconfirmed";
  return "current";
}
function currentKnown(basis, current) {
  switch (basis.kind) {
    case "content":
      return current.contentFingerprint !== void 0;
    case "event":
      return basis.eventId !== void 0;
    case "slice":
      return current.sliceBases?.[basis.sliceKey] !== void 0;
  }
}
var init_basis_state = __esm({
  "plugins/dev-flow/src/core/basis-state.ts"() {
    "use strict";
  }
});

// plugins/dev-flow/src/core/governance-state.ts
function governanceLedger(state) {
  return state.governance ?? EMPTY_GOVERNANCE_LEDGER;
}
function currentRiskAuthorizations(state, basis) {
  return governanceLedger(state).authorizations.filter((authorization) => authorization.authorizationType === "risk-acceptance" && deriveCurrency(authorization, basis) === "current");
}
var init_governance_state = __esm({
  "plugins/dev-flow/src/core/governance-state.ts"() {
    "use strict";
    init_basis_state();
    init_governance_records();
  }
});

// plugins/dev-flow/src/core/quality-exceptions.ts
function reviewWaiverSliceKey(batchId, basisHash2) {
  return `review-waiver:${batchId}:${basisHash2}`;
}
function hasCurrentQualityException(state, kind, binding) {
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  const current = { contentFingerprint: state.businessFingerprint };
  if (kind === "review" && binding && state.businessFingerprint) {
    current.sliceBases = { [reviewWaiverSliceKey(binding.batchId, binding.basisHash)]: state.businessFingerprint };
  }
  return currentRiskAuthorizations(state, current).some((item) => item.target === kind && (!Number.isFinite(invalidatedAt) || !item.recordedAt || Date.parse(item.recordedAt) >= invalidatedAt));
}
var init_quality_exceptions = __esm({
  "plugins/dev-flow/src/core/quality-exceptions.ts"() {
    "use strict";
    init_errors();
    init_state_store();
    init_evidence_baseline2();
    init_fingerprint();
    init_governance_records();
    init_user_interactions();
    init_obligations();
    init_governance_state();
    init_review_store();
    init_step_order();
  }
});

// plugins/dev-flow/src/core/review-jobs.ts
import { createHash as createHash11, randomUUID as randomUUID7 } from "node:crypto";
function nonBehaviorDispositions(trace) {
  const nodes = Object.values(trace?.nodes ?? {}).filter((node) => node.status !== "tombstoned");
  const coveredBy = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    if (node.kind !== "task") continue;
    for (const covered of node.covers) {
      if (!covered.startsWith("AC-")) continue;
      const list = coveredBy.get(covered) ?? [];
      list.push({ taskId: node.id, ...node.tdd ? { tdd: node.tdd } : {} });
      coveredBy.set(covered, list);
    }
  }
  return nodes.filter((node) => node.kind === "acceptance-criterion" && node.verificationDisposition !== void 0 && node.verificationDisposition.kind !== "behavior-test").map((node) => ({
    criterionId: node.id,
    dispositionKind: node.verificationDisposition.kind,
    ...node.verificationDisposition.reason ? { reason: node.verificationDisposition.reason } : {},
    ...node.verificationDisposition.target ? { target: node.verificationDisposition.target } : {},
    coveredBy: (coveredBy.get(node.id) ?? []).sort((left, right) => left.taskId.localeCompare(right.taskId))
  })).sort((left, right) => left.criterionId.localeCompare(right.criterionId));
}
function invalid4(code, message, details = {}) {
  throw new DevFlowError(code, message, details);
}
function reviewArtifactKinds(state) {
  return basisArtifactKinds.filter((kind) => Boolean(state.artifacts[kind]));
}
async function deriveReviewInput(root, state) {
  const trace = state.traceability ? await readTraceability(root, state) : void 0;
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
  const frozenArtifacts = await Promise.all(reviewArtifactKinds(state).map(async (kind) => {
    const artifact = state.artifacts[kind];
    if (!artifact) invalid4("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact is missing: ${kind}`, { kind });
    let contents;
    try {
      contents = await assertArtifactCurrent(root, state.featureId, state, kind);
    } catch (error) {
      if (error instanceof DevFlowError && error.code === "ARTIFACT_INTEGRITY_FAILED") throw error;
      invalid4("REVIEW_BASIS_ARTIFACT_MISSING", `review basis artifact cannot be read: ${kind}`, { kind });
    }
    if (digest5(contents) !== artifact.sha256) {
      invalid4("ARTIFACT_INTEGRITY_FAILED", `review basis artifact was edited without registration: ${kind}`, {
        kind,
        recoveryHint: `Re-register the edited ${kind} artifact with the latest feature revision known before the edit.`
      });
    }
    return { kind, path: artifact.path, sha256: artifact.sha256, contents };
  }));
  const projectContents = (await readProjectConfigSnapshot(root)).contents;
  if (digest5(projectContents) !== projectConfigSha256) {
    invalid4("REVIEW_BASIS_UNAVAILABLE", "project configuration changed while review basis was being captured");
  }
  const scopeManifest = {
    inScope: [...state.scope.inScope].sort(),
    outOfScope: [...state.scope.outOfScope].sort(),
    governedRoots: [...config.governedRoots].sort(),
    rollbackFileScopes: Object.values(trace?.nodes ?? {}).reduce((scopes, node) => {
      if ((node.kind === "implementation-unit" || node.kind === "rollback") && node.status === "current") {
        scopes.push({ id: node.id, fileScope: [...node.fileScope].sort() });
      }
      return scopes;
    }, []).sort((left, right) => left.id.localeCompare(right.id))
  };
  const governedRootsFingerprint = await fingerprintGovernedRoots(root, config);
  const featureOwnedFingerprint = await fingerprintFeatureOwned(root, config, state.workspace.ownership);
  const basis = {
    featureId: state.featureId,
    route: state.route,
    workflowCapabilities: { ...state.workflowCapabilities ?? { trace: 0, review: 0, checkpoints: 0, rollbackExecution: 0 } },
    classification: {
      level: state.classification.level,
      topology: state.classification.topology,
      ...state.classification.requirements ? { requirements: state.classification.requirements } : {},
      riskLabels: [...state.classification.riskLabels].sort()
    },
    artifacts: frozenArtifacts.map(({ kind, path: artifactPath, sha256: sha2564 }) => ({ kind, path: artifactPath, sha256: sha2564 })),
    ...state.traceability && trace ? { traceability: { path: state.traceability.path, sha256: state.traceability.sha256, revision: trace.revision } } : {},
    projectConfigSha256,
    verificationCommandHashes: verificationCommandHashes(config),
    scopeManifestSha256: digest5(canonicalReviewValueJson(scopeManifest)),
    governedRootsFingerprint,
    featureOwnedFingerprint
  };
  const fallbackRoles = ["requirements-coverage", "architecture-testability", "rollback-operability"];
  const baseRoles = state.classification.controls.reviewRoles.length ? state.classification.controls.reviewRoles : fallbackRoles;
  const roles = [.../* @__PURE__ */ new Set([
    ...baseRoles,
    ...state.classification.controls.codeReview !== "none" ? ["code-quality", "requirement-fidelity"] : []
  ])];
  const roleBasisHashes = Object.fromEntries(
    roles.map((role) => [role, roleBasisHash(basis, frozenArtifacts, trace, role)])
  );
  return {
    basis,
    roleBasisHashes,
    frozenArtifacts,
    projectConfig: { sha256: projectConfigSha256, contents: projectContents },
    scopeManifest: {
      governedRoots: scopeManifest.governedRoots,
      rollbackFileScopes: scopeManifest.rollbackFileScopes.flatMap((item) => item.fileScope),
      traceIds: Object.values(trace?.nodes ?? {}).filter((node) => node.status === "current").map((node) => node.id).sort(),
      frozenArtifactPaths: frozenArtifacts.map((artifact) => artifact.path).sort()
    },
    nonBehaviorDispositions: nonBehaviorDispositions(trace)
  };
}
function basisHash(basis) {
  return semanticReviewBasisHash(basis);
}
function roleBasisHash(basis, frozenArtifacts, trace, role) {
  const spec = REVIEW_ROLE_SEMANTIC_SPECS[role];
  const artifacts = frozenArtifacts.filter((artifact) => spec.artifactKinds.includes(artifact.kind)).map(({ kind, path: artifactPath, sha256: sha2564 }) => ({ kind, path: artifactPath, sha256: sha2564 }));
  const traceSlice = Object.values(trace?.nodes ?? {}).filter((node) => node.status !== "tombstoned" && spec.traceKinds.includes(node.kind)).sort((left, right) => left.id.localeCompare(right.id)).map(({ sourceArtifact: _sourceArtifact, sourceSha256: _sourceSha256, sourceAnchor: _sourceAnchor, sourceBlockSha256: _sourceBlockSha256, status: _status, ...semantic }) => semantic);
  if (spec.riskLabels) {
    return digest5(canonicalReviewValueJson({
      role,
      route: basis.route,
      level: basis.classification.level,
      riskLabels: basis.classification.riskLabels.filter((label) => spec.riskLabels.includes(label)),
      traceSlice
    }));
  }
  const referencedCommandIds = spec.bindReferencedCommandHashes ? traceSlice.flatMap((node) => node.kind === "implementation-unit" ? node.forwardVerification : []).filter((reference) => typeof reference === "string") : [];
  const referencedCommandHashes = Object.fromEntries([...new Set(referencedCommandIds)].sort().filter((id) => basis.verificationCommandHashes?.[id] !== void 0).map((id) => [id, basis.verificationCommandHashes[id]]));
  return digest5(canonicalReviewValueJson({
    role,
    route: basis.route,
    level: basis.classification.level,
    ...role === "architecture-testability" ? { topology: basis.classification.topology } : {},
    ...artifacts.length ? { artifacts } : {},
    traceSlice,
    ...spec.bindFeatureOwnedContent ? { featureOwnedFingerprint: basis.featureOwnedFingerprint ?? "" } : {},
    ...spec.bindNonBehaviorDispositions ? { nonBehaviorDispositions: nonBehaviorDispositions(trace) } : {},
    ...spec.bindReferencedCommandHashes ? { verificationCommandHashes: referencedCommandHashes } : {}
  }));
}
function codeReviewIsolationRequired(state) {
  return state.classification.controls.codeReview === "independent" || state.classification.controls.codeReview === "full";
}
function submittedSourceForJob(ledger, job, visited = /* @__PURE__ */ new Set()) {
  if (job.status === "submitted") return job;
  if (job.status !== "reused" || !job.reusedFrom) return void 0;
  const key = `${job.reusedFrom.batchId}:${job.reusedFrom.jobId}`;
  if (visited.has(key)) return void 0;
  visited.add(key);
  const sourceBatch = ledger.batches.find((candidate) => candidate.batchId === job.reusedFrom.batchId);
  const sourceJob = sourceBatch?.jobs.find((candidate) => candidate.jobId === job.reusedFrom.jobId);
  return sourceJob ? submittedSourceForJob(ledger, sourceJob, visited) : void 0;
}
function jobHasEffectiveIsolationProof(ledger, job) {
  const source = submittedSourceForJob(ledger, job);
  return Boolean(source?.submission?.isolationProof);
}
function submittedFindings(ledger) {
  return ledger.batches.flatMap((batch) => batch.jobs.flatMap((job) => (job.submission?.findings ?? []).map((finding) => ({ batch, job, finding }))));
}
function sortedFindingIds(findingIds) {
  if (!Array.isArray(findingIds) || !findingIds.length || findingIds.some((id) => typeof id !== "string" || !id)) {
    invalid4("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance requires one or more finding ids");
  }
  const sorted = [...findingIds].sort();
  if (new Set(sorted).size !== sorted.length) {
    invalid4("REVIEW_RISK_ACCEPTANCE_INVALID", "risk acceptance finding ids must be unique");
  }
  return sorted;
}
function findingSetHash(batch, findings) {
  const items = findings.map((finding) => ({ findingId: finding.findingId, sha256: digest5(canonicalReviewValueJson(finding)) })).sort((left, right) => left.findingId.localeCompare(right.findingId));
  return digest5(canonicalReviewValueJson({ batchId: batch.batchId, basisHash: batch.basisHash, findings: items }));
}
function riskBinding(interaction) {
  const binding = interaction.binding;
  if (interaction.kind !== "risk-acceptance" || !binding || typeof binding.batchId !== "string" || typeof binding.findingSetHash !== "string" || !Array.isArray(binding.findingIds)) {
    invalid4("REVIEW_RISK_ACCEPTANCE_INVALID", "interaction is not a valid review risk-acceptance decision", { interactionId: interaction.id });
  }
  return { batchId: binding.batchId, findingIds: sortedFindingIds(binding.findingIds), findingSetHash: binding.findingSetHash };
}
function planReviewBoundToBatch(state, batch) {
  const evidence = state.steps.planning?.evidence;
  return state.steps.planning?.status === "satisfied" && evidence?.batchId === batch.batchId && evidence?.basisHash === batch.basisHash;
}
function currentUnresolvedBlocking(ledger, batch, state) {
  if (ledger.findingEvents?.length) {
    const roleBasis = (origin) => batch.jobs.find((job) => job.role === origin.role)?.roleBasisHash;
    return unresolvedBlockingFindings(ledger, roleBasis);
  }
  const jobs = ledger.batches.flatMap((candidate) => candidate.jobs);
  const dispositions = Object.assign({}, ...ledger.batches.map((candidate) => candidate.dispositions ?? {}));
  return jobs.flatMap((job) => job.submission?.findings ?? []).filter((finding) => {
    if (finding.severity !== "blocking") return false;
    const disposition = dispositions[finding.findingId];
    if (!disposition) return true;
    if (disposition.kind === "risk-accepted") {
      if (disposition.batchId !== batch.batchId || disposition.basisHash !== batch.basisHash) return true;
      const interaction = state.interactions?.[disposition.interactionId];
      if (!interaction || interaction.kind !== "risk-acceptance" || interaction.status !== "resolved" || interaction.response?.action !== "accept" || interaction.basisHash !== batch.basisHash) return true;
      let binding;
      try {
        binding = riskBinding(interaction);
      } catch {
        return true;
      }
      if (binding.batchId !== batch.batchId || binding.findingSetHash !== disposition.findingSetHash || binding.findingIds.join("\n") !== [...disposition.findingIds].sort().join("\n") || !binding.findingIds.includes(finding.findingId)) return true;
      const acceptedFindings = submittedFindings(ledger).filter(({ batch: source, finding: candidate }) => source.batchId === batch.batchId && binding.findingIds.includes(candidate.findingId)).map(({ finding: candidate }) => candidate);
      if (acceptedFindings.length !== binding.findingIds.length || acceptedFindings.some((candidate) => candidate.severity !== "blocking") || findingSetHash(batch, acceptedFindings) !== binding.findingSetHash) return true;
      return false;
    }
    const successor = ledger.batches.find((candidate) => candidate.batchId === disposition.successorBatchId);
    const resolutionJob = successor?.jobs.find((candidate) => candidate.jobId === disposition.resolutionJobId);
    const sourceJob = jobs.find((candidate) => candidate.jobId === finding.jobId);
    return !successor || !resolutionJob || !sourceJob || resolutionJob.role !== sourceJob.role || !resolutionJob.submission?.resolutions.some((resolution) => resolution.findingId === finding.findingId);
  });
}
function reviewObligation(state, phase) {
  if (state.mode !== "routed") return false;
  if (phase === "code") return state.classification.controls.codeReview !== "none";
  return reviewEnforcementRequired(state.route, state.classification.controls);
}
async function reviewBasisStale(root, state, batch, phase) {
  const requireLiveBasis = !planReviewBoundToBatch(state, batch);
  const reviewInput = await deriveReviewInput(root, state);
  if (requireLiveBasis && basisHash(reviewInput.basis) !== batch.basisHash) return true;
  const requirements = deriveReviewJobRequirements(state.route, state.classification.riskLabels, state.classification.controls.reviewRoles, phase);
  for (const requirement of requirements) {
    const job = batch.jobs.find((candidate) => candidate.role === requirement.role);
    if (!job || job.roleBasisHash !== reviewInput.roleBasisHashes[requirement.role]) return true;
  }
  return false;
}
function reviewJobsSummary(batch) {
  return batch.jobs.map(({ jobId, role, reviewDepth, status }) => ({ jobId, role, reviewDepth, status }));
}
function reviewWaiverCurrent(state, batch) {
  return hasCurrentQualityException(state, "review", { batchId: batch.batchId, basisHash: batch.basisHash });
}
async function reviewGate(root, state, query) {
  const phase = query?.phase ?? (currentOpenStep(state) === "code_review" ? "code" : "plan");
  if (!reviewObligation(state, phase)) return { status: "ready" };
  const ledger = await readReviewLedger(root, state);
  const batch = ledger.batches.find((candidate) => candidate.validity === "current" && (candidate.phase ?? "plan") === phase);
  if (!batch) {
    const otherPhase = ledger.batches.find((candidate) => candidate.validity === "current");
    return otherPhase ? { status: "need-batch", cause: "phase", batchId: otherPhase.batchId } : { status: "need-batch", cause: "missing" };
  }
  if (await reviewBasisStale(root, state, batch, phase)) return { status: "need-batch", cause: "stale", batchId: batch.batchId };
  if (batch.progress === "waived" && reviewWaiverCurrent(state, batch)) return { status: "waived", batchId: batch.batchId };
  if (batch.progress !== "complete") {
    if (reviewWaiverCurrent(state, batch)) return { status: "waived", batchId: batch.batchId };
    return { status: "jobs-open", batchId: batch.batchId, jobs: reviewJobsSummary(batch) };
  }
  if (phase === "code") {
    const requiresIsolation = codeReviewIsolationRequired(state);
    if (requiresIsolation && !reviewWaiverCurrent(state, batch) && !hasCurrentQualityException(state, "review")) {
      const requirements = deriveReviewJobRequirements(state.route, state.classification.riskLabels, state.classification.controls.reviewRoles, phase);
      const missingIsolation = requirements.map((requirement) => batch.jobs.find((job) => job.role === requirement.role)).filter((job) => job !== void 0 && !jobHasEffectiveIsolationProof(ledger, job)).map((job) => job.jobId);
      if (missingIsolation.length) return { status: "isolation", batchId: batch.batchId, jobIds: missingIsolation };
    }
  }
  const unresolved = currentUnresolvedBlocking(ledger, batch, state);
  if (unresolved.length && !reviewWaiverCurrent(state, batch) && !hasCurrentQualityException(state, "review")) {
    return { status: "blocking", batchId: batch.batchId, findingIds: unresolved.map((finding) => finding.findingId) };
  }
  if (reviewEnforcementRequired(state.route, state.classification.controls)) {
    await assertCurrentReviewProjection(root, state);
  }
  return { status: "ready", stamp: { batchId: batch.batchId, basisHash: batch.basisHash, assuranceLevel: batch.assuranceLevel } };
}
function reviewGateError(gate, phase) {
  switch (gate.status) {
    case "need-batch": {
      if (gate.cause === "stale") {
        return new DevFlowError("REVIEW_BASIS_STALE", "review batch basis no longer matches current feature state", {
          batchId: gate.batchId,
          recoveryHint: "\u91CD\u5EFA\u6279\u6B21\u2192\u91CD\u4EA4 jobs\u2192re-record planning"
        });
      }
      return new DevFlowError("REVIEW_BATCH_REQUIRED", `a current ${phase} review batch is required`, { expectedPhase: phase });
    }
    case "jobs-open":
      return new DevFlowError("REVIEW_BATCH_INCOMPLETE", "all required review jobs must be submitted", { batchId: gate.batchId });
    case "isolation":
      return new DevFlowError("REVIEW_ISOLATION_REQUIRED", "\u72EC\u7ACB\u4EE3\u7801\u5BA1\u67E5\u8981\u6C42\u5BA1\u67E5\u5728\u4E0E\u5B9E\u73B0\u9694\u79BB\u7684\u65B0\u4E0A\u4E0B\u6587\u4E2D\u5B8C\u6210\uFF0C\u5F53\u524D\u6279\u6B21\u7F3A\u5C11\u9694\u79BB\u8BC1\u660E\u3002", {
        jobIds: gate.jobIds,
        batchId: gate.batchId,
        recoveryHint: "\u5728\u4E0E\u5B9E\u73B0\u9694\u79BB\u7684\u4E0A\u4E0B\u6587\u4E2D\u91CD\u65B0\u5B8C\u6210\u8FD9\u4E9B\u5BA1\u67E5 job \u5E76\u8BB0\u5F55 review-execution \u4E8B\u4EF6\uFF0C\u6216\u901A\u8FC7\u670D\u52A1\u7AEF\u91C7\u6837\u5B8C\u6210 job\uFF1B\u590D\u7528\u6279\u6B21\u540C\u6837\u9700\u8981\u9694\u79BB\u8BC1\u660E\uFF0C\u53EF\u5728\u9694\u79BB\u5B50\u4EE3\u7406\u4E2D\u91CD\u505A job \u6216\u7ECF\u8D28\u91CF\u4F8B\u5916\u63A5\u53D7\u98CE\u9669\u3002",
        retryOriginal: true
      });
    case "blocking":
      return new DevFlowError("REVIEW_BLOCKING_FINDINGS", "review ledger has unresolved blocking findings", {
        batchId: gate.batchId,
        findingIds: gate.findingIds
      });
  }
}
async function requireReviewReady(root, state, query) {
  const phase = query?.phase ?? (currentOpenStep(state) === "code_review" ? "code" : "plan");
  const gate = await reviewGate(root, state, query);
  if (gate.status === "ready") return gate.stamp;
  if (gate.status === "waived") return { waived: true, batchId: gate.batchId };
  throw reviewGateError(gate, phase);
}
var digest5, leaseMilliseconds, samplingLeaseMilliseconds, basisArtifactKinds;
var init_review_jobs = __esm({
  "plugins/dev-flow/src/core/review-jobs.ts"() {
    "use strict";
    init_review();
    init_rollback();
    init_review_basis();
    init_review();
    init_errors();
    init_path_normalization();
    init_fingerprint();
    init_state_store();
    init_artifacts();
    init_review_store();
    init_traceability_store();
    init_review_projection();
    init_obligations();
    init_traceability_gates();
    init_user_interactions();
    init_review_findings();
    init_review_findings();
    init_quality_exceptions();
    init_project_config();
    init_step_order();
    init_contract2();
    digest5 = (value) => createHash11("sha256").update(value).digest("hex");
    leaseMilliseconds = 60 * 60 * 1e3;
    samplingLeaseMilliseconds = 120 * 1e3;
    basisArtifactKinds = ["requirements", "implementation-plan"];
  }
});

// plugins/dev-flow/src/core/review-execution.ts
import { createHash as createHash12, randomUUID as randomUUID8 } from "node:crypto";
import { mkdir as mkdir7, open as open7, readFile as readFile11, rename as rename7 } from "node:fs/promises";
import path13 from "node:path";
async function captureHostReviewEnvelope(root, input) {
  if (input.rawResult === void 0 || input.rawResult === null) throw new TypeError("review envelope rawResult is required");
  const rawBytes = Buffer.isBuffer(input.rawResult) ? input.rawResult : Buffer.from(input.rawResult, "utf8");
  const rawStored = await putEvidenceObject(root, input.featureId, "review-result", rawBytes);
  const envelope = {
    schemaVersion: 1,
    featureId: input.featureId,
    batchId: input.batchId,
    jobId: input.jobId,
    role: input.role,
    packageSha256: input.packageSha256,
    capabilityHash: input.capabilityHash,
    executionRequestId: input.executionRequestId,
    leaseGeneration: input.leaseGeneration,
    ...input.declarationId ? { declarationId: input.declarationId } : {},
    source: input.source,
    host: input.host,
    ...input.hostEventId ? { hostEventId: input.hostEventId } : {},
    ...input.parentContext ? { parentContext: input.parentContext } : {},
    ...input.childContext ? { childContext: input.childContext } : {},
    ...input.agentId ? { agentId: input.agentId } : {},
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    rawResultSha256: rawStored.ref.sha256,
    ...input.parsedCompletion ? { parsedCompletionSha256: sha2563(Buffer.isBuffer(input.parsedCompletion) ? input.parsedCompletion : Buffer.from(input.parsedCompletion, "utf8")) } : {},
    rawResultRef: rawStored.ref
  };
  const envelopeStored = await putEvidenceObject(root, input.featureId, "review-result", Buffer.from(`${stableJson(envelope)}
`, "utf8"));
  parseReviewResultEnvelope(envelope);
  return { ref: envelopeStored.ref, envelope };
}
async function readHostReviewEnvelope(root, featureId, ref) {
  const bytes = await readEvidenceObject(root, featureId, ref);
  let envelope;
  try {
    envelope = parseReviewResultEnvelope(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    throw new DevFlowError("REVIEW_ENVELOPE_INVALID", "review result envelope is invalid", {
      featureId,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (envelope.featureId !== featureId) throw new DevFlowError("REVIEW_ENVELOPE_INVALID", "envelope featureId mismatch", { featureId });
  return envelope;
}
function executionDirectory(root, featureId) {
  return path13.join(root, ".dev-flow", "features", featureId, "review", "executions");
}
function executionIndexPath(root, featureId) {
  return path13.join(executionDirectory(root, featureId), "index.json");
}
async function readExecutionIndex(root, featureId) {
  try {
    const raw = await readFile11(executionIndexPath(root, featureId), "utf8");
    const value = JSON.parse(raw);
    if (!value || value.schemaVersion !== 1 || value.featureId !== featureId || !Array.isArray(value.entries)) {
      throw new TypeError("invalid review execution index");
    }
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: 1, featureId, entries: [] };
    throw error;
  }
}
async function writeExecutionIndex(root, featureId, index) {
  const directory = executionDirectory(root, featureId);
  await mkdir7(directory, { recursive: true });
  const target = executionIndexPath(root, featureId);
  const temporary = path13.join(directory, `.index.${randomUUID8()}.tmp`);
  const handle = await open7(temporary, "wx");
  try {
    await handle.writeFile(`${stableJson(index)}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename7(temporary, target);
}
async function writeReviewExecutionRecord(root, featureId, record) {
  const stored = await putEvidenceObject(root, featureId, "review-execution", Buffer.from(`${stableJson(record)}
`, "utf8"));
  return { ref: stored.ref, pointer: stored.pointer };
}
async function readReviewExecutionRecord(root, featureId, executionRequestId) {
  const index = await readExecutionIndex(root, featureId);
  const entry = index.entries.find((candidate) => candidate.executionRequestId === executionRequestId);
  if (!entry) throw new DevFlowError("REVIEW_EXECUTION_NOT_FOUND", "review execution record not found", { executionRequestId });
  const bytes = await readEvidenceObject(root, featureId, entry.ref);
  return parseReviewExecutionRecord(JSON.parse(bytes.toString("utf8")));
}
async function recordReviewCaptureRejection(root, input) {
  const featureId = input.featureId ?? (await readActive(root))?.featureId;
  if (!featureId) return;
  const state = await readState(root, featureId);
  await appendFeatureEvent(root, featureId, state.revision, "review-capture-rejected", {
    type: "review-capture-rejected",
    reason: input.reason,
    ...input.jobId ? { jobId: input.jobId } : {},
    ...input.declarationId ? { declarationId: input.declarationId } : {},
    ...input.executionRequestId ? { executionRequestId: input.executionRequestId } : {},
    ...input.hostEventId ? { hostEventId: input.hostEventId } : {},
    ...input.issues ? { issues: input.issues } : {},
    at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
async function recordCapturedEnvelope(root, featureId, executionRequestId, envelopeRef) {
  const index = await readExecutionIndex(root, featureId);
  const entry = index.entries.find((candidate) => candidate.executionRequestId === executionRequestId);
  if (!entry) throw new DevFlowError("REVIEW_EXECUTION_NOT_FOUND", "review execution record not found", { executionRequestId });
  const record = await readReviewExecutionRecord(root, featureId, executionRequestId);
  if (record.envelopes.some((ref) => ref.sha256 === envelopeRef.sha256 && ref.kind === envelopeRef.kind)) return;
  const updated = { ...record, envelopes: [...record.envelopes, envelopeRef] };
  const stored = await writeReviewExecutionRecord(root, featureId, updated);
  await writeExecutionIndex(root, featureId, {
    ...index,
    entries: index.entries.map((candidate) => candidate.executionRequestId === executionRequestId ? { ...candidate, ref: stored.ref } : candidate)
  });
}
async function reviewExecutionEvidenceRoots(root, featureId) {
  const index = await readExecutionIndex(root, featureId);
  const refs = [];
  for (const entry of index.entries) {
    if (refs.some((candidate) => candidate.kind === entry.ref.kind && candidate.sha256 === entry.ref.sha256)) continue;
    refs.push(entry.ref);
    const record = await readReviewExecutionRecord(root, featureId, entry.executionRequestId);
    for (const envelopeRef of record.envelopes) {
      if (!refs.some((candidate) => candidate.kind === envelopeRef.kind && candidate.sha256 === envelopeRef.sha256)) refs.push(envelopeRef);
      const envelope = await readHostReviewEnvelope(root, featureId, envelopeRef);
      if (!refs.some((candidate) => candidate.kind === envelope.rawResultRef.kind && candidate.sha256 === envelope.rawResultRef.sha256)) refs.push(envelope.rawResultRef);
    }
  }
  return refs;
}
var sha2563, leaseMilliseconds2;
var init_review_execution2 = __esm({
  "plugins/dev-flow/src/core/review-execution.ts"() {
    "use strict";
    init_stable_json();
    init_review_execution();
    init_review();
    init_evidence_store2();
    init_errors();
    init_review_store();
    init_review_jobs();
    init_state_store();
    init_obligations();
    sha2563 = (bytes) => createHash12("sha256").update(bytes).digest("hex");
    leaseMilliseconds2 = 60 * 60 * 1e3;
  }
});

// plugins/dev-flow/src/policy/plan-revision.ts
function isRecord11(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSha2565(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function stringArray(value, allowEmpty = false) {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every((item) => typeof item === "string" && item.length > 0);
}
function parseImplementationRuntimeProjection(value) {
  if (!isRecord11(value) || !Array.isArray(value.units) || !Array.isArray(value.recoveryArrangements)) {
    throw new TypeError("invalid implementation runtime projection");
  }
  const units = value.units.map((unit) => {
    if (!isRecord11(unit) || typeof unit.unitId !== "string" || !/^UNIT-[0-9]{3,}$/.test(unit.unitId) || !stringArray(unit.tasks) || !stringArray(unit.dependsOn, true) || !stringArray(unit.fileScope) || !stringArray(unit.forwardVerification)) {
      throw new TypeError("invalid implementation runtime projection unit");
    }
    return {
      unitId: unit.unitId,
      tasks: unit.tasks,
      dependsOn: unit.dependsOn,
      fileScope: unit.fileScope,
      forwardVerification: unit.forwardVerification
    };
  });
  const recoveryArrangements = value.recoveryArrangements.map((recovery) => {
    if (!isRecord11(recovery) || typeof recovery.arrangementId !== "string" || typeof recovery.stepRef !== "string" || !/^(?:UNIT|TASK)-[0-9]{3,}$/.test(recovery.stepRef) || recovery.recoveryKind !== "rollback" && recovery.recoveryKind !== "compensation" || typeof recovery.method !== "string" || !recovery.method.trim() || typeof recovery.riskRef !== "string" || !recovery.riskRef.trim()) {
      throw new TypeError("invalid implementation runtime projection recovery");
    }
    return {
      arrangementId: recovery.arrangementId,
      stepRef: recovery.stepRef,
      recoveryKind: recovery.recoveryKind,
      method: recovery.method,
      riskRef: recovery.riskRef
    };
  });
  return { units, recoveryArrangements };
}
function parsePlanRevisionProposal(value) {
  if (!isRecord11(value) || value.schemaVersion !== 1 || typeof value.featureId !== "string" || !value.featureId || !isRecord11(value.artifact) || typeof value.artifact.path !== "string" || !value.artifact.path || !isSha2565(value.artifact.rawSha256) || !isSha2565(value.artifact.semanticSha256) || !isRecord11(value.basis) || !Number.isInteger(value.basis.stateRevision) || !isSha2565(value.basis.currentTraceSha256) || !isSha2565(value.basis.requirementsArtifactSha256) || !isSha2565(value.basis.requirementsSemanticSha256) || !isSha2565(value.basis.requirementsSliceSha256) || !isSha2565(value.basis.projectConfigSha256) || value.basis.executionSemanticBasisHash !== void 0 && !isSha2565(value.basis.executionSemanticBasisHash) || !isRecord11(value.compiledTrace) || !isSha2565(value.compiledTrace.sha256) || !Number.isInteger(value.compiledTrace.size) || !isRecord11(value.impact) || !Array.isArray(value.impact.affectedUnits) || !Array.isArray(value.impact.redoUnits) || !Array.isArray(value.impact.sideEffectUnits) || !Array.isArray(value.impact.invalidatedPhases)) {
    throw new TypeError("invalid plan revision proposal");
  }
  return {
    schemaVersion: 1,
    featureId: value.featureId,
    artifact: {
      path: value.artifact.path,
      rawSha256: value.artifact.rawSha256,
      semanticSha256: value.artifact.semanticSha256
    },
    basis: {
      stateRevision: value.basis.stateRevision,
      currentTraceSha256: value.basis.currentTraceSha256,
      requirementsArtifactSha256: value.basis.requirementsArtifactSha256,
      requirementsSemanticSha256: value.basis.requirementsSemanticSha256,
      requirementsSliceSha256: value.basis.requirementsSliceSha256,
      projectConfigSha256: value.basis.projectConfigSha256,
      ...value.basis.executionSemanticBasisHash !== void 0 ? { executionSemanticBasisHash: value.basis.executionSemanticBasisHash } : {}
    },
    compiledTrace: parseEvidenceObjectRef(value.compiledTrace),
    implementationProjection: parseImplementationRuntimeProjection(value.implementationProjection),
    impact: {
      affectedUnits: value.impact.affectedUnits,
      redoUnits: value.impact.redoUnits,
      sideEffectUnits: value.impact.sideEffectUnits,
      invalidatedPhases: value.impact.invalidatedPhases
    }
  };
}
var init_plan_revision = __esm({
  "plugins/dev-flow/src/policy/plan-revision.ts"() {
    "use strict";
    init_evidence_store();
  }
});

// plugins/dev-flow/src/core/evidence-maintenance.ts
function addRef(refs, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  try {
    const parsed = parseEvidenceObjectRef(value);
    const key = `${parsed.kind}:${parsed.sha256}`;
    if (!refs.some((ref) => `${ref.kind}:${ref.sha256}` === key)) refs.push(parsed);
  } catch {
  }
}
function evidenceRootSet(state) {
  const refs = [];
  const archived = state.archivedCollections;
  if (archived) {
    addRef(refs, archived.workspaceLineage);
    addRef(refs, archived.interactionLedger);
    addRef(refs, archived.governanceLedger);
    addRef(refs, archived.verificationLedger);
    addRef(refs, archived.repairLedger);
  }
  for (const claim of state.governance?.claims ?? []) addRef(refs, claim.baselineRef);
  for (const authorization of state.governance?.authorizations ?? []) addRef(refs, authorization.baselineRef);
  for (const interaction of Object.values(state.interactions ?? {})) addRef(refs, interaction.planRevisionProposal);
  return refs;
}
async function collectEvidenceRootSet(root, featureId, state) {
  const refs = evidenceRootSet(state);
  const pushUnique = (ref) => {
    if (!ref) return;
    const key = `${ref.kind}:${ref.sha256}`;
    if (refs.some((candidate) => `${candidate.kind}:${candidate.sha256}` === key)) return;
    refs.push(ref);
  };
  for (const ref of await eventSegmentRootRefs(root, featureId)) pushUnique(ref);
  for (const ref of await checkpointManifestRootRefs(root, featureId)) pushUnique(ref);
  for (const ref of await reviewExecutionEvidenceRoots(root, featureId)) pushUnique(ref);
  for (const claim of state.governance?.claims ?? []) {
    if (!claim.baselineRef) continue;
    try {
      const manifestBytes = await readEvidenceObject(root, featureId, claim.baselineRef);
      const manifest = parseEvidenceBaselineManifest(JSON.parse(manifestBytes.toString("utf8")));
      pushUnique(manifest.snapshotRef);
    } catch {
    }
  }
  for (const authorization of state.governance?.authorizations ?? []) {
    if (!authorization.baselineRef) continue;
    try {
      const manifestBytes = await readEvidenceObject(root, featureId, authorization.baselineRef);
      const manifest = parseEvidenceBaselineManifest(JSON.parse(manifestBytes.toString("utf8")));
      pushUnique(manifest.snapshotRef);
    } catch {
    }
  }
  for (const interaction of Object.values(state.interactions ?? {})) {
    if (!interaction.planRevisionProposal) continue;
    try {
      const proposalBytes = await readEvidenceObject(root, featureId, interaction.planRevisionProposal);
      const proposal = parsePlanRevisionProposal(JSON.parse(proposalBytes.toString("utf8")));
      pushUnique(proposal.compiledTrace);
    } catch {
    }
  }
  return refs;
}
async function runBoundedEvidenceMaintenance(root, featureId, state, options = {}) {
  const roots = await collectEvidenceRootSet(root, featureId, state);
  const result = await collectEvidenceOrphans(root, featureId, roots, {
    packBudget: options.packBudget ?? DEFAULT_GC_PACK_BUDGET,
    byteBudget: options.byteBudget ?? DEFAULT_GC_BYTE_BUDGET
  });
  return { roots: roots.length, deletedPacks: result.deletedPacks, deletedFiles: result.deletedFiles, deletedBytes: result.deletedBytes };
}
var init_evidence_maintenance = __esm({
  "plugins/dev-flow/src/core/evidence-maintenance.ts"() {
    "use strict";
    init_evidence_store();
    init_evidence_store2();
    init_event_segments();
    init_checkpoint_store();
    init_review_execution2();
    init_evidence_baseline();
    init_plan_revision();
  }
});

// plugins/dev-flow/src/core/workspace-store.ts
import { lstat as lstat2, readFile as readFile12, readlink as readlink2 } from "node:fs/promises";
import path14 from "node:path";
import { createHash as createHash13 } from "node:crypto";
async function trustedWriteSummary(root, file) {
  const target = path14.join(root, file);
  try {
    const metadata = await lstat2(target);
    const bytes = metadata.isSymbolicLink() ? Buffer.from(await readlink2(target)) : await readFile12(target);
    return `${metadata.isSymbolicLink() ? "symlink" : "file"}:${createHash13("sha256").update(bytes).digest("hex")}`;
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
}
var init_workspace_store = __esm({
  "plugins/dev-flow/src/core/workspace-store.ts"() {
    "use strict";
  }
});

// plugins/dev-flow/src/core/git-reconciliation.ts
import { execFile as execFile2 } from "node:child_process";
import { createHash as createHash14 } from "node:crypto";
import { lstat as lstat3, readFile as readFile13 } from "node:fs/promises";
import path15 from "node:path";
import { promisify as promisify2 } from "node:util";
async function git(root, args, allowExitOne = false) {
  try {
    const result = await run("git", args, { cwd: root, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
    return Buffer.from(result.stdout).toString("utf8");
  } catch (error) {
    const failure = error;
    if (allowExitOne && failure.code === 1) return Buffer.from(failure.stdout ?? "").toString("utf8");
    throw new DevFlowError("GIT_LINEAGE_UNAVAILABLE", "\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D Git \u5DE5\u4F5C\u533A\u3002", {
      cause: Buffer.from(failure.stderr ?? failure.message ?? "").toString("utf8").trim() || "Git \u547D\u4EE4\u5931\u8D25\u3002",
      impact: "\u65E0\u6CD5\u786E\u5B9A feature \u7684\u57FA\u7EBF\u3001\u63D0\u4EA4\u5F52\u5C5E\u548C\u6700\u7EC8\u4EA4\u4ED8\u5185\u5BB9\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u68C0\u67E5 Git \u4ED3\u5E93\u548C\u5F53\u524D\u5206\u652F\u540E\uFF0C\u5237\u65B0\u72B6\u6001\uFF1B\u4E0D\u8981\u7EE7\u7EED finalize\u3002",
      retryOriginal: false,
      command: ["git", ...args].join(" ")
    });
  }
}
function normalizePath(value) {
  return normalizeProjectPath(normalizeUnicode(value).replaceAll("\\", "/"));
}
function builtInControlPath(value) {
  return value === ".git" || value.startsWith(".git/") || value === ".dev-flow" || value.startsWith(".dev-flow/") || value === "node_modules" || value.startsWith("node_modules/");
}
function statusKind(code) {
  if (code.includes("?") || code.includes("A")) return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code[0] !== " " && code[1] === " ") return "staged";
  return "unstaged";
}
async function contentHash(root, relative) {
  try {
    const metadata = await lstat3(path15.join(root, relative));
    if (!metadata.isFile()) return void 0;
    return createHash14("sha256").update(await readFile13(path15.join(root, relative))).digest("hex");
  } catch {
    return void 0;
  }
}
async function dirtyPaths(root, config) {
  const output = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...config.governedRoots]);
  const items = output.split("\0").filter(Boolean);
  const result = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.length < 4) continue;
    const code = item.slice(0, 2);
    const current = normalizePath(item.slice(3));
    if (builtInControlPath(current)) {
      if (code.includes("R")) index += 1;
      continue;
    }
    if (config.governedRootsExclude?.some((pattern) => current === pattern || current.startsWith(`${pattern}/`))) {
      if (code.includes("R")) index += 1;
      continue;
    }
    const entry = {
      status: statusKind(code),
      ...await contentHash(root, current) ? { sha256: await contentHash(root, current) } : {}
    };
    if (code.includes("R") && items[index + 1]) {
      entry.renamedFrom = normalizePath(items[index + 1]);
      index += 1;
    }
    result[current] = entry;
  }
  return result;
}
async function branchName(root) {
  return (await git(root, ["branch", "--show-current"])).trim();
}
async function head(root) {
  return (await git(root, ["rev-parse", "HEAD"])).trim();
}
async function fingerprint(root, config) {
  return fingerprintGovernedRoots(root, config);
}
async function pathFingerprints(root, config) {
  return Object.fromEntries((await snapshotGovernedRoots(root, config)).map((file) => [
    file.path,
    `${file.kind ?? "file"}:${file.sha256}:${file.mode}`
  ]));
}
async function captureObservedCommits(root, baseHead, observedHead) {
  if (!baseHead || !observedHead || baseHead === observedHead) return [];
  const output = await git(root, ["log", "--format=%H%x00%P", `${baseHead}..${observedHead}`]);
  const commits = [];
  for (const line of output.split("\n").filter(Boolean)) {
    const [hash2, parents = ""] = line.split("\0");
    if (!hash2) continue;
    const paths = await git(root, ["show", "--format=", "--name-only", "--pretty=", hash2]);
    commits.push({
      hash: hash2,
      parentHashes: parents.split(" ").filter(Boolean),
      changedPaths: paths.split("\n").map((value) => value.trim()).filter(Boolean).map(normalizePath).filter((file) => !builtInControlPath(file)),
      source: "unknown",
      observedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  return commits;
}
async function changedPathsBetween(root, baseHead, observedHead) {
  if (!baseHead || !observedHead || baseHead === observedHead) return [];
  const output = await git(root, ["diff", "--name-only", "-z", baseHead, observedHead]);
  return output.split("\0").filter(Boolean).map(normalizePath).filter((file) => !builtInControlPath(file)).sort();
}
async function gitBranchAndHead(root) {
  return { branch: await branchName(root), head: await head(root) };
}
async function reconcileWorkspaceLineage(root, lineage, config) {
  const current = await gitBranchAndHead(root);
  if (lineage.baseBranch && current.branch !== lineage.baseBranch) {
    throw new DevFlowError("GIT_BRANCH_CHANGED", "\u5F53\u524D\u5206\u652F\u5DF2\u5207\u6362\uFF0C\u4E0D\u80FD\u81EA\u52A8\u5047\u5B9A\u63D0\u4EA4\u5F52\u5C5E\u3002", {
      userMessage: "\u68C0\u6D4B\u5230\u5F53\u524D\u5206\u652F\u53D1\u751F\u53D8\u5316\uFF0C\u6D41\u7A0B\u5DF2\u5B89\u5168\u505C\u6B62\u3002",
      cause: `\u542F\u52A8\u5206\u652F\u4E3A ${lineage.baseBranch}\uFF0C\u5F53\u524D\u5206\u652F\u4E3A ${current.branch || "\u672A\u547D\u540D\u5206\u652F"}\u3002`,
      impact: "\u65E0\u6CD5\u8BC1\u660E\u5F53\u524D\u63D0\u4EA4\u5C5E\u4E8E\u539F feature\uFF0C\u5BA1\u67E5\u548C\u4EA4\u4ED8\u8BC1\u636E\u4FDD\u6301\u539F\u72B6\u3002",
      recoveryKind: "ask-user",
      recoveryInstruction: "\u5207\u56DE\u539F\u5206\u652F\u540E\u5237\u65B0\u72B6\u6001\uFF0C\u6216\u6682\u505C/\u7EC8\u6B62\u5F53\u524D feature\u3002",
      requiresUserDecision: true,
      retryOriginal: false,
      baseBranch: lineage.baseBranch,
      currentBranch: current.branch
    });
  }
  if (lineage.baseHead && !await isAncestor(root, lineage.baseHead, current.head)) {
    throw new DevFlowError("GIT_HISTORY_REWRITE", "\u5F53\u524D HEAD \u4E0D\u662F\u542F\u52A8\u57FA\u7EBF\u7684\u540E\u4EE3\u3002", {
      userMessage: "\u68C0\u6D4B\u5230 Git \u5386\u53F2\u65E0\u6CD5\u8BC1\u660E\u8FDE\u7EED\uFF0C\u6D41\u7A0B\u5DF2\u5B89\u5168\u505C\u6B62\u3002",
      cause: "\u542F\u52A8\u57FA\u7EBF\u4E0D\u662F\u5F53\u524D HEAD \u7684\u7956\u5148\u3002",
      impact: "\u4EA4\u4ED8\u5185\u5BB9\u548C\u5BA1\u67E5\u8BC1\u636E\u7684\u63D0\u4EA4\u5F52\u5C5E\u4E0D\u786E\u5B9A\uFF0C\u4E0D\u80FD\u4F2A\u88C5\u6210\u529F\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u6062\u590D\u53EF\u8BC1\u660E\u7684\u63D0\u4EA4\u94FE\u540E\u5237\u65B0\u72B6\u6001\uFF0C\u6216\u6682\u505C/\u7EC8\u6B62\u5F53\u524D feature\u3002",
      retryOriginal: false,
      baseHead: lineage.baseHead,
      currentHead: current.head
    });
  }
  const observedCommits = await captureObservedCommits(root, lineage.baseHead, current.head);
  const knownCommits = new Set(lineage.observedCommits.map((commit) => commit.hash));
  return {
    ...lineage,
    observedHead: current.head,
    observedCommits: [...lineage.observedCommits, ...observedCommits.filter((commit) => !knownCommits.has(commit.hash))],
    observedPathFingerprints: await pathFingerprints(root, config),
    lastWorkspaceFingerprint: await fingerprint(root, config),
    reconciliationStatus: "current"
  };
}
async function isAncestor(root, ancestor, descendant) {
  if (!ancestor || !descendant) return false;
  try {
    await git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    const failure = error;
    if (failure.code === 1) return false;
    throw error;
  }
}
async function reconcileWorkspaceForFeature(root, state, config) {
  const previouslyObservedHead = state.workspace.observedHead;
  let workspace = await reconcileWorkspaceLineage(root, state.workspace, config);
  const committedPaths = await changedPathsBetween(root, previouslyObservedHead, workspace.observedHead);
  const ownership = { ...workspace.ownership };
  const ownershipSource = { ...workspace.ownershipSource };
  for (const file of committedPaths) {
    if (state.scope.outOfScope.some((entry) => entry === "." || file === entry || file.startsWith(`${entry}/`))) {
      ownership[file] = "excluded";
    }
  }
  workspace = { ...workspace, ownership, ownershipSource };
  const dirty = Object.keys(await dirtyPaths(root, config));
  const previousPaths = state.workspace.observedPathFingerprints ?? {};
  const currentPaths = workspace.observedPathFingerprints;
  const candidates = /* @__PURE__ */ new Set([...Object.keys(previousPaths), ...Object.keys(currentPaths), ...committedPaths, ...dirty]);
  const knownUnowned = /* @__PURE__ */ new Set([
    ...state.workspace.unownedPaths ?? [],
    ...Object.keys(state.workspace.startedDirty).filter((file) => state.workspace.ownership[file] === void 0)
  ]);
  const changedPaths2 = [...candidates].filter(
    (file) => previousPaths[file] !== currentPaths[file] || knownUnowned.has(file)
  ).sort();
  const unownedPaths = [.../* @__PURE__ */ new Set([...state.workspace.unownedPaths ?? [], ...changedPaths2])].filter((file) => workspace.ownership[file] === void 0).sort();
  return {
    workspace: { ...workspace, unownedPaths },
    contentChanged: changedPaths2.length > 0,
    changedPaths: changedPaths2
  };
}
var run;
var init_git_reconciliation = __esm({
  "plugins/dev-flow/src/core/git-reconciliation.ts"() {
    "use strict";
    init_errors();
    init_path_normalization();
    init_fingerprint();
    run = promisify2(execFile2);
  }
});

// plugins/dev-flow/src/core/approval.ts
var init_approval = __esm({
  "plugins/dev-flow/src/core/approval.ts"() {
    "use strict";
    init_user_interactions();
  }
});

// plugins/dev-flow/src/core/decision-interactions.ts
function pendingInteraction(state) {
  return Object.values(state.interactions ?? {}).find((value) => value.status === "pending");
}
function rejectLegacyGrill() {
  throw new DevFlowError("GRILL_INTERACTION_RESTART_REQUIRED", "legacy grill state has no explicit recommendation", {
    userMessage: "\u8FD9\u4E2A grill \u95EE\u9898\u6765\u81EA\u65E7\u7248\u4EA4\u4E92\u5408\u540C\uFF0C\u4E0D\u80FD\u53EF\u9760\u7EE7\u7EED\u3002",
    recoveryKind: "repair",
    recoveryInstruction: "\u653E\u5F03\u53D7\u5F71\u54CD\u7684 feature\uFF0C\u518D\u7528\u5F53\u524D\u7248\u672C\u91CD\u65B0\u63D0\u51FA\u8BE5 grill \u95EE\u9898\u3002",
    retryOriginal: false
  });
}
function pendingDecisionForState(state) {
  const interaction = pendingInteraction(state);
  if (interaction) {
    if (interaction.kind === "grill" && !interaction.recommendation) rejectLegacyGrill();
    const grillPresentation = interaction.kind === "grill" && interaction.recommendation ? buildGrillPresentation({ question: interaction.question ?? "", options: interaction.options, recommendation: interaction.recommendation }) : void 0;
    return {
      kind: interaction.kind === "risk-acceptance" ? "review-risk" : interaction.kind,
      question: interaction.question ?? "\u8BF7\u9009\u62E9\u4E00\u4E2A\u65B9\u6848\u3002",
      options: grillPresentation ? grillPresentation.options.map((option) => ({ ...option })) : interaction.options.map((option, index) => ({ ...option, recommended: index === 0 })),
      ...grillPresentation ? {
        recommendation: { ...grillPresentation.recommendation },
        presentation: grillPresentation.text
      } : {},
      basisHash: interaction.basisHash,
      presentedAt: interaction.presentedAt,
      presentedRevision: interaction.presentedRevision ?? state.pendingDecision?.presentedRevision ?? state.revision,
      source: "core",
      target: interaction.target,
      ...interaction.presentationEventId ? { presentationEventId: interaction.presentationEventId } : {}
    };
  }
  if (state.pendingDecision?.kind === "grill") rejectLegacyGrill();
  return state.pendingDecision;
}
var init_decision_interactions = __esm({
  "plugins/dev-flow/src/core/decision-interactions.ts"() {
    "use strict";
    init_approval();
    init_decision_language();
    init_errors();
    init_grill_interaction();
    init_user_interactions();
  }
});

// plugins/dev-flow/src/core/host-health.ts
import { mkdir as mkdir8, open as open8, readFile as readFile14 } from "node:fs/promises";
import path16 from "node:path";
async function readHostHealth(root) {
  try {
    const raw = await readFile14(hostHealthPath(root), "utf8");
    return raw.split("\n").filter(Boolean).flatMap((line) => {
      try {
        const signal = JSON.parse(line);
        return (signal.host === "claude" || signal.host === "codex") && typeof signal.kind === "string" && typeof signal.eventId === "string" && typeof signal.at === "string" ? [{
          ...signal,
          ...signal.adapterVersion !== void 0 ? { adapterVersion: String(signal.adapterVersion) } : {},
          ...Array.isArray(signal.capabilities) ? { capabilities: signal.capabilities.filter((value) => typeof value === "string") } : {}
        }] : [];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function recordHostHealth(root, signal) {
  const before = await readHostHealth(root);
  const latest = [...before].reverse().find((entry) => entry.host === signal.host);
  const now = signal.at ?? (/* @__PURE__ */ new Date()).toISOString();
  await mkdir8(path16.dirname(hostHealthPath(root)), { recursive: true });
  const handle = await open8(hostHealthPath(root), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ ...signal, at: now })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { recovered: Boolean(latest && Date.parse(now) - Date.parse(latest.at) > healthWindowMs), latest };
}
async function assertHostHealth(root, host, operation) {
  const latest = [...await readHostHealth(root)].reverse().find((signal) => signal.host === host);
  const ageMs = latest ? Date.now() - Date.parse(latest.at) : Number.POSITIVE_INFINITY;
  if (!latest) {
    throw new DevFlowError("HOOK_HEALTH_REQUIRED", `${host} hook health is required before ${operation}`, {
      userMessage: `\u5F00\u59CB${operation}\u524D\u6CA1\u6709\u53D1\u73B0 ${host} \u5BBF\u4E3B\u7684\u53EF\u4FE1 hook \u5065\u5EB7\u4FE1\u53F7\u3002`,
      cause: "\u5BBF\u4E3B\u63A5\u7EBF\u5C1A\u672A\u8BC1\u660E\u5F53\u524D\u4F1A\u8BDD\u80FD\u591F\u6355\u83B7\u7528\u6237\u56DE\u5408\u548C\u5199\u5165\u5F52\u5C5E\u3002",
      impact: "\u64CD\u4F5C\u6CA1\u6709\u6539\u53D8 feature\u3001ownership \u6216\u8BC1\u636E\u72B6\u6001\u3002",
      recoveryKind: "refresh",
      recoveryInstruction: `\u786E\u8BA4 ${host} manifest\u3001MCP \u4E0E hook \u5DF2\u5171\u540C\u5B89\u88C5\uFF0C\u91CD\u65B0\u5F00\u542F\u5BBF\u4E3B\u4F1A\u8BDD\u540E\u91CD\u8BD5\u3002`,
      retryOriginal: true,
      host,
      operation
    });
  }
  if (!Number.isFinite(ageMs) || ageMs > healthWindowMs) {
    throw new DevFlowError("HOOK_HEALTH_STALE", `${host} hook health is stale before ${operation}`, {
      userMessage: `${host} \u5BBF\u4E3B hook \u7684\u6700\u8FD1\u53EF\u4FE1\u4FE1\u53F7\u5DF2\u8FC7\u671F\uFF0C\u5DF2\u5B89\u5168\u6682\u505C\u5F53\u524D\u64CD\u4F5C\u3002`,
      cause: `\u6700\u8FD1\u4FE1\u53F7\u8DDD\u73B0\u5728\u7EA6 ${Math.round(ageMs / 6e4)} \u5206\u949F\uFF0C\u8D85\u8FC7 15 \u5206\u949F\u5065\u5EB7\u7A97\u53E3\u3002`,
      impact: "\u64CD\u4F5C\u6CA1\u6709\u6539\u53D8 feature\u3001ownership \u6216\u8BC1\u636E\u72B6\u6001\u3002",
      recoveryKind: "refresh",
      recoveryInstruction: `\u6062\u590D ${host} hook \u5E76\u91CD\u65B0\u5F00\u542F\u4F1A\u8BDD\u540E\u91CD\u8BD5\u539F\u64CD\u4F5C\uFF1B\u82E5\u53D1\u73B0\u672A\u77E5\u8DEF\u5F84\uFF0C\u518D\u8C03\u7528 dev_flow_reconcile_workspace\u3002`,
      retryOriginal: true,
      host,
      operation,
      latestAt: latest.at
    });
  }
  return latest;
}
var healthWindowMs, hostHealthPath;
var init_host_health = __esm({
  "plugins/dev-flow/src/core/host-health.ts"() {
    "use strict";
    init_errors();
    healthWindowMs = 15 * 60 * 1e3;
    hostHealthPath = (root) => path16.join(root, ".dev-flow", "host-health.jsonl");
  }
});

// plugins/dev-flow/src/core/project-config-impact.ts
var init_project_config_impact = __esm({
  "plugins/dev-flow/src/core/project-config-impact.ts"() {
    "use strict";
    init_traceability_store();
    init_checkpoint_store();
  }
});

// plugins/dev-flow/src/core/requirements-grill.ts
import { readFile as readFile15 } from "node:fs/promises";
import path17 from "node:path";
function openQuestionItems(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => OPEN_QUESTION_HEADING.test(line.trim()));
  if (start < 0) return [];
  const items = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s/.test(line) || /^<!-- dev-flow:/.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(?:[-*]\s+|(?:\d+[.)]\s+))(.*)$/);
    if (!match) continue;
    const item = match[1].trim();
    if (!item || EMPTY_OPEN_QUESTION_MARKERS.has(item)) continue;
    items.push(item);
  }
  return items;
}
async function openQuestionsAdvisory(root, state) {
  if (state.mode !== "routed" || state.route !== "m" && state.route !== "l") return void 0;
  const artifact = state.artifacts.requirements;
  if (!artifact) return void 0;
  try {
    const pendingGrill = Object.values(state.interactions ?? {}).some((value) => {
      const interaction = value;
      return interaction.kind === "grill" && interaction.status === "pending";
    });
    if (!pendingGrill) {
      const decision = pendingDecisionForState(state);
      if (decision?.kind === "grill") return void 0;
    }
    const contents = await readFile15(
      path17.join(root, ".dev-flow", "features", state.featureId, normalizeUnicode(artifact.path)),
      "utf8"
    );
    const items = openQuestionItems(contents);
    return items.length ? { code: "OPEN_QUESTIONS_UNCONVERGED", items } : void 0;
  } catch {
    return void 0;
  }
}
var EMPTY_OPEN_QUESTION_MARKERS, OPEN_QUESTION_HEADING;
var init_requirements_grill = __esm({
  "plugins/dev-flow/src/core/requirements-grill.ts"() {
    "use strict";
    init_artifacts();
    init_errors();
    init_state_store();
    init_obligations();
    init_decision_interactions();
    init_governance_records();
    init_path_normalization();
    init_user_interactions();
    EMPTY_OPEN_QUESTION_MARKERS = /* @__PURE__ */ new Set(["\u65E0", "\u65E0\u3002", "\u6682\u65E0", "\u6682\u65E0\u3002", "\u6CA1\u6709", "\u6CA1\u6709\u3002", "n/a", "N/A", "na", "-", "\u2014"]);
    OPEN_QUESTION_HEADING = /^##\s*开放问题\s*$/;
  }
});

// plugins/dev-flow/src/core/evidence-snapshot-store.ts
import { mkdir as mkdir9, readFile as readFile16, writeFile as writeFile3 } from "node:fs/promises";
import path18 from "node:path";
function featureDirectory3(root, id) {
  return path18.join(root, ".dev-flow", "features", id);
}
async function readEvidenceSnapshot(root, id, snapshotPath) {
  const raw = await readFile16(path18.join(featureDirectory3(root, id), snapshotPath), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new TypeError("evidence snapshot must be an array");
  return parsed;
}
var init_evidence_snapshot_store = __esm({
  "plugins/dev-flow/src/core/evidence-snapshot-store.ts"() {
    "use strict";
  }
});

// plugins/dev-flow/src/core/change-invalidation.ts
async function baselineForRecord(root, state, kind, recordId, baselineRef, aggregateFingerprint) {
  if (!baselineRef || typeof baselineRef !== "object" || baselineRef === null || Array.isArray(baselineRef)) {
    return aggregateFingerprint ? { recordId, kind, fingerprint: aggregateFingerprint } : void 0;
  }
  const ref = baselineRef;
  if (typeof ref.sha256 !== "string") return aggregateFingerprint ? { recordId, kind, fingerprint: aggregateFingerprint } : void 0;
  try {
    const manifestBytes = await readEvidenceObject(root, state.featureId, ref);
    const manifest = parseEvidenceBaselineManifest(JSON.parse(manifestBytes.toString("utf8")));
    const snapshotBytes = await readEvidenceObject(root, state.featureId, manifest.snapshotRef);
    const snapshot = parseWorkspaceSnapshotManifest(JSON.parse(snapshotBytes.toString("utf8")));
    return {
      recordId,
      kind,
      fingerprint: manifest.contentFingerprint,
      snapshotFiles: snapshot.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        mode: file.mode,
        kind: file.kind,
        ...file.linkTarget !== void 0 ? { linkTarget: file.linkTarget } : {}
      }))
    };
  } catch {
    return aggregateFingerprint ? { recordId, kind, fingerprint: aggregateFingerprint } : void 0;
  }
}
async function contentBoundBaselines(root, state) {
  const records = [];
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  for (const claim of state.governance?.claims ?? []) {
    if (claim.supersededBy !== void 0) continue;
    if (claim.claimType !== "review-complete" && claim.claimType !== "verification-current") continue;
    const basis = claim.basis?.kind === "content" ? claim.basis.sha256 : void 0;
    if (basis === void 0) continue;
    const live = claim.claimType === "review-complete" ? state.steps.code_review?.evidence?.fingerprint === basis : state.verification.verifiedFingerprint === basis;
    if (!live) continue;
    const record = await baselineForRecord(root, state, "claim", claim.recordId, claim.baselineRef, basis);
    if (record) records.push(record);
  }
  for (const authorization of state.governance?.authorizations ?? []) {
    if (authorization.supersededBy !== void 0) continue;
    if (authorization.authorizationType !== "risk-acceptance") continue;
    const basis = authorization.basis?.kind === "content" ? authorization.basis.sha256 : void 0;
    if (basis === void 0) continue;
    if (Number.isFinite(invalidatedAt) && authorization.recordedAt && Date.parse(authorization.recordedAt) < invalidatedAt) continue;
    const record = await baselineForRecord(root, state, "authorization", authorization.recordId, authorization.baselineRef, basis);
    if (record) records.push(record);
  }
  if (records.length > 0) return records;
  const verificationEvidence = state.steps.verification?.evidence;
  if (state.verification.verifiedFingerprint) {
    return [{ recordId: "", kind: "legacy", fingerprint: state.verification.verifiedFingerprint, snapshotPath: verificationEvidence?.snapshotPath }];
  }
  const reviewEvidence = state.steps.code_review?.evidence;
  if (typeof reviewEvidence?.fingerprint === "string") {
    return [{ recordId: "", kind: "legacy", fingerprint: reviewEvidence.fingerprint, snapshotPath: reviewEvidence.snapshotPath }];
  }
  const accepted = (state.governance?.authorizations ?? []).find((authorization) => authorization.authorizationType === "risk-acceptance" && authorization.supersededBy === void 0 && authorization.basis?.kind === "content" && (!Number.isFinite(invalidatedAt) || !authorization.recordedAt || Date.parse(authorization.recordedAt) >= invalidatedAt));
  if (accepted?.basis?.kind !== "content") return [];
  return baselineForRecord(root, state, "authorization", accepted.recordId, accepted.baselineRef, accepted.basis.sha256).then((record) => record ? [record] : []);
}
function changedPaths(before, after) {
  const beforeMap = new Map(before.map((file) => [file.path, file]));
  const afterMap = new Map(after.map((file) => [file.path, file]));
  const changed = /* @__PURE__ */ new Set();
  for (const [filePath, beforeFile] of beforeMap) {
    const afterFile = afterMap.get(filePath);
    if (!afterFile) changed.add(filePath);
    else if (afterFile.sha256 !== beforeFile.sha256 || afterFile.mode !== beforeFile.mode) changed.add(filePath);
  }
  for (const [filePath] of afterMap) {
    if (!beforeMap.has(filePath)) changed.add(filePath);
  }
  return [...changed].sort();
}
async function invalidateAffectedClaims(root, id, expectedRevision) {
  const state = await readState(root, id);
  if (state.lifecycle !== "active") return void 0;
  const baselines = await contentBoundBaselines(root, state);
  if (!baselines.length) return void 0;
  const config = await readProjectConfig(root);
  const current = await fingerprintFeatureOwned(root, config, state.workspace.ownership);
  let changedFiles;
  let afterFiles;
  const hasSnapshot = baselines.some((baseline) => Boolean(baseline.snapshotFiles || baseline.snapshotPath));
  const unionChanged = /* @__PURE__ */ new Set();
  let anyPerRecordFingerprintMismatch = false;
  for (const baseline of baselines) {
    let recordChanged;
    if (baseline.snapshotFiles) {
      afterFiles ??= (await snapshotGovernedRoots(root, config)).filter((file) => state.workspace.ownership[file.path] !== "excluded");
      recordChanged = changedPaths(
        baseline.snapshotFiles.filter((file) => state.workspace.ownership[file.path] !== "excluded"),
        afterFiles
      );
      if (featureOwnedSnapshotHash(afterFiles, state.workspace.ownership) !== baseline.fingerprint) anyPerRecordFingerprintMismatch = true;
    } else if (baseline.snapshotPath) {
      try {
        const before = (await readEvidenceSnapshot(root, id, baseline.snapshotPath)).filter((file) => state.workspace.ownership[file.path] !== "excluded");
        afterFiles ??= (await snapshotGovernedRoots(root, config)).filter((file) => state.workspace.ownership[file.path] !== "excluded");
        recordChanged = changedPaths(before, afterFiles);
      } catch {
        recordChanged = void 0;
      }
    }
    if (recordChanged === void 0) {
      changedFiles = void 0;
      break;
    }
    for (const file of recordChanged) unionChanged.add(file);
  }
  changedFiles = unionChanged.size > 0 ? [...unionChanged].sort() : [];
  const unownedDeliveryChange = changedFiles?.some((file) => state.workspace.ownership[file] === void 0) ?? true;
  const invalidatedAt = state.lastInvalidation?.at ? Date.parse(state.lastInvalidation.at) : Number.NaN;
  const fullDrift = hasSnapshot ? unownedDeliveryChange : true;
  const firstBaseline = baselines[0];
  const comparableCurrent = firstBaseline.snapshotFiles && afterFiles ? featureOwnedSnapshotHash(afterFiles, state.workspace.ownership) : current;
  const recordMismatch = anyPerRecordFingerprintMismatch || baselines.some((baseline) => baseline.fingerprint !== comparableCurrent);
  if (!recordMismatch && !fullDrift) return void 0;
  const reviewEvidence = state.steps.code_review?.evidence;
  const reviewReopened = state.steps.code_review !== void 0 && (fullDrift || typeof reviewEvidence?.fingerprint !== "string" || reviewEvidence.fingerprint !== current);
  const verificationReopened = state.verification.verifiedFingerprint !== void 0 && (fullDrift || state.verification.verifiedFingerprint !== current);
  const liveAuthorizations = (state.governance?.authorizations ?? []).filter((authorization) => authorization.authorizationType === "risk-acceptance" && authorization.supersededBy === void 0 && authorization.basis?.kind === "content" && (!Number.isFinite(invalidatedAt) || !authorization.recordedAt || Date.parse(authorization.recordedAt) >= invalidatedAt));
  const authorizationBound = liveAuthorizations.some((authorization) => {
    const basis = authorization.basis;
    return basis?.kind === "content" && basis.sha256 !== current;
  });
  let exceptionBound = authorizationBound;
  if (!hasSnapshot) {
    changedFiles = void 0;
    exceptionBound = true;
  }
  if ((changedFiles?.length ?? 0) > 0 && liveAuthorizations.length > 0) {
    exceptionBound = true;
  }
  const checkpointed = (state.implementationUnits ?? []).filter((unit) => unit.status === "checkpointed");
  let reopenedUnits = [];
  let fallback = false;
  let reason = "";
  if (!changedFiles) {
    reopenedUnits = checkpointed.map((unit) => unit.unitId);
    fallback = reopenedUnits.length > 0;
    reason = reopenedUnits.length ? "\u65E0\u6CD5\u5B9A\u4F4D\u53D8\u5316\u5F71\u54CD\uFF1A\u7F3A\u5C11\u9010\u6587\u4EF6\u57FA\u51C6\u5FEB\u7167\uFF0C\u56DE\u9000\u5230\u5B8C\u6574\u5B9E\u73B0\u91CD\u505A" : "\u65E0\u5B9E\u73B0\u5355\u5143\u8BB0\u5F55\uFF0C\u8DF3\u8FC7\u5355\u5143\u91CD\u5F00";
  } else if (changedFiles.length > 0) {
    const matched = /* @__PURE__ */ new Set();
    for (const unit of checkpointed) {
      const manifest = await readCheckpointManifest(root, id, unit.checkpointId);
      const unitFiles = new Set(manifest.files.map((record) => record.path));
      if (changedFiles.some((file) => unitFiles.has(file))) matched.add(unit.unitId);
    }
    reopenedUnits = [...matched].sort();
    if (reopenedUnits.length === 0) {
      reopenedUnits = checkpointed.map((unit) => unit.unitId);
      fallback = reopenedUnits.length > 0;
      reason = reopenedUnits.length ? "\u65E0\u6CD5\u5B9A\u4F4D\u53D8\u5316\u5F71\u54CD\uFF1A\u53D8\u5316\u6587\u4EF6\u672A\u547D\u4E2D\u4EFB\u4F55\u5B9E\u73B0\u5355\u5143\u7684\u5B9E\u9645\u5199\u5165\u8303\u56F4\uFF0C\u56DE\u9000\u5230\u5B8C\u6574\u5B9E\u73B0\u91CD\u505A" : "\u53D8\u5316\u672A\u547D\u4E2D\u4EFB\u4F55\u5B9E\u73B0\u5355\u5143";
    } else {
      reason = "\u53D7\u5F71\u54CD\u5B9E\u73B0\u5355\u5143\u5DF2\u91CD\u5F00";
    }
  } else {
    reason = "\u65E0\u6587\u4EF6\u7EA7\u53D8\u5316\uFF08\u4EC5\u5143\u6570\u636E\u6F02\u79FB\uFF09\uFF0C\u8DF3\u8FC7\u5355\u5143\u91CD\u5F00";
  }
  if (reopenedUnits.length === 0 && !reviewReopened && !verificationReopened && !exceptionBound) return void 0;
  const invalidated = {
    changedFiles,
    reopenedUnits,
    reviewReopened,
    verificationReopened,
    fallback,
    reason
  };
  await mutate(root, id, expectedRevision, "claims-invalidated", (draft) => {
    for (const unitId of reopenedUnits) {
      const unit = (draft.implementationUnits ?? []).find((candidate) => candidate.unitId === unitId);
      if (!unit || unit.status !== "checkpointed") continue;
      reopenImplementationUnit(unit);
    }
    const liveReview = draft.steps.code_review?.evidence;
    if (draft.steps.code_review !== void 0 && (fullDrift || typeof liveReview?.fingerprint !== "string" || liveReview.fingerprint !== current)) {
      delete draft.steps.code_review;
    }
    if (verificationReopened) {
      delete draft.verification.satisfiedByAttemptId;
      delete draft.verification.verifiedFingerprint;
      draft.steps.verification = { status: "pending", evidence: { reason: "governed-files-changed", current } };
    }
    if (reopenedUnits.length > 0) delete draft.steps.implementation;
    if (draft.acceptance) {
      draft.acceptance.dispositions = draft.acceptance.dispositions.map((disposition) => ({
        ...disposition,
        status: "stale"
      }));
    }
    draft.logicComplete = false;
    delete draft.steps.finalize;
    draft.lastInvalidation = {
      at: (/* @__PURE__ */ new Date()).toISOString(),
      ...changedFiles ? { changedFiles } : {},
      reopenedUnits,
      reviewReopened,
      verificationReopened,
      fallback,
      reason
    };
    draft.lastUpdatedBy = { host: state.lastUpdatedBy.host, pluginVersion: "6.0.1" };
  }, { changedFiles, reopenedUnits, reviewReopened, verificationReopened, fallback, reason });
  return invalidated;
}
var init_change_invalidation = __esm({
  "plugins/dev-flow/src/core/change-invalidation.ts"() {
    "use strict";
    init_fingerprint();
    init_errors();
    init_state_store();
    init_checkpoint_store();
    init_evidence_snapshot_store();
    init_evidence_store2();
    init_evidence_baseline2();
    init_evidence_baseline();
    init_evidence_store();
    init_rollback();
  }
});

// plugins/dev-flow/src/core/ownership-workflow.ts
import { createHash as createHash15, randomUUID as randomUUID9 } from "node:crypto";
function unknownOwnershipPaths(state) {
  const candidates = new Set(state.workspace.unownedPaths ?? Object.keys(state.workspace.startedDirty));
  return [...candidates].filter((file) => state.workspace.ownership[file] === void 0).sort();
}
function workspaceOwnershipQuestion(paths, single) {
  if (single) return `\u8DEF\u5F84\u201C${paths[0]}\u201D\u662F\u5426\u5C5E\u4E8E\u5F53\u524D\u4EFB\u52A1\uFF1F`;
  return `\u53D1\u73B0 ${paths.length} \u4E2A\u65E0\u6CD5\u5F52\u5C5E\u7684\u5DE5\u4F5C\u533A\u8DEF\u5F84\uFF1A
${paths.map((file) => `- ${file}`).join("\n")}
\u8BF7\u9009\u62E9\u5904\u7406\u65B9\u5F0F\u3002`;
}
function presentWorkspaceOwnership(state, paths, options = {}) {
  const currentPaths = [...new Set(paths)].sort();
  const batchPaths = [...new Set(options.batchPaths ?? currentPaths)].sort();
  const single = options.single ?? currentPaths.length === 1;
  const presentationEventId = options.presentationEventId ?? randomUUID9();
  const basisHash2 = createHash15("sha256").update(JSON.stringify({ kind: "workspace-ownership", paths: batchPaths, fingerprint: state.workspace.lastWorkspaceFingerprint })).digest("hex");
  const interaction = createInteraction(state, {
    kind: "workspace-ownership",
    target: `workspace:${createHash15("sha256").update(batchPaths.join("\n")).digest("hex").slice(0, 16)}:${currentPaths[0] ?? "batch"}`,
    basisHash: basisHash2,
    question: workspaceOwnershipQuestion(currentPaths, single),
    options: single ? [
      { id: "adopt", label: "\u7EB3\u5165\u5F53\u524D\u4EFB\u52A1" },
      { id: "exclude", label: "\u6392\u9664\u5E76\u5148\u5904\u7406" }
    ] : [
      { id: "adopt-all", label: "\u5168\u90E8\u7EB3\u5165\u5F53\u524D\u4EFB\u52A1" },
      { id: "exclude-all", label: "\u5168\u90E8\u6392\u9664\u5E76\u5148\u5904\u7406" },
      { id: "one-by-one", label: "\u9010\u4E2A\u786E\u8BA4" }
    ],
    presentationEventId,
    workspacePaths: currentPaths,
    workspaceBatchPaths: batchPaths,
    ...options.remainingPaths ? { workspaceRemainingPaths: [...options.remainingPaths] } : {}
  });
  return { interaction, presentationEventId };
}
async function reconcileWorkspace(root, id, expectedRevision, host) {
  await invalidateAffectedClaims(root, id, expectedRevision);
  const state = await readState(root, id);
  const config = await readProjectConfig(root);
  const { workspace, contentChanged, changedPaths: changedPaths2 } = await reconcileWorkspaceForFeature(root, state, config);
  const legalCheckpointPaths = contentChanged ? await legalActiveUnitChanges(root, state, changedPaths2) : /* @__PURE__ */ new Set();
  const active = state.lifecycle === "finalized" && contentChanged ? await readActive(root) : void 0;
  const reopenedLifecycle = state.lifecycle === "finalized" && contentChanged ? !active || active.featureId === id ? "active" : "paused" : void 0;
  const checkpointAffected = contentChanged ? checkpointAffectedByPaths(state, changedPaths2, legalCheckpointPaths) : false;
  let presentationEventId;
  return mutate(root, id, state.revision, "workspace-reconciled", (draft) => {
    draft.workspace = workspace;
    if (contentChanged) markAffectedEvidenceStale(draft, changedPaths2, reopenedLifecycle, legalCheckpointPaths);
    presentationEventId = queueNextOwnershipDecision(draft);
    draft.lastUpdatedBy = { host, pluginVersion: "6.0.1" };
  }, () => ({
    observedHead: workspace.observedHead,
    commitCount: workspace.observedCommits.length,
    contentChanged,
    checkpointAffected,
    reopenedLifecycle,
    unresolvedOwnership: changedPaths2.filter((file) => workspace.ownership[file] === void 0),
    ...presentationEventId ? { presentationEventId } : {}
  }));
}
function queueNextOwnershipDecision(draft) {
  if (pendingDecisionForState(draft)) return void 0;
  const paths = unknownOwnershipPaths(draft);
  if (!paths.length) return void 0;
  return presentWorkspaceOwnership(draft, paths).presentationEventId;
}
function markAffectedEvidenceStale(draft, changedPaths2, reopenedLifecycle, legalCheckpointPaths = /* @__PURE__ */ new Set()) {
  const checkpointAffected = checkpointAffectedByPaths(draft, changedPaths2, legalCheckpointPaths);
  draft.evidenceFreshness = {
    ...draft.evidenceFreshness,
    verification: draft.verification.satisfiedByAttemptId !== void 0 ? "stale" : draft.evidenceFreshness.verification,
    checkpoint: checkpointAffected ? "stale" : draft.evidenceFreshness.checkpoint,
    implementation: "current"
  };
  if (checkpointAffected) {
    delete draft.steps.implementation;
    delete draft.steps.code_review;
    delete draft.steps.verification;
    delete draft.steps.finalize;
  } else if (draft.steps.verification?.status === "satisfied" || draft.steps.finalize?.status === "satisfied") {
    delete draft.steps.verification;
    delete draft.steps.finalize;
  }
  draft.logicComplete = false;
  if (reopenedLifecycle) {
    draft.lifecycle = reopenedLifecycle;
    delete draft.deliverySnapshot;
    const openStep = currentOpenStep(draft) ?? "\u5F53\u524D\u9636\u6BB5";
    draft.resumeSummary = reopenedLifecycle === "active" ? `\u5DF2\u64A4\u9500\u8FC7\u671F\u7684\u5B8C\u6210\u58F0\u660E\uFF0C\u4ECE\u201C${openStep}\u201D\u7EE7\u7EED\u3002` : `\u5B8C\u6210\u540E\u68C0\u6D4B\u5230\u771F\u5B9E\u5185\u5BB9\u6F02\u79FB\uFF1B\u53E6\u4E00\u4E2A feature \u6B63\u5728\u8FDB\u884C\uFF0C\u672C\u4EFB\u52A1\u5DF2\u6062\u590D\u4E3A\u6682\u505C\u72B6\u6001\u5E76\u56DE\u9000\u5230\u201C${openStep}\u201D\u3002`;
  }
  draft.obligations = reopenObligations(draft.obligations, [
    ...checkpointAffected ? ["checkpoint"] : [],
    "verification"
  ]);
}
function checkpointAffectedByPaths(state, changedPaths2, legalCheckpointPaths) {
  const externallyChangedPaths = changedPaths2.filter((file) => !legalCheckpointPaths.has(file));
  return state.checkpoints?.some((checkpoint) => checkpoint.files.some((file) => externallyChangedPaths.includes(file))) ?? false;
}
async function legalActiveUnitChanges(root, state, changedPaths2) {
  const activeUnit = state.implementationUnits?.find((unit) => unit.status === "active" || unit.status === "verified");
  if (!activeUnit || !state.traceability || !state.checkpoints?.length) return /* @__PURE__ */ new Set();
  const trace = await readTraceability(root, state);
  const node = trace.nodes[activeUnit.unitId];
  if (!node || node.kind !== "rollback" || node.status !== "current") return /* @__PURE__ */ new Set();
  const events = await readFeatureEvents(root, state.featureId);
  let lastCheckpointEventIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === "automatic-checkpoint-captured") {
      lastCheckpointEventIndex = index;
      break;
    }
  }
  const legal = /* @__PURE__ */ new Set();
  for (const file of changedPaths2) {
    if (!pathWithinFileScope(file, node.fileScope)) continue;
    let event;
    for (let index = events.length - 1; index > lastCheckpointEventIndex; index -= 1) {
      const candidate = events[index];
      const after = candidate.type === "trusted-write-owned" ? candidate.data.after : void 0;
      if (typeof after?.[file] === "string") {
        event = candidate;
        break;
      }
    }
    if (!event) continue;
    const expected = event.data.after[file];
    if (expected === await trustedWriteSummary(root, file)) legal.add(file);
  }
  return legal;
}
var init_ownership_workflow = __esm({
  "plugins/dev-flow/src/core/ownership-workflow.ts"() {
    "use strict";
    init_errors();
    init_decision_interactions();
    init_user_interactions();
    init_state_store();
    init_change_invalidation();
    init_git_reconciliation();
    init_obligations();
    init_rollback();
    init_traceability_store();
    init_step_order();
    init_workspace_store();
  }
});

// plugins/dev-flow/src/core/route-workflow.ts
var init_route_workflow = __esm({
  "plugins/dev-flow/src/core/route-workflow.ts"() {
    "use strict";
    init_contract2();
    init_route();
    init_types();
    init_errors();
    init_repository_facts();
    init_fingerprint();
    init_project_config();
    init_traceability();
    init_traceability_store();
    init_review_store();
    init_basis_state();
    init_user_interactions();
    init_decision_interactions();
    init_state_store();
  }
});

// plugins/dev-flow/src/core/decision-ledger.ts
var init_decision_ledger = __esm({
  "plugins/dev-flow/src/core/decision-ledger.ts"() {
    "use strict";
    init_errors();
  }
});

// plugins/dev-flow/src/core/interaction-provenance.ts
var init_interaction_provenance = __esm({
  "plugins/dev-flow/src/core/interaction-provenance.ts"() {
    "use strict";
    init_user_interactions();
    init_errors();
  }
});

// plugins/dev-flow/src/core/decision-workflow.ts
var init_decision_workflow = __esm({
  "plugins/dev-flow/src/core/decision-workflow.ts"() {
    "use strict";
    init_governance_records();
    init_decision_ledger();
    init_errors();
    init_interaction_provenance();
    init_decision_interactions();
    init_text_normalization();
    init_user_interactions();
    init_state_store();
  }
});

// plugins/dev-flow/src/core/plan-revision.ts
var init_plan_revision2 = __esm({
  "plugins/dev-flow/src/core/plan-revision.ts"() {
    "use strict";
    init_stable_json();
    init_contract2();
    init_plan_revision();
    init_rollback();
    init_errors();
    init_artifacts();
    init_plan_compile_context();
    init_project_config();
    init_evidence_store2();
    init_traceability_store();
    init_step_order();
    init_user_interactions();
    init_decision_interactions();
    init_state_store();
    init_review_store();
  }
});

// plugins/dev-flow/src/core/approval-interactions.ts
var init_approval_interactions = __esm({
  "plugins/dev-flow/src/core/approval-interactions.ts"() {
    "use strict";
    init_contract2();
    init_errors();
    init_approval();
    init_approval_basis();
    init_requirements_grill();
    init_state_store();
    init_traceability_gates();
    init_review_projection();
    init_step_order();
    init_obligations();
    init_user_interactions();
  }
});

// plugins/dev-flow/src/core/acceptance-store.ts
var init_acceptance_store = __esm({
  "plugins/dev-flow/src/core/acceptance-store.ts"() {
    "use strict";
    init_errors();
  }
});

// plugins/dev-flow/src/core/acceptance.ts
var init_acceptance = __esm({
  "plugins/dev-flow/src/core/acceptance.ts"() {
    "use strict";
    init_fingerprint();
    init_state_store();
    init_traceability_store();
    init_repository_fact_store();
    init_acceptance_store();
    init_errors();
    init_user_interactions();
  }
});

// plugins/dev-flow/src/core/repair-loop.ts
var init_repair_loop = __esm({
  "plugins/dev-flow/src/core/repair-loop.ts"() {
    "use strict";
  }
});

// plugins/dev-flow/src/core/verification-store.ts
import { execFile as execFile3 } from "node:child_process";
import { promisify as promisify3 } from "node:util";
var run2;
var init_verification_store = __esm({
  "plugins/dev-flow/src/core/verification-store.ts"() {
    "use strict";
    run2 = promisify3(execFile3);
  }
});

// plugins/dev-flow/src/core/verification.ts
var DEFAULT_COMMAND_MAX_OUTPUT_BYTES;
var init_verification = __esm({
  "plugins/dev-flow/src/core/verification.ts"() {
    "use strict";
    init_governance_records();
    init_errors();
    init_fingerprint();
    init_requirements_grill();
    init_state_store();
    init_project_config();
    init_traceability_store();
    init_step_order();
    init_repair_loop();
    init_obligations();
    init_contract2();
    init_change_invalidation();
    init_evidence_baseline2();
    init_verification_store();
    DEFAULT_COMMAND_MAX_OUTPUT_BYTES = 1024 * 1024;
  }
});

// plugins/dev-flow/src/core/checkpoints.ts
import { randomUUID as randomUUID10, createHash as createHash16 } from "node:crypto";
import { access, mkdir as mkdir10, open as open9, readFile as readFile17, readlink as readlink3, readdir as readdir6, rename as rename8 } from "node:fs/promises";
import path19 from "node:path";
function blobPath(sha2564) {
  return `checkpoints/blobs/${sha2564}`;
}
function baselinePath(unitId) {
  return `checkpoints/baselines/${unitId}.json`;
}
async function writeAtomic(file, contents) {
  const temp = `${file}.${randomUUID10()}.tmp`;
  const handle = await open9(temp, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename8(temp, file);
  const directory = await open9(path19.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function pathExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
async function writeBlobIfAbsent(root, featureId, bytes) {
  const sha2564 = digest6(bytes);
  const file = path19.join(featureDirectory4(root, featureId), blobPath(sha2564));
  if (await pathExists(file)) return sha2564;
  await mkdir10(path19.dirname(file), { recursive: true });
  await writeAtomic(file, bytes);
  return sha2564;
}
async function captureUnitBaseline(root, featureId, unitId, snapshot) {
  for (const file2 of snapshot) {
    const bytes = file2.kind === "symlink" ? Buffer.from(await readlink3(path19.join(root, file2.path))) : await readFile17(path19.join(root, file2.path));
    if (digest6(bytes) !== file2.sha256) {
      throw new DevFlowError("CHECKPOINT_HASH_MISMATCH", "\u6355\u83B7\u5355\u5143\u57FA\u7EBF\u65F6 governed \u6587\u4EF6\u53D1\u751F\u53D8\u5316\u3002", { path: file2.path });
    }
    await writeBlobIfAbsent(root, featureId, bytes);
  }
  const baseline = {
    schemaVersion: 2,
    featureId,
    unitId,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files: snapshot
  };
  const file = path19.join(featureDirectory4(root, featureId), baselinePath(unitId));
  await mkdir10(path19.dirname(file), { recursive: true });
  await writeAtomic(file, `${JSON.stringify(baseline, null, 2)}
`);
}
var digest6, featureDirectory4;
var init_checkpoints = __esm({
  "plugins/dev-flow/src/core/checkpoints.ts"() {
    "use strict";
    init_contract2();
    init_rollback();
    init_errors();
    init_fingerprint();
    init_project_config();
    init_review_store();
    init_host_health();
    init_obligations();
    init_state_store();
    init_step_order();
    init_traceability_store();
    init_verification();
    init_checkpoint_store();
    init_change_invalidation();
    init_evidence_store2();
    digest6 = (value) => createHash16("sha256").update(value).digest("hex");
    featureDirectory4 = (root, featureId) => path19.join(root, ".dev-flow", "features", featureId);
  }
});

// plugins/dev-flow/src/core/implementation-units.ts
import { createHash as createHash17, randomUUID as randomUUID11 } from "node:crypto";
function currentImplementationNodes(ledger) {
  return Object.values(ledger?.nodes ?? {}).filter((node) => node.kind === "implementation-unit" && node.status === "current");
}
function readyUnitFromNodes(state, nodes) {
  const statusByUnit = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit.status]));
  return [...nodes].sort((left, right) => left.id.localeCompare(right.id)).find((node) => statusByUnit.get(node.id) !== "checkpointed" && node.dependsOn.every((dependency) => statusByUnit.get(dependency) === "checkpointed"));
}
function planImplementationUnitDefs(planMarkdown) {
  const blocks = parsePlanBlocks(planMarkdown);
  const defs = [];
  for (const [id, block2] of blocks) {
    if (block2.kind !== "implementation-unit" || !/^UNIT-[0-9]{3,}$/.test(id)) continue;
    const fields = {};
    for (const line of block2.text.split("\n")) {
      const match = /^-\s+([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      const raw = match[2].trim();
      fields[match[1]] = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1).trim() ? raw.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean) : [] : raw ? [raw] : [];
    }
    defs.push({ id, tasks: fields["tasks"] ?? [], dependsOn: fields["depends_on"] ?? [] });
  }
  return defs.sort((left, right) => left.id.localeCompare(right.id));
}
async function assertImplementationUnitBeginReady(root, id, state, unitId) {
  await assertHostHealth(root, state.lastUpdatedBy.host, "implementation unit");
  await assertWorkspaceOwnershipComplete(root, state, await readProjectConfig(root), "implementation unit");
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls) && state.classification.controls.plan !== "formal") {
    throw new DevFlowError("IMPLEMENTATION_UNITS_NOT_ENFORCED", "\u5F53\u524D\u52A8\u6001\u8DEF\u7EBF\u672A\u542F\u7528 unit-chain checkpoint \u63A7\u5236\u3002");
  }
  if (currentOpenStep(state) !== "implementation") {
    throw new DevFlowError("STEP_OUT_OF_ORDER", "begin requires the implementation step", { expected: currentOpenStep(state) });
  }
  const approvalObligation = (state.obligations ?? []).find((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied");
  if (approvalObligation && !confirmedApproval(state)) {
    throw new DevFlowError("DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED", "implementation approval must be confirmed before beginning a unit");
  }
  const assertNoPendingSideEffect = (targetUnitId) => {
    const pendingSideEffect = Object.values(state.interactions ?? {}).find((candidate) => candidate.kind === "side-effect-rerun" && candidate.status === "pending" && candidate.sideEffectRerun?.units.includes(targetUnitId));
    if (pendingSideEffect) {
      throw new DevFlowError("SIDE_EFFECT_UNIT_PENDING_CONFIRMATION", "\u8BE5\u5B9E\u73B0\u5355\u5143\u5305\u542B\u6709\u526F\u4F5C\u7528\u7684\u64CD\u4F5C\uFF0C\u8BA1\u5212\u4FEE\u8BA2\u540E\u9700\u7528\u6237\u786E\u8BA4\u624D\u80FD\u91CD\u8DD1\u3002", {
        unitId: targetUnitId,
        recoveryHint: "\u56DE\u7B54\u5F53\u524D\u5F85\u51B3\u95EE\u9898\uFF08\u786E\u8BA4\u91CD\u8DD1\u8BE5\u5355\u5143\uFF0C\u6216\u4E0D\u91CD\u8DD1\u4FDD\u7559\u539F\u7ED3\u679C\uFF09\u540E\u518D\u91CD\u8BD5 begin\u3002"
      });
    }
  };
  if (unitId) assertNoPendingSideEffect(unitId);
  const traceEnforced = traceEnforcementRequired(state.route, state.classification.controls);
  let nodes;
  if (traceEnforced) {
    const ledger = await assertTraceGateCurrent(root, state, "implementation");
    for (const kind of ["requirements", "implementation-plan"]) {
      await assertArtifactCurrent(root, id, state, kind);
    }
    if (reviewEnforcementRequired(state.route, state.classification.controls)) {
      await requireReviewReady(root, state, { phase: "plan" });
    }
    nodes = currentImplementationNodes(ledger);
  } else {
    const plan = state.artifacts["implementation-plan"];
    if (!plan) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", "implementation-plan");
    const contents = await assertArtifactCurrent(root, id, state, "implementation-plan");
    nodes = planImplementationUnitDefs(contents);
  }
  let targetId = unitId;
  if (!targetId) {
    const ready = readyUnitFromNodes(state, nodes);
    if (!ready) return void 0;
    targetId = ready.id;
    assertNoPendingSideEffect(targetId);
  }
  const node = nodes.find((candidate) => candidate.id === targetId);
  if (!node) {
    throw new DevFlowError("IMPLEMENTATION_UNIT_UNKNOWN", "implementation unit is not part of the current execution graph", { unitId: targetId });
  }
  if ((state.implementationUnits ?? []).some((unit) => unit.status === "active")) {
    const active = state.implementationUnits.find((unit) => unit.status === "active");
    throw new DevFlowError("IMPLEMENTATION_UNIT_ALREADY_ACTIVE", "another implementation unit is already active", { activeUnitId: active.unitId });
  }
  const basisHash2 = implementationUnitBasisHash(state);
  const byId = new Map((state.implementationUnits ?? []).map((unit) => [unit.unitId, unit]));
  const merged = [];
  for (const candidate of nodes) {
    const candidateId = candidate.id;
    const existing = byId.get(candidateId);
    if (existing && existing.status !== "pending") {
      merged.push(existing);
    } else {
      merged.push({
        unitId: candidateId,
        status: "pending",
        basisHash: basisHash2,
        ...candidate.tasks.length ? { tasks: [...candidate.tasks] } : {},
        ...candidate.dependsOn.length ? { dependsOn: [...candidate.dependsOn] } : {}
      });
    }
  }
  for (const dependency of node.dependsOn) {
    const unit = merged.find((candidate) => candidate.unitId === dependency);
    if (unit?.status !== "checkpointed") {
      throw new DevFlowError("IMPLEMENTATION_UNIT_DEPENDENCY_INCOMPLETE", "implementation unit dependencies must be checkpointed first", {
        unitId: targetId,
        dependency,
        status: unit?.status ?? "unknown"
      });
    }
  }
  const target = merged.find((unit) => unit.unitId === targetId);
  if (target.status !== "pending" && target.status !== "rolled_back") {
    throw new DevFlowError("IMPLEMENTATION_UNIT_NOT_PENDING", "implementation unit cannot begin from its current status", { unitId: targetId, status: target.status });
  }
  return { unitId: targetId, merged, basisHash: basisHash2 };
}
async function assessImplementationUnitBegin(root, id, state) {
  try {
    const ready = await assertImplementationUnitBeginReady(root, id, state, void 0);
    return ready ? { kind: "ready", unitId: ready.unitId } : { kind: "none" };
  } catch (error) {
    return {
      kind: "blocked",
      code: error instanceof DevFlowError ? error.code : "IMPLEMENTATION_UNIT_BEGIN_FAILED",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
function implementationUnitBasisHash(state) {
  return digest7(canonicalReviewValueJson({
    traceability: state.traceability,
    approval: confirmedApproval(state)?.record ?? null
  }));
}
function implementationUnitWriteBlock(state, ledger, _relativePath) {
  if (!checkpointsEnforcementRequired(state.route, state.classification.controls)) return void 0;
  if (currentOpenStep(state) !== "implementation") return void 0;
  if (!confirmedApproval(state)) return void 0;
  const active = (state.implementationUnits ?? []).find((unit) => unit.status === "active");
  if (!active) {
    return {
      code: "IMPLEMENTATION_UNIT_REQUIRED",
      details: { recoveryHint: "\u5199\u5165 governed \u6587\u4EF6\u524D\uFF0C\u5148\u901A\u8FC7 dev_flow_begin_implementation_unit \u5F00\u59CB\u4E0B\u4E00\u4E2A implementation unit" }
    };
  }
  const node = currentImplementationNodes(ledger).find((candidate) => candidate.id === active.unitId);
  if (!node) {
    return {
      code: "IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
      details: { unitId: active.unitId, fileScope: [], path: _relativePath }
    };
  }
  return void 0;
}
async function beginImplementationUnit(root, id, expectedRevision, unitId) {
  return mutate(root, id, expectedRevision, "implementation-unit-begun", async (state) => {
    const ready = await assertImplementationUnitBeginReady(root, id, state, unitId);
    const { merged, basisHash: basisHash2 } = ready;
    const project = await readProjectConfig(root);
    const snapshot = await snapshotGovernedRoots(root, project);
    await captureUnitBaseline(root, id, unitId, snapshot);
    const target = merged.find((unit) => unit.unitId === unitId);
    delete target.checkpointId;
    target.basisHash = basisHash2;
    target.beginNonce = randomUUID11();
    target.status = "active";
    target.startedFingerprint = await fingerprintGovernedRoots(root, project);
    state.implementationUnits = merged;
  }, { unitId });
}
var digest7;
var init_implementation_units = __esm({
  "plugins/dev-flow/src/core/implementation-units.ts"() {
    "use strict";
    init_contract2();
    init_review_store();
    init_rollback();
    init_errors();
    init_artifacts();
    init_checkpoints();
    init_fingerprint();
    init_review_jobs();
    init_host_health();
    init_state_store();
    init_step_order();
    init_traceability_gates();
    init_approval_basis();
    init_plan_graph();
    digest7 = (value) => createHash17("sha256").update(value).digest("hex");
  }
});

// plugins/dev-flow/src/core/rollback-journal.ts
var init_rollback_journal = __esm({
  "plugins/dev-flow/src/core/rollback-journal.ts"() {
    "use strict";
    init_errors();
    init_state_store();
  }
});

// plugins/dev-flow/src/core/rollback.ts
var init_rollback2 = __esm({
  "plugins/dev-flow/src/core/rollback.ts"() {
    "use strict";
    init_contract2();
    init_review_store();
    init_checkpoints();
    init_errors();
    init_fingerprint();
    init_project_config();
    init_rollback();
    init_implementation_units();
    init_state_store();
    init_rollback_journal();
    init_traceability_store();
    init_verification();
    init_approval_basis();
    init_user_interactions();
  }
});

// plugins/dev-flow/src/core/interaction-answer.ts
var init_interaction_answer = __esm({
  "plugins/dev-flow/src/core/interaction-answer.ts"() {
    "use strict";
    init_errors();
    init_decision_interactions();
    init_decision_workflow();
    init_plan_revision2();
    init_requirements_grill();
    init_approval_interactions();
    init_ownership_workflow();
    init_route_workflow();
    init_quality_exceptions();
    init_acceptance();
    init_rollback2();
    init_review_jobs();
    init_user_interactions();
    init_state_store();
    init_host_health();
    init_interaction_provenance();
  }
});

// plugins/dev-flow/src/core/state-store.ts
import { randomUUID as randomUUID12, createHash as createHash18 } from "node:crypto";
import { access as access2, mkdir as mkdir11, open as open10, readdir as readdir7, readFile as readFile18, rename as rename9, rm, writeFile as writeFile4 } from "node:fs/promises";
import { hostname } from "node:os";
import path20 from "node:path";
function validateImplementationUnits(units) {
  if (!Array.isArray(units)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementationUnits must be an array");
  const ids = /* @__PURE__ */ new Set();
  const checkpoints = /* @__PURE__ */ new Set();
  for (const value of units) {
    const unit = value;
    if (!unit || typeof unit !== "object" || Array.isArray(unit) || typeof unit.unitId !== "string" || !/^UNIT-[0-9]{3,}$/.test(unit.unitId) || typeof unit.status !== "string" || !unitStatuses.has(unit.status) || typeof unit.basisHash !== "string" || !/^[a-f0-9]{64}$/.test(unit.basisHash) || unit.startedFingerprint !== void 0 && (typeof unit.startedFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(unit.startedFingerprint)) || unit.checkpointId !== void 0 && typeof unit.checkpointId !== "string" || unit.beginNonce !== void 0 && (typeof unit.beginNonce !== "string" || unit.beginNonce.trim().length === 0)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation unit state is invalid");
    }
    const started = unit.startedFingerprint !== void 0;
    const checkpointed = unit.checkpointId !== void 0;
    const hasNonce = unit.beginNonce !== void 0;
    const consistent = unit.status === "pending" && !started && !checkpointed && !hasNonce || (unit.status === "active" || unit.status === "verified") && started && !checkpointed || (unit.status === "checkpointed" || unit.status === "rolled_back") && started && checkpointed;
    if (!consistent) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation unit status is inconsistent with its fields");
    if (ids.has(unit.unitId)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate an implementation unit");
    if (checkpointed && checkpoints.has(unit.checkpointId)) throw new DevFlowError("INVALID_STATE_SCHEMA", "implementation units duplicate a checkpoint id");
    ids.add(unit.unitId);
    if (checkpointed) checkpoints.add(unit.checkpointId);
  }
}
function validateAcceptanceState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance state is invalid");
  const acceptance = value;
  if (!Array.isArray(acceptance.evidence) || !Array.isArray(acceptance.dispositions)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance state must contain evidence and dispositions arrays");
  }
  const sha = /^[a-f0-9]{64}$/;
  const evidenceIds = /* @__PURE__ */ new Set();
  for (const record of acceptance.evidence) {
    if (!record || typeof record !== "object" || typeof record.recordId !== "string" || evidenceIds.has(record.recordId) || record.kind !== "acceptance-evidence" || !/^AC-[0-9]{3,}$/.test(record.acceptanceCriterionId) || !record.basis || record.basis.kind !== "content" || !sha.test(record.basis.sha256) || !["browser-operation", "screenshot", "file-inspection", "agent-self-check"].includes(record.evidenceKind)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance evidence record is invalid");
    }
    if (record.artifactSha256 !== void 0 && (typeof record.artifactSha256 !== "string" || !sha.test(record.artifactSha256))) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance evidence artifact hash is invalid");
    }
    evidenceIds.add(record.recordId);
  }
  const dispositionIds = /* @__PURE__ */ new Set();
  for (const disposition of acceptance.dispositions) {
    if (!disposition || typeof disposition !== "object" || !/^AC-[0-9]{3,}$/.test(disposition.acceptanceCriterionId) || dispositionIds.has(disposition.acceptanceCriterionId) || !["behavior-test", "type-check", "rule-check", "file-check", "human-acceptance"].includes(disposition.dispositionKind) || !["pending", "satisfied", "stale"].includes(disposition.status) || !Array.isArray(disposition.evidenceRefs) || disposition.evidenceRefs.some((id) => typeof id !== "string") || !disposition.basis || disposition.basis.kind !== "content" || !sha.test(disposition.basis.sha256)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "acceptance disposition state is invalid");
    }
    dispositionIds.add(disposition.acceptanceCriterionId);
  }
}
function validateInteractionRecords(interactions2) {
  for (const value of Object.values(interactions2)) {
    const record = value;
    if (!record || typeof record !== "object" || Array.isArray(record) || typeof record.id !== "string" || !record.id || typeof record.kind !== "string" || !interactionKinds.has(record.kind) || typeof record.target !== "string" || typeof record.basisHash !== "string" || !Array.isArray(record.options) || record.status !== "pending" && record.status !== "resolved" || record.presentationEventSequence !== void 0 && (!Number.isInteger(record.presentationEventSequence) || record.presentationEventSequence < 1)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "interaction record is invalid");
    }
  }
}
function validateFeatureState(value) {
  const state = value;
  if ([1, 2, 3].includes(Number(state.schemaVersion))) throw new DevFlowError("UNSUPPORTED_FEATURE_SCHEMA", "\u68C0\u6D4B\u5230 Dev Flow 4.x \u6216\u66F4\u65E9\u7684 active state\u3002", { userMessage: "\u65E7 feature \u4E0D\u80FD\u5728 Dev Flow 6.0 \u4E2D\u7EE7\u7EED\u3002", cause: "6.0 \u4E0D\u8FC1\u79FB\u65E7 active state\u3002", impact: "\u7CFB\u7EDF\u4E0D\u4F1A\u8986\u76D6\u6216\u731C\u6D4B\u65E7\u5BA1\u8BA1\u72B6\u6001\u3002", recoveryKind: "repair", recoveryInstruction: "\u7528\u4EA7\u751F\u8BE5\u72B6\u6001\u7684\u65E7\u63D2\u4EF6\u5B8C\u6210\u6216\u653E\u5F03\u8BE5 feature\uFF0C\u5907\u4EFD .dev-flow \u540E\u91CD\u65B0\u521D\u59CB\u5316\u3002", retryOriginal: false, schemaVersion: state.schemaVersion });
  const schemaVersion = Number(state.schemaVersion);
  if (schemaVersion !== 6) throw new DevFlowError("UNSUPPORTED_FEATURE_SCHEMA", "\u5F53\u524D\u53EA\u652F\u6301 schema v6 \u72B6\u6001\u3002", { recoveryHint: "\u4F7F\u7528 Dev Flow 6.0 \u91CD\u65B0\u521D\u59CB\u5316 feature" });
  if (schemaVersion === 6) {
    if (Object.keys(state).includes("decisionLedger") || Object.keys(state).includes("qualityExceptions")) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "v6 \u8FD0\u884C\u6001\u4E0D\u80FD\u5305\u542B\u65E7 decisionLedger \u6216 qualityExceptions \u5B57\u6BB5\u3002", {
        recoveryHint: "\u7528\u4EA7\u751F\u8BE5\u72B6\u6001\u7684\u65E7\u63D2\u4EF6\u6536\u5C3E\uFF0C\u5907\u4EFD .dev-flow \u540E\u7528 6.0 \u91CD\u65B0\u521D\u59CB\u5316\u3002"
      });
    }
    validateGovernanceLedger(state.governance);
    if (state.acceptance !== void 0) validateAcceptanceState(state.acceptance);
  }
  if (state.mode !== "intake" && state.mode !== "routed") throw new DevFlowError("INVALID_STATE_SCHEMA", "state mode must be intake or routed");
  const missingCoreFields = [
    typeof state.featureId === "string" && state.featureId ? void 0 : "featureId",
    Number.isInteger(state.revision) && (state.revision ?? -1) >= 0 ? void 0 : "revision",
    lifecycles.has(state.lifecycle) ? void 0 : "lifecycle",
    state.scope && Array.isArray(state.scope.inScope) && Array.isArray(state.scope.outOfScope) ? void 0 : "scope",
    state.steps ? void 0 : "steps",
    state.humanGates ? void 0 : "humanGates",
    state.artifacts ? void 0 : "artifacts",
    state.verification && Array.isArray(state.verification.attempts) ? void 0 : "verification.attempts",
    state.interactions === void 0 || typeof state.interactions === "object" && state.interactions !== null && !Array.isArray(state.interactions) ? void 0 : "interactions",
    Array.isArray(state.blockingFindings) ? void 0 : "blockingFindings",
    typeof state.logicComplete === "boolean" ? void 0 : "logicComplete",
    state.lastUpdatedBy ? void 0 : "lastUpdatedBy",
    state.workspace ? void 0 : "workspace",
    state.evidenceFreshness ? void 0 : "evidenceFreshness"
  ].filter((field) => typeof field === "string");
  if (missingCoreFields.length > 0) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "\u72B6\u6001\u4E0D\u662F\u5408\u6CD5\u7684 feature state\u3002", { missingCoreFields });
  }
  const lastUpdatedBy = state.lastUpdatedBy;
  if (lastUpdatedBy?.host !== "claude" && lastUpdatedBy?.host !== "codex") throw new DevFlowError("INVALID_STATE_SCHEMA", "lastUpdatedBy host is invalid");
  if (state.interactions !== void 0) validateInteractionRecords(state.interactions);
  const pendingInteractions = Object.values(state.interactions ?? {}).filter((item) => item.status === "pending");
  if (pendingInteractions.length > 1) throw new DevFlowError("MULTIPLE_PENDING_DECISIONS", "schema v4 \u72B6\u6001\u5305\u542B\u591A\u4E2A\u5F85\u51B3\u95EE\u9898\u3002", { userMessage: "\u5F53\u524D\u72B6\u6001\u540C\u65F6\u5B58\u5728\u591A\u4E2A\u5F85\u51B3\u95EE\u9898\uFF0C\u6D41\u7A0B\u5DF2\u5B89\u5168\u505C\u6B62\u3002", cause: "\u51B3\u7B56\u8D26\u672C\u4E0D\u662F\u5355\u4E00\u5F85\u51B3\u95EE\u9898\u3002", impact: "\u7CFB\u7EDF\u4E0D\u4F1A\u4EFB\u9009\u4E00\u4E2A\u95EE\u9898\u6D88\u8D39\u3002", recoveryKind: "repair", recoveryInstruction: "\u8FD0\u884C doctor \u68C0\u67E5\u51B3\u7B56\u8D26\u672C\uFF0C\u7136\u540E\u901A\u8FC7\u516C\u5F00\u56DE\u7B54\u63A5\u53E3\u6062\u590D\u3002", retryOriginal: false });
  if (state.pendingDecision !== void 0) {
    const decision = state.pendingDecision;
    if (!decision || decision.source !== "core" || typeof decision.question !== "string" || !decision.question.trim() || !/^[a-f0-9]{64}$/.test(decision.basisHash) || !Number.isInteger(decision.presentedRevision) || decision.presentationEventId !== void 0 && typeof decision.presentationEventId !== "string" || !Array.isArray(decision.options) || decision.options.length < 2 || decision.options.length > 3 || decision.options.some((option) => !option || typeof option.id !== "string" || typeof option.label !== "string" || !option.label.trim())) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "pendingDecision is invalid");
    }
  }
  const workspace = state.workspace;
  if (!workspace || typeof workspace.baseHead !== "string" || typeof workspace.baseBranch !== "string" || typeof workspace.observedHead !== "string" || typeof workspace.lastWorkspaceFingerprint !== "string" || !["current", "required", "blocked"].includes(workspace.reconciliationStatus) || typeof workspace.startedDirty !== "object" || workspace.startedDirty === null || Array.isArray(workspace.startedDirty) || typeof workspace.ownership !== "object" || workspace.ownership === null || Array.isArray(workspace.ownership) || typeof workspace.ownershipSource !== "object" || workspace.ownershipSource === null || Array.isArray(workspace.ownershipSource) || typeof workspace.observedPathFingerprints !== "object" || workspace.observedPathFingerprints === null || Array.isArray(workspace.observedPathFingerprints) || workspace.unownedPaths !== void 0 && (!Array.isArray(workspace.unownedPaths) || workspace.unownedPaths.some((file) => typeof file !== "string")) || !Array.isArray(workspace.observedCommits)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "workspace lineage is invalid");
  }
  if (state.lifecycle === "finalized" && !state.deliverySnapshot) throw new DevFlowError("INVALID_STATE_SCHEMA", "finalized \u72B6\u6001\u5FC5\u987B\u5305\u542B\u4EA4\u4ED8\u5FEB\u7167\u3002");
  if (state.lifecycle === "abandoned" && !state.abandonment) throw new DevFlowError("INVALID_STATE_SCHEMA", "abandoned \u72B6\u6001\u5FC5\u987B\u5305\u542B\u7528\u6237\u539F\u56E0\u3002");
  if (state.mode === "intake") {
    if (state.route !== void 0 || state.classification !== void 0 || state.classificationBasis !== void 0 || state.obligations !== void 0) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "intake state cannot contain route or classification fields");
    }
    return;
  }
  if (!state.route || !routeDefinition(state.route) || !state.classification || !state.classificationBasis || !Array.isArray(state.obligations)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "routed \u72B6\u6001\u5FC5\u987B\u5305\u542B\u5206\u7C7B\u4E8B\u5B9E\u548C\u4E49\u52A1\u3002");
  }
  if (state.repair !== void 0 && (typeof state.repair !== "object" || !["active", "stalled", "waiting-user", "completed"].includes(state.repair.status) || !Array.isArray(state.repair.attempts) || !Number.isInteger(state.repair.maxAttempts) || state.repair.maxAttempts < 1)) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "repair state is invalid");
  }
  if (state.checkpoints !== void 0 && (!Array.isArray(state.checkpoints) || state.checkpoints.some((checkpoint) => {
    const item = checkpoint;
    return !item || typeof item.checkpointId !== "string" || !/^AUTO-[0-9a-f-]{10,}$/.test(item.checkpointId) || typeof item.stage !== "string" || typeof item.capturedAt !== "string" || typeof item.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint) || !Array.isArray(item.files) || item.files.some((file) => typeof file !== "string") || typeof item.basisHash !== "string" || !/^[a-f0-9]{64}$/.test(item.basisHash);
  }))) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "automatic checkpoints are invalid");
  }
  if (state.workflowCapabilities !== void 0) {
    try {
      normalizeWorkflowCapabilities(state.workflowCapabilities);
    } catch {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "workflowCapabilities are invalid");
    }
  }
  if (state.traceability !== void 0) {
    const pointer = state.traceability;
    if (typeof pointer !== "object" || pointer === null || !/^traceability\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path) || !/^[a-f0-9]{64}$/.test(pointer.sha256) || pointer.path !== `traceability/snapshots/${pointer.sha256}.json` || !Number.isInteger(pointer.revision) || pointer.revision < 0 || !pointer.summary || !["total", "current", "stale", "tombstoned"].every((key) => Number.isInteger(pointer.summary[key]) && pointer.summary[key] >= 0)) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "traceability pointer is invalid");
    }
  }
  if (traceEnforcementRequired(state.route, state.classification.controls) && !state.traceability) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "\u542F\u7528 Trace \u63A7\u5236\u7684 feature \u5FC5\u987B\u5305\u542B traceability pointer\u3002");
  }
  if (state.evidenceStore !== void 0) {
    try {
      parseEvidenceStorePointer(state.evidenceStore);
    } catch {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "evidenceStore pointer is invalid");
    }
  }
  if (state.review !== void 0) {
    const pointer = state.review;
    if (typeof pointer !== "object" || pointer === null || !/^review\/snapshots\/[a-f0-9]{64}\.json$/.test(pointer.path) || !/^[a-f0-9]{64}$/.test(pointer.sha256) || pointer.path !== `review/snapshots/${pointer.sha256}.json` || !Number.isInteger(pointer.revision) || pointer.revision < 0 || !pointer.summary || !["batches", "current", "stale", "open", "complete"].every((key) => {
      const value2 = pointer.summary?.[key];
      return Number.isInteger(value2) && value2 >= 0;
    })) {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "review pointer is invalid");
    }
  }
  if (reviewLedgerRequired(state.route, state.classification.controls) && !state.review) {
    throw new DevFlowError("INVALID_STATE_SCHEMA", "\u542F\u7528\u5BA1\u67E5\u63A7\u5236\u7684 feature \u5FC5\u987B\u5305\u542B review pointer\u3002");
  }
  if (state.implementationUnits !== void 0) validateImplementationUnits(state.implementationUnits);
  if (state.rollbackGate !== void 0) {
    const gate = state.rollbackGate;
    if (typeof gate !== "object" || gate === null || gate.status !== "pending" && gate.status !== "confirmed" || typeof gate.targetCheckpointId !== "string" || typeof gate.targetUnitId !== "string" || !/^[a-f0-9]{64}$/.test(gate.previewBasisHash) || typeof gate.interactionId !== "string" || typeof gate.stateRevision !== "number" || !Number.isInteger(gate.stateRevision) || gate.stateRevision < 0 || typeof gate.presentedAt !== "string" || gate.confirmedAt !== void 0 && typeof gate.confirmedAt !== "string") {
      throw new DevFlowError("INVALID_STATE_SCHEMA", "rollbackGate is invalid");
    }
  }
}
function invalidGovernance(message) {
  return new DevFlowError("INVALID_STATE_SCHEMA", `governance ledger is invalid: ${message}`);
}
function validateRecordBasis(basis) {
  if (basis === void 0) return;
  if (!basis || typeof basis !== "object" || Array.isArray(basis)) throw invalidGovernance("record basis must be an object");
  const value = basis;
  if (value.kind === "content") {
    if (Object.keys(value).some((key) => key !== "kind" && key !== "sha256") || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
      throw invalidGovernance("content record basis requires only a valid sha256");
    }
    return;
  }
  if (value.kind === "event") {
    if (Object.keys(value).some((key) => key !== "kind" && key !== "eventId") || typeof value.eventId !== "string" || !value.eventId) {
      throw invalidGovernance("event record basis requires only a non-empty eventId");
    }
    return;
  }
  if (value.kind === "slice") {
    if (Object.keys(value).some((key) => key !== "kind" && key !== "sliceKey" && key !== "sliceHash") || typeof value.sliceKey !== "string" || !value.sliceKey || typeof value.sliceHash !== "string" || !value.sliceHash) {
      throw invalidGovernance("slice record basis requires only sliceKey and sliceHash");
    }
    return;
  }
  throw invalidGovernance("record basis kind is invalid");
}
function validateGovernanceRecordBase(record) {
  if (typeof record.recordId !== "string" || !record.recordId) throw invalidGovernance("record recordId must be a non-empty string");
  if (record.supersededBy !== void 0 && (typeof record.supersededBy !== "string" || !record.supersededBy)) throw invalidGovernance("record supersededBy must be a non-empty string");
  if (record.recordedAt !== void 0 && typeof record.recordedAt !== "string") throw invalidGovernance("record recordedAt must be a string");
  validateRecordBasis(record.basis);
}
function validateGovernanceLedger(ledger) {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) throw invalidGovernance("ledger must be an object");
  const value = ledger;
  const arrays = [
    ["decisions", ["decision"]],
    ["claims", ["claim"]],
    ["authorizations", ["authorization"]],
    ["credentials", ["credential"]],
    ["repositoryFacts", ["repository-fact"]]
  ];
  for (const [key, allowedKinds] of arrays) {
    const entries = value[key];
    if (!Array.isArray(entries)) throw invalidGovernance(`${key} must be an array`);
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalidGovernance(`${key} entries must be objects`);
      const record = entry;
      if (!allowedKinds.includes(record.kind)) throw invalidGovernance(`${key} entry kind must be ${allowedKinds.join(" or ")}`);
      validateGovernanceRecordBase(record);
      switch (record.kind) {
        case "decision":
          if (typeof record.question !== "string" || !record.question.trim()) throw invalidGovernance("decision question must be a non-empty string");
          if (typeof record.conclusion !== "string" || !record.conclusion.trim()) throw invalidGovernance("decision conclusion must be a non-empty string");
          if (record.credentialId !== void 0 && typeof record.credentialId !== "string") throw invalidGovernance("decision credentialId must be a string");
          break;
        case "claim":
          if (typeof record.claimType !== "string" || !record.claimType) throw invalidGovernance("claim claimType must be a non-empty string");
          if (typeof record.subject !== "string" || !record.subject) throw invalidGovernance("claim subject must be a non-empty string");
          break;
        case "authorization":
          if (typeof record.authorizationType !== "string" || !record.authorizationType) throw invalidGovernance("authorization authorizationType must be a non-empty string");
          if (typeof record.target !== "string" || !record.target) throw invalidGovernance("authorization target must be a non-empty string");
          if (record.credentialId !== void 0 && typeof record.credentialId !== "string") throw invalidGovernance("authorization credentialId must be a string");
          break;
        case "credential":
          if (record.source !== "native-form" && record.source !== "text") throw invalidGovernance("credential source must be native-form or text");
          if (record.host !== "claude" && record.host !== "codex") throw invalidGovernance("credential host must be claude or codex");
          if (typeof record.interactionId !== "string" || !record.interactionId) throw invalidGovernance("credential interactionId must be a non-empty string");
          if (record.optionId !== void 0 && typeof record.optionId !== "string") throw invalidGovernance("credential optionId must be a string");
          if (record.rawText !== void 0 && typeof record.rawText !== "string") throw invalidGovernance("credential rawText must be a string");
          break;
        case "repository-fact": {
          const location = record.location;
          if (!location || typeof location !== "object" || Array.isArray(location)) throw invalidGovernance("repository-fact location must be an object");
          if (typeof record.assertion !== "string" || !record.assertion.trim()) throw invalidGovernance("repository-fact assertion must be a non-empty string");
          if (location.kind === "positive") {
            if (typeof location.path !== "string" || !location.path) throw invalidGovernance("repository-fact positive location path must be a non-empty string");
          } else if (location.kind === "negative") {
            if (!Array.isArray(location.checkedScope) || location.checkedScope.some((item) => typeof item !== "string")) throw invalidGovernance("repository-fact negative checkedScope must be a string array");
            if (typeof location.conditions !== "string" || !location.conditions.trim()) throw invalidGovernance("repository-fact negative conditions must be a non-empty string");
          } else {
            throw invalidGovernance("repository-fact location kind must be positive or negative");
          }
          if (record.observation !== void 0) {
            const observation = record.observation;
            if (!observation || typeof observation !== "object" || Array.isArray(observation) || typeof observation.kind !== "string") {
              throw invalidGovernance("repository-fact observation must be a tagged object");
            }
            const hasOnly = (keys) => Object.keys(observation).every((key2) => keys.includes(key2));
            const nonEmptyPath = () => typeof observation.path === "string" && observation.path.trim().length > 0;
            if (observation.kind === "file-exists") {
              if (!hasOnly(["kind", "path"]) || !nonEmptyPath()) throw invalidGovernance("file-exists observation is invalid");
            } else if (observation.kind === "text-present") {
              if (!hasOnly(["kind", "path", "text", "occurrence"]) || !nonEmptyPath() || typeof observation.text !== "string" || !observation.text.trim() || observation.occurrence !== void 0 && (typeof observation.occurrence !== "number" || !Number.isInteger(observation.occurrence) || observation.occurrence < 1)) throw invalidGovernance("text-present observation is invalid");
            } else if (observation.kind === "symbol-present") {
              if (!hasOnly(["kind", "path", "symbol"]) || !nonEmptyPath() || typeof observation.symbol !== "string" || !observation.symbol.trim()) throw invalidGovernance("symbol-present observation is invalid");
            } else if (observation.kind === "json-value") {
              if (!hasOnly(["kind", "path", "pointer", "expected"]) || !nonEmptyPath() || typeof observation.pointer !== "string" || !observation.pointer.startsWith("/")) throw invalidGovernance("json-value observation is invalid");
            } else if (observation.kind === "search-absent") {
              if (!hasOnly(["kind", "checkedScope", "pattern", "patternKind"]) || !Array.isArray(observation.checkedScope) || observation.checkedScope.length === 0 || observation.checkedScope.some((item) => typeof item !== "string" || !item.trim()) || typeof observation.pattern !== "string" || !observation.pattern.trim() || observation.patternKind !== "literal" && observation.patternKind !== "regex") throw invalidGovernance("search-absent observation is invalid");
            } else {
              throw invalidGovernance("repository-fact observation kind is invalid");
            }
          }
          if (typeof record.observedFingerprint !== "string" || !record.observedFingerprint) throw invalidGovernance("repository-fact observedFingerprint must be a non-empty string");
          break;
        }
      }
    }
  }
}
async function readProjectConfig(root) {
  try {
    const raw = await readFile18(path20.join(devFlow(root), "project.json"), "utf8");
    const value = JSON.parse(raw);
    validateProjectConfig(value);
    return value;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if (error.code === "ENOENT") {
      throw new DevFlowError("PROJECT_NOT_INITIALIZED", "run dev_flow_init_project first", {
        userMessage: "\u9879\u76EE\u5C1A\u672A\u521D\u59CB\u5316\uFF0C\u8BF7\u5148\u8FD0\u884C dev_flow_init_project\u3002",
        cause: "\u5F53\u524D\u4E1A\u52A1\u76EE\u5F55\u7F3A\u5C11 .dev-flow/project.json\u3002",
        impact: "\u672A\u521D\u59CB\u5316\u9879\u76EE\u524D\u65E0\u6CD5\u5F00\u59CB\u6216\u63A8\u8FDB\u4EFB\u4F55\u9700\u6C42\u3002",
        recoveryKind: "retry",
        recoveryInstruction: "\u8FD0\u884C dev_flow_init_project \u521D\u59CB\u5316\u9879\u76EE\uFF0C\u7136\u540E\u91CD\u65B0 dev_flow_start\u3002",
        retryOriginal: true,
        requiresUserDecision: false
      });
    }
    throw new DevFlowError("INVALID_PROJECT_CONFIG", "project.json exists but is unreadable", {
      userMessage: "\u9879\u76EE\u914D\u7F6E\u6587\u4EF6\u65E0\u6CD5\u8BFB\u53D6\u3002",
      cause: ".dev-flow/project.json \u5B58\u5728\u4F46\u5185\u5BB9\u635F\u574F\u6216\u65E0\u6CD5\u89E3\u6790\u3002",
      impact: "\u65E0\u6CD5\u786E\u8BA4\u9879\u76EE\u7684\u5F3A\u5236\u914D\u7F6E\u4E0E\u53D7\u4FDD\u62A4\u8DEF\u5F84\uFF0C\u6D41\u7A0B\u5DF2\u505C\u6B62\u3002",
      recoveryKind: "repair",
      recoveryInstruction: "\u8FD0\u884C dev_flow_doctor \u68C0\u67E5\uFF0C\u6216\u4FEE\u590D project.json \u540E\u91CD\u8BD5\u3002",
      retryOriginal: false,
      requiresUserDecision: false
    });
  }
}
async function writeAtomic2(file, value) {
  const temp = `${file}.${randomUUID12()}.tmp`;
  const handle = await open10(temp, "w");
  const payload = file.endsWith(`${path20.sep}state.json`) && value && typeof value === "object" && value.schemaVersion === 6 ? (() => {
    const copy = { ...value };
    delete copy.decisionLedger;
    delete copy.qualityExceptions;
    return copy;
  })() : value;
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename9(temp, file);
  const directory = await open10(path20.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function prepareStatusProjection(root, state, revision) {
  const status = state.artifacts.status;
  if (!status) return;
  if (state.mode !== "routed" || !state.route || !state.classification) {
    const pending = pendingDecisionForState(state);
    const contents2 = [
      "---",
      "dev_flow:",
      "  schema_version: 1",
      `  feature_id: ${state.featureId}`,
      "  kind: status",
      "  generated: true",
      "---",
      "",
      "# Dev Flow Status",
      "",
      `- Revision: ${revision}`,
      `- Lifecycle: ${state.lifecycle}`,
      "- Mode: intake",
      "",
      ...pending?.kind === "route-confirmation" ? ["## Pending", "", `- ${pending.question}`, ""] : []
    ].join("\n");
    const file2 = path20.join(features(root), state.featureId, status.path);
    state.artifacts.status = { ...status, sha256: createHash18("sha256").update(contents2).digest("hex") };
    return async () => {
      await writeFile4(file2, contents2);
    };
  }
  const trace = await inspectCurrentTrace(root, state);
  const summary = trace.effectiveSummary;
  const traceLines = [
    "## Trace",
    "",
    `- Enforced: ${trace.enforced}`,
    ...state.traceability ? [`- Pointer: ${state.traceability.path}`] : [],
    ...summary ? [`- Summary: total=${summary.total} current=${summary.current} stale=${summary.stale} tombstoned=${summary.tombstoned}`] : [],
    ...trace.blocker ? [`- Blocker: ${trace.blocker.code} (${trace.blocker.step})`] : [],
    ""
  ];
  const grillAdvisory = state.steps.requirements_alignment?.status !== "satisfied" ? await openQuestionsAdvisory(root, state) : void 0;
  const projection = [
    "---",
    "dev_flow:",
    "  schema_version: 1",
    `  feature_id: ${state.featureId}`,
    `  route: ${state.route}`,
    "  kind: status",
    "  generated: true",
    "---",
    "",
    "# Dev Flow Status",
    "",
    `- Revision: ${revision}`,
    `- Lifecycle: ${state.lifecycle}`,
    `- Route: ${state.route}`,
    `- Logic complete: ${state.logicComplete}`,
    "",
    "## Steps",
    "",
    ...routeDefinitionForFeature(state.route, state.classification.controls).orderedSteps.map((step) => {
      const snapshot = state.steps[step];
      const evidence = snapshot?.evidence;
      const label = evidence?.reviewStatus === "risk-accepted" ? "\u98CE\u9669\u5DF2\u63A5\u53D7" : snapshot?.status ?? "pending";
      return `- ${step}: ${label}`;
    }),
    "",
    ...traceLines,
    ...grillAdvisory ? [`- \u63D0\u793A: \u9700\u6C42\u6587\u6863\u300C\u5F00\u653E\u95EE\u9898\u300D\u8FD8\u6709 ${grillAdvisory.items.length} \u9879\u672A\u6536\u655B\uFF08${grillAdvisory.items.join("\uFF1B")}\uFF09\uFF0C\u5EFA\u8BAE\u5148\u8C03\u7528 dev_flow_request_grill_decision \u6536\u655B\u540E\u518D\u8FDB\u5165 planning\u3002`, ""] : []
  ].join("\n");
  const contents = `${projection}
`;
  const file = path20.join(features(root), state.featureId, status.path);
  state.artifacts.status = { ...status, sha256: createHash18("sha256").update(contents).digest("hex") };
  return async () => {
    await writeFile4(file, contents);
  };
}
async function lock(root, featureId, operation) {
  const directory = path20.join(devFlow(root), ".lock");
  const started = Date.now();
  await mkdir11(devFlow(root), { recursive: true });
  while (true) {
    try {
      await mkdir11(directory);
      await writeFile4(path20.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), acquiredAt: (/* @__PURE__ */ new Date()).toISOString(), featureId, operation }));
      return async () => {
        await rm(directory, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await readFile18(path20.join(directory, "owner.json"), "utf8"));
        const age = Date.now() - Date.parse(owner.acquiredAt);
        let live = owner.hostname === hostname();
        if (live) {
          try {
            process.kill(owner.pid, 0);
          } catch {
            live = false;
          }
        }
        if (!live && age > 3e4) {
          await rm(directory, { recursive: true, force: true });
          continue;
        }
      } catch {
      }
      if (Date.now() - started >= 5e3) throw new DevFlowError("STATE_LOCK_TIMEOUT", "state lock could not be acquired");
      await delay(50 + Math.floor(Math.random() * 20));
    }
  }
}
async function readState(root, featureId) {
  try {
    const raw = JSON.parse(await readFile18(statePath(root, featureId), "utf8"));
    const state = raw?.schemaVersion === 6 ? await hydrateFeatureState(root, raw) : (() => {
      validateFeatureState(raw);
      return raw;
    })();
    validateFeatureState(state);
    if (state.featureId !== featureId) throw new DevFlowError("INVALID_STATE_SCHEMA", "state feature id does not match its path");
    return state;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    if (error.code === "ENOENT") throw new DevFlowError("FEATURE_NOT_FOUND", `feature ${featureId} does not exist`, {
      userMessage: "\u627E\u4E0D\u5230\u8BE5 feature\u3002",
      cause: `feature ${featureId} \u4E0D\u5B58\u5728\uFF0C\u6216\u5C1A\u672A\u901A\u8FC7 dev_flow_start \u521B\u5EFA\u3002`,
      impact: "\u672A\u521B\u5EFA\u8BE5 feature \u524D\u65E0\u6CD5\u67E5\u770B\u5176\u72B6\u6001\u3002",
      recoveryKind: "retry",
      recoveryInstruction: "\u5148 dev_flow_start \u521B\u5EFA\u8BE5 feature\uFF1B\u5982\u5DF2\u521B\u5EFA\uFF0C\u6838\u5BF9 featureId\u3002",
      retryOriginal: true,
      requiresUserDecision: false
    });
    throw new DevFlowError("INVALID_STATE_SCHEMA", `feature ${featureId} state is unreadable`, {
      recoveryHint: "Run dev_flow_doctor; if corrupt, use dev_flow_recover_corrupt_feature then start a new feature"
    });
  }
}
async function readActive(root) {
  let raw;
  try {
    raw = await readFile18(activePath(root), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw new DevFlowError("ACTIVE_POINTER_UNREADABLE", "active.json cannot be read", { recoveryHint: "Run dev_flow_doctor and use recovery; do not start a new feature" });
  }
  try {
    const active = JSON.parse(raw);
    if (typeof active.featureId !== "string" || !active.featureId || typeof active.revision !== "number" || !Number.isInteger(active.revision) || active.revision < 0) {
      throw new Error("invalid active pointer fields");
    }
    return { featureId: active.featureId, revision: active.revision, ...typeof active.updatedAt === "string" ? { updatedAt: active.updatedAt } : {} };
  } catch {
    throw new DevFlowError("ACTIVE_POINTER_UNREADABLE", "active.json is invalid", { recoveryHint: "Run dev_flow_doctor and use recovery; do not start a new feature" });
  }
}
async function appendEvent(root, id, revision, type, data) {
  const eventSequence = await nextFeatureEventSequence(root, id);
  const handle = await open10(eventPath(root, id), "a");
  try {
    await handle.writeFile(`${JSON.stringify({ eventSequence, revision, type, at: (/* @__PURE__ */ new Date()).toISOString(), data })}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function assertWorkspaceOwnershipComplete(root, state, config, operation) {
  const reconciled = await reconcileWorkspaceForFeature(root, state, config);
  const unownedPaths = reconciled.workspace.unownedPaths ?? [];
  if (unownedPaths.length) {
    throw new DevFlowError("WORKSPACE_OWNERSHIP_REQUIRED", `unknown workspace ownership before ${operation}`, {
      userMessage: `${operation} \u524D\u53D1\u73B0\u5C1A\u672A\u786E\u8BA4\u5F52\u5C5E\u7684\u5DE5\u4F5C\u533A\u8DEF\u5F84\u3002`,
      cause: `\u4EE5\u4E0B\u8DEF\u5F84\u5DF2\u88AB\u89C2\u5BDF\u5230\uFF0C\u4F46\u6CA1\u6709\u53EF\u4FE1\u7684 ownership \u7ED3\u8BBA\uFF1A${unownedPaths.join("\u3001")}`,
      impact: "\u64CD\u4F5C\u6CA1\u6709\u63A8\u8FDB feature\u3001checkpoint\u3001verification \u6216\u4EA4\u4ED8\u72B6\u6001\u3002",
      recoveryKind: "refresh",
      recoveryInstruction: "\u5148\u8C03\u7528 dev_flow_reconcile_workspace\uFF0C\u6309\u5F53\u524D\u6E05\u5355\u5B8C\u6210\u5168\u90E8\u7EB3\u5165\u3001\u5168\u90E8\u6392\u9664\u6216\u9010\u4E2A\u786E\u8BA4\uFF0C\u518D\u91CD\u8BD5\u539F\u64CD\u4F5C\u3002",
      retryOriginal: true,
      operation,
      unownedPaths
    });
  }
  return reconciled.workspace;
}
async function recordHostEvent(root, hostEvent) {
  if (hostEvent.type === "review-execution") {
    throw new DevFlowError("REVIEW_EXECUTION_EVENT_INVALID", "review execution proofs must use the dedicated adapter seam");
  }
  const active = await readActive(root);
  if (!active) return;
  const release = await lock(root, active.featureId, "host-event");
  try {
    const state = await readState(root, active.featureId);
    const events = await readFeatureEvents(root, active.featureId);
    const duplicate = events.some((item) => {
      const recorded = item.data;
      return item.type === "host-event" && recorded.host === hostEvent.host && recorded.eventId === hostEvent.eventId;
    });
    if (!duplicate) await appendEvent(root, active.featureId, state.revision, "host-event", { ...hostEvent, at: hostEvent.at ?? (/* @__PURE__ */ new Date()).toISOString() });
  } finally {
    await release();
  }
}
async function recordReviewExecutionEvent(root, hostEvent) {
  for (const [key, value] of Object.entries(hostEvent)) {
    if (["at", "parentContextId"].includes(key)) continue;
    if (typeof value !== "string" || !value.trim()) throw new DevFlowError("REVIEW_EXECUTION_EVENT_INVALID", `${key} must be non-empty`);
  }
  const active = await readActive(root);
  if (!active) return;
  const release = await lock(root, active.featureId, "review-execution-event");
  try {
    const state = await readState(root, active.featureId);
    const events = await readFeatureEvents(root, active.featureId);
    if (events.some((item) => item.type === "review-execution" && item.data.eventId === hostEvent.eventId)) return;
    await appendEvent(root, active.featureId, state.revision, "review-execution", { ...hostEvent, at: hostEvent.at ?? (/* @__PURE__ */ new Date()).toISOString() });
  } finally {
    await release();
  }
}
function isDeliveryOwnedPath(file) {
  return file !== ".dev-flow" && !file.startsWith(".dev-flow/") && file !== "devflow-issues" && !file.startsWith("devflow-issues/");
}
function governedWritePaths(paths, governedRoots) {
  return paths.filter((file) => governedRoots.some((entry) => entry === "." || file === entry || file.startsWith(`${entry}/`)));
}
async function recordTrustedWriteIntent(root, paths, host, eventId2) {
  const active = await readActive(root);
  if (!active || paths.length === 0) return;
  const state = await readState(root, active.featureId);
  if (state.mode !== "routed" || state.lifecycle !== "active") return;
  const config = await readProjectConfig(root);
  const governed = governedWritePaths(paths, config.governedRoots);
  if (!governed.length) return;
  const before = Object.fromEntries(await Promise.all(governed.map(async (file) => [file, await trustedWriteSummary(root, file)])));
  await appendFeatureEvent(root, state.featureId, state.revision, "trusted-write-before", { eventId: eventId2, host, paths: governed, before });
}
async function recordTrustedWriteOwnership(root, paths, host, eventId2) {
  const active = await readActive(root);
  if (!active || paths.length === 0) return;
  const state = await readState(root, active.featureId);
  if (state.mode !== "routed" || state.lifecycle !== "active") return;
  const config = await readProjectConfig(root);
  const governed = governedWritePaths(paths, config.governedRoots);
  if (!governed.length) return;
  const after = Object.fromEntries(await Promise.all(governed.map(async (file) => [file, await trustedWriteSummary(root, file)])));
  const events = await readFeatureEvents(root, state.featureId);
  const intent = [...events].reverse().find((event) => {
    if (event.type !== "trusted-write-before") return false;
    const data = event.data;
    return data.eventId === eventId2;
  });
  const before = intent?.data?.before ?? {};
  const operational = governed.filter((file) => !isDeliveryOwnedPath(file));
  const delivery = governed.filter(isDeliveryOwnedPath).filter((file) => after[file] !== (before[file] ?? "missing"));
  if (operational.length) {
    await appendFeatureEvent(root, state.featureId, state.revision, "operational-write", { eventId: eventId2, host, paths: operational, after: Object.fromEntries(operational.map((file) => [file, after[file]])) });
  }
  if (!delivery.length) return;
  await mutate(root, state.featureId, state.revision, "trusted-write-owned", (draft) => {
    for (const file of delivery) {
      draft.workspace.ownership[file] = "feature";
      draft.workspace.ownershipSource[file] = "trusted-hook";
    }
    draft.workspace.unownedPaths = (draft.workspace.unownedPaths ?? []).filter((file) => !delivery.includes(file));
    draft.lastUpdatedBy = { host, pluginVersion: "6.0.1" };
  }, { eventId: eventId2, host, paths: delivery, after: Object.fromEntries(delivery.map((file) => [file, after[file]])) });
}
async function recordHostAuthorizationEvent(root, type, record) {
  const active = await readActive(root);
  if (!active || active.featureId !== record.featureId) return;
  const release = await lock(root, active.featureId, "host-authorization");
  try {
    const current = await readActive(root);
    if (!current || current.featureId !== record.featureId || current.revision !== active.revision) return;
    const state = await readState(root, record.featureId);
    if (state.lifecycle !== "active" || state.revision !== current.revision) return;
    const events = await readFeatureEvents(root, record.featureId);
    const duplicate = events.some((event) => {
      if (event.type !== type) return false;
      const value = event.data;
      return value.host === record.host && value.featureId === record.featureId && value.riskClass === record.riskClass && value.commandFingerprint === record.commandFingerprint && value.sourceToolEvent === record.sourceToolEvent;
    });
    if (!duplicate) await appendEvent(root, record.featureId, state.revision, type, record);
  } finally {
    await release();
  }
}
async function readHostAuthorizationEvents(root, featureId) {
  const events = await readFeatureEvents(root, featureId);
  return events.flatMap((event) => {
    if (event.type !== "host-authorization-pending" && event.type !== "host-authorization-granted") return [];
    return [{ type: event.type, data: event.data }];
  });
}
async function readFeatureEvents(root, id) {
  const result = await readSegmentedFeatureEvents(root, id);
  return result.records.map((record) => ({
    eventSequence: record.eventSequence,
    revision: record.revision,
    type: record.type,
    at: record.at,
    data: record.data
  }));
}
async function mutate(root, id, expectedRevision, operation, mutator, eventData = {}) {
  return mutatePrepared(root, id, expectedRevision, operation, async () => ({ mutate: mutator, eventData }));
}
async function mutatePrepared(root, id, expectedRevision, operation, prepare, options = {}) {
  const release = await lock(root, id, operation);
  try {
    return await mutatePreparedLocked(root, id, expectedRevision, operation, prepare, options);
  } finally {
    await release();
  }
}
async function mutatePreparedLocked(root, id, expectedRevision, operation, prepare, options = {}) {
  const state = await readState(root, id);
  await assertNoOpenRollbackTransaction(root, { featureId: id, transactionId: options.allowRollbackTransaction });
  if (state.revision !== expectedRevision) throw new DevFlowError("STATE_REVISION_CONFLICT", "state revision changed", { currentRevision: state.revision });
  const presentedBefore = new Set(Object.values(state.interactions ?? {}).filter((interaction) => interaction.status === "pending").map((interaction) => interaction.id));
  const prepared = await prepare(state, state.revision + 1);
  if (prepared.unchanged) return state;
  await prepared.mutate(state);
  state.revision += 1;
  const nextSequence = await nextFeatureEventSequence(root, id);
  for (const interaction of Object.values(state.interactions ?? {})) {
    if (interaction.status === "pending" && !presentedBefore.has(interaction.id) && interaction.presentationEventSequence === void 0) {
      interaction.presentationEventSequence = nextSequence;
    }
  }
  await prepareReviewProjection(root, state);
  validateFeatureState(state);
  const writeStatus = await prepareStatusProjection(root, state, state.revision);
  await options.fault?.("before-state-commit");
  const persisted = await persistableFeatureState(root, state);
  await writeAtomic2(statePath(root, id), persisted);
  state.archivedCollections = persisted.archivedCollections;
  const failures = [];
  try {
    await options.fault?.("after-state-commit");
  } catch {
    failures.push("after-state-commit");
  }
  try {
    await writeStatus?.();
  } catch {
    failures.push("status");
  }
  try {
    const data = typeof prepared.eventData === "function" ? prepared.eventData() : prepared.eventData ?? {};
    await appendEvent(root, id, state.revision, operation, data);
  } catch {
    failures.push("event");
  }
  try {
    const active = await readActive(root);
    if (active?.featureId === id && (state.lifecycle === "finalized" || state.lifecycle === "abandoned" || state.lifecycle === "paused")) await rm(activePath(root), { force: true });
    else if (state.lifecycle === "active" && (active?.featureId === id || !active && ["feature-resumed", "workspace-reconciled", "feature-derived-state-repaired"].includes(operation))) await writeAtomic2(activePath(root), { featureId: id, revision: state.revision, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  } catch {
    failures.push("active");
  }
  try {
    await runBoundedEvidenceMaintenance(root, id, state);
  } catch {
    failures.push("evidence-maintenance");
  }
  if (failures.length) {
    throw new DevFlowError("STATE_COMMITTED_PROJECTION_FAILED", "state commit succeeded but one or more projections failed", {
      committed: true,
      currentRevision: state.revision,
      failedProjections: failures
    });
  }
  return state;
}
function isRecoveryPhase(value) {
  return value === "prepared" || value === "directory-moved" || value === "active-cleared" || value === "completed";
}
function validateRecoveryTransaction(value) {
  const transaction = value;
  if (transaction?.schemaVersion !== 1 || typeof transaction.transactionId !== "string" || !transaction.transactionId || !isRecoveryPhase(transaction.phase) || typeof transaction.featureId !== "string" || !transaction.featureId || typeof transaction.stateSha256 !== "string" || !transaction.stateSha256 || typeof transaction.recoveredTo !== "string" || !path20.isAbsolute(transaction.recoveredTo) || typeof transaction.reason !== "string" || typeof transaction.userEvidence !== "string" || transaction.host !== "claude" && transaction.host !== "codex" || typeof transaction.at !== "string" || transaction.activeSha256 !== void 0 && typeof transaction.activeSha256 !== "string") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
  if (path20.basename(transaction.featureId) !== transaction.featureId || transaction.featureId === "." || transaction.featureId === "..") {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal has an unsafe feature id", { recoveryHint: "Run dev_flow_doctor; recovery remains fail-closed" });
  }
}
function validateRecoveryLocation(root, transaction) {
  const recoveredRoot = path20.join(devFlow(root), "recovered");
  const relative = path20.relative(recoveredRoot, transaction.recoveredTo);
  if (!relative || relative.startsWith("..") || path20.isAbsolute(relative) || path20.basename(relative) !== relative) {
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal points outside the recovered directory", {
      recoveryHint: "Run dev_flow_doctor; do not start a new feature or hand-edit .dev-flow"
    });
  }
}
async function readRecoveryTransaction(root) {
  let raw;
  try {
    raw = await readFile18(recoveryTxnPath(root), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal cannot be read", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
  }
  try {
    const transaction = JSON.parse(raw);
    validateRecoveryTransaction(transaction);
    validateRecoveryLocation(root, transaction);
    return transaction;
  } catch (error) {
    if (error instanceof DevFlowError) throw error;
    throw new DevFlowError("RECOVERY_TRANSACTION_UNREADABLE", "recovery journal is not valid JSON", { recoveryHint: "Run dev_flow_doctor; do not start a new feature" });
  }
}
async function readRollbackJournalPresence(root, featureId) {
  let raw;
  try {
    raw = await readFile18(rollbackTxnPath(root, featureId), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return void 0;
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal cannot be read", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal is not valid JSON", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
  const journal = parsed;
  if (typeof journal.phase !== "string" || typeof journal.transactionId !== "string" || typeof journal.featureId !== "string") {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal is invalid", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
  if (journal.featureId !== featureId) {
    throw new DevFlowError("ROLLBACK_TRANSACTION_UNREADABLE", "rollback transaction journal feature id does not match its path", {
      recoveryHint: "Run dev_flow_doctor; the workspace may be mid-rollback \u2014 do not hand-edit .dev-flow"
    });
  }
  const finished = (journal.phase === "committed" || journal.phase === "compensated") && typeof journal.completedAt === "string";
  return { finished, transactionId: journal.transactionId, featureId: journal.featureId, phase: journal.phase };
}
async function assertNoOpenRollbackTransaction(root, allow) {
  let entries;
  try {
    entries = await readdir7(features(root), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const presence = await readRollbackJournalPresence(root, entry.name);
    if (!presence || presence.finished) continue;
    if (allow?.featureId === entry.name && allow.transactionId !== void 0 && allow.transactionId === presence.transactionId) continue;
    throw new DevFlowError("ROLLBACK_TRANSACTION_OPEN", "a rollback transaction is open", {
      transactionId: presence.transactionId,
      featureId: entry.name,
      phase: presence.phase,
      recoveryHint: `Resume the rollback transaction for feature ${entry.name} with the same input before mutating features`
    });
  }
}
async function appendFeatureEvent(root, id, revision, type, data) {
  await appendEvent(root, id, revision, type, data);
}
var lifecycles, unitStatuses, interactionKinds, delay, devFlow, features, statePath, eventPath, activePath, recoveryTxnPath, rollbackTxnPath;
var init_state_store = __esm({
  "plugins/dev-flow/src/core/state-store.ts"() {
    "use strict";
    init_contract2();
    init_types();
    init_evidence_store();
    init_errors();
    init_step_order();
    init_repository_facts();
    init_fingerprint();
    init_project_config();
    init_traceability_gates();
    init_review_store();
    init_event_segments();
    init_state_archive2();
    init_evidence_maintenance();
    init_workspace_store();
    init_review_projection();
    init_path_normalization();
    init_git_reconciliation();
    init_decision_interactions();
    init_host_health();
    init_project_config_impact();
    init_requirements_grill();
    init_ownership_workflow();
    init_ownership_workflow();
    init_ownership_workflow();
    init_route_workflow();
    init_decision_workflow();
    init_plan_revision2();
    init_interaction_answer();
    init_host_health();
    lifecycles = /* @__PURE__ */ new Set(["active", "paused", "finalized", "abandoned"]);
    unitStatuses = /* @__PURE__ */ new Set(["pending", "active", "verified", "checkpointed", "rolled_back"]);
    interactionKinds = /* @__PURE__ */ new Set(["approval", "grill", "risk-acceptance", "rollback-confirmation", "quality-exception", "workspace-ownership", "route-confirmation", "task-switch", "decision-ratification", "decision-revision", "plan-revision", "side-effect-rerun", "acceptance-confirmation"]);
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    devFlow = (root) => path20.join(root, ".dev-flow");
    features = (root) => path20.join(devFlow(root), "features");
    statePath = (root, id) => path20.join(features(root), id, "state.json");
    eventPath = (root, id) => path20.join(features(root), id, "events.jsonl");
    activePath = (root) => path20.join(devFlow(root), "active.json");
    recoveryTxnPath = (root) => path20.join(devFlow(root), "recovery-transaction.json");
    rollbackTxnPath = (root, featureId) => path20.join(features(root), featureId, "rollback-transaction.json");
  }
});

// plugins/dev-flow/src/hosts/hook-adapter.ts
init_state_store();

// plugins/dev-flow/src/hosts/adapter-policy.ts
import { execFile as execFile4 } from "node:child_process";
import { promisify as promisify4 } from "node:util";

// plugins/dev-flow/src/core/git-policy.ts
var readOnly = /* @__PURE__ */ new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "ls-tree", "cat-file", "name-rev"]);
var write = /* @__PURE__ */ new Set(["add", "commit", "push", "merge", "rebase", "tag", "cherry-pick", "reset"]);
function isReadOnly(subcommand, args) {
  if (readOnly.has(subcommand)) return true;
  const normalized = args.trim();
  if (subcommand === "branch") return normalized === "" || /^(--list|--show-current|-a|-r|-v|-vv)(\s|$)/.test(normalized);
  if (subcommand === "remote") return /^(?:-v|show|get-url)(\s|$)/.test(normalized);
  if (subcommand === "config") return /^(?:--get|--get-all|--list)(\s|$)/.test(normalized);
  if (subcommand === "worktree") return /^list(\s|$)/.test(normalized);
  if (subcommand === "stash") return /^(?:list|show)(\s|$)/.test(normalized);
  return false;
}
function classifyGitCommand(command) {
  const commands = [...command.matchAll(/(?:^|[;&|]\s*|\$\([^)]*?)(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*(?:command\s+)?git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))?\s+([\w-]+)([^;&|\n)]*)/g)];
  if (!commands.length) return "other";
  for (const match of commands) {
    const subcommand = match[1];
    const args = match[2] ?? "";
    if (write.has(subcommand) || !isReadOnly(subcommand, args)) return "write";
  }
  return "read";
}
function classifyGitCommandKind(command) {
  const commands = [...command.matchAll(/(?:^|[;&|]\s*)(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*(?:command\s+)?git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))?\s+([\w-]+)([^;&|\n)]*)/g)];
  if (!commands.length) return "other";
  let result = "read";
  for (const match of commands) {
    const subcommand = match[1];
    const args = (match[2] ?? "").trim();
    if (isReadOnly(subcommand, args)) continue;
    if (subcommand === "add") result = "local-stage";
    else if (subcommand === "commit") result = result === "history-rewrite" ? result : "local-commit";
    else if (subcommand === "push") result = "external-publish";
    else result = "history-rewrite";
  }
  return result;
}
var gitReadOnlyCommands = [...readOnly].sort();

// plugins/dev-flow/src/core/write-gate.ts
init_approval_basis();
init_implementation_units();
init_review_store();
init_state_store();
init_step_order();
init_traceability_store();
import path21 from "node:path";
function block(code, paths, reason, detail) {
  return { decision: "block", block: { code, paths, reason, ...detail ? { detail } : {} } };
}
var controlFileNames = /* @__PURE__ */ new Set(["state.json", "active.json", "project.json", "events.jsonl", "status.md", "\u72B6\u6001\u6587\u6863.md", "recovery-transaction.json", "recovery-events.jsonl"]);
function isDevFlowPath(relative) {
  return relative === ".dev-flow" || relative.startsWith(".dev-flow/");
}
function isControlPath(relative) {
  if (!isDevFlowPath(relative)) return false;
  if (/^\.dev-flow\/features\/[^/]+\/traceability(?:\/|$)/.test(relative)) return true;
  if (/^\.dev-flow\/features\/[^/]+\/review\/(?:snapshots|packages|projections)(?:\/|$)/.test(relative)) return true;
  const base = path21.posix.basename(relative);
  if (controlFileNames.has(base)) return true;
  if (relative.includes("/.lock/") || relative.endsWith("/.lock")) return true;
  if (relative === ".dev-flow/active.json" || relative === ".dev-flow/project.json") return true;
  if (relative.includes("/recovered/")) return true;
  if (relative.endsWith("/state.json") || relative.endsWith("/events.jsonl") || relative.endsWith("/status.md") || relative.endsWith("/\u72B6\u6001\u6587\u6863.md")) return true;
  return false;
}
function isGoverned(relative, governedRoots) {
  return governedRoots.some((item) => relative === item || relative.startsWith(`${item}/`));
}
function isGeneratedReviewProjectionPath(kind, artifactPath) {
  return kind === "plan-review" && typeof artifactPath === "string" && /^review\/projections\/[a-f0-9]{64}\.md$/.test(artifactPath);
}
function inFeatureScope(relative, state) {
  return state.scope.inScope.some((scope) => scope === "." || relative === scope || relative.startsWith(`${scope}/`));
}
async function loadActiveWorkflow(root) {
  try {
    const recovery = await readRecoveryTransaction(root);
    if (recovery) {
      try {
        const project2 = await readProjectConfig(root);
        return { kind: "unreadable", reason: `recovery journal open for ${recovery.featureId}`, governedRoots: project2.governedRoots, blockAllWrites: false };
      } catch {
        return { kind: "unreadable", reason: "project.json invalid while recovery journal is open", blockAllWrites: true };
      }
    }
  } catch {
    return { kind: "unreadable", reason: "recovery journal unreadable", blockAllWrites: true };
  }
  let active;
  try {
    active = await readActive(root);
  } catch {
    try {
      const project2 = await readProjectConfig(root);
      return { kind: "unreadable", reason: "active.json unreadable", governedRoots: project2.governedRoots, blockAllWrites: false };
    } catch {
      return { kind: "unreadable", reason: "project.json invalid while active.json is unreadable", blockAllWrites: true };
    }
  }
  if (!active) return { kind: "none" };
  let project;
  try {
    project = await readProjectConfig(root);
  } catch {
    return { kind: "unreadable", reason: "project.json invalid", blockAllWrites: true };
  }
  let state;
  let ledger;
  try {
    state = await readState(root, active.featureId);
  } catch {
    return { kind: "unreadable", reason: "state invalid", governedRoots: project.governedRoots, blockAllWrites: false };
  }
  if (state.lifecycle !== "active" || active.revision !== state.revision) return { kind: "unreadable", reason: "active pointer revision mismatch", governedRoots: project.governedRoots, blockAllWrites: false };
  if (state.traceability) {
    try {
      ledger = await readTraceability(root, state);
    } catch {
      return { kind: "unreadable", reason: "traceability snapshot invalid", governedRoots: project.governedRoots, blockAllWrites: false };
    }
  }
  if (state.review) {
    try {
      await readReviewLedger(root, state);
    } catch {
      return { kind: "unreadable", reason: "review snapshot invalid", governedRoots: project.governedRoots, blockAllWrites: false };
    }
  }
  const allowedArtifacts = /* @__PURE__ */ new Set();
  for (const [kind, artifact] of Object.entries(state.artifacts ?? {})) {
    if (kind === "status" || !artifact?.path) continue;
    if (isGeneratedReviewProjectionPath(kind, artifact.path)) continue;
    if (typeof artifact.path !== "string" || path21.posix.dirname(artifact.path) !== "." || !artifact.path.endsWith(".md")) {
      return { kind: "unreadable", reason: "artifact path invalid", governedRoots: project.governedRoots, blockAllWrites: false };
    }
    const relative = `.dev-flow/features/${active.featureId}/${artifact.path}`.split(path21.sep).join("/");
    allowedArtifacts.add(relative);
  }
  return {
    kind: "ready",
    workflow: {
      featureId: active.featureId,
      logicComplete: state.logicComplete,
      approvalConfirmed: Boolean(confirmedApproval(state)),
      allowedArtifacts,
      governedRoots: project.governedRoots,
      state,
      ledger
    }
  };
}
async function revokedImplementationApprovalHint(root, featureId) {
  const events = await readFeatureEvents(root, featureId);
  let lastConfirmedIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    const data = event.data;
    if ((event.type === "approval-confirmed" || event.type === "approval-interaction-resolved") && typeof data.approval === "string" && data.approval.startsWith("approval:")) {
      lastConfirmedIndex = index;
      break;
    }
  }
  if (lastConfirmedIndex < 0) return void 0;
  for (let index = events.length - 1; index >= lastConfirmedIndex; index--) {
    const event = events[index];
    const data = event.data;
    if ((event.type === "artifact-recorded" || event.type === "artifact-recorded-with-trace") && data.kind !== void 0 && approvalBasisArtifacts.includes(data.kind) && data.invalidationReason) {
      return data.kind;
    }
  }
  return void 0;
}
async function writeGate(root, intent) {
  if (intent.kind === "file" && "unresolved" in intent) {
    const loaded2 = await loadActiveWorkflow(root);
    return loaded2.kind === "ready" ? { decision: "allow", advisory: "unresolved-write" } : { decision: "allow" };
  }
  if (intent.kind === "file") {
    for (const relative of intent.paths) {
      if (isControlPath(relative)) {
        return block("CONTROL_MUTATION_FORBIDDEN", [relative], "workflow control files are Core-owned", { variant: "control-file" });
      }
    }
  }
  const loaded = await loadActiveWorkflow(root);
  if (loaded.kind === "none") return { decision: "allow" };
  if (loaded.kind === "unreadable") {
    if (intent.kind === "git") {
      return block("WORKFLOW_STATE_UNREADABLE", [], loaded.reason, { unreadableReason: loaded.reason });
    }
    for (const relative of intent.paths) {
      if (loaded.blockAllWrites || isDevFlowPath(relative) || isGoverned(relative, loaded.governedRoots ?? [])) {
        return block("WORKFLOW_STATE_UNREADABLE", [relative], loaded.reason, { unreadableReason: loaded.reason });
      }
    }
    return { decision: "allow" };
  }
  if (intent.kind === "git") return evaluateGitWrite(loaded.workflow, intent);
  return evaluateFileWrite(root, loaded.workflow, intent.paths);
}
async function evaluateFileWrite(root, workflow, paths) {
  const state = workflow.state;
  if (!state) return { decision: "allow" };
  let unitNeededPath;
  let governedWriteObserved = false;
  for (const relative of paths) {
    if (isControlPath(relative)) return block("CONTROL_MUTATION_FORBIDDEN", [relative], "workflow control files are Core-owned", { variant: "control-file" });
    if (isDevFlowPath(relative)) {
      if (workflow.allowedArtifacts.has(relative)) continue;
      if (relative.startsWith(`.dev-flow/features/${workflow.featureId}/`) && relative.endsWith(".md")) {
        return block("ARTIFACT_NOT_REGISTERED", [relative], "feature artifact Markdown is not registered");
      }
      return block("CONTROL_MUTATION_FORBIDDEN", [relative], "Dev Flow control area is Core-owned", { variant: "control-area" });
    }
    const governed = isGoverned(relative, workflow.governedRoots);
    if (state.mode === "intake" && governed) {
      return approvalBlock(root, workflow, relative, "intake");
    }
    if (state.mode === "routed" && currentOpenStep(state) === "implementation" && governed) {
      const approvalPending = state.obligations?.some((obligation) => obligation.kind === "approval" && obligation.status !== "satisfied") ?? false;
      if (approvalPending && !workflow.approvalConfirmed) {
        return approvalBlock(root, workflow, relative, "approval");
      }
      const unitBlock = implementationUnitWriteBlock(state, workflow.ledger, relative);
      if (unitBlock?.code === "IMPLEMENTATION_UNIT_OUT_OF_SCOPE") {
        return block("IMPLEMENTATION_UNIT_OUT_OF_SCOPE", [relative], "active implementation unit is not backed by the current trace");
      }
      if (unitBlock?.code === "IMPLEMENTATION_UNIT_REQUIRED") unitNeededPath ??= relative;
      continue;
    }
    if (state.mode === "routed" && currentOpenStep(state) !== "implementation" && governed) {
      governedWriteObserved = true;
      continue;
    }
  }
  if (unitNeededPath) {
    const assessment = await assessImplementationUnitBegin(root, workflow.featureId, state);
    if (assessment.kind === "blocked") {
      return block("IMPLEMENTATION_UNIT_REQUIRED", [unitNeededPath], "no active implementation unit", { beginFailed: `${assessment.code}: ${assessment.message}` });
    }
    if (assessment.kind === "none") {
      return block("IMPLEMENTATION_UNIT_REQUIRED", [unitNeededPath], "no active implementation unit");
    }
    try {
      await beginImplementationUnit(root, workflow.featureId, state.revision, assessment.unitId);
      return { decision: "allow" };
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : String(error);
      return block("IMPLEMENTATION_UNIT_REQUIRED", [unitNeededPath], "no active implementation unit", { beginFailed: diagnostic });
    }
  }
  if (governedWriteObserved) return { decision: "allow", advisory: "governed-write-observed" };
  return { decision: "allow" };
}
async function approvalBlock(root, workflow, relative, variant) {
  let revokedKind;
  try {
    revokedKind = await revokedImplementationApprovalHint(root, workflow.featureId);
  } catch {
    return block("WORKFLOW_STATE_UNREADABLE", [relative], "events.jsonl invalid or unreadable", { unreadableReason: "events.jsonl invalid or unreadable" });
  }
  return block("IMPLEMENTATION_APPROVAL_REQUIRED", [relative], "governed write requires implementation approval", {
    variant,
    ...revokedKind ? { revokedKind } : {}
  });
}
function evaluateGitWrite(workflow, intent) {
  if (intent.kind !== "git") return { decision: "allow" };
  if ("form" in intent) {
    if (intent.form === "publish") {
      return block("GIT_GUARD", [], "external publish is not allowed", { variant: "publish" });
    }
    return block("GIT_GUARD", [], "git write cannot be safety-enumerated", { variant: "unbounded" });
  }
  const state = workflow.state;
  const paths = intent.paths;
  if (!state || state.lifecycle !== "active") {
    return block("GIT_GUARD", paths, "git delivery write is not allowed before the implementation stage", { variant: "not-eligible" });
  }
  const implementationReady = state.mode === "routed" && currentOpenStep(state) === "implementation" && workflow.approvalConfirmed;
  if (!state.logicComplete && !implementationReady) {
    return block("GIT_GUARD", paths, "git delivery write is not allowed before logic-complete", { variant: "not-eligible" });
  }
  const startedDirty = state.workspace.startedDirty ?? {};
  const startupExcluded = paths.filter((relative) => state.workspace.ownership[relative] === "excluded" && startedDirty[relative] !== void 0);
  const excluded = paths.filter((relative) => state.workspace.ownership[relative] === "excluded" && startedDirty[relative] === void 0);
  const unknown = paths.filter((relative) => state.workspace.ownership[relative] !== "feature" && state.workspace.ownership[relative] !== "excluded" && !inFeatureScope(relative, state));
  if (excluded.length || unknown.length) {
    return block("GIT_GUARD", [...excluded, ...unknown], "git command includes unowned or excluded paths", { variant: "paths" });
  }
  if (startupExcluded.length) {
    return {
      decision: "audit",
      block: {
        code: "GIT_STARTUP_EXCLUDED",
        paths: startupExcluded,
        reason: "startup-excluded pre-existing dirty paths are not blocked but stay out of delivery"
      }
    };
  }
  return { decision: "allow" };
}

// plugins/dev-flow/src/hosts/bash-syntax.ts
import path22 from "node:path";
var directWriteTools = /* @__PURE__ */ new Set(["write", "edit", "multiedit", "applypatch", "apply_patch", "patch"]);
function toolName(event) {
  return String(event.tool_name ?? "").toLowerCase();
}
function isRelevantPreToolUse(event) {
  const name = toolName(event);
  return name === "bash" || directWriteTools.has(name);
}
function projectRelative(root, target) {
  const absolute = path22.resolve(root, target);
  const relative = path22.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path22.isAbsolute(relative)) return void 0;
  return relative.split(path22.sep).join("/").normalize("NFC");
}
function projectRelativePaths(root, targets) {
  const seen = /* @__PURE__ */ new Set();
  const paths = [];
  for (const target of targets) {
    const relative = projectRelative(root, target);
    if (!relative || seen.has(relative)) continue;
    seen.add(relative);
    paths.push(relative);
  }
  return paths;
}
function patchTargets(value) {
  const text = typeof value === "string" ? value : "";
  const targets = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) targets.add(match[1].trim());
  for (const match of text.matchAll(/^(?:---|\+\+\+) (?:a\/|b\/)?(.+)$/gm)) {
    if (match[1] !== "/dev/null") targets.add(match[1].trim());
  }
  return [...targets];
}
function directTargets(event) {
  const input = event.tool_input ?? {};
  const targets = [input.file_path, input.path, input.target_file].filter((value) => typeof value === "string");
  for (const key of ["patch", "diff", "input"]) targets.push(...patchTargets(input[key]));
  return targets;
}
function isTrustedWriteTool(event) {
  const name = toolName(event);
  return name === "bash" || directWriteTools.has(name);
}
function trustedWriteTargets(root, event) {
  if (!isTrustedWriteTool(event)) return [];
  const targets = toolName(event) === "bash" ? (() => {
    const analysis = analyzeBashWriteTargets(String(event.tool_input?.command ?? ""));
    return analysis.kind === "resolved" ? analysis.targets : [];
  })() : directTargets(event);
  return [...new Set(targets.map((target) => projectRelative(root, target)).filter((value) => Boolean(value)))].sort();
}
var writeSyntaxHint = /(?:^|[;&|]\s*)(?:\w+=\S+\s+)*(?:tee\b|touch\b|mkdir\b|rm\b|mv\b|cp\b|sed\s+-i\b|perl\s+-pi\b)|(?:^|\s)>{1,2}\s*|\s>{1,2}\s*|\bapply_patch\b/;
function stripQuotes(token) {
  if (token.startsWith("'") && token.endsWith("'") || token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1);
  return token;
}
function hasUnresolvedExpansion(token) {
  return /\$|`|\*|\{|\?/.test(token);
}
function shellWords(input) {
  const words = [];
  let current = "";
  let quote;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = void 0;
        continue;
      }
      if (quote === '"' && char === "\\") return void 0;
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    if (/[|&;<>()$`*{}?\\]/.test(char)) return void 0;
    current += char;
  }
  if (quote) return void 0;
  if (current) words.push(current);
  return words;
}
function collectPathOperands(words, start) {
  const paths = [];
  let optionsEnded = false;
  for (const word of words.slice(start)) {
    if (!optionsEnded && word === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && word.startsWith("-")) continue;
    if (hasUnresolvedExpansion(word)) return void 0;
    paths.push(word);
  }
  return paths.length ? paths : void 0;
}
function commandWords(segment, command) {
  const match = segment.match(new RegExp(`(?:^|\\s)${command}\\s+([\\s\\S]*)$`));
  if (!match) return void 0;
  return shellWords(match[1]);
}
var heredocDataConsumers = /* @__PURE__ */ new Set(["cat", "tee"]);
function heredocDelimiter(rest) {
  let word = "";
  let index = 0;
  while (index < rest.length && /\s/.test(rest[index])) index += 1;
  while (index < rest.length) {
    const char = rest[index];
    if (char === "'") {
      const end = rest.indexOf("'", index + 1);
      if (end < 0) return void 0;
      word += rest.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    if (char === '"') {
      let cursor = index + 1;
      let inner = "";
      let closed = false;
      while (cursor < rest.length) {
        const current = rest[cursor];
        if (current === '"') {
          closed = true;
          break;
        }
        if (current === "\\" && cursor + 1 < rest.length) {
          const next = rest[cursor + 1];
          if (["$", "`", '"', "\\"].includes(next)) {
            inner += next;
            cursor += 2;
            continue;
          }
          inner += `\\${next}`;
          cursor += 2;
          continue;
        }
        inner += current;
        cursor += 1;
      }
      if (!closed) return void 0;
      word += inner;
      index = cursor + 1;
      continue;
    }
    if (char === "\\") {
      if (index + 1 >= rest.length) return void 0;
      word += rest[index + 1];
      index += 2;
      continue;
    }
    if (/\s/.test(char)) break;
    if (char === "$" || char === "`") return void 0;
    word += char;
    index += 1;
  }
  return word ? { value: word, consumed: index } : void 0;
}
function findHeredocOpener(line) {
  let quote;
  for (let cursor = 0; cursor < line.length - 1; cursor += 1) {
    const char = line[cursor];
    if (quote) {
      if (char === quote) quote = void 0;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "$" && line[cursor + 1] === "(" && line[cursor + 2] === "(" || char === "(" && line[cursor + 1] === "(") {
      let depth = 1;
      cursor += char === "$" ? 2 : 1;
      while (depth > 0 && cursor + 1 < line.length) {
        cursor += 1;
        if (line[cursor] === "(" && line[cursor + 1] === "(") {
          depth += 1;
          cursor += 1;
        } else if (line[cursor] === ")" && line[cursor + 1] === ")") {
          depth -= 1;
          cursor += 1;
        }
      }
      continue;
    }
    if (char !== "<" || line[cursor + 1] !== "<" || line[cursor + 2] === "<") continue;
    let restStart = cursor + 2;
    const stripTabs = line[restStart] === "-";
    if (stripTabs) restStart += 1;
    const parsed = heredocDelimiter(line.slice(restStart));
    return {
      delimiter: parsed?.value,
      openerIndex: cursor,
      openerEndIndex: parsed ? restStart + parsed.consumed : line.length,
      stripTabs
    };
  }
  return void 0;
}
function heredocConsumer(line, openerIndex) {
  const lastSegment = line.slice(0, openerIndex).split(/[;&|]\s*/).at(-1) ?? "";
  const withoutEnv = lastSegment.replace(/^(?:\w+=\S+\s+)+/, "");
  const command = withoutEnv.match(/^\s*(?:command\s+)?([A-Za-z0-9_./-]+)/)?.[1];
  return command ? path22.posix.basename(command) : void 0;
}
function maskHeredocBodies(command) {
  const lines = command.split("\n");
  const masked = [...lines];
  let index = 0;
  while (index < lines.length) {
    const opener = findHeredocOpener(lines[index]);
    if (!opener) {
      index += 1;
      continue;
    }
    const consumer = heredocConsumer(lines[index], opener.openerIndex);
    if (opener.delimiter === void 0 || !consumer || !heredocDataConsumers.has(consumer)) {
      return { masked: command, unsafe: true };
    }
    masked[index] = `${lines[index].slice(0, opener.openerIndex)}${lines[index].slice(opener.openerEndIndex)}`;
    if (findHeredocOpener(masked[index])) return { masked: command, unsafe: true };
    let terminatorIndex = -1;
    for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
      const candidateLine = opener.stripTabs ? lines[candidate].replace(/^\t+/, "") : lines[candidate];
      if (candidateLine === opener.delimiter || candidateLine === `${opener.delimiter}\r`) {
        terminatorIndex = candidate;
        break;
      }
    }
    if (terminatorIndex < 0) return { masked: command, unsafe: true };
    for (let body = index + 1; body < terminatorIndex; body += 1) masked[body] = "";
    index = terminatorIndex + 1;
  }
  return { masked: masked.join("\n"), unsafe: false };
}
function analyzeBashWriteTargets(command) {
  const trimmed = command.trim();
  if (!trimmed) return { kind: "read-only" };
  if (/\b(?:sh|bash|zsh)\s+-c\b/.test(trimmed) || /\bxargs\b/.test(trimmed) || /\bapply_patch\b/.test(trimmed)) {
    return { kind: "unresolved", syntax: "unsupported-shell-wrapper" };
  }
  const { masked, unsafe } = maskHeredocBodies(trimmed);
  if (unsafe) return { kind: "unresolved", syntax: "heredoc-unresolved" };
  if (!writeSyntaxHint.test(masked)) return { kind: "read-only" };
  const segments = masked.split(/(?:&&|\|\||;|\n)/).map((part) => part.trim()).filter(Boolean);
  const targets = [];
  let sawDevNull = false;
  const collect2 = (token) => {
    if (token === "/dev/null") {
      sawDevNull = true;
      return;
    }
    targets.push(token);
  };
  for (const segment of segments) {
    const withoutEnv = segment.replace(/^(?:\w+=\S+\s+)+/, "");
    if (/\b(?:python|node|ruby|perl)\b/.test(withoutEnv) && !/\bsed\s+-i\b/.test(withoutEnv) && !/\bperl\s+-pi\b/.test(withoutEnv)) {
      if (writeSyntaxHint.test(withoutEnv)) return { kind: "unresolved", syntax: "interpreter-write" };
    }
    const redirectMatches = [...withoutEnv.matchAll(/(?:^|[^0-9&])>{1,2}\s*([^\s|&;]+)/g)];
    for (const match of redirectMatches) {
      const token = stripQuotes(match[1]);
      if (hasUnresolvedExpansion(token)) return { kind: "unresolved", syntax: "redirect-expansion" };
      collect2(token);
    }
    const teeIndex = withoutEnv.search(/\btee\b/);
    if (teeIndex >= 0) {
      if ((withoutEnv.match(/\btee\b/g) ?? []).length !== 1) return { kind: "unresolved", syntax: "multiple-tee" };
      const words = commandWords(withoutEnv.slice(teeIndex), "tee");
      const paths = words && collectPathOperands(words, 0);
      if (!paths) return { kind: "unresolved", syntax: "tee-args" };
      for (const path26 of paths) collect2(path26);
    }
    const simple = withoutEnv.match(/^(touch|mkdir|rm)\b/);
    if (simple) {
      const words = commandWords(withoutEnv, simple[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths) return { kind: "unresolved", syntax: "simple-args" };
      for (const path26 of paths) collect2(path26);
    }
    const moveCopy = withoutEnv.match(/^(mv|cp)\b/);
    if (moveCopy) {
      const words = commandWords(withoutEnv, moveCopy[1]);
      const paths = words && collectPathOperands(words, 0);
      if (!paths || paths.length < 2) return { kind: "unresolved", syntax: "mv-cp-args" };
      if (moveCopy[1] === "mv") for (const path26 of paths) collect2(path26);
      else collect2(paths.at(-1));
    }
    const sed = withoutEnv.match(/^sed\s+(-i\S*)\s+([\s\S]*)$/);
    if (sed) {
      const words = shellWords(sed[2]);
      const paths = words && collectPathOperands(words, 1);
      if (!paths) return { kind: "unresolved", syntax: "sed-args" };
      for (const path26 of paths) collect2(path26);
    }
    const perl = withoutEnv.match(/^perl\s+(-pi\S*)\s+([\s\S]*)$/);
    if (perl) {
      const words = shellWords(perl[2]);
      const firstPath = words?.[0] === "-e" ? 2 : 0;
      const paths = words && collectPathOperands(words, firstPath);
      if (!paths) return { kind: "unresolved", syntax: "perl-args" };
      for (const path26 of paths) collect2(path26);
    }
  }
  if (targets.length === 0) {
    if (sawDevNull || masked !== trimmed) return { kind: "read-only" };
    return { kind: "unresolved", syntax: "write-syntax-no-target" };
  }
  return { kind: "resolved", targets };
}

// plugins/dev-flow/src/hosts/block-format.ts
import path23 from "node:path";
function createPreToolBlock(code, reason, impact, recovery) {
  return { code, reason, impact, recovery };
}
function formatPreToolBlock(block2) {
  const confirmation = block2.recovery.mode === "user-decision" ? "\u9700\u8981\u7528\u6237\u51B3\u5B9A\uFF1B\u6A21\u578B\u5E94\u53EA\u8BE2\u95EE\u4E00\u6B21\uFF0C\u786E\u8BA4\u540E\u76F4\u63A5\u6267\u884C\u89E3\u51B3\u52A8\u4F5C\u3002" : block2.recovery.mode === "guided" ? "\u5148\u81EA\u52A8\u6267\u884C\u89E3\u51B3\u52A8\u4F5C\uFF1B\u53EA\u6709\u52A8\u4F5C\u8BC1\u660E\u9700\u8981 recover\u3001\u91CD\u5EFA\u3001\u653E\u5F03\u6216\u6539\u53D8\u76EE\u6807\u65F6\u624D\u8BE2\u95EE\u7528\u6237\u4E00\u6B21\u3002" : "\u4E0D\u9700\u8981\u7528\u6237\u51B3\u5B9A\uFF1B\u6A21\u578B\u53EF\u4EE5\u76F4\u63A5\u6267\u884C\u89E3\u51B3\u52A8\u4F5C\u3002";
  const continuation = block2.recovery.retryOriginal ? "\u89E3\u51B3\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u64CD\u4F5C\uFF0C\u65E0\u9700\u7528\u6237\u518D\u6B21\u56DE\u590D\u7EE7\u7EED" : "\u539F\u64CD\u4F5C\u4E0D\u4F1A\u91CD\u8BD5\uFF1B\u5B8C\u6210\u89E3\u51B3\u52A8\u4F5C\u540E\u7EE7\u7EED\u540E\u7EED\u5FC5\u8981\u6B65\u9AA4";
  return [
    block2.code,
    `\u539F\u56E0\uFF1A${block2.reason}`,
    `\u5F71\u54CD\uFF1A${block2.impact}`,
    `\u89E3\u51B3\u65B9\u6848\uFF1A${block2.recovery.action}`,
    `\u786E\u8BA4\uFF1A${confirmation}`,
    `\u7EE7\u7EED\u65B9\u5F0F\uFF1A${continuation}`
  ].join("\n");
}
var scratchHint = "\uFF1B\u4E34\u65F6\u9A8C\u8BC1\u6587\u4EF6\u8BF7\u653E\u5165 scratch/ \u76EE\u5F55";
function artifactKind(relative) {
  const displayName = path23.posix.basename(relative, ".md");
  return displayName === "\u9700\u6C42\u6587\u6863" ? "requirements" : displayName === "\u5B9E\u65BD\u8BA1\u5212" ? "implementation-plan" : displayName;
}
function unreadableBlock(reason) {
  return createPreToolBlock(
    "DEV_FLOW_WORKFLOW_STATE_UNREADABLE",
    `\u8BFB\u53D6\u5DE5\u4F5C\u6D41\u8BC1\u636E\u5931\u8D25\uFF1A${reason}`,
    "\u539F\u64CD\u4F5C\u672A\u6267\u884C\uFF1B\u65E0\u6CD5\u5B89\u5168\u786E\u8BA4\u5F53\u524D workflow gate \u662F\u5426\u6EE1\u8DB3",
    {
      mode: "guided",
      action: "\u5148\u81EA\u52A8\u5237\u65B0 active/state \u5E76\u8FD0\u884C\u53EA\u8BFB dev_flow_doctor\uFF1B\u53EA\u6709 doctor \u8BC1\u660E\u5FC5\u987B recover\u3001\u91CD\u5EFA\u6216\u653E\u5F03 feature \u65F6\u624D\u5411\u7528\u6237\u8BE2\u95EE\u4E00\u6B21\uFF0C\u89E3\u51B3\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u64CD\u4F5C",
      retryOriginal: true
    }
  );
}
function formatWriteGateBlock(block2) {
  const relative = block2.paths[0] ?? "";
  const detail = block2.detail;
  switch (block2.code) {
    case "CONTROL_MUTATION_FORBIDDEN":
      if (detail?.variant === "control-area") {
        return createPreToolBlock(
          "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
          `\u76EE\u6807 ${relative} \u4F4D\u4E8E Dev Flow \u63A7\u5236\u533A\uFF0C\u4E14\u4E0D\u662F active feature \u5DF2\u767B\u8BB0\u7684\u53EF\u7F16\u8F91 Markdown \u8D44\u4EA7`,
          "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1BDev Flow \u63A7\u5236\u533A\u6CA1\u6709\u88AB\u4FEE\u6539",
          { mode: "user-decision", action: "\u786E\u8BA4\u540E\u7531\u6A21\u578B\u8C03\u7528\u5BF9\u5E94 MCP \u5B8C\u6210\u540C\u4E00\u5DE5\u4F5C\u6D41\u610F\u56FE\uFF1B\u4E0D\u8981\u76F4\u63A5\u7F16\u8F91\u63A7\u5236\u533A\u6587\u4EF6", retryOriginal: false }
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
        `\u76EE\u6807 ${relative} \u662F Dev Flow \u63A7\u5236\u6587\u4EF6\uFF0C\u4E0D\u80FD\u7531\u666E\u901A\u6587\u4EF6\u5DE5\u5177\u76F4\u63A5\u4FEE\u6539`,
        "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1B\u5DE5\u4F5C\u6D41\u63A7\u5236\u72B6\u6001\u4FDD\u6301\u4E0D\u53D8",
        { mode: "user-decision", action: `\u786E\u8BA4\u540E\u7531\u6A21\u578B\u8C03\u7528\u5BF9\u5E94 MCP \u5B8C\u6210\u5BF9 ${relative} \u7684\u540C\u4E00\u610F\u56FE\uFF1B\u4E0D\u8981\u91CD\u8BD5\u8FD9\u6B21\u63A7\u5236\u6587\u4EF6\u76F4\u63A5\u5199\u5165`, retryOriginal: false }
      );
    case "ARTIFACT_NOT_REGISTERED": {
      const kind = artifactKind(relative);
      return createPreToolBlock(
        "DEV_FLOW_ARTIFACT_NOT_REGISTERED",
        `\u76EE\u6807 ${relative} \u662F active feature \u7684 ${kind} Markdown \u8D44\u4EA7\uFF0C\u4F46\u5C1A\u672A\u767B\u8BB0`,
        "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1B\u8BE5\u8D44\u4EA7\u4E0D\u4F1A\u8FDB\u5165 feature \u8BC1\u636E\u8D26\u672C",
        { mode: "guided", action: `\u5148\u901A\u8FC7 MCP scaffold/register ${kind} \u8D44\u4EA7 ${relative}\uFF0C\u518D\u81EA\u52A8\u91CD\u8BD5\u539F\u5199\u5165`, retryOriginal: true }
      );
    }
    case "IMPLEMENTATION_APPROVAL_REQUIRED": {
      const impact = "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1B\u76EE\u6807\u6587\u4EF6\u548C\u5F53\u524D feature \u72B6\u6001\u672A\u6539\u53D8";
      if (detail?.revokedKind) {
        const action = `\u8BA1\u5212\u4F9D\u636E\uFF08${detail.revokedKind}\uFF09\u5DF2\u5728\u5B9E\u73B0\u6279\u51C6\u540E\u53D8\u66F4\uFF0C\u6279\u51C6\u5DF2\u4F5C\u5E9F\uFF1B\u8BF7\u5148\u5B8C\u6210\u76F8\u5173\u6B65\u9AA4\u5E76\u91CD\u65B0\u786E\u8BA4\u5B9E\u73B0\u6279\u51C6\u540E\u518D\u5199 governed \u6587\u4EF6${scratchHint}`;
        return createPreToolBlock("DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED", action, impact, { mode: "user-decision", action, retryOriginal: true });
      }
      if (detail?.variant === "approval") {
        return createPreToolBlock(
          "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
          `\u5F53\u524D open step \u662F implementation\uFF0C\u4F46\u76EE\u6807 ${relative} \u4F4D\u4E8E governed root\uFF0C\u6267\u884C\u6279\u51C6\u4E49\u52A1\u5C1A\u672A\u6EE1\u8DB3`,
          impact,
          { mode: "user-decision", action: `\u5411\u7528\u6237\u5C55\u793A\u5F53\u524D\u5B9E\u73B0\u6279\u51C6\u95EE\u9898\u5E76\u8BF7\u6C42\u4E00\u6B21\u786E\u8BA4\uFF1B\u786E\u8BA4\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u5199\u5165${scratchHint}`, retryOriginal: true }
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
        `feature \u4ECD\u5904\u4E8E intake\uFF0C\u76EE\u6807 ${relative} \u4F4D\u4E8E governed root\uFF0C\u5C1A\u672A\u8FDB\u5165\u53EF\u6267\u884C\u5B9E\u73B0\u9636\u6BB5`,
        "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1Bgoverned \u76EE\u6807\u4FDD\u6301\u4E0D\u53D8",
        { mode: "user-decision", action: "\u5148\u5B8C\u6210 intake \u8C03\u67E5\u3001\u89E3\u51B3\u5206\u7C7B\u51B3\u7B56\u5E76\u9501\u5B9A\u57FA\u7840\u8DEF\u7EBF\uFF1B\u6EE1\u8DB3\u5B9E\u73B0\u6279\u51C6\u6761\u4EF6\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u5199\u5165", retryOriginal: true }
      );
    }
    case "IMPLEMENTATION_UNIT_REQUIRED": {
      const base = createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED",
        `\u76EE\u6807 ${relative} \u5DF2\u901A\u8FC7\u5B9E\u73B0\u6279\u51C6\uFF0C\u4F46\u5F53\u524D\u6CA1\u6709\u6D3B\u52A8\u7684 implementation unit`,
        "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1Bgoverned \u76EE\u6807\u4FDD\u6301\u4E0D\u53D8",
        { mode: "automatic", action: "\u8C03\u7528 dev_flow_begin_implementation_unit \u51C6\u5907\u5F53\u524D implementation unit\uFF1B\u6210\u529F\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u5199\u5165", retryOriginal: true }
      );
      if (!detail?.beginFailed) return base;
      const reason = `${base.reason} Core \u81EA\u52A8\u51C6\u5907 implementation unit \u5931\u8D25\uFF1A${detail.beginFailed}`;
      const action = `${base.recovery.action}\uFF1B\u4E0D\u8981\u628A\u8BE5 Core \u9519\u8BEF\u89E3\u91CA\u4E3A workflow state unreadable`;
      return { ...base, reason, recovery: { ...base.recovery, action } };
    }
    case "IMPLEMENTATION_UNIT_OUT_OF_SCOPE":
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
        `\u5F53\u524D implementation unit \u5728 Trace \u4E2D\u5DF2\u5931\u6548\uFF0C\u65E0\u6CD5\u8BC1\u660E\u76EE\u6807 ${relative} \u5C5E\u4E8E\u5F53\u524D\u5B9E\u73B0\u4F9D\u636E`,
        "\u539F\u5199\u5165\u672A\u6267\u884C\uFF1B\u76EE\u6807\u6587\u4EF6\u548C Trace \u72B6\u6001\u672A\u6539\u53D8",
        { mode: "user-decision", action: "\u5237\u65B0 Trace\uFF1B\u80FD\u81EA\u52A8\u4FEE\u590D\u5931\u6548\u5F15\u7528\u65F6\u5148\u4FEE\u590D\uFF0C\u5426\u5219\u5C55\u793A\u5DEE\u5F02\u5E76\u5411\u7528\u6237\u8BE2\u95EE\u4E00\u6B21\uFF1B\u89E3\u51B3\u540E\u81EA\u52A8\u91CD\u8BD5\u539F\u5199\u5165", retryOriginal: true }
      );
    case "GIT_GUARD":
      if (detail?.variant === "paths") {
        return createPreToolBlock(
          "DEV_FLOW_GIT_GUARD",
          "Git \u547D\u4EE4\u5305\u542B\u672A\u5F52\u5C5E\u6216\u5DF2\u6392\u9664\u7684\u8DEF\u5F84",
          "\u539F Git \u64CD\u4F5C\u672A\u6267\u884C\uFF1B\u4E0D\u4F1A\u628A\u7528\u6237\u6216\u5176\u4ED6\u4EFB\u52A1\u7684\u6587\u4EF6\u6DF7\u5165 feature \u63D0\u4EA4",
          { mode: "user-decision", action: "\u5148\u5C06\u8DEF\u5F84\u660E\u786E\u7EB3\u5165\u5F53\u524D feature \u6216\u79FB\u51FA\u6682\u5B58\u533A\uFF1B\u672C\u4ED3\u5E93\u7981\u6B62\u667A\u80FD\u4F53\u63D0\u4EA4\u65F6\u4EA4\u7531\u7528\u6237\u5BA1\u6838", retryOriginal: false }
        );
      }
      if (detail?.variant === "publish") {
        return createPreToolBlock(
          "DEV_FLOW_GIT_GUARD",
          "\u5916\u90E8\u53D1\u5E03\u4ECD\u7136\u88AB\u7981\u6B62",
          "\u539F Git \u64CD\u4F5C\u672A\u6267\u884C\uFF1B\u5DE5\u4F5C\u6811\u548C Git \u5386\u53F2\u6CA1\u6709\u88AB\u8FD9\u6B21\u547D\u4EE4\u4FEE\u6539",
          { mode: "guided", action: "\u4E0D\u8981\u6267\u884C push \u6216\u5176\u4ED6\u5916\u90E8\u53D1\u5E03\uFF1B\u672C\u4ED3\u5E93\u7531\u7528\u6237\u5BA1\u6838\u540E\u624B\u52A8\u53D1\u5E03", retryOriginal: true }
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_GIT_GUARD",
        "\u5F53\u524D Git \u5199\u5165\u4E0D\u6EE1\u8DB3\u9636\u6BB5\u3001\u6279\u51C6\u6216\u8DEF\u5F84\u5F52\u5C5E\u6761\u4EF6",
        "\u539F Git \u64CD\u4F5C\u672A\u6267\u884C\uFF1B\u5DE5\u4F5C\u6811\u548C Git \u5386\u53F2\u6CA1\u6709\u88AB\u8FD9\u6B21\u547D\u4EE4\u4FEE\u6539",
        { mode: "guided", action: "\u5148\u5B8C\u6210\u5B9E\u73B0\u6279\u51C6\u5E76\u53EA\u6682\u5B58 feature-owned \u8DEF\u5F84\uFF1B\u4ED3\u5E93\u89C4\u5219\u7981\u6B62\u667A\u80FD\u4F53\u63D0\u4EA4\u65F6\u4EA4\u7531\u7528\u6237\u6267\u884C", retryOriginal: true }
      );
    case "WORKFLOW_STATE_UNREADABLE":
      return unreadableBlock(detail?.unreadableReason ?? block2.reason);
    default:
      return unreadableBlock(block2.reason);
  }
}

// plugins/dev-flow/src/hosts/adapter-policy.ts
function hostToolExecutionDetails(event, succeeded, fallbackEventId) {
  const response = event.tool_response ?? event.tool_result;
  const record = response && typeof response === "object" && !Array.isArray(response) ? response : void 0;
  const message = [record?.summary, record?.message, record?.text].find((value) => typeof value === "string" && value.trim().length > 0);
  return {
    toolName: String(event.tool_name ?? "unknown"),
    executionId: event.tool_use_id ?? event.event_id ?? fallbackEventId,
    result: succeeded ? "success" : "failure",
    resultSummary: (message?.trim() ?? (succeeded ? "\u5DE5\u5177\u6267\u884C\u6210\u529F" : "\u5DE5\u5177\u6267\u884C\u5931\u8D25")).slice(0, 512)
  };
}
var runGit = promisify4(execFile4);
async function stagedGitPaths(root) {
  const result = await runGit("git", ["diff", "--cached", "--name-only", "-z"], { cwd: root, encoding: "utf8" });
  return String(result.stdout).split("\0").filter(Boolean).map((value) => value.replaceAll("\\", "/").normalize("NFC"));
}
async function buildGitIntent(command, root) {
  const gitKind = classifyGitCommandKind(command);
  const localCommit = gitKind === "local-stage" || gitKind === "local-commit";
  const unsafePathForm = localCommit && (/\bgit\s+add\s+(?:-A|--all|\.|-u\b)/.test(command) || /\bgit\s+commit\b[^;&|\n]*?\s(?:-a(?:m)?|--all)(?:\s|$)/.test(command));
  if (gitKind === "external-publish") return { kind: "git", form: "publish" };
  if (unsafePathForm) return { kind: "git", form: "unbounded" };
  if (localCommit) {
    const addMatch = command.match(/\bgit\s+add\s+([^;&|\n]+)/);
    const explicitPaths = addMatch ? addMatch[1].split(/\s+/).filter((value) => value && !value.startsWith("-")) : await stagedGitPaths(root);
    return { kind: "git", paths: projectRelativePaths(root, explicitPaths) };
  }
  return { kind: "git", form: "unbounded" };
}
async function evaluatePreToolUse(root, event) {
  if (!isRelevantPreToolUse(event)) return { kind: "allow" };
  const advisoryOut = {};
  try {
    const block2 = await evaluatePreToolUseInternal(root, event, advisoryOut);
    if (block2) return { kind: "block", block: block2 };
    return advisoryOut.advisory ? { kind: "allow", advisory: advisoryOut.advisory } : { kind: "allow" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: "allow",
      advisory: {
        code: "DEV_FLOW_HOOK_EVALUATION_FAILED",
        message: `DEV_FLOW_HOOK_EVALUATION_FAILED: Dev Flow hook analysis failed (${detail}); the original operation was not blocked and remains subject to host permissions.`
      }
    };
  }
}
async function evaluatePreToolUseInternal(root, event, advisoryOut = {}) {
  if (!isRelevantPreToolUse(event)) return void 0;
  const command = typeof event.tool_input?.command === "string" ? event.tool_input.command : "";
  if (toolName(event) === "bash" && classifyGitCommand(command) === "write") {
    const intent = await buildGitIntent(command, root);
    const verdict2 = await writeGate(root, intent);
    if (verdict2.decision === "allow") return void 0;
    if (verdict2.decision === "audit") {
      advisoryOut.advisory = {
        code: "DEV_FLOW_GIT_STARTUP_EXCLUDED",
        message: `\u8BE5\u8DEF\u5F84\u542F\u52A8\u524D\u5DF2\u6709\u6539\u52A8\u3001\u5DF2\u9ED8\u8BA4\u6392\u9664\u51FA\u4EA4\u4ED8\uFF1B\u672C\u6B21 Git \u64CD\u4F5C\u672A\u62E6\u622A\uFF0C\u4F46\u8FD9\u4E9B\u6587\u4EF6\u4E0D\u4F1A\u8FDB\u5165\u4EA4\u4ED8\u5FEB\u7167\u3002\u5982\u9700\u8BA1\u5165\u8BF7\u5148\u5728\u5DE5\u4F5C\u533A\u5BF9\u8D26\u7EB3\u5165\uFF1A${verdict2.block.paths.join("\u3001")}`
      };
      return void 0;
    }
    return formatWriteGateBlock(verdict2.block);
  }
  if (toolName(event) === "bash") {
    const analysis = analyzeBashWriteTargets(command);
    if (analysis.kind === "read-only") return void 0;
    if (analysis.kind === "unresolved") {
      const verdict3 = await writeGate(root, { kind: "file", unresolved: true });
      if (verdict3.decision === "allow" && verdict3.advisory === "unresolved-write") {
        advisoryOut.advisory = {
          code: "DEV_FLOW_HOOK_UNRESOLVED_WRITE",
          message: "DEV_FLOW_HOOK_UNRESOLVED_WRITE: \u65E0\u6CD5\u4ECE\u547D\u4EE4\u6587\u672C\u786E\u8BA4\u672C\u6B21\u5199\u5165\u6D89\u53CA\u54EA\u4E9B\u6587\u4EF6\uFF0C\u56E0\u6B64\u6CA1\u6709\u81EA\u52A8\u628A\u8FD9\u4E9B\u6587\u4EF6\u8BB0\u5165\u5F53\u524D\u4EFB\u52A1\uFF1B\u5982\u679C\u6D89\u53CA\u9879\u76EE\u6587\u4EF6\uFF0C\u7A0D\u540E\u4F1A\u8BF7\u4F60\u786E\u8BA4\u8FD9\u4E9B\u6587\u4EF6\u662F\u5426\u5C5E\u4E8E\u5F53\u524D\u4EFB\u52A1\u3002"
        };
      }
      return void 0;
    }
    const verdict2 = await writeGate(root, { kind: "file", paths: projectRelativePaths(root, analysis.targets) });
    if (verdict2.decision === "block") return formatWriteGateBlock(verdict2.block);
    if (verdict2.decision === "allow" && verdict2.advisory === "governed-write-observed") {
      advisoryOut.advisory = {
        code: "DEV_FLOW_GOVERNED_WRITE_OBSERVED",
        message: "DEV_FLOW_GOVERNED_WRITE_OBSERVED: \u5F53\u524D\u9636\u6BB5\u5199\u5165 governed \u6587\u4EF6\u4F1A\u88AB\u8BB0\u5F55\u5E76\u53EF\u80FD\u4F7F\u65E2\u6709\u5BA1\u67E5/\u9A8C\u8BC1\u5931\u6548\uFF1B\u5199\u5165\u540E\u8BF7\u6309 status \u63D0\u793A\u91CD\u65B0 reconcile\u3001review \u6216 verify\u3002"
      };
    }
    return void 0;
  }
  const targets = directTargets(event);
  if (!targets.length) return void 0;
  const verdict = await writeGate(root, { kind: "file", paths: projectRelativePaths(root, targets) });
  if (verdict.decision === "block") return formatWriteGateBlock(verdict.block);
  if (verdict.decision === "allow" && verdict.advisory === "governed-write-observed") {
    advisoryOut.advisory = {
      code: "DEV_FLOW_GOVERNED_WRITE_OBSERVED",
      message: "DEV_FLOW_GOVERNED_WRITE_OBSERVED: \u5F53\u524D\u9636\u6BB5\u5199\u5165 governed \u6587\u4EF6\u4F1A\u88AB\u8BB0\u5F55\u5E76\u53EF\u80FD\u4F7F\u65E2\u6709\u5BA1\u67E5/\u9A8C\u8BC1\u5931\u6548\uFF1B\u5199\u5165\u540E\u8BF7\u6309 status \u63D0\u793A\u91CD\u65B0 reconcile\u3001review \u6216 verify\u3002"
    };
  }
  return void 0;
}

// plugins/dev-flow/src/hosts/risk-policy.ts
import { createHash as createHash19 } from "node:crypto";
import path24 from "node:path";
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
function commandFor(input) {
  const command = input.toolInput?.command;
  if (typeof command === "string") return command.trim().replace(/\s+/g, " ");
  return canonical(input.toolInput ?? {});
}
function targetScope(command, root) {
  if (/[$`*?{]/.test(command) || /(?:^|\s)~(?:\/|\s|$)/.test(command)) return "unknown";
  const candidates = [...command.matchAll(/(?:^|[\s"'=])((?:\/|(?:\.\.\/)+)[^\s'"`;|&]*)/g)].map((match) => match[1]);
  for (const target of candidates) {
    const absolute = path24.resolve(root, target);
    const relative = path24.relative(root, absolute);
    if (relative.startsWith("..") || path24.isAbsolute(relative)) return "outside";
  }
  return "inside";
}
function fingerprint2(input, riskClass, category, command) {
  return createHash19("sha256").update(canonical({ riskClass, category, toolName: String(input.toolName ?? ""), command })).digest("hex");
}
function classifyRisk(input, root) {
  const toolName2 = String(input.toolName ?? "").toLowerCase();
  const command = commandFor(input);
  if (!command && !toolName2) return void 0;
  const external = /\b(?:git\s+push|(?:npm|pnpm|yarn|bun)\s+(?:publish|release)|docker\s+push)\b/i.test(command) || /\b(?:deploy|deployment|publish|release)\b/i.test(command) || /\b(?:production|prod)\b/i.test(command) && /\b(?:change|apply|delete|deploy|push|publish|release|migrate)\b/i.test(command) || /\b(?:terraform\s+destroy|kubectl\s+delete|helm\s+(?:uninstall|delete)|(?:aws|gcloud|az)\b[^\n]*(?:delete|destroy|remove))\b/i.test(command);
  if (external) {
    return {
      riskClass: "always-confirm",
      category: "external-action",
      commandFingerprint: fingerprint2(input, "always-confirm", "external-action", command)
    };
  }
  const destructive = /\brm\s+(?:-[^\s]*r[^\s]*|--recursive)\b/i.test(command) || /\bgit\s+(?:reset\s+--hard|clean\s+[^\n]*-[^\n]*f|(?:checkout|restore)\s+--|rebase)\b/i.test(command) || /\b(?:delete|remove)\b/i.test(toolName2);
  if (!destructive) return void 0;
  const scope = targetScope(command, root);
  if (scope !== "inside") {
    return {
      riskClass: "always-confirm",
      category: "external-action",
      commandFingerprint: fingerprint2(input, "always-confirm", "external-action", command)
    };
  }
  return {
    riskClass: "task-reusable",
    category: "destructive-worktree",
    commandFingerprint: fingerprint2(input, "task-reusable", "destructive-worktree", command)
  };
}

// plugins/dev-flow/src/hosts/host-authorization.ts
init_state_store();
function eventId(event, assessment, kind) {
  const value = event;
  const supplied = [value.event_id, value.tool_use_id, value.permission_request_id].find((candidate) => typeof candidate === "string" && candidate.length > 0);
  return supplied ?? `${kind}:${assessment.commandFingerprint}`;
}
function executionKey(event) {
  const value = event;
  return [value.tool_use_id, value.permission_request_id, value.event_id].find((candidate) => typeof candidate === "string" && candidate.length > 0);
}
async function activeFeature(root) {
  const active = await readActive(root);
  if (!active) return void 0;
  const state = await readState(root, active.featureId);
  if (state.lifecycle !== "active" || state.revision !== active.revision) return void 0;
  return { featureId: active.featureId, revision: active.revision };
}
function sameRequest(record, host, featureId, assessment) {
  return record.host === host && record.featureId === featureId && record.riskClass === assessment.riskClass && record.commandFingerprint === assessment.commandFingerprint;
}
async function evaluatePermissionRequest(root, event, host) {
  if (event.hook_event_name !== "PermissionRequest") return void 0;
  const assessment = classifyRisk({ toolName: event.tool_name, toolInput: event.tool_input }, root);
  if (!assessment) return void 0;
  const feature = await activeFeature(root);
  if (!feature) return void 0;
  const events = await readHostAuthorizationEvents(root, feature.featureId);
  const key = executionKey(event);
  if (key !== void 0 && events.some((item) => item.type === "host-authorization-pending" && item.data.executionKey === key)) {
    return void 0;
  }
  const sourceToolEvent = eventId(event, assessment, "permission-request");
  await recordHostAuthorizationEvent(root, "host-authorization-pending", {
    host,
    featureId: feature.featureId,
    riskClass: assessment.riskClass,
    commandFingerprint: assessment.commandFingerprint,
    sourceToolEvent,
    ...key !== void 0 ? { executionKey: key } : {},
    requestedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return { kind: "defer", assessment };
}
function postToolSucceeded(event) {
  const value = event;
  if (value.error !== void 0 && value.error !== null) return false;
  for (const response of [value.tool_response, value.tool_result]) {
    if (!response || typeof response !== "object") continue;
    const candidate = response;
    if (candidate.is_error === true || candidate.isError === true || candidate.success === false || candidate.error !== void 0) return false;
  }
  return true;
}
async function recordPermissionPostToolUse(root, event, host) {
  if (event.hook_event_name !== "PostToolUse" || !postToolSucceeded(event)) return;
  const assessment = classifyRisk({ toolName: event.tool_name, toolInput: event.tool_input }, root);
  if (!assessment || assessment.riskClass !== "task-reusable") return;
  const feature = await activeFeature(root);
  if (!feature) return;
  const events = await readHostAuthorizationEvents(root, feature.featureId);
  const key = executionKey(event);
  const pending = [...events].reverse().find((item) => {
    if (item.type !== "host-authorization-pending") return false;
    if (item.data.executionKey !== void 0) {
      return key !== void 0 && item.data.executionKey === key;
    }
    return sameRequest(item.data, host, feature.featureId, assessment);
  });
  if (!pending) return;
  await recordHostAuthorizationEvent(root, "host-authorization-granted", {
    host,
    featureId: feature.featureId,
    riskClass: assessment.riskClass,
    commandFingerprint: assessment.commandFingerprint,
    sourceToolEvent: pending.data.sourceToolEvent,
    ...pending.data.executionKey !== void 0 ? { executionKey: pending.data.executionKey } : {},
    grantedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}

// plugins/dev-flow/src/core/host-recovery.ts
init_host_health();
init_state_store();
init_evidence_maintenance();
async function observeHostRecovery(root, signal) {
  const health = await recordHostHealth(root, signal);
  if (signal.kind === "session-start") {
    const active2 = await readActive(root);
    if (active2) {
      let release;
      try {
        release = await lock(root, active2.featureId, "session-evidence-maintenance");
        const state2 = await readState(root, active2.featureId);
        await runBoundedEvidenceMaintenance(root, active2.featureId, state2);
      } catch {
      } finally {
        await release?.();
      }
    }
  }
  if (!health.recovered) return;
  const active = await readActive(root);
  if (!active) return;
  const state = await readState(root, active.featureId);
  if (state.lifecycle !== "active" && state.lifecycle !== "finalized") return;
  await reconcileWorkspace(root, active.featureId, state.revision, signal.host);
}

// plugins/dev-flow/src/hosts/host-health-adapter.ts
async function recordAdapterHealth(root, event, host) {
  const kind = event.hook_event_name === "SessionStart" ? "session-start" : event.hook_event_name === "UserPromptSubmit" ? "user-prompt-submit" : event.hook_event_name === "Stop" ? "turn-boundary" : event.hook_event_name === "PreToolUse" || event.hook_event_name === "PostToolUse" ? "tool" : void 0;
  if (!kind) return;
  try {
    await observeHostRecovery(root, {
      host,
      kind,
      eventId: event.event_id ?? `${event.hook_event_name}-${Date.now()}`,
      ...kind === "session-start" ? {
        adapterVersion: "6.0.1",
        capabilities: host === "claude" ? ["review-result-envelope-v1"] : []
      } : {}
    });
  } catch {
  }
}
async function recordNativePromptHealth(root, event, host) {
  try {
    await observeHostRecovery(root, {
      host,
      kind: "user-prompt-submit",
      eventId: `${event.event_id ?? "native-question"}:answer`
    });
  } catch {
  }
}

// plugins/dev-flow/src/hosts/claude-native-question.ts
function questionsFrom(event) {
  const questions = event.tool_input?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const question = item.question;
    return typeof question === "string" && question.trim() ? [question] : [];
  });
}
function parseResponse(response) {
  if (typeof response !== "string") return response;
  const trimmed = response.trim();
  if (!trimmed.startsWith("{")) return response;
  try {
    return JSON.parse(trimmed);
  } catch {
    return response;
  }
}
function textResponse(response) {
  const parsed = parseResponse(response);
  if (typeof parsed === "string") return parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
  const content = parsed.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const text = item.text;
      return typeof text === "string" ? [text] : [];
    });
    return texts.length ? texts.join("\n") : void 0;
  }
  return void 0;
}
function structuredAnswers(response, questions) {
  const parsed = parseResponse(response);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  let root = parsed;
  if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) {
    root = root.data;
  }
  const answers = root.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return [];
  return questions.flatMap((question) => {
    const answer2 = answers[question];
    if (typeof answer2 === "string" && answer2.trim()) return [{ question, answer: answer2 }];
    if (Array.isArray(answer2) && answer2.every((item) => typeof item === "string")) {
      const text = answer2.join(", ").trim();
      return text ? [{ question, answer: text }] : [];
    }
    return [];
  });
}
function parseQuotedPairs(response) {
  const pairs = [];
  const pattern = /"((?:\\.|[^"\\])*)"="((?:\\.|[^"\\])*)"/g;
  for (const match of response.matchAll(pattern)) {
    try {
      const decode = (value) => JSON.parse(`"${value.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`);
      const question = decode(match[1]);
      const answer2 = decode(match[2]);
      if (question.trim() && answer2.trim()) pairs.push({ question, answer: answer2 });
    } catch {
    }
  }
  return pairs;
}
function claudeNativeQuestionAnswers(event) {
  if (event.hook_event_name !== "PostToolUse" || event.tool_name !== "AskUserQuestion") return [];
  const questions = questionsFrom(event);
  if (!questions.length) return [];
  for (const response of [event.tool_response, event.tool_result]) {
    const structured = structuredAnswers(response, questions);
    if (structured.length) return structured;
    const text = textResponse(response);
    if (!text) continue;
    const allowed = new Set(questions);
    const parsed = parseQuotedPairs(text).filter((item) => allowed.has(item.question));
    if (parsed.length) return parsed;
  }
  return [];
}

// plugins/dev-flow/src/hosts/project-root.ts
import { access as access3 } from "node:fs/promises";
import path25 from "node:path";
async function hasDevFlowMarker(directory) {
  for (const marker of ["project.json", "active.json"]) {
    try {
      await access3(path25.join(directory, ".dev-flow", marker));
      return true;
    } catch {
    }
  }
  return false;
}
async function resolveDevFlowRoot(cwd) {
  const original = path25.resolve(cwd);
  let current = original;
  for (; ; ) {
    if (await hasDevFlowMarker(current)) return current;
    const parent = path25.dirname(current);
    if (parent === current) return original;
    current = parent;
  }
}

// plugins/dev-flow/src/hosts/review-execution-adapter.ts
init_state_store();
init_review_execution2();
init_review();
import { readFile as readFile19 } from "node:fs/promises";
var DECLARATION_MARKER = /dev-flow:isolated-review:([A-Za-z0-9-]+)/u;
function firstText(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value;
    for (const key of ["prompt", "description", "text"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return "";
}
async function transcriptText(event) {
  const transcriptPath = event.agent_transcript_path;
  if (typeof transcriptPath !== "string" || !transcriptPath.trim()) return "";
  let contents;
  try {
    contents = await readFile19(transcriptPath, "utf8");
  } catch {
    return "";
  }
  const marker = contents.match(DECLARATION_MARKER);
  if (!marker) return "";
  return marker[0];
}
async function recordSubagentReviewOutput(root, event, host) {
  const active = await readActive(root);
  if (!active) return { recorded: false, reason: "no-active-feature" };
  const promptText = firstText(event.last_assistant_message) || firstText(event.prompt) || firstText(event.tool_input) || firstText(event.tool_response) || firstText(event.tool_result) || await transcriptText(event);
  const marker = promptText.match(DECLARATION_MARKER);
  if (!marker) {
    await recordReviewCaptureRejection(root, { featureId: active.featureId, reason: "missing-marker" });
    return { recorded: false, reason: "missing-marker" };
  }
  const declarationId = marker[1];
  const events = await readFeatureEvents(root, active.featureId);
  const declaration = [...events].reverse().find((item) => {
    const data2 = item.data;
    return item.type === "review-execution-declared" && data2?.type === "review-execution-declared" && data2.declarationId === declarationId;
  });
  if (!declaration) {
    await recordReviewCaptureRejection(root, { featureId: active.featureId, declarationId, reason: "unknown-declaration" });
    return { recorded: false, reason: "unknown-declaration", declarationId };
  }
  const data = declaration.data;
  if (typeof data.batchId !== "string" || typeof data.jobId !== "string" || typeof data.executionId !== "string" && typeof data.executionRequestId !== "string") {
    await recordReviewCaptureRejection(root, { featureId: active.featureId, declarationId, reason: "unknown-declaration" });
    return { recorded: false, reason: "unknown-declaration", declarationId };
  }
  const executionId = typeof data.executionId === "string" ? data.executionId : String(data.executionRequestId);
  const executionRequestId = typeof data.executionRequestId === "string" ? data.executionRequestId : void 0;
  const input = event.tool_input ?? {};
  const response = event.tool_response && typeof event.tool_response === "object" ? event.tool_response : {};
  const contextId = [
    event.agent_id,
    input.agent_id,
    response.agent_id
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  const implementationContextId = [
    event.session_id,
    input.session_id,
    response.session_id
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  if (!contextId || !implementationContextId) {
    await recordReviewCaptureRejection(root, {
      featureId: active.featureId,
      jobId: data.jobId,
      declarationId,
      executionRequestId,
      reason: "missing-context-ids"
    });
    return { recorded: false, reason: "missing-context-ids", declarationId };
  }
  if (contextId === implementationContextId) {
    await recordReviewCaptureRejection(root, {
      featureId: active.featureId,
      jobId: data.jobId,
      declarationId,
      executionRequestId,
      reason: "same-context"
    });
    return { recorded: false, reason: "same-context", declarationId };
  }
  const eventId2 = `${declarationId}:complete`;
  const rawText = typeof event.last_assistant_message === "string" ? event.last_assistant_message : promptText;
  const rawResult = (() => {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const candidate = rawText.slice(start, end + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        return rawText;
      }
    }
    return rawText;
  })();
  let parsedJson;
  try {
    parsedJson = JSON.parse(rawResult);
  } catch {
    parsedJson = void 0;
  }
  const issues = parsedJson === void 0 ? [{ path: "$", message: "completion is not valid JSON" }] : describeReviewJobCompletionIssues(parsedJson);
  if (issues.length) {
    await recordReviewCaptureRejection(root, {
      featureId: active.featureId,
      jobId: data.jobId,
      declarationId,
      executionRequestId,
      hostEventId: eventId2,
      reason: "invalid-completion",
      issues
    });
    return { recorded: false, reason: "invalid-completion", declarationId, eventId: eventId2, issues };
  }
  await recordReviewExecutionEvent(root, {
    eventId: eventId2,
    type: "review-execution",
    host: typeof data.host === "string" && (data.host === "claude" || data.host === "codex") ? data.host : host,
    batchId: data.batchId,
    jobId: data.jobId,
    executionId,
    sourceId: `subagent:${contextId}`,
    contextId,
    implementationContextId,
    parentContextId: implementationContextId,
    text: typeof event.last_assistant_message === "string" ? event.last_assistant_message : void 0
  });
  if (typeof data.executionRequestId === "string" && typeof data.capabilityHash === "string" && typeof data.packageSha256 === "string" && typeof data.role === "string" && typeof data.leaseGeneration === "number" && typeof data.declaredAt === "string") {
    try {
      const captured = await captureHostReviewEnvelope(root, {
        featureId: active.featureId,
        batchId: data.batchId,
        jobId: data.jobId,
        role: data.role,
        packageSha256: data.packageSha256,
        capabilityHash: data.capabilityHash,
        executionRequestId: data.executionRequestId,
        leaseGeneration: data.leaseGeneration,
        declarationId,
        source: "claude-subagent",
        host: typeof data.host === "string" && (data.host === "claude" || data.host === "codex") ? data.host : host,
        hostEventId: eventId2,
        parentContext: implementationContextId,
        childContext: contextId,
        agentId: contextId,
        startedAt: data.declaredAt,
        completedAt: (/* @__PURE__ */ new Date()).toISOString(),
        rawResult,
        parsedCompletion: rawResult
      });
      await recordCapturedEnvelope(root, active.featureId, data.executionRequestId, captured.ref);
    } catch {
      await recordReviewCaptureRejection(root, {
        featureId: active.featureId,
        jobId: data.jobId,
        declarationId,
        executionRequestId,
        hostEventId: eventId2,
        reason: "invalid-completion",
        issues
      });
      return { recorded: false, reason: "invalid-completion", declarationId, eventId: eventId2, issues };
    }
  }
  return { recorded: true, declarationId, eventId: eventId2 };
}

// plugins/dev-flow/src/hosts/hook-adapter.ts
var presets = {
  claude: {
    label: "Claude",
    permissionAllow: () => ({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" }
      }
    }),
    preToolBlock: (reason) => ({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason
      }
    }),
    advisory: (message) => ({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: message
      }
    }),
    onPostToolUseSuccess: async (root, event) => {
      const sourceEventId = event.event_id ?? event.tool_use_id ?? `native-question-${Date.now()}`;
      const nativeAnswers = claudeNativeQuestionAnswers(event);
      if (nativeAnswers.length) await recordNativePromptHealth(root, { ...event, event_id: sourceEventId }, "claude");
      for (const [index, answer2] of nativeAnswers.entries()) {
        try {
          await recordHostEvent(root, {
            eventId: `${sourceEventId}:answer:${index}`,
            type: "user-prompt",
            host: "claude",
            text: answer2.answer,
            ...answer2.question ? { question: answer2.question } : {}
          });
        } catch {
        }
      }
    }
  },
  codex: {
    label: "Codex",
    permissionAllow: () => ({ decision: "allow" }),
    preToolBlock: (reason) => ({ decision: "block", reason }),
    advisory: (message) => ({ hookSpecificOutput: { additionalContext: message } })
  }
};
async function runHookAdapter(host) {
  const preset = presets[host];
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const root = await resolveDevFlowRoot(event.cwd ?? process.cwd());
  await recordAdapterHealth(root, event, host);
  if (event.hook_event_name === "PermissionRequest") {
    try {
      const outcome = await evaluatePermissionRequest(root, event, host);
      if (outcome?.kind === "allow") {
        process.stdout.write(JSON.stringify(preset.permissionAllow()) + "\n");
      }
    } catch (error) {
      process.stderr.write(`Dev Flow ${preset.label} permission evaluation failed: ${String(error)}
`);
    }
  }
  if (event.hook_event_name === "PreToolUse") {
    try {
      const outcome = await evaluatePreToolUse(root, event);
      if (outcome.kind === "block") {
        process.stdout.write(JSON.stringify(preset.preToolBlock(formatPreToolBlock(outcome.block))) + "\n");
      } else if (outcome.advisory) {
        process.stdout.write(JSON.stringify(preset.advisory(outcome.advisory.message)) + "\n");
      } else {
        await recordTrustedWriteIntent(root, trustedWriteTargets(root, event), host, event.event_id ?? event.tool_use_id ?? `pre-${Date.now()}`);
      }
    } catch (error) {
      process.stderr.write(`Dev Flow ${preset.label} hook evaluation failed: ${String(error)}
`);
    }
  }
  if (event.hook_event_name === "SubagentStop") {
    try {
      await recordSubagentReviewOutput(root, event, host);
    } catch (error) {
      process.stderr.write(`Dev Flow ${preset.label} subagent review proof failed: ${String(error)}
`);
    }
  }
  if (event.hook_event_name === "UserPromptSubmit" || event.hook_event_name === "Stop" || event.hook_event_name === "PostToolUse") {
    if (event.hook_event_name === "PostToolUse") {
      try {
        await recordPermissionPostToolUse(root, event, host);
      } catch {
      }
      if (postToolSucceeded(event)) {
        try {
          await recordTrustedWriteOwnership(root, trustedWriteTargets(root, event), host, event.event_id ?? event.tool_use_id ?? `post-${Date.now()}`);
        } catch {
        }
        await preset.onPostToolUseSuccess?.(root, event);
      }
    }
    try {
      const text = event.prompt ?? event.user_prompt ?? event.tool_input?.prompt;
      const eventId2 = event.event_id ?? `${event.hook_event_name}-${Date.now()}`;
      await recordHostEvent(root, {
        eventId: eventId2,
        type: event.hook_event_name === "UserPromptSubmit" ? "user-prompt" : event.hook_event_name === "Stop" ? "turn-boundary" : "tool",
        host,
        text: typeof text === "string" ? text : void 0,
        ...event.hook_event_name === "PostToolUse" ? hostToolExecutionDetails(event, postToolSucceeded(event), eventId2) : {}
      });
    } catch {
    }
  }
}

// plugins/dev-flow/src/hosts/codex-adapter.ts
await runHookAdapter("codex");
