---
name: writing-plans
description: 将已确认的需求说明书、OpenSpec 产物或用户澄清整理为可执行的多步实现计划。dev-flow 在标准 M/L 完成需求固化后使用；`grillme` 是否执行由需求是否明确确认决定。按项目适配层生成实现计划，并交接给下一道已触发门禁。
---

# Writing Plans

把已确认的需求或规格整理为可执行的多步实现计划。计划要让不了解当前上下文的工程师也能按任务落地：每个任务写清文件、行为变化、验证和回撤，不预写完整实现。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<FEATURE_ROOT>`、`<SCOPED_SPEC_ROOT>`、feature-id 规约和验证配置。

## 资产读取

按 `dev-flow/references/protocol.md` 的资产读取优先级；本技能额外查找需求说明书和 `openspec/changes/<change-id>/proposal.md`/`design.md`/`tasks.md`/`specs/**/*.md`。

如果需求边界未确认，不要猜测补计划：完整文档返回 grillme，模糊/缺失返回 req-probe，OpenSpec 项目返回 openspec。标准 M/L 进入前必须已有 `start --execution standard --requirements ...` 创建的 status；缺失时返回 dev-flow 补做 start。用户当前消息已明确确认且无未决时先登记 requirement evidence；其它 pending 场景输出 HUMAN GATE 并停止。

## 保存路径

计划保存到 `<FEATURE_ROOT>/<feature-id>/实现计划.md`。`feature-id` 使用项目适配层的命名规约；无法稳定推导时先给出建议 id 并询问用户确认。

OpenSpec 只作为需求和设计输入。从本技能开始，计划、覆盖、回撤、审查和验证等实现层产物统一写入 `<FEATURE_ROOT>/<feature-id>/` 或 `<REVIEW_ROOT>/`。如果 OpenSpec `tasks.md` 已经足够具体，只引用并补充项目执行细节，不复制成第二套互相冲突的计划。

存在成熟 design 时使用 **delta 卡**（不复制 design 原文）：本次范围、非目标、验收差异、风险差异、与 design 的差异。

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
- 如项目适配层定义了任务大小约束，则按适配层执行；否则按"可独立验证、可独立回撤"拆分，不按文件数量硬切。

## Plan Document Header

每份计划必须以这个结构开头：

```markdown
# [功能名称] 实现计划

> **使用说明：** 按照 `Depends on` 依赖关系执行。每步使用 checkbox (`- [ ]`) 语法跟踪进度。

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

唯一任务格式（禁止同时维护 `Files` 与 `Writes` 两套列表）：

```markdown
### Task N: <目标>

**Requirements:** R-002, R-004
**Depends on:** Task 1 或 `none`
**Writes:**
- Modify `src/a.ts`
- Create `src/b.ts`

**Change:** 行为变化和接口边界（短接口签名或 5–15 行骨架仅在消除歧义时使用）。
**Verification:** 可执行验证命令或人工检查点与预期结果。
**Rollback:** 回撤范围与顺序。
```

规则：

- 不预写完整实现；禁止把整文件/大段实现代码 dump 进计划。
- 只在消除歧义时保留短接口签名或 5–15 行骨架。
- 计划长度只做观测，不设 hard gate。

任务编号只用于稳定引用，不代表必须按数字顺序执行。计划必须显式写出 `Depends on` 与 `Writes`；`Writes` 是编排规则（`task-schedule` 用它判断并行），不是 hook 级安全控制。文件、父目录、子目录或 glob 有交集即串行；缺少 `Writes` 的任务不得派发。实现顺序由依赖关系和可独立验证性决定，回撤顺序另由 `rollback-units` 定义。成熟设计可将覆盖内嵌在计划的 `## Requirements coverage` 章节（配合 light gate 与 `gate_evidence`），`assets` 只登记真实文件路径，禁止 `path#heading`。

## No Placeholders

这些是计划失败，必须修掉：

- `TBD`、`TODO`、`implement later`、`fill in details`
- `稍后实现`、`适当处理`、`按需处理`
- "添加适当的错误处理"但没有列出具体错误分支
- "写测试"但没有写具体验证命令或检查点
- "类似 Task N"但没有重复必要信息
- 引用了未定义的类型、函数、路由、字段或文件

## Self-Review

计划写完后自查并直接修正：

1. **Spec coverage**：每条需求是否能指向一个任务？列出任何缺口并补任务。
2. **Placeholder scan**：检查并删除占位表达。
3. **No full dump**：任务是否只写 Change/Verification/Rollback，而非完整实现。
4. **Type consistency**：后续任务引用的类型、函数、字段是否与前面定义一致。
5. **Rollback readiness**：每个任务是否能成为后续 `rollback-units` 的最小回撤单元。
6. **Verification readiness**：每个任务是否有能证明完成的命令或人工检查点。
7. **Timing / reverse paths**：每条 MUST/NEVER/仅当/成功后等时机约束须进入对应任务的 Change 与 Verification；每个成功副作用须写明失败、取消、重试与 no-op 路径。

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

生成计划后：保存路径，用 `add-asset --kind plan` 登记并调用 `complete-gate <feature-id> writing-plans`；CLI 根据路线把 `next_action` 派生为 `requirements-coverage`（触发时）或 `plan-review`，不得手改。简短说明任务数量和关键风险，再按 `dev-flow/references/protocol.md` 输出 `[HANDOFF]`。

标准 M/L 中，需求覆盖门禁被风险维度触发时自动交给 `requirements-coverage`；否则交给 `plan-review`。标准 L 默认触发 `requirements_coverage: full`；标准 M/L 的计划审查至少为 `light`，命中 security 风险标签且计划跨模块或共享状态时默认 `plan_review: full`。不得直接从 `writing-plans` 进入 `executing-plans` 或 `implementation_approval`。

计划阶段不要创建实现 Todo 或把实现任务标记为进行中/完成；真正的执行任务只在 `implementation_approval.status == confirmed` 后创建或推进。`Auto-continue: yes` 且无 HUMAN GATE/阻塞项时，当前回合直接继续调用 `Next skill`。

常见取值：需求覆盖触发或标准 L → `Next skill: requirements-coverage`；未触发 → `Next skill: plan-review`。标准 M/L 的 plan-review 是路线门禁，用户不继续时保持 approval-pending 并停止，不能以 accepted risk 把 process gate 伪装为完成。
