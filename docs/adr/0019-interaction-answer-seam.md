# 交互以一份凭证落账

交互的解析曾经拆在 matcher、各 kind 的 resolve、以及 MCP 的 elicit 副本里。我们把这条 seam 收成一个入口：`answer` 收下宿主凭证，在同一笔 `mutatePrepared` 里证明、语义解析、并执行 kind.apply。

**决定：** caller 只传 `root`、`featureId`、`expectedRevision`、`host` 和一份凭证（表单选中或原文）。成功返回账本（`state`、`action`、可选 `comment`、若 apply 又呈现了下一题则带 `pending`）。不传 `interactionId`，不传 kind。不公开 inspect / prove / preview / replay。kind 表留在 implementation 里，下一刀验收或回撤加行，不改 `answer`。

**为什么不选另外两套：** 宽 interface 会把「证明 → 解析 → 应用」再拆成 caller 可编排的步骤，组合问题没有 locality。把 `expectedRevision` 藏进 persist 闭包，会和全仓 CAS 合同不一致——交互仍 pending、依据已变时，caller 带来的 revision 是 lock 前唯一能拒的信号。

**后果：** 没有 `UserInteraction` 则失败关闭，删除 `dev_flow_answer` 里内联 lock 路线或改归属的 fallback。第一刀只接追认、修订、计划修订、副作用重跑、归属、grill、批准、路线确认。测试只打 `answer` 的账本结果；旧 matcher / 各 kind resolve 单测删掉。表单按选中即信任证明，文本按展示之后、同宿主、未消费绑定。失败整笔不写。present 文案和危险操作授权不在此 module。
