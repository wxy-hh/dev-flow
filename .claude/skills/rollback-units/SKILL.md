---
name: rollback-units
description: 按需设计或审计最小回撤边界。优先把回撤写进 work.md 的各批次和 Risk and rollback；不默认创建回撤报告、提交或 patch 文件。
---

# 最小回撤单元

本技能帮助回答“失败后如何只撤掉受影响的增量”，不默认执行 Git 操作。

## 设计模式

对每个相关批次检查：

- Purpose：为什么需要这批改动。
- Scope：主要文件、共享接口或数据边界。
- Produces / Consumed by：后续依赖关系。
- Revert order：有关联时先撤谁。
- Strategy：revert、反向 patch、配置止血或其它可行方式。
- Post-revert verification：撤回后如何证明旧链路恢复。
- Residual risk：无法完全撤回的状态或外部影响。

简单且可独立 revert 的批次只需一两句。跨共享协议、队列 payload、数据结构或外部状态时才展开。

## 审计模式

实现后基于真实 diff 检查计划边界是否仍成立：

- 实际文件是否超出原 Scope。
- 共享生产者与消费者是否能按记录顺序回撤。
- 是否存在未记录的数据、配置或外部副作用。
- 回撤后验证是否仍可执行。

## 输出

存在 `work.md` 时直接修订对应 Batch 和 `Risk and rollback`；没有时在对话中给出短清单。用户明确要求独立报告时才创建。

不自动 `git commit`、`git revert`、`reset`、覆盖文件或删除资产。发现回撤不闭合且失败后果高时作为阻塞项返回 dev-flow；只有用户明确接受残留风险后才能收尾。
