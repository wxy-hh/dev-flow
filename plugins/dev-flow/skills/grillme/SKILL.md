---
name: grillme
description: 在 Dev Flow 中用统一 A/B/C 交互澄清现场取舍，并以可信语义回答落账。
---

先查仓库，只有会改变范围、验收、拓扑、风险或不可逆取舍的问题才询问用户，每次只问一个互斥决策。

现场取舍只走 `dev_flow_request_grill_decision` → 原生 elicitation / `dev_flow_answer`；不要创建第二份 pending ledger，也不存在 resolve-decision 工具。已有明确用户结论使用 `dev_flow_record_decision`：它先展示用户原话与拟登记结论，只有用户简短确认后才登记为当前决定（决策追认），不会仅凭历史消息中的相同文字自动落账。

每次请求必须提交 2–3 个正式选项。每个选项只提供稳定的语义 `id`、不带 A/B/C 的 `label` 和非空 `description`；另传唯一 `recommendation: { optionId, reason }`，推荐理由不能为空。`other` 是 Core 保留的自定义出口，不能用作正式 option id。Core 按选项顺序自动分配 A/B/C，并统一生成以下展示，Skill 不得自行重排或改写：

```text
问题……

A. 选项一（推荐）
   推荐理由……

B. 选项二
   说明……

C. 选项三
   说明……

请回复 A、B 或 C。
如果都不合适，请回复“其他：<你的方案和理由>”。
```

会改变范围、验收条件、拓扑、风险或不可逆取舍的高影响问题，`recommendation` 必须额外提供 `drawback`（推荐方案的主要缺点）与 `alternative: { optionId, condition }`（一个非推荐替代方案更适用的条件）。Core 会在选项之后、回复引导之前统一附加这两行提醒；普通低影响问题不要携带这两个字段，保持简短呈现。

Core 只在客户端能稳定消费时使用 MCP form elicitation；Claude Code 当前直接使用可信文本 interaction，避免多步键盘表单和 60 秒超时。decline、cancel、协议错误、超时或缺少能力时保留 pending，并展示同一份 A/B/C 文本。

文本入口接受 `A`/`a`/全角字母、`我选择 A`、`按方案 A 来`、唯一完整标签，以及带实质说明的 `其他：...` / `都不合适，我建议...`。这些表达归一为 option 或 other 响应，不要要求用户切换表单或复述完整标签。`A 或 B`、`A/B 都行`、单纯 `其他` 和否定某项但未明确选择的回答仍保持 pending；approval 继续使用严格整句合同。Claude `AskUserQuestion` 的已展示问题与真实选择会通过 `PostToolUse` 作为可信证据，选择后直接调用 `dev_flow_answer`，不再让用户用文本重复。

当前合同不读取旧 grill 的隐式“第一项推荐”合同；遇到旧 pending grill 时重新提出当前问题，不添加兼容分支。
