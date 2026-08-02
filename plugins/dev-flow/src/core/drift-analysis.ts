import type { ClassificationBasis, RecoveryAction } from "../policy/types.js";

export type DriftSeverity = "minor" | "material" | "uncertain";
export interface DriftReport {
  actualFiles: string[];
  anticipatedFiles: string[];
  added: string[];
  removed: string[];
  outOfScope: string[];
  touchesSharedContract: boolean;
  severity: DriftSeverity;
  evidence: string[];
  recommendation: "continue" | "revise-plan" | "reclassify" | "ask-user";
  recoveryAction: RecoveryAction;
}

export function analyzeDrift(input: {
  anticipatedFiles: string[];
  actualFiles: string[];
  outOfScope?: string[];
  touchesSharedContract?: boolean;
  classificationBasis?: ClassificationBasis;
}): DriftReport {
  const anticipated = [...new Set(input.anticipatedFiles)].sort();
  const actual = [...new Set(input.actualFiles)].sort();
  const expected = new Set(anticipated);
  const added = actual.filter((file) => !expected.has(file));
  const removed = anticipated.filter((file) => !actual.includes(file));
  const outOfScope = [...new Set(input.outOfScope ?? [])].sort();
  const shared = input.touchesSharedContract === true;
  const uncertain = actual.some((file) => !file || file.includes("*"));
  const severity: DriftSeverity = uncertain ? "uncertain" : (added.length || outOfScope.length || shared ? "material" : removed.length ? "minor" : "minor");
  const evidence = [
    `actual=${actual.join(",") || "(none)"}`,
    `anticipated=${anticipated.join(",") || "(none)"}`,
    ...(added.length ? [`added=${added.join(",")}`] : []),
    ...(outOfScope.length ? [`out-of-scope=${outOfScope.join(",")}`] : []),
    ...(shared ? ["shared-contract=true"] : []),
  ];
  const recommendation = uncertain ? "ask-user" : (outOfScope.length || shared ? "reclassify" : added.length ? "revise-plan" : "continue");
  const recoveryAction: RecoveryAction = recommendation === "continue"
    ? { kind: "refresh-status", reason: "记录实际 diff 后继续当前单元" }
    : recommendation === "revise-plan"
      ? { kind: "revise-plan", reason: "实际文件集合超出预期，需要更新计划并重新审查" }
      : recommendation === "reclassify"
        ? { kind: "reclassify", reason: "实际 diff 触及范围或共享契约" }
        : { kind: "ask-user", reason: "机器无法安全判断偏航含义", facts: evidence, impact: "可能改变路线、风险义务或验收范围", recommendation: "请确认继续、修订计划或重新分级" };
  return { actualFiles: actual, anticipatedFiles: anticipated, added, removed, outOfScope, touchesSharedContract: shared, severity, evidence, recommendation, recoveryAction };
}

