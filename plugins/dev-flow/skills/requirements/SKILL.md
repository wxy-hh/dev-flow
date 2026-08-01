---
name: requirements
description: 采集、压测并确认需求。触发：写需求、需求不清楚、requirements、df-requirements、dev-flow-requirements。当 dev_flow_next 指向 requirements 或 requirement_confirmation 时使用。
---

以 Dev Flow MCP 为唯一工作流权威。先读 `dev_flow_status`，再调用 `dev_flow_next`，只执行它返回的唯一动作。禁止手改 state/控制文件。

## 合法写盘顺序

标准 M/L 的 Trace source 固定顺序：**`dev_flow_scaffold_artifact` → Read 已登记 artifact → 编辑 → `dev_flow_record_artifact_with_trace`**。禁止抢先 Write 未登记路径，也禁止直接编辑 snapshot 或 state pointer。

标准 M/L 的 `requirements` 步骤：

1. 仅在 MCP 请求时脚手架 requirements artifact，并从 MCP 返回的已登记路径读取文件名。
2. `missing-or-unclear` 或 `documented-unconfirmed` 委托 `grillme`（兼容 `df-grillme` / `dev-flow-grillme`）；后续回合续写已有 Decision Log 与首个未决 `Q-...`，不要重开访谈。
3. 每轮 grill 文件更新后立即以 `kind: "requirements"` 调用 `dev_flow_record_artifact_with_trace`，提交当前文件中的每个 `REQ-...` 和 `AC-...`（AC 必须声明 `parentRequirement`）。若仍有 `in_progress` 的当前题，使用 grillme 交接的题干与稳定选项 ID 调用 `dev_flow_request_grill_decision`；该工具会优先展示原生选择控件。
   - 清单预批轮（`grill_status: pending`、无当前题字段）：登记后纯文本等待用户批准/合并/裁剪清单，不调用 `dev_flow_request_grill_decision`、不 `dev_flow_record_step`（会被 `GRILL_INCOMPLETE` 拒绝）；此阶段 `dev_flow_status` 显示无等待属预期。
   - 返回 `response.action === "merge-remaining"`（core 自动注入的「合并剩余」选项，原生选择或 fallback token）：交回 grillme 把当前题与剩余清单逐行写入 Decision Log（决策=推荐答案，来源=用户合并确认）并置 `complete`、清除当前题字段，重新登记后继续；**不要**再用 `dev_flow_resolve_grill_decision` 处理同一 interaction。
   - 用户自由文本回复「合并剩余」：不调用 `dev_flow_resolve_grill_decision`（自由文本不匹配交互 token 会报错）；同样作为超驰指令交回 grillme 按上述方式收尾。
   - 返回 `interactionOutcome: pending`：以自然语言呈现当前问题与选项（`A. <方案>（推荐）` 列表），引导用户**直接回复 A/B/C 或方案名称**（也接受「推荐」）；仅在用户表示无法自然选择时，才以代码块展示返回值 `interaction.fallback` 的一次性回复行作为兜底；不要新建 interaction。
   - 返回已选 `response`：把选项和补充说明交还 grillme，当回合写入 Decision Log 后**立即把 front matter 推进到下一题并调用 `dev_flow_request_grill_decision` 呈现它**，直到 `grill_status` 为 `complete`；不要把结果当成用户的自由文本重新猜测，也不要停在中间等待用户指示。
   - 用户在无控件回退中提交一次性回复后，先读 status，再用 `dev_flow_resolve_grill_decision`；只把其返回的结构化 `response` 交还 grillme。
4. 仅当 `dev_flow.grill_status` 为 `complete`（当前题字段已清除）并已登记，才可 `dev_flow_record_step(requirements)`。
5. record step 后立即调用 `dev_flow_next`。若返回 `present-human-gate: requirement_confirmation`，立即调用 `dev_flow_present_gate`。
6. `dev_flow_present_gate` 的结果处理：
   - `interactionOutcome: confirm`：这是有溯源的真实用户选择；立即继续 `dev_flow_next`，不要再要求用户输入批准短语。禁止同回合伪造 `confirm` 或自行填充选择结果。
   - `interactionOutcome: request-changes`：读取返回值 `response.comment` 的结构化修改意见，更新相应 artifact 并登记；门禁会失效，基于新资料重新展示控件。
   - `interactionOutcome: pending`：**直接询问用户**——“需要你确认需求基线，回复「确认」通过；如需修改，回复「修改需求：<内容>」”；仅在用户无法确认时，才以代码块展示 `interaction.fallback` 的一次性回复行兜底。
   - 后续用户使用自然语言回复或一次性回复时，调用 `dev_flow_respond_interaction`；只有没有 interaction 的旧 feature 才使用 `dev_flow_confirm_gate` 的旧文本兼容路径。

对 `provided-confirmed` 不自动调用 grillme；脚手架或快照需求后以 `grill_status: not_required` 继续。显式 grillme 交接可改为 `complete`，之后必须重新登记并重新展示因此失效的需求门禁。

## 停步话术（HUMAN GATE）

面向用户呈现纯自然语言（不展示 featureId/route 等内部标识）：

```text
需要你确认需求基线：

<目标一句话摘要>

回复「确认」通过；如需修改，回复「修改需求：<内容>」
```

进度（剩余步骤）如需提示，压缩成一行小字放在结尾。合法等待不是失败。禁止创建第二份 requirements artifact、需求门禁或工作流状态文件。
