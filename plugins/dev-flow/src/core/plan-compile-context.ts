import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { stableJson } from "../policy/stable-json.js";
import type { TraceArtifactKind, TraceDelta, TraceNodeInput } from "../policy/traceability.js";
import { DevFlowError } from "./errors.js";
import { compilePlan, type CompilePlanInput, type CompilePlanResult, type PlanDiagnostic } from "./plan-compiler.js";
import { normalizeUnicode } from "./path-normalization.js";
import { verificationCommandHashes, type ProjectConfig } from "./project-config.js";
import { readState, type FeatureState } from "./state-store.js";
import { parseTraceSourceBlocks } from "./traceability-anchors.js";
import { parseTraceMarkdown } from "./traceability-markdown.js";
import { readProjectConfigSnapshot, readTraceabilityForArtifactReplacement } from "./traceability-store.js";

const featureDirectory = (root: string, id: string) => path.join(root, ".dev-flow", "features", id);

export interface ArtifactPlanCompilation {
  /** 装配完成的编译输入：调用点可取 currentLedger / artifactSha256 等做后续比较。 */
  input: CompilePlanInput;
  result: CompilePlanResult;
  /** state 中的工件登记记录（登记前 sha，用于变更检测与 mutate 更新）。 */
  artifact: { path: string; sha256: string };
  config: ProjectConfig;
}

/**
 * 计划编译上下文装载 + 编译的唯一入口。「预检（validatePlan）、正式登记
 * （recordArtifactWithTrace）与计划修订（revisePlan）共用同一编译函数：相同输入
 * 必得相同诊断」这条不变量由本函数的结构保证，而非注释约定。调用点只提供
 * traceDelta 与 revision 语义，前置断言与失败处理各自保留。
 */
