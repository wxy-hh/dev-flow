import type { RouteId } from "../policy/types.js";
import type { VerificationGuarantee } from "./project-config.js";
import type { TraceArtifactKind, TraceabilityLedger, TraceDelta } from "../policy/traceability.js";
import { applyTraceDelta, assertTraceabilityComplete, collectUncoveredAcceptanceCriteria, validateTraceGraph } from "./traceability.js";
import { type TraceSourceBlock } from "./traceability-anchors.js";
import { DevFlowError } from "./errors.js";

/**
 * 计划编译深模块（spec"计划编译" / issue 10）。
 *
 * 计划预检与正式登记共用同一个编译函数：相同输入必得相同的规范化语义
 * 与相同诊断集合；正式登记只在编译成功后额外完成原子持久化。预检本身
 * 零副作用（不写快照、不推进 revision、不创建审查批次、不产生审计垃圾）。
 *
 * 诊断按固定阶段顺序聚合：
 * 1. Trace delta 形状与合同（失败即停，无法继续编译）；
 * 2. 任务图校验（失败即停，完备性依赖有效图）；
 * 3. 完备性校验，并收集全部缺失测试覆盖的 AC（不再只报第一个，消灭级联往返）。
 */

export interface PlanDiagnostic {
  code: string;
  /** 定位：锚点 id / 节点 id / 阶段名。 */
  position: string;
  message: string;
  recoveryHint: string;
}

export interface CompilePlanInput {
  route: RouteId;
  artifactKind: TraceArtifactKind;
  artifactSha256: string;
  sourceBlocks: TraceSourceBlock[];
  currentLedger: TraceabilityLedger;
  traceDelta: TraceDelta;
  projectConfigSha256: string;
  verificationCommandIds: string[];
  verificationCommandHashes: Record<string, string>;
  /** Guarantees declared by project commands; used for aggregate targeted preflight. */
  verificationCommandGuarantees?: Record<string, VerificationGuarantee[]>;
  /** 与正式登记一致的下一个 state revision（只影响 ledger 元数据）。 */
  nextStateRevision: number;
  /** 路线风险标签（ADR-0016：数据迁移/外部副作用/不可逆步骤要求恢复安排）。 */
  riskLabels?: string[];
}

export interface ImplementationUnitProjection {
  unitId: string;
  tasks: string[];
  dependsOn: string[];
  fileScope: string[];
  /** 前向验证命令引用；不含任何回撤语义。 */
  forwardVerification: string[];
}

export interface RecoveryArrangementProjection {
  arrangementId: string;
  stepRef: string;
  recoveryKind: "rollback" | "compensation";
  method: string;
  riskRef: string;
}

export interface CompilePlanResult {
  ok: boolean;
  diagnostics: PlanDiagnostic[];
  ledger?: TraceabilityLedger;
  /** 独立实现单元投影（从 rollback 节点派生，剥离回撤语义）。 */
  implementationUnits?: ImplementationUnitProjection[];
  /** 独立恢复安排投影（recovery 节点原样）。 */
  recoveryArrangements?: RecoveryArrangementProjection[];
}

function diagnosticFrom(error: unknown, position: string, fallbackCode: string): PlanDiagnostic {
  if (error instanceof DevFlowError) {
    return {
      code: error.code,
      position,
      message: error.message.replace(/^[A-Z_]+:\s*/, ""),
      recoveryHint: typeof error.details?.recoveryHint === "string" ? error.details.recoveryHint : "修正对应位置后重新预检。",
    };
  }
  return { code: fallbackCode, position, message: error instanceof Error ? error.message : String(error), recoveryHint: "修正对应位置后重新预检。" };
}

