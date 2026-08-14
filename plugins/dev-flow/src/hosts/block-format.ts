import path from "node:path";
import type { WriteGateBlock } from "../core/write-gate.js";

// ---------------------------------------------------------------------------
// 门禁结果格式化：语义判决 → 宿主 PreToolBlock。中文文案只在这一层。
// 本模块只有纯函数：合成 WriteGateBlock 即可表驱动直测全部文案分支。
// ---------------------------------------------------------------------------

export type PreToolBlockCode =
  | "DEV_FLOW_GIT_GUARD"
  | "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED"
  | "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED"
  | "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE"
  | "DEV_FLOW_STATE_MUTATION_FORBIDDEN"
  | "DEV_FLOW_ARTIFACT_NOT_REGISTERED"
  | "DEV_FLOW_WORKFLOW_STATE_UNREADABLE";

export interface PreToolRecovery {
  mode: "automatic" | "guided" | "user-decision";
  action: string;
  retryOriginal: boolean;
}

export interface PreToolBlock {
  code: PreToolBlockCode;
  reason: string;
  impact: string;
  recovery: PreToolRecovery;
}

export interface PreToolAdvisory {
  code: "DEV_FLOW_HOOK_EVALUATION_FAILED" | "DEV_FLOW_HOOK_UNRESOLVED_WRITE" | "DEV_FLOW_GIT_STARTUP_EXCLUDED";
  message: string;
}

export type PreToolOutcome =
  | { kind: "allow"; advisory?: PreToolAdvisory }
  | { kind: "block"; block: PreToolBlock };

function createPreToolBlock(
  code: PreToolBlockCode,
  reason: string,
  impact: string,
  recovery: PreToolRecovery,
): PreToolBlock {
  return { code, reason, impact, recovery };
}

/** Serialize the complete recovery contract for host hooks and model context. */
export function formatPreToolBlock(block: PreToolBlock): string {
  const confirmation = block.recovery.mode === "user-decision"
    ? "需要用户决定；模型应只询问一次，确认后直接执行解决动作。"
    : block.recovery.mode === "guided"
      ? "先自动执行解决动作；只有动作证明需要 recover、重建、放弃或改变目标时才询问用户一次。"
      : "不需要用户决定；模型可以直接执行解决动作。";
  const continuation = block.recovery.retryOriginal
    ? "解决后自动重试原操作，无需用户再次回复继续"
    : "原操作不会重试；完成解决动作后继续后续必要步骤";
  return [
    block.code,
    `原因：${block.reason}`,
    `影响：${block.impact}`,
    `解决方案：${block.recovery.action}`,
    `确认：${confirmation}`,
    `继续方式：${continuation}`,
  ].join("\n");
}

/** 拦截消息中的 scratch 引导：临时验证文件放到 governedRoots 之外的 scratch/，不触发 checkpoint。 */
const scratchHint = "；临时验证文件请放入 scratch/ 目录";

function artifactKind(relative: string): string {
  const displayName = path.posix.basename(relative, ".md");
  return displayName === "需求文档" ? "requirements" : displayName === "实施计划" ? "implementation-plan" : displayName;
}

function unreadableBlock(reason: string): PreToolBlock {
  return createPreToolBlock(
    "DEV_FLOW_WORKFLOW_STATE_UNREADABLE",
    `读取工作流证据失败：${reason}`,
    "原操作未执行；无法安全确认当前 workflow gate 是否满足",
    {
      mode: "guided",
      action: "先自动刷新 active/state 并运行只读 dev_flow_doctor；只有 doctor 证明必须 recover、重建或放弃 feature 时才向用户询问一次，解决后自动重试原操作",
      retryOriginal: true,
    },
  );
}

