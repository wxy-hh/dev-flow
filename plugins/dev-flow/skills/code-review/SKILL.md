---
name: code-review
description: 按 Core 返回的 none、focused、independent 或 full 深度审查实现。
---

读取 `classification.controls.codeReview`，不要在 Skill 复制风险映射。`none` 不创建独立阶段；`focused` 对实际 diff 做聚焦自审；`independent` 使用与实现分离的审查；`full` 深入调用影响、失败路径、安全、数据/金额/不可逆后果和测试充分性。

## 独立审查的隔离证明（ADR-0017 / issue 19）

`independent` 与 `full` 路线要求每个代码审查 job 在与实现隔离的上下文中完成，否则 `record_step code_review` 会被 `REVIEW_ISOLATION_REQUIRED` 阻塞。隔离证明只能来自宿主捕获的审查执行（SubagentOutput 完成的 review-execution 事件）或受控服务端采样，智能体自行声明或自行写入的事件不构成证明。

Claude Code 宿主的合规顺序：

1. 创建并 claim 当前 code 审查 job。
2. 调用 `dev_flow_start_isolated_review`，传入 `batchId`、`jobId`、稳定 `executionId`，得到 `declarationId`。
3. 启动隔离子代理，任务提示中必须包含标记 `dev-flow:isolated-review:<declarationId>`；子代理完成审查后返回结论。
4. 宿主 `SubagentOutput` hook 用父/子上下文 ID 自动补记 review-execution 事件；如果事件字段缺失或 contextId 相同，hook 失败关闭、不落证明。
5. 提交该 job 时，attestation.hostEventId 使用 `<declarationId>:complete`。

服务端采样仍可替代子代理：

1. **服务端采样**：通过 `dev_flow_sample_review_job` 完成 job，采样本身即受控隔离上下文，Core 自动记录证明。
2. **风险接受**：宿主确实无法提供隔离上下文时，先完成审查，再通过 `dev_flow_present_quality_exception`（kind=review）让用户明确接受独立性风险；接受只绑定当时交付内容。

普通 user-prompt、tool 事件或自由文本说明都不能形成隔离证明。

> Codex 侧本轮未实现 SubagentOutput 等价接缝：Codex 宿主使用服务端采样或质量例外路径。

审查范围以 Core 派生 implementation/delivery 文件和 Git 基线为准，不向用户索要文件清单。先修 blocking，再复审；修复产生的新可信写入自动加入交付。仅在实质审查完成且无 blocker 后，按 Core 返回的 requiredEvidence 记录 code_review；不要用 code review 替代 plan review。

## 双轴审查（ADR-0012）

code_review 必须分别完成并分别报告两个轴，Core 不接受单一总分或总体通过：

1. **代码质量轴**：交付内容本身是否可靠、清晰并符合项目规则。使用稳定审查基线（12 项常见缺陷类目）作为判断提示；项目规则优先，只有影响正确性、安全性、可维护性底线或违反项目明确规则的问题才标为 blocking，纯风格偏好不得阻塞。
2. **需求忠实度轴**：逐项核对每个验收条件（AC）是否被完整实现、是否遗漏、是否存在超出约定范围的实现（scope creep）。识别缺失实现与超范围改动，两轴结论分开记录。

提交 `record_step code_review` 时，evidence 必须包含：

```json
{
  "reviewType": "code",
  "axes": {
    "quality": { "status": "complete", "blockingCount": 0 },
    "fidelity": { "status": "complete", "blockingCount": 0 }
  },
  "findings": [
    {
      "axis": "quality",
      "severity": "blocking",
      "targets": ["src/foo.ts:42"],
      "claim": "……",
      "recommendation": "……",
      "status": "resolved"
    }
  ]
}
```

每个 blocking finding 必须有具体位置（targets）和显式处理状态（open / resolved / risk-accepted）；`blockingCount` 只统计尚未解决或未被风险接受的 blocking。两轴都必须 complete 且 blockingCount 为 0 时 Core 才允许 code_review 通过。

## 审查后变更（ADR-0005 / issue 21）

审查完成后如果交付内容再次变化，Core 会检测到依据漂移并自动重新打开受影响的实现单元、代码审查与验证；`finalize` 也会在最终内容与审查/验证记录不一致时拒绝。因此审查通过后修改代码时，先重新审查（必要时先重做受影响实现单元），不要直接重跑验证或完成。

## 风险接受（issue 22）

审查发现 blocking 时可以通过风险接受交互让用户确认，但接受只绑定当时的交付内容：内容变化后旧接受自动失效，必须重新审查或重新验证；风险已消失时 Core 不会要求再次接受。接受风险不会把失败检查改写为通过——报告始终显示"风险已接受"。
