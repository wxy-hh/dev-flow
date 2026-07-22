# dev-flow 收尾可靠性设计

## 目标

修复一次真实任务暴露的三项执行偏差，并让无阻塞的代码审查自动推进到 logic-complete，避免遗留 active `status.md`。

## 约束

- 不增加风险标签、HUMAN GATE、状态 schema 或新的 CLI 层。
- 实现确认仍只允许在用户后续回复后生效；资产删除、提交、推送仍不得自动执行。
- 自动推进只覆盖无阻塞的既有步骤：code-review → verification → feature-check → final assets → finalizer dry-run。
- 任一 CRITICAL/HIGH、验证失败、待接受的残余风险、资产处置选择或 Git 操作都立即停止；已形成合规 partial 的任务可进入 logic-complete，但不得自动接受风险。

## 备选方案

1. 只补充文档提示：改动最小，但无法让编排器明确承担自动续跑责任。
2. **采用：收紧现有技能交接语义。** 复用 `Auto-continue`，使通过的 code-review 和 verification 明确自动进入下一既有技能；`/finish` 负责 logic-complete，随后停在资产处置选择。
3. 新增一条“一键收尾”CLI：会重复 `/finish` 编排、增加脚本层与恢复分支，拒绝采用。

## 设计

### 1. 实现批准范围

`implementation_approval` 卡必须列出“本次实现范围”和“明确不做范围”。有可选项时，默认不实现；用户只有明确选择后才能纳入范围。“确认”只能批准卡中已经确定的范围。

### 2. 风险证据就绪

对派生 full risk gate 的任务，必须在输出 implementation approval 前完成 report-mode 风险证据的落盘与登记。此处是已有证据义务的前置，不是额外门禁；避免用户确认后才发现 CLI 拒绝批准。

### 3. 资产处置确认

`compact`、`retain full`、`not now` 是逐字匹配的唯一选择。任何拼写错误、同义表达或推测意图均不得触发 finalizer；代理必须请求用户重发选项。该语义仍是对话协议，不伪装成可由本地 CLI 验证的用户身份认证。

### 4. 自动收尾

无 CRITICAL/HIGH 的 code-review 以 `Auto-continue: yes` 交给 verification。验证形成 verified 或合规 partial 后，编排器同回合调用 `/finish` 完成 feature-check 和最终资产生成，再输出 finalizer dry-run 与 `[ASSET FINALIZATION]` 并停止。

## 错误处理与验证

- 任何审查阻塞、验证失败、证据不完整、fingerprint 漂移或 final-assets 校验失败均维持当前 gate，不自动收尾。
- 为自动续跑和三项约束补充 doctor 静态不变量；保留现有 status/finalizer 的原子校验测试。
- 运行全部 dev-flow 脚本测试、doctor preflight/full 以及 manifest 一致性检查。

## 回撤

本次均为工作流说明和 doctor 静态检查。回撤相关文档与 doctor 断言即可恢复原行为，不涉及业务项目或状态迁移。
