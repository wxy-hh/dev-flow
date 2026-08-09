---
name: rollback-safety
description: 落实 Dev Flow 的 delivery reverse、operational strategy 与 executable rollback 三层恢复保证。
---

所有任务必须生成 delivery reverse。L、数据/金额/可用性或多单元耦合还要 operational strategy。只有变更真实可逆、存在 unit-chain 且计划命令可执行时，才能声明 executable rollback。

不可逆变更不得伪称可回滚；必须使用 backup、preview、abort、compensation 与 full verification。执行 rollback 前展示精确 scope 与后果并取得当前确认；事务失败保留 journal 与现场，按 Core 恢复动作续办。symlink 回撤重建链接本身，不能跟随覆盖目标。
