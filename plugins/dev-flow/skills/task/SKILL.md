---
name: task
description: 启动 Dev Flow 2.0 任务并进入 intake。触发：开任务、开始功能、task、df-task、dev-flow-task。
---

仅使用 Dev Flow MCP；禁止手改 `.dev-flow` 控制文件。启动不预先猜路线：先创建 intake，再调查事实、登记用户决策，最后原子锁定分类。

## 启动合同

1. 收集用户目标、初始范围和排除范围，调用 `dev_flow_start`，并显式传当前宿主 `host`（scope 可选）。
2. 读取代码、文档、测试和 Git 状态，整理 `classificationBasis`：scopeFacts、topologyFacts、uncertaintyFacts、riskFacts、decisionRefs；可进一步提供结构化 `signals` 使用推荐模式。
3. 只有必须由用户决定的边界才调用 `grillme`；问题和答案通过 decision ledger 记录。能从仓库查明的事实不提问。
4. 优先用含 `classificationBasis.signals` 的推荐模式调用 `dev_flow_classify` 做纯预览，操作者核实 reasons 后再 lock；兼容模式仍需检查矛盾和风险依据，没有事实依据的 risk label 不得提交。
5. 所有影响分类的 decision 已 resolved/merged 后，调用 `dev_flow_lock_classification`。锁定失败时按 recoveryHint 处理，不手改状态。
6. 之后反复读取 `dev_flow_next` 返回的 stage、allowedActions、completionCriteria 和 obligations，在能力合同内选择等价工具；不要把返回值理解为只能执行一个动作。Core 只验证语义结果。

## 分级原则

- 六条基础路线只由 level、topology、execution 和可核查事实决定：XS、S、light M、standard M、light L、standard L。
- 风险只增加 review、verification、rollback、approval、checkpoint 义务，永不创建额外路线；禁止业务关键词或案例名单分级。
- 清晰 XS/S/light M 不设形式化人工门禁；standard M、light/standard L 或有事实依据的重大风险才产生执行确认义务。
- 同一 decision basis 不重复询问；事实、范围、拓扑或残余风险发生实质变化时可以产生新的用户决策。

## 正常恢复

技术错误优先调用 status/next、重试或使用等价操作继续；只有 `waiting-user`、真实偏航或恢复路径耗尽才向用户反馈。不要因为命令形式不同、临时文件或一次可修复失败而停止流程。
