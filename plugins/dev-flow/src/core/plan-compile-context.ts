import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TraceArtifactKind, TraceDelta } from "../policy/traceability.js";
import { DevFlowError } from "./errors.js";
import { compilePlan, type CompilePlanInput, type CompilePlanResult } from "./plan-compiler.js";
import { normalizeUnicode } from "./path-normalization.js";
import { verificationCommandHashes, type ProjectConfig } from "./project-config.js";
import type { FeatureState } from "./state-store.js";
import { parseTraceSourceBlocks } from "./traceability-anchors.js";
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
    nextStateRevision: options.nextStateRevision,
    riskLabels: state.classification.riskLabels,
  };
  return { input, result: compilePlan(input), artifact, config };
}
