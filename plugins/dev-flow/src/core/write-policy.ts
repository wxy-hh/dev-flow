import type { RecoveryAction } from "../policy/types.js";

export type WriteDecision =
  | { decision: "allow"; reason: string }
  | { decision: "audit"; reason: string }
  | { decision: "block"; reason: string; recoveryAction: RecoveryAction };

export interface WriteContext {
  mode: "intake" | "routed";
  stage?: string;
  controlPath: boolean;
  protectedPath: boolean;
  impactResolved: boolean;
  recoveryTransactionOpen?: boolean;
}

/** Semantic write judgment shared by host adapters; command syntax is absent. */
export function judgeWrite(context: WriteContext): WriteDecision {
  if (context.recoveryTransactionOpen) return {
    decision: "block",
    reason: "recovery transaction is open",
    recoveryAction: { kind: "refresh-status", reason: "先恢复未完成事务" },
  };
  if (context.controlPath) return {
    decision: "block",
    reason: "workflow control files are Core-owned",
    recoveryAction: { kind: "use-equivalent-operation", reason: "通过 MCP/Core 变更状态" },
  };
  if (context.mode === "intake" && context.protectedPath) return {
    decision: "block",
    reason: "intake has no implementation stage",
    recoveryAction: { kind: "refresh-status", reason: "先完成事实调查并锁定路线" },
  };
  if (context.stage === "implementation" && context.protectedPath) {
    return context.impactResolved
      ? { decision: "allow", reason: "implementation writes are semantically in scope; actual diff is audited at unit boundary" }
      : { decision: "audit", reason: "write target will be classified from post-tool actual diff" };
  }
  if (context.protectedPath) return {
    decision: "block",
    reason: "protected source write is outside implementation stage",
    recoveryAction: { kind: "revise-plan", reason: "将实现写入放到 implementation stage" },
  };
  return { decision: "allow", reason: "unprotected or scratch write" };
}

