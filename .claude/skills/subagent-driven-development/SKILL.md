---
name: subagent-driven-development
description: 用户明确要求子代理/并行执行，且 work.md 批次可独立派发时使用。控制者按批次提供最小上下文，回收 diff 与验证结果，并更新同一个 work.md。
---

# 子代理驱动开发

子代理是执行方式，不是新的治理层。只有用户明确要求，或宿主规则明确允许代理分工时使用。

## 前置条件

- 已有清楚的 Boundary 和可独立验证的 Batches。
- 批次之间的共享文件和依赖已明确。
- 风险任务的 `Approval` 已确认或带证据地跳过。
- 主代理保留整体验收、风险门禁和最终 Git 决策责任。

## 派发单位

一个子代理只接收一个批次，输入包含：

```text
Outcome:
Scope:
Depends on:
Relevant context paths:
Constraints and risks:
Verification:
Rollback:
Expected report: files changed, evidence, unresolved risks
```

不要把整个对话或所有仓库文档交给子代理。禁止把 `.env*`、凭据或无关源码作为上下文。

## 执行规则

1. 有依赖的批次串行；真正独立且不会写同一文件的批次才可并行。
2. 子代理只实现当前 Outcome，不扩大范围，不自行提交、推送或回滚。
3. 子代理必须运行批次验证并报告原始结果；不能只说“完成”。
4. 主代理检查 diff、调用边界、验证和风险，不直接相信摘要。
5. 通过后由主代理勾选 `work.md` 批次并记录 Evidence。
6. 发现冲突、新风险或扩范围时停止相关批次，由主代理重新规划或输出风险卡。

## 审查强度

- 小而独立的批次：主代理做一次 diff 审查即可。
- 修改共享协议、状态或安全边界：增加独立审查视角。
- Critical/Important 问题修复后重审受影响 diff。

所有子代理完成后，主代理仍需做跨批次集成审查和新鲜验证。不要另建进度台账、审查包或任务报告目录；需要恢复的信息只写回 `work.md`。
