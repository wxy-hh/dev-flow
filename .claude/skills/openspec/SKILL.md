---
name: openspec
description: 使用 OpenSpec 做需求和变更治理。用户提到 OpenSpec、openspec、opsx、spec-driven、变更提案、proposal/design/tasks/spec delta，或 dev-flow 将 M/L 级需求路由到 OpenSpec 时使用；负责创建/维护 openspec/changes 下的 proposal、delta specs、design 和 tasks。
---

# OpenSpec 项目工作流

用 OpenSpec 把模糊需求变成可审查、可验证、可归档的变更包。OpenSpec 是需求和变更治理层，不直接替代代码实现、代码审查或完成前验证。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 OpenSpec 策略、`<FEATURE_ROOT>`、`<REVIEW_ROOT>` 和 feature-id 规约。

## CLI 可用性

优先使用已安装的 `openspec` CLI（`openspec validate <change-id>` 等）。CLI 不可用时，按本文规则手工维护 `openspec/changes/<change-id>/`，不要为了使用 CLI 擅自安装依赖或重写项目配置。

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

是否维护 `openspec/specs/` 活 baseline 由项目适配层的 `living-baseline` 决定：

- `false`：OpenSpec 只保存 point-in-time 变更包；完成后不回写 `openspec/specs/`。不要让空的 `openspec/specs/` 看起来像已经维护了活文档。
- `true`：收尾阶段必须 archive change，并把 delta 合并回 `openspec/specs/`。

## 路由选择

使用 OpenSpec 的场景：dev-flow 判断为 M/L 且用户希望用 OpenSpec 固化需求；涉及登录、鉴权、订单、跨系统跳转、权限、接口契约或多页面状态；需求可能被多人复用或后续归档。

不使用 OpenSpec 的场景：XS/S 小修；用户明确要求只走轻量流程；只需要一次性 `req-probe` 需求说明书。

## 创建变更

1. 选择 kebab-case `change-id`，例如 `user-login-code-auth`；创建 `openspec/changes/<change-id>/`。
2. 写 `proposal.md`：Intent（为什么做）、Scope（做什么，不做什么）、Impact（涉及页面、接口、状态、权限、验证）。
3. 写 delta spec：放在 `openspec/changes/<change-id>/specs/<domain>/spec.md`，用 `## ADDED Requirements`、`## MODIFIED Requirements`、`## REMOVED Requirements`；每个 requirement 至少包含一个 `#### Scenario:`。
4. 写 `design.md`：技术方案、数据流、状态副作用、异常处理、风险。L 级且设计不确定性高时，写 2-3 个候选方案、取舍和推荐方案；设计自明时说明跳过多方案。
5. 写 `tasks.md`：使用 checkbox，每项任务必须能被实现和验证。

## 验证

CLI 可用时运行 `openspec validate <change-id>`。CLI 不可用时手工检查：`proposal.md` 是否说明 intent/scope/impact；delta spec 是否使用 ADDED/MODIFIED/REMOVED；每个 requirement 是否有 scenario；`design.md` 是否覆盖数据流、异常、风险；`tasks.md` 是否能映射回需求和设计。

## 交接给 dev-flow

OpenSpec change 完成后，把 `proposal.md`、`specs/`、`design.md`、`tasks.md` 交给后续流程：

```text
grillme → [HUMAN GATE:requirement_confirmation] → writing-plans → requirements-coverage（触发时；标准 L 固定）→ plan-review → rollback-units/security-review（触发时）→ [HUMAN GATE:implementation_approval] → 实现 → code-review → verification-before-completion
```

如果 `tasks.md` 已经足够具体，`writing-plans` 可以引用它并只补充项目内执行细节，不要重复制造第二套互相冲突的计划。从 `writing-plans` 起，所有实现层产物都写到 `<FEATURE_ROOT>/<feature-id>/` 或 `<REVIEW_ROOT>/`；OpenSpec 目录只保留需求、设计和 delta spec。

OpenSpec 完成后，在分类回合以 `start --execution standard --requirements openspec` 创建的 status 中登记 change 资产，再 `complete-gate <feature-id> openspec` 推进到 grillme。独立使用且明确要求状态资产时才初始化。

完成 OpenSpec 变更包后，不提前输出 `[HUMAN GATE:requirement_confirmation]`。按 `dev-flow/references/protocol.md` 输出 `[HANDOFF]`：`Current gate: openspec`，`Next skill: grillme`，`Auto-continue: yes`；由 `grillme` 压测并更新 OpenSpec 后统一输出唯一一次需求确认门禁。只有用户明确要求单独使用 OpenSpec、不进入 dev-flow 标准 M/L 链路时，才由 OpenSpec 自己输出需求确认并停止。