export async function compileArtifactPlan(
  root: string,
  id: string,
  state: FeatureState,
  options: {
    artifactKind: TraceArtifactKind;
    traceDelta: TraceDelta;
    nextStateRevision: number;
  },
): Promise<ArtifactPlanCompilation> {
  const artifact = state.artifacts[options.artifactKind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", options.artifactKind);
  const contents = await readFile(path.join(featureDirectory(root, id), normalizeUnicode(artifact.path)), "utf8");
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
  const currentLedger = await readTraceabilityForArtifactReplacement(root, state, options.artifactKind);
  const input: CompilePlanInput = {
    route: state.route,
    artifactKind: options.artifactKind,
    artifactSha256: createHash("sha256").update(contents).digest("hex"),
    sourceBlocks: parseTraceSourceBlocks(contents),
    currentLedger,
    traceDelta: options.traceDelta,
    projectConfigSha256,
    verificationCommandIds: config.verification.commands.map((command) => command.id),
    verificationCommandHashes: verificationCommandHashes(config),
    verificationCommandGuarantees: Object.fromEntries(config.verification.commands.map((command) => [command.id, [...command.provides]])),
    nextStateRevision: options.nextStateRevision,
    riskLabels: state.classification.riskLabels,
  };
  return { input, result: compilePlan(input), artifact, config };
}

/** Markdown-first compilation result. `input` is absent when the parser failed. */
export interface MarkdownArtifactPlanCompilation {
  input?: CompilePlanInput;
  result: CompilePlanResult;
  artifact: { path: string; sha256: string };
  config: ProjectConfig;
  /** Structured semantic SHA of the parsed TraceNodeInput set. */
  semanticSha256?: string;
  nodes: TraceNodeInput[];
}

function markdownDiagnostics(parsed: ReturnType<typeof parseTraceMarkdown>): PlanDiagnostic[] {
  return parsed.diagnostics.map((item) => ({
    code: "TRACE_MARKDOWN_INVALID",
    position: item.position,
    message: item.message,
    recoveryHint: `按 ${item.artifactKind} Markdown 字段合同修正 ${item.position}${item.field ? ` 的 ${item.field}` : ""} 后重新预检。`,
  }));
}

async function readArtifactContents(root: string, id: string, state: FeatureState, artifactKind: TraceArtifactKind): Promise<{ artifact: { path: string; sha256: string }; contents: string }> {
  const artifact = state.artifacts[artifactKind];
  if (!artifact) throw new DevFlowError("MISSING_REQUIRED_ARTIFACT", artifactKind);
  return {
    artifact,
    contents: await readFile(path.join(featureDirectory(root, id), normalizeUnicode(artifact.path)), "utf8"),
  };
}

/**
 * v6 compiler entry point: structured Markdown is the only semantic input.
 * Parser diagnostics and the existing graph/config compiler diagnostics are
 * returned as one stable diagnostic set.
 */
export async function compileArtifactPlanFromMarkdown(
  root: string,
  id: string,
  state: FeatureState,
  options: { artifactKind: TraceArtifactKind; nextStateRevision: number },
): Promise<MarkdownArtifactPlanCompilation> {
  const { artifact, contents } = await readArtifactContents(root, id, state, options.artifactKind);
  const { config, sha256: projectConfigSha256 } = await readProjectConfigSnapshot(root);
  const parsed = parseTraceMarkdown(contents, options.artifactKind);
  const nodes = parsed.nodes;
  if (!parsed.ok) {
    // 一次预检聚合：解析失败时仍报告已解析 UNIT 的 targeted/未知命令引用
    // （GPT-009：不能只给 parser 错误，让 targeted 问题在 checkpoint 才暴露）。
    const diagnostics = markdownDiagnostics(parsed);
    if (options.artifactKind === "implementation-plan") {
      for (const node of nodes) {
        if (node.kind !== "implementation-unit") continue;
        for (const reference of node.forwardVerification) {
          const command = config.verification.commands.find((candidate) => candidate.id === reference);
          if (!command) {
            diagnostics.push({
              code: "TRACE_VERIFICATION_COMMAND_UNKNOWN",
              position: node.id,
              message: `UNIT 前向验证命令 ${reference} 未在 project config 中登记。`,
              recoveryHint: "将命令登记到 project config verification.commands 后在 Markdown 中引用其 ID。",
            });
            continue;
          }
          if (!command.provides.includes("targeted")) {
            diagnostics.push({
              code: "TRACE_VERIFICATION_COMMAND_NOT_TARGETED",
              position: node.id,
              message: `UNIT 前向验证命令 ${reference} 未声明 targeted guarantee。`,
              recoveryHint: "为 project command 增加 targeted provides，或改用已提供 targeted 的 named command。",
            });
          }
        }
      }
    }
    return { result: { ok: false, diagnostics }, artifact, config, nodes };
  }
  const semanticSha256 = createHash("sha256").update(stableJson({ nodes })).digest("hex");
  const currentLedger = await readTraceabilityForArtifactReplacement(root, state, options.artifactKind);
  const input: CompilePlanInput = {
    route: state.route,
    artifactKind: options.artifactKind,
    artifactSha256: createHash("sha256").update(contents).digest("hex"),
    sourceBlocks: parseTraceSourceBlocks(contents),
    currentLedger,
    traceDelta: { nodes },
    projectConfigSha256,
    verificationCommandIds: config.verification.commands.map((command) => command.id),
    verificationCommandHashes: verificationCommandHashes(config),
    verificationCommandGuarantees: Object.fromEntries(config.verification.commands.map((command) => [command.id, [...command.provides]])),
    nextStateRevision: options.nextStateRevision,
    riskLabels: state.classification.riskLabels,
  };
  return { input, result: compilePlan(input), artifact, config, semanticSha256, nodes };
}

/** Phase 2 public seam: later callers express only intent, never a delta. */
export async function prepareArtifactRegistration(
  root: string,
  featureId: string,
  kind: TraceArtifactKind,
  nextStateRevision: number,
): Promise<MarkdownArtifactPlanCompilation> {
  const state = await readState(root, featureId);
  return compileArtifactPlanFromMarkdown(root, featureId, state, { artifactKind: kind, nextStateRevision });
}

