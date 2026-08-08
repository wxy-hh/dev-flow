---
name: finish
description: 在 Dev Flow 5.0 finalize 中完成完整性检查、精确恢复与交付快照。
---

只在 status 显示 finalize 时调用 `dev_flow_finalize`。不存在公开 feature-check；finalize 内部统一校验需求/计划/Trace、review、approval、checkpoint、verification freshness、ownership 与 delivery snapshot。

未知归属必须列出具体文件并 reconcile/回答 ownership decision。真实 stale 时接受 Core 给出的最早恢复阶段，重做受影响步骤，不进行全量无差别重跑。最终交付只包含 Core 从可信写事件、checkpoint、Git 基线与已确认 ownership 派生的 governed 文件。

完成后报告快照和验证摘要。不要 commit、push 或发布；由用户审核并执行 Git 操作。
