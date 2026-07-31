---
name: task
description: 开任务并分级 start。触发：开任务、开始功能、task、df-task、dev-flow-task。
---

仅使用 Dev Flow MCP。禁止手改 `.dev-flow` 控制文件（`state.json` / `active.json` / `events.jsonl` 等）；状态只由 MCP 推进。

## 合法写盘顺序

业务证据 Markdown：**`dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑 → `dev_flow_record_artifact`**。禁止抢先 Write 未登记路径。生成的 `status` 例外：只能 scaffold，禁止手工编辑或 `record_artifact`，随后继续 MCP 要求的步骤。

## 分类顺序

必须按以下顺序判断，不能先凭任务规模选择 standard：

1. **topology → 最低 level**：`local`、`shared-contract`、`multi-chain`、`coordinated-rollback`；最低 level 只升不降。
2. **具体失败后果 → riskLabels**：每个标签都必须能说出 security/data/money/external/availability/critical correctness/irreversible consequence 的具体后果。禁止因“相关”堆标签，禁止发明 `product-ux` 等领域标签。
3. **未决策程度 → execution**：M/L 分类输入使用 `execution: light | standard`。范围、接口、回滚、验收已锁定且无关键分叉时优先 `execution: light`；multi-chain 仍是 L，但可走 light-L。只有真实需求分叉、优先级或跨模块行为尚未决策时才用 `execution: standard`。
4. **仅 standard M/L → requirements/grill**：再从输入质量选择 `missing-or-unclear`、`documented-unconfirmed`、`provided-confirmed`。需求不清晰（`missing-or-unclear` / `documented-unconfirmed`）不得选 XS/S：先向用户澄清，或升级 M + standard；classify 会对这类组合返回 warning。
5. **验收协助建议 → acceptanceAssistSuggested**：需求明确包含 UI、浏览器、交互或视觉验收时传 `true`，否则传 `false`。它只决定 verify 阶段是否友好地建议可协助浏览器验收，绝不阻塞自动化验证、feature-check 或 finalize；money 风险仍由机器验证规则处理。

| 输入质量 | requirements | grill |
| --- | --- | --- |
| 一句话、范围或目标不清 | `missing-or-unclear` | 完整 grill（仅缺口） |
| 目标、参考与范围已给出，只缺 1–2 决策 | `documented-unconfirmed` | 短 grill |
| 书面规格且明确确认 / LGTM | `provided-confirmed` | 不自动 grill |

`provided-confirmed` 只是 light 候选信号，不会自动改变 route。截图 + 参考实现 + 明确视觉目标通常优先 `light` 或 `documented-unconfirmed`；禁止把 `missing-or-unclear` 当 standard 默认。

## 启动步骤

1. 必须先调用 `dev_flow_classify`，再以完全相同的分类输入调用 `dev_flow_start`；两个调用都必须带 `acceptanceAssistSuggested`。`scope` 必须是 `{ inScope: string[], outOfScope: string[] }` 或省略。
2. start 返回 FeatureState，不期待它额外返回 riskRequirements。start 成功后使用此前 classify 结果输出摘要：
   - route 与原因（1 句）；
   - 压缩 steps；
   - riskRequirements 派生的 checks 与 verification kinds；
   - 预计最多用户交互次数（grill 清单题数 + gate 数）；
   - 若偏重：说明可在安全边界内请求同 level standard→light。
3. 禁止在 Skill 内复制或重新实现 risk → evidence 映射。
4. 调用 `dev_flow_next`，只执行返回的唯一动作。

## 降级

用户明确要求“太重了 / 改 light”，且尚未 present/confirm `implementation_approval`、未实现、protected roots 自 start 未变时，调用 `dev_flow_reclassify`（`userEvidence` = 用户原话）。若指纹已变，只能走完当前 standard 或 abandon 后重开，禁止手改 state。

v1 does not integrate OpenSpec；已有规格仅作需求输入。
