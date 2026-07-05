---
name: writing-plans
description: 将已确认的需求说明书、OpenSpec 产物或用户澄清整理为可执行的多步实现计划。dev-flow 在标准 M/L 的需求固化和 grillme 后使用；按项目适配层生成初步实现计划，并交接给下一道已触发门禁。
---

# Writing Plans

把已确认的需求或规格整理为可执行的多步实现计划。计划要让不了解当前上下文的工程师也能按任务落地：每个任务包含文件、核心改动、接口输入输出、验证方式和回撤思路。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<FEATURE_ROOT>`、feature-id 规约和验证配置；写文件前再展开为真实路径。

开场说明：

```text
正在使用 writing-plans 技能创建实现计划。
```

## 资产读取

输入优先级：

1. 用户当前消息中手动引用的需求说明书、OpenSpec 产物或设计文档。
2. 上一步 `[HANDOFF]` 的 `Next inputs`。
3. 当前 feature 目录的约定文件：
   - `<FEATURE_ROOT>/<feature-id>/需求说明书.md`
   - `openspec/changes/<change-id>/proposal.md`
   - `openspec/changes/<change-id>/design.md`
   - `openspec/changes/<change-id>/tasks.md`
   - `openspec/changes/<change-id>/specs/**/*.md`
4. 无明确 feature 时，查找最近修改的 `<FEATURE_ROOT>/*/需求说明书.md` 或 `openspec/changes/*/proposal.md`。

如果需求边界没有确认，先返回 `req-probe` 或 `openspec`，不要用猜测补计划。

## 保存路径

计划保存到：

```text
<FEATURE_ROOT>/<feature-id>/初步实现计划.md
```

`feature-id` 使用项目适配层的命名规约。无法从需求中稳定推导时，先给出建议 id 并询问用户确认。

OpenSpec 只作为需求和设计输入。从本技能开始，计划、覆盖、回撤、审查和验证等实现层产物统一写入 `<FEATURE_ROOT>/<feature-id>/` 或 `<REVIEW_ROOT>/`。如果 OpenSpec `tasks.md` 已经足够具体，只引用并补充项目执行细节，不复制成第二套互相冲突的计划。

## Scope Check

如果需求覆盖多个独立子系统，建议拆成多个 feature 或多个计划。每份计划都应该能产出独立可验证的软件增量。

## File Structure

定义任务前，先列出会创建或修改的文件，并说明每个文件负责什么。

- 遵循现有代码结构和项目规范。
- 文件职责要清楚，避免把多个职责塞进同一个任务或同一个文件。
- 文件一起变化时可以放在同一任务；两个任务能独立审查或回撤时要拆开。

## Task Right-Sizing

任务是最小可独立验证、可独立回撤的工作单元。拆分规则：

- 每个任务产出一个可检查的增量。
- 每个任务包含自己的验证方式。
- 每个任务写明原子回滚思路。
- 如项目适配层定义了任务大小约束，则按适配层执行；否则按“可独立验证、可独立回撤”拆分，不按文件数量硬切。

## Plan Document Header

每份计划必须以这个结构开头：

```markdown
# [功能名称] 实现计划

> **使用说明：** 按照任务编号顺序执行。每步使用 checkbox (`- [ ]`) 语法跟踪进度。

**目标：** [一句话描述要构建的内容]

**技术方案：** [2-3 句关于实现思路的说明]

**技术栈：** [关键技术/库]

## 输入资产
- 需求说明书：
- OpenSpec：
- grillme 结论：

## 全局约束

[项目级要求；每个任务都需遵守的公共前提。]

---
```

## Task Structure

````markdown
### Task N: [任务名称]

**Requirement IDs:** REQ-001, REQ-002

**Files:**
- Create: `exact/path/to/file.vue`
- Modify: `exact/path/to/existing.ts`

**Interfaces:**
- Consumes: [本任务依赖的输入、函数、类型或状态]
- Produces: [后续任务依赖的接口、组件、状态、路由或配置]

**Rollback idea:**
- [如何撤销本任务，不影响其他任务]

- [ ] **Step 1: 创建/修改文件**

```typescript
// 展示核心代码片段或结构；不要用占位句糊弄实现细节
```

- [ ] **Step 2: 验证**

验证方式: [具体命令或页面检查点；写明预期结果]
````

## No Placeholders

这些是计划失败，必须修掉：

- `TBD`、`TODO`、`implement later`、`fill in details`
- `稍后实现`、`适当处理`、`按需处理`
- “添加适当的错误处理”但没有列出具体错误分支
- “写测试”但没有写具体验证命令或检查点
- “类似 Task N”但没有重复必要信息
- 引用了未定义的类型、函数、路由、字段或文件

## Self-Review

计划写完后自查并直接修正：

1. **Spec coverage**：每条需求是否能指向一个任务？列出任何缺口并补任务。
2. **Placeholder scan**：检查并删除占位表达。
3. **Type consistency**：后续任务引用的类型、函数、字段是否与前面定义一致。
4. **Rollback readiness**：每个任务是否能成为后续 `rollback-units` 的最小回撤单元。
5. **Verification readiness**：每个任务是否有能证明完成的命令或人工检查点。

## 计划末尾

计划末尾必须包含：

```markdown
## 风险点与依赖项
- ...

## 验证总览
- ...

## 回撤边界草案
- Task 1: ...
- Task 2: ...
```

## 输出和交接

生成计划后输出：

1. 计划路径。
2. 更新 `<FEATURE_ROOT>/<feature-id>/status.md`，记录 `Current gate: writing-plans`、完成资产和下一步。
3. 简短说明任务数量、关键风险和需要用户确认的点。
4. `[HANDOFF]` 交接块。

标准 M/L 中，如果需求覆盖门禁被风险维度触发，自动交给 `requirements-coverage`；未触发时交给下一道已触发门禁：

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: writing-plans
Generated assets:
- <FEATURE_ROOT>/<feature-id>/status.md
- <FEATURE_ROOT>/<feature-id>/初步实现计划.md
Next skill: <next-triggered-gate>
Next inputs:
- <FEATURE_ROOT>/<feature-id>/需求说明书.md
- <FEATURE_ROOT>/<feature-id>/初步实现计划.md
Auto-continue: yes
[/HANDOFF]
```

常见取值：

- 需求覆盖触发：`Next skill: requirements-coverage`
- 需求覆盖未触发但计划审查触发：`Next skill: plan-review`
- 无前置检查门禁触发：`Next skill: subagent-driven-development` 或 `executing-plans`，并在实现前确认