function compileCore(input: CompilePlanInput): { diagnostics: PlanDiagnostic[]; ledger?: TraceabilityLedger } {
  const diagnostics: PlanDiagnostic[] = [];

  // 阶段 1：delta 形状与合同。失败则无法继续编译。
  let ledger: TraceabilityLedger;
  try {
    ledger = applyTraceDelta({
      current: input.currentLedger,
      route: input.route,
      artifactKind: input.artifactKind,
      artifactSha256: input.artifactSha256,
      sourceBlocks: input.sourceBlocks,
      delta: input.traceDelta,
      projectConfigSha256: input.projectConfigSha256,
      verificationCommandIds: input.verificationCommandIds,
      verificationCommandHashes: input.verificationCommandHashes,
      nextStateRevision: input.nextStateRevision,
    }, { validateGraph: false });
  } catch (error) {
    return { diagnostics: [diagnosticFrom(error, "trace-delta", "TRACE_DELTA_INVALID")] };
  }

  // 阶段 2：任务图校验（partial：引用/依赖/对称性）。图错误不能阻止
  // 后续的完备性与风险诊断；只要 delta 已成功归约，就继续收集可发现问题。
  let graphError: PlanDiagnostic | undefined;
  try {
    validateTraceGraph(ledger, input.route, "partial");
  } catch (error) {
    graphError = diagnosticFrom(error, "plan-graph", "PLAN_TASK_GRAPH_INVALID");
    diagnostics.push(graphError);
  }

  // 阶段 3（仅实施计划）：完备性校验 + 收集全部缺失测试覆盖的 AC。
  if (input.artifactKind !== "implementation-plan") return { diagnostics, ledger };
  // 高风险路线（ADR-0016）：数据迁移、外部副作用或不可逆步骤必须预先
  // 声明恢复安排（回滚或补偿）；普通任务不承担这项要求。
  const highRisk = (input.riskLabels ?? []).some((label) =>
    label === "data" || label === "external" || label === "irreversible_consequence");
  if (highRisk) {
    const recoveries = Object.values(ledger.nodes).filter((node): node is Extract<typeof node, { kind: "recovery" }> => node.kind === "recovery" && node.status === "current");
    if (recoveries.length === 0) {
      diagnostics.push({
        code: "PLAN_RECOVERY_REQUIRED",
        position: "plan-recovery",
        message: "当前路线涉及数据迁移、外部副作用或不可逆步骤，实施计划必须为高风险步骤声明恢复安排（recovery 节点）。",
        recoveryHint: "为受保护步骤添加 recovery 锚点（stepRef/recoveryKind/method/riskRef），或确认该步骤不属于高风险类别。",
      });
    } else {
      const steps = Object.values(ledger.nodes).filter((node): node is Extract<typeof node, { kind: "implementation-unit" }> => node.kind === "implementation-unit" && node.status === "current");
      for (const step of steps) {
        const matching = recoveries.filter((recovery) => recovery.stepRef === step.id || (recovery.stepRef.startsWith("TASK-") && step.tasks.includes(recovery.stepRef as `TASK-${string}`)));
        if (!matching.length) {
          diagnostics.push({
            code: "PLAN_RECOVERY_STEP_UNCOVERED",
            position: step.id,
            message: `高风险步骤 ${step.id} 没有匹配的恢复安排。`,
            recoveryHint: `为 ${step.id} 或其任务添加 recovery，并让 riskRef 明确对应当前风险。`,
          });
        }
      }
    }
  }
  // 完整图校验（含 AC 覆盖）：partial 已失败时跳过，避免同一图错误重复出现；
  // 未覆盖 AC 与恢复安排诊断不受图错误影响，已在上面独立收集。
  if (!graphError) {
    try {
      validateTraceGraph(ledger, input.route, "complete");
      assertTraceabilityComplete(ledger, input.route, input.projectConfigSha256, input.verificationCommandHashes);
    } catch (error) {
      diagnostics.push(diagnosticFrom(error, "plan-complete", "TRACE_SLICE_INCOMPLETE"));
    }
  }
  for (const uncovered of collectUncoveredAcceptanceCriteria(ledger)) {
    diagnostics.push({
      code: "TRACE_SLICE_INCOMPLETE",
      position: uncovered.id,
      message: `验收条件 ${uncovered.id} 缺少验证处置：没有行为测试（TEST 节点 verifies 它），也没有有效的非行为处置（类型/规则检查、文件核对或人工验收）。`,
      recoveryHint: "为该验收条件添加 TEST 节点，或按验证处置规则为它声明具体的非行为验证方法与预期证据。",
    });
  }
  // 测试先行只约束可自动测试的行为变更（spec §171 / §49）：test-first 任务
  // 覆盖的验收条件必须由行为测试覆盖，不能用"无法测试"声明非行为处置绕过。
  // Phase 2 targeted preflight: every forward_verification command of every
  // current UNIT must provide targeted. All violations are aggregated with the
  // unit and command ID instead of surfacing one-at-a-time at checkpoint.
  if (input.artifactKind === "implementation-plan") {
    for (const node of Object.values(ledger.nodes)) {
      if (node.kind !== "implementation-unit" || node.status !== "current") continue;
      for (const reference of node.forwardVerification) {
        if (typeof reference !== "string") {
          diagnostics.push({
            code: "TRACE_INLINE_VERIFICATION_FORBIDDEN",
            position: node.id,
            message: "v6 implementation-unit forward_verification 只能是 named command ID，不接受 inline object。",
            recoveryHint: "将命令登记到 project config verification.commands 后在 Markdown 中引用其 ID。",
          });
          continue;
        }
        const guarantees = input.verificationCommandGuarantees?.[reference] ?? [];
        if (guarantees.includes("targeted")) continue;
        diagnostics.push({
          code: "TRACE_VERIFICATION_COMMAND_NOT_TARGETED",
          position: node.id,
          message: `UNIT 前向验证命令 ${reference} 未声明 targeted guarantee。`,
          recoveryHint: "为 project command 增加 targeted provides，或改用已提供 targeted 的 named command。",
        });
      }
    }
  }
  const testFirstAcCoveredByTest = new Set<`AC-${string}`>();
  for (const node of Object.values(ledger.nodes)) {
    if (node.kind !== "task" || node.tdd !== "test-first") continue;
    for (const covered of node.covers) {
      if (covered.startsWith("AC-")) testFirstAcCoveredByTest.add(covered as `AC-${string}`);
    }
  }
  if (testFirstAcCoveredByTest.size > 0) {
    const tests = Object.values(ledger.nodes)
      .filter((node): node is Extract<typeof node, { kind: "test" }> => node.kind === "test" && node.status === "current")
      .flatMap((node) => node.verifies);
    const covered = new Set(tests);
    for (const acId of [...testFirstAcCoveredByTest].sort()) {
      if (covered.has(acId)) continue;
      diagnostics.push({
        code: "TEST_FIRST_REQUIRES_BEHAVIOR_TEST",
        position: acId,
        message: `验收条件 ${acId} 由 test-first 任务覆盖，必须由行为测试验证；非行为验证处置不能替代可自动测试行为变更的测试先行。`,
        recoveryHint: "为该验收条件添加 TEST 节点，或将该任务声明为 direct（非行为变更）。",
      });
    }
  }
  return { diagnostics, ledger };
}

/** 计划编译唯一入口：预检与正式登记共用。 */
export function compilePlan(input: CompilePlanInput): CompilePlanResult {
  const { diagnostics, ledger } = compileCore(input);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const nodes = Object.values(ledger!.nodes);
  const current = (node: { status?: string }) => node.status === "current";
  const implementationUnits: ImplementationUnitProjection[] = nodes
    .filter((node): node is Extract<typeof node, { kind: "implementation-unit" }> => current(node) && node.kind === "implementation-unit")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => ({
      unitId: node.id,
      tasks: [...node.tasks],
      dependsOn: [...node.dependsOn],
      fileScope: [...node.fileScope],
      forwardVerification: node.forwardVerification.filter((ref): ref is string => typeof ref === "string"),
    }));
  const recoveryArrangements: RecoveryArrangementProjection[] = nodes
    .filter((node): node is Extract<typeof node, { kind: "recovery" }> => current(node) && node.kind === "recovery")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => ({
      arrangementId: node.id,
      stepRef: node.stepRef,
      recoveryKind: node.recoveryKind,
      method: node.method,
      riskRef: node.riskRef,
    }));
  return { ok: true, diagnostics, ledger, implementationUnits, recoveryArrangements };
}
