import type { RecoveryAction } from "../policy/types.js";

export interface RepairAttempt {
  attempt: number;
  signature: string;
  progressEvidence: string[];
  at: string;
}

export interface RepairState {
  status: "active" | "stalled" | "waiting-user" | "completed";
  attempts: RepairAttempt[];
  maxAttempts: number;
  recoveryAction?: RecoveryAction;
}

export function startRepairLoop(maxAttempts = 5): RepairState {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
  return { status: "active", attempts: [], maxAttempts };
}

export function recordRepairAttempt(state: RepairState, signature: string, progressEvidence: string[]): RepairState {
  const attempts = [...state.attempts, { attempt: state.attempts.length + 1, signature, progressEvidence: [...progressEvidence], at: new Date().toISOString() }];
  const prior = attempts.at(-2);
  const noProgress = Boolean(prior && prior.signature === signature && prior.progressEvidence.join("\n") === progressEvidence.join("\n"));
  const stalled = noProgress || attempts.length >= state.maxAttempts;
  return stalled
    ? { ...state, status: "waiting-user", attempts, recoveryAction: { kind: "ask-user", reason: noProgress ? "同一失败签名连续两次没有进展" : "自动修复已达到轮次上限", facts: [signature, ...progressEvidence], impact: "继续自动修复可能掩盖真实偏差", recommendation: "请确认修订当前单元、回滚或调整计划" } }
    : { ...state, status: "active", attempts };
}

export function markRepairCompleted(state: RepairState): RepairState {
  return { ...state, status: "completed", recoveryAction: undefined };
}

