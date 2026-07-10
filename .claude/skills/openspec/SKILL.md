---
name: openspec
description: 用户明确要求 OpenSpec/spec-driven 变更治理，或项目约定必须维护 OpenSpec baseline 时使用。维护 proposal/design/tasks/spec delta，但不为 dev-flow 再复制一套需求、计划或审查资产。
---

# OpenSpec 工作流

OpenSpec 是显式选择的规格系统，不是所有 M/L 的默认入口。

## 何时使用

- 用户明确提到 OpenSpec、proposal、spec delta、archive 或 baseline。
- 项目规则要求某类变更必须维护 OpenSpec。
- 需要长期维护的跨版本契约确实适合进入 living spec。

普通需求澄清或一次性计划优先留在对话/`work.md`，不为了形式启动 OpenSpec。

## 开始前

1. 读取项目内 OpenSpec 文档、配置和既有 change。
2. 检查 CLI 是否真实可用；不可用时说明限制，不猜命令。
3. 确认是创建新 change、更新已有 change、验证还是 archive。
4. 复用已有 change id；新 id 使用项目命名约定。

## 产物职责

- `proposal.md`：为什么做、范围和非目标。
- `design.md`：有真实技术取舍时记录方案与决策。
- `tasks.md`：OpenSpec 自身需要的任务跟踪；如果 `work.md` 已存在，只保留规格层任务，不复制逐批实现进度。
- `specs/**`：可长期验证的行为增量。

不要为没有设计取舍的变更强行创建 design，不要维护两份互相漂移的实现计划。

## 与 dev-flow 协作

L 或风险任务的执行事实源仍是 `work.md`。在其 Context 中列出真正需要读取的 OpenSpec 路径即可。风险标签、实现前确认、批次进度和最终验证仍由 dev-flow 管理。

OpenSpec 完成后只汇报 change id、生成/更新的规格文件、验证结果和下一步。除非用户明确要求，不自动 archive、提交或开始实现。
