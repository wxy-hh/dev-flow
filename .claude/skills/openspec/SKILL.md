---
name: openspec
description: 使用 OpenSpec 做需求和变更治理。用户提到 OpenSpec、openspec、opsx、spec-driven、变更提案、proposal/design/tasks/spec delta，或 dev-flow 将 M/L 级需求路由到 OpenSpec 时使用；负责创建/维护 openspec/changes 下的 proposal、delta specs、design 和 tasks。
---

# OpenSpec 项目工作流

用 OpenSpec 把模糊需求变成可审查、可验证、可归档的变更包。OpenSpec 是需求和变更治理层，不直接替代代码实现、代码审查或完成前验证。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 OpenSpec 策略、`<FEATURE_ROOT>`、`<REVIEW_ROOT>` 和 feature-id 规约。

## 本地源码

本项目已经包含 OpenSpec 源码和文档：

- `OpenSpec-main/docs/concepts.md`
- `OpenSpec-main/docs/workflows.md`
- `OpenSpec-main/docs/commands.md`
- `OpenSpec-main/docs/agent-contract.md`
- `OpenSpec-main/schemas/spec-driven/templates/`

需要深入规则时，按任务读取对应文档。不要一次性加载整个 `OpenSpec-main`。

## CLI 可用性

优先使用已安装或已构建的 `openspec` CLI。

如果 `openspec` 命令不可用，或 `OpenSpec-main/bin/openspec.js` 因缺少 `dist/` 不能运行，则按本文规则手工维护 `openspec/changes/<change-id>/`。不要为了使用 OpenSpec 擅自安装依赖或重写项目配置。

## 项目结构

OpenSpec 项目产物放在：

```text
openspec/
├── config.yaml
├── specs/
└── changes/
    └── <change-id>/
        ├── proposal.md
        ├── design.md
        ├── tasks.md
        └── specs/
            └── <domain>/
                └── spec.md
```

## Baseline 策略

是否维护 `openspec/specs/` 活 baseline 由项目适配层决定：

- `living-baseline: false`：OpenSpec 只保存 point-in-time 变更包；完成后不回写 `openspec/specs/`。
- `living-baseline: true`：收尾阶段必须 archive change，并把 delta 合并回 `openspec/specs/`。

当前项目为 `living-baseline: false`。不要让空的 `openspec/specs/` 看起来像已经维护了活文档。

## 路由选择

使用 OpenSpec 的场景：

- dev-flow 判断为 M/L，且用户希望用 OpenSpec 固化需求。
- 涉及登录、鉴权、订单、跨系统跳转、权限、接口契约或多页面状态。
- 需求可能被多人复用或后续归档。

不使用 OpenSpec 的场景：

- XS/S 小修。
- 用户明确要求只走轻量流程。
- 只需要一次性 `req-probe` 需求说明书。

## 创建变更

1. 选择 kebab-case `change-id`，例如 `user-login-code-auth`。
2. 创建 `openspec/changes/<change-id>/`。
3. 写 `proposal.md`：
   - Intent：为什么做。
   - Scope：做什么，不做什么。
   - Impact：涉及页面、接口、状态、权限、验证。
4. 写 delta spec：
   - 放在 `openspec/changes/<change-id>/specs/<domain>/spec.md`。
   - 用 `## ADDED Requirements`、`## MODIFIED Requirements`、`## REMOVED Requirements`。
   - 每个 requirement 至少包含一个 `#### Scenario:`。
5. 写 `design.md`：
   - 技术方案、数据流、状态副作用、异常处理、风险。
   - L 级且设计不确定性高时，写 2-3 个候选方案、取舍和推荐方案；设计自明时说明跳过多方案。
6. 写 `tasks.md`：
   - 使用 checkbox。
   - 每项任务必须能被实现和验证。

## 验证

如果 CLI 可用，运行：

```bash
openspec validate <change-id>
```

如果 CLI 不可用，手工检查：

- `proposal.md` 是否说明 intent/scope/impact。
- delta spec 是否使用 ADDED/MODIFIED/REMOVED。
- 每个 requirement 是否有 scenario。
- `design.md` 是否覆盖数据流、异常、风险。
- `tasks.md` 是否能映射回需求和设计。

## 交接给 dev-flow

OpenSpec change 完成后，把以下路径交给后续流程：

```text
openspec/changes/<change-id>/proposal.md
openspec/changes/<change-id>/specs/
openspec/changes/<change-id>/design.md
openspec/changes/<change-id>/tasks.md
```

后续步骤通常是：

```text
grillme → writing-plans → requirements-coverage → plan-review → rollback-units → 实现 → code-review → verification-before-completion
```

如果 `tasks.md` 已经足够具体，`writing-plans` 可以引用它并只补充项目内执行细节，不要重复制造第二套互相冲突的计划。

从 `writing-plans` 起，所有实现层产物都写到 `<FEATURE_ROOT>/<feature-id>/` 或 `<REVIEW_ROOT>/`；OpenSpec 目录只保留需求、设计和 delta spec。

OpenSpec 完成后更新 `<FEATURE_ROOT>/<feature-id>/status.md`；如果目录尚不存在，先创建 feature 目录并记录 OpenSpec 路径。轻量 L 和标准 M/L 的 `status.md` 必须包含 `dev_flow_status`；context manifest 由后续 `writing-plans` 创建或刷新，并把 OpenSpec 产物登记为需求或计划上下文。

完成 OpenSpec 变更包后输出 `[HANDOFF]`，并等待用户确认需求边界：

```text
[HANDOFF]
Feature ID: <change-id>
Level: <M|L>
Current gate: openspec
Generated assets:
- <FEATURE_ROOT>/<feature-id>/status.md
- openspec/changes/<change-id>/proposal.md
- openspec/changes/<change-id>/design.md
- openspec/changes/<change-id>/tasks.md
- openspec/changes/<change-id>/specs/
Next skill: grillme
Next inputs:
- <FEATURE_ROOT>/<feature-id>/status.md
- openspec/changes/<change-id>/proposal.md
- openspec/changes/<change-id>/design.md
- openspec/changes/<change-id>/tasks.md
- openspec/changes/<change-id>/specs/
Auto-continue: no
Stop reason: human requirement confirmation required
[/HANDOFF]
```
