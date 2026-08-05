export type FailureRecoveryKind = "retry" | "refresh" | "repair" | "ask-user" | "pause" | "abandon";

export interface DevFlowFailure {
  code: string;
  userMessage: string;
  cause: string;
  impact: string;
  recovery: {
    kind: FailureRecoveryKind;
    instruction: string;
    requiresUserDecision: boolean;
    retryOriginal: boolean;
  };
  technical?: Record<string, unknown>;
}

const chineseRecovery = (code: string): DevFlowFailure["recovery"] => {
  if (code.includes("REVISION") || code.includes("CONFLICT")) {
    return { kind: "refresh", instruction: "刷新当前状态后重试原操作。", requiresUserDecision: false, retryOriginal: true };
  }
  if (code.includes("INTEGRITY") || code.includes("CORRUPT") || code.includes("UNREADABLE")) {
    return { kind: "repair", instruction: "运行 doctor 检查当前状态；不要手动修改控制文件。", requiresUserDecision: false, retryOriginal: false };
  }
  if (code.includes("REQUIRED") || code.includes("INCOMPLETE") || code.includes("STALE")) {
    return { kind: "retry", instruction: "按当前状态提示补齐缺失证据后重试。", requiresUserDecision: false, retryOriginal: true };
  }
  return { kind: "ask-user", instruction: "请确认是否按推荐恢复动作继续。", requiresUserDecision: true, retryOriginal: false };
};

export class DevFlowError extends Error {
  readonly userMessage: string;
  readonly cause: string;
  readonly impact: string;
  readonly recovery: DevFlowFailure["recovery"];

  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(`${code}: ${message}`);
    this.name = "DevFlowError";
    this.userMessage = typeof details.userMessage === "string" ? details.userMessage : "当前动作未完成。";
    this.cause = typeof details.cause === "string" ? details.cause : "当前流程条件尚未满足。";
    this.impact = typeof details.impact === "string" ? details.impact : "流程保持在当前阶段，已有用户文件不会被自动改写。";
    this.recovery = {
      ...chineseRecovery(code),
      ...(typeof details.recoveryKind === "string" ? { kind: details.recoveryKind as FailureRecoveryKind } : {}),
      ...(typeof details.recoveryInstruction === "string" ? { instruction: details.recoveryInstruction } : {}),
      ...(typeof details.requiresUserDecision === "boolean" ? { requiresUserDecision: details.requiresUserDecision } : {}),
      ...(typeof details.retryOriginal === "boolean" ? { retryOriginal: details.retryOriginal } : {}),
    };
  }

  toFailure(): DevFlowFailure {
    const technical: Record<string, unknown> = { ...this.details };
    // Revision conflicts are always safe to refresh-and-retry under the Core
    // expectedRevision CAS: the retry re-reads the caller-provided revision.
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
      ...(Object.keys(technical).length ? { technical } : {}),
    };
  }
}

export function failureFrom(error: unknown): DevFlowFailure {
  if (error instanceof DevFlowError) return error.toFailure();
  const cause = error instanceof Error ? error.message : String(error);
  return {
    code: "INTERNAL_ERROR",
    userMessage: "系统动作未完成。",
    cause,
    impact: "流程保持在当前阶段，未确认的动作不会被视为成功。",
    recovery: { kind: "repair", instruction: "运行 doctor 导出诊断并停止继续写入。", requiresUserDecision: false, retryOriginal: false },
    technical: {},
  };
}
