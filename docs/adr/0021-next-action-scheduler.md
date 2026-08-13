# 下一步只有 nextAction 一处调度

「现在该做什么」曾拆成 Policy 里 39 行的 `deriveNext`、Core 里真正覆盖审查/单元/追溯的 `nextAction`、以及 doctor 手写的下一步字符串。生产只信 `nextAction`，bug 也在覆盖层。

**决定：** `nextAction` 是唯一调度。`deriveNext` 不再是公开合同，沉为私有或内联。CompactStatus 只翻译 NextAction。`readStatusView` 只消费 `nextAction`，不另算一遍。intake 与 routed 只要存在唯一待决交互，下一步就是先回答它。doctor 仍不跑完整调度，只投影 mode/待决，文案不得发明第三套 next 语义。

**为什么：** 留下公开 `deriveNext` 会继续测错层。doctor 若改调完整调度，损坏态下医生先炸（8-13 第 4 条）。待决与「开始单元」并行会让用户看见两条下一步。

**后果：** 测试打 NextAction 的 kind/step/unitId；中文投影只留少量翻译测。不把审查账本 I/O 抽成假 port。这是可见行为变化：有待决交互时不再同时建议推进实现。