export function formatWriteGateBlock(block: WriteGateBlock): PreToolBlock {
  const relative = block.paths[0] ?? "";
  const detail = block.detail;
  switch (block.code) {
    case "CONTROL_MUTATION_FORBIDDEN":
      if (detail?.variant === "control-area") {
        return createPreToolBlock(
          "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
          `目标 ${relative} 位于 Dev Flow 控制区，且不是 active feature 已登记的可编辑 Markdown 资产`,
          "原写入未执行；Dev Flow 控制区没有被修改",
          { mode: "user-decision", action: "确认后由模型调用对应 MCP 完成同一工作流意图；不要直接编辑控制区文件", retryOriginal: false },
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_STATE_MUTATION_FORBIDDEN",
        `目标 ${relative} 是 Dev Flow 控制文件，不能由普通文件工具直接修改`,
        "原写入未执行；工作流控制状态保持不变",
        { mode: "user-decision", action: `确认后由模型调用对应 MCP 完成对 ${relative} 的同一意图；不要重试这次控制文件直接写入`, retryOriginal: false },
      );
    case "ARTIFACT_NOT_REGISTERED": {
      const kind = artifactKind(relative);
      return createPreToolBlock(
        "DEV_FLOW_ARTIFACT_NOT_REGISTERED",
        `目标 ${relative} 是 active feature 的 ${kind} Markdown 资产，但尚未登记`,
        "原写入未执行；该资产不会进入 feature 证据账本",
        { mode: "guided", action: `先通过 MCP scaffold/register ${kind} 资产 ${relative}，再自动重试原写入`, retryOriginal: true },
      );
    }
    case "IMPLEMENTATION_APPROVAL_REQUIRED": {
      const impact = "原写入未执行；目标文件和当前 feature 状态未改变";
      if (detail?.revokedKind) {
        const action = `计划依据（${detail.revokedKind}）已在实现批准后变更，批准已作废；请先完成相关步骤并重新确认实现批准后再写 governed 文件${scratchHint}`;
        return createPreToolBlock("DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED", action, impact, { mode: "user-decision", action, retryOriginal: true });
      }
      if (detail?.variant === "approval") {
        return createPreToolBlock(
          "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
          `当前 open step 是 implementation，但目标 ${relative} 位于 governed root，执行批准义务尚未满足`,
          impact,
          { mode: "user-decision", action: `向用户展示当前实现批准问题并请求一次确认；确认后自动重试原写入${scratchHint}`, retryOriginal: true },
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED",
        `feature 仍处于 intake，目标 ${relative} 位于 governed root，尚未进入可执行实现阶段`,
        "原写入未执行；governed 目标保持不变",
        { mode: "user-decision", action: "先完成 intake 调查、解决分类决策并锁定基础路线；满足实现批准条件后自动重试原写入", retryOriginal: true },
      );
    }
    case "IMPLEMENTATION_UNIT_REQUIRED": {
      const base = createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_REQUIRED",
        `目标 ${relative} 已通过实现批准，但当前没有活动的 implementation unit`,
        "原写入未执行；governed 目标保持不变",
        { mode: "automatic", action: "调用 dev_flow_begin_implementation_unit 准备当前 implementation unit；成功后自动重试原写入", retryOriginal: true },
      );
      if (!detail?.beginFailed) return base;
      const reason = `${base.reason} Core 自动准备 implementation unit 失败：${detail.beginFailed}`;
      const action = `${base.recovery.action}；不要把该 Core 错误解释为 workflow state unreadable`;
      return { ...base, reason, recovery: { ...base.recovery, action } };
    }
    case "IMPLEMENTATION_UNIT_OUT_OF_SCOPE":
      return createPreToolBlock(
        "DEV_FLOW_IMPLEMENTATION_UNIT_OUT_OF_SCOPE",
        `当前 implementation unit 在 Trace 中已失效，无法证明目标 ${relative} 属于当前实现依据`,
        "原写入未执行；目标文件和 Trace 状态未改变",
        { mode: "user-decision", action: "刷新 Trace；能自动修复失效引用时先修复，否则展示差异并向用户询问一次；解决后自动重试原写入", retryOriginal: true },
      );
    case "GIT_GUARD":
      if (detail?.variant === "paths") {
        return createPreToolBlock(
          "DEV_FLOW_GIT_GUARD",
          "Git 命令包含未归属或已排除的路径",
          "原 Git 操作未执行；不会把用户或其他任务的文件混入 feature 提交",
          { mode: "user-decision", action: "先将路径明确纳入当前 feature 或移出暂存区；本仓库禁止智能体提交时交由用户审核", retryOriginal: false },
        );
      }
      if (detail?.variant === "publish") {
        return createPreToolBlock(
          "DEV_FLOW_GIT_GUARD",
          "外部发布仍然被禁止",
          "原 Git 操作未执行；工作树和 Git 历史没有被这次命令修改",
          { mode: "guided", action: "不要执行 push 或其他外部发布；本仓库由用户审核后手动发布", retryOriginal: true },
        );
      }
      return createPreToolBlock(
        "DEV_FLOW_GIT_GUARD",
        "当前 Git 写入不满足阶段、批准或路径归属条件",
        "原 Git 操作未执行；工作树和 Git 历史没有被这次命令修改",
        { mode: "guided", action: "先完成实现批准并只暂存 feature-owned 路径；仓库规则禁止智能体提交时交由用户执行", retryOriginal: true },
      );
    case "WORKFLOW_STATE_UNREADABLE":
      return unreadableBlock(detail?.unreadableReason ?? block.reason);
    default:
      // GIT_STARTUP_EXCLUDED is an audit verdict and is never formatted as a block.
      return unreadableBlock(block.reason);
  }
}
