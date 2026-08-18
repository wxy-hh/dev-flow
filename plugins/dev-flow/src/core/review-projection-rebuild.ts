import { prepareReviewProjection } from "./review-projection.js";
import { mutatePrepared, readState, type FeatureState } from "./state-store.js";
import { DevFlowError } from "./errors.js";

export async function rebuildReviewProjection(root: string, featureId: string, expectedRevision: number): Promise<FeatureState> {
  const current = await readState(root, featureId);
  if (!current.review) throw new DevFlowError("REVIEW_PROJECTION_INVALID", "当前 feature 没有 review ledger pointer。", { userMessage: "当前没有可重建的审查投影。重建投影只能修复投影文件，不能恢复从未捕获的审查输出。", recoveryKind: "repair", recoveryInstruction: "运行 doctor 检查审查 ledger。重建投影不能发明 envelope。", retryOriginal: false });
  return mutatePrepared(root, featureId, expectedRevision, "review-projection-rebuilt", async (state) => {
    const projectionState = structuredClone(state) as FeatureState;
    await prepareReviewProjection(root, projectionState);
    const artifact = projectionState.artifacts["plan-review"];
    if (!artifact) throw new DevFlowError("REVIEW_PROJECTION_INVALID", "无法从 ledger 生成 review projection。", { userMessage: "审查投影无法从当前 ledger 重建。", recoveryKind: "repair", recoveryInstruction: "运行 doctor 检查审查 ledger 和投影文件。", retryOriginal: false });
    return {
      mutate: (draft) => { draft.artifacts["plan-review"] = artifact; },
      eventData: { projectionPath: artifact.path },
    };
  });
}
