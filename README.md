# Dev Flow

Dev Flow 是面向 **Claude Code** 与 **Codex CLI** 的预构建双宿主插件。

它按**规模（XS/S/M/L）× 拓扑 × 执行方式（light/standard）× 需求状态 × 风险标签**选择路线，只强制该路线所需的步骤与证据；两端共用 `.dev-flow/` 状态，可在 Claude 开任务、Codex 收尾（或反向）。

- 安装与升级：仅宿主原生 marketplace / plugin 命令  
- 流程接口：本地 MCP（Skills 不得手改状态文件）  
- 不提供：复制安装、升级脚本、旧版迁移、CLAUDE.md 注入、OpenSpec 集成  

更细的契约见 [路线说明](docs/routes.md)、[架构](docs/architecture.md)、[发布](docs/publishing.md)。

---

## 安装

```bash
# Claude Code
claude plugin marketplace add wxy-hh/dev-flow
claude plugin install dev-flow@dev-flow-marketplace

# Codex CLI
codex plugin marketplace add wxy-hh/dev-flow
codex plugin add dev-flow@dev-flow-marketplace
```

升级使用各宿主原生命令（如 `claude plugin update`、`codex plugin marketplace upgrade` 等），**没有** `dev-flow-upgrade`。

安装后请：新开会话或 reload 插件；按提示**信任 hooks**；确认 MCP 中有 `dev_flow_*` 工具。

### 宿主基线

v1 经 release-smoke 验证的最低组合：

| 组件 | 版本 |
|------|------|
| Claude Code | **2.1.215** |
| Codex CLI | **0.144.4** |
| Node.js | **≥ 20**（仅开发/构建；用户安装插件无需 `npm install`） |

本机真机安装与跨宿主接力（可选）：

```bash
HOST_E2E=1 npm run test:host-e2e
```

日常 `npm test` 会跳过该层，仍覆盖全路线、资产、门禁与 adapter。

---

## 第一次使用

1. 在业务仓库中让智能体调用 **`dev_flow_init_project`**，生成 `.dev-flow/project.json`（强制模式、受保护根目录、允许的验证命令）。  
2. 未初始化前**不能** `dev_flow_start`。  
3. 用 **`dev-flow-task`**（或自然语言「用 Dev Flow 开始任务」）做分类并 `start`。  
4. 始终先 **`dev_flow_next`**，只执行返回的**一个**动作。  
5. 遇到 HUMAN GATE：输出后**停等**用户原话，再用 `dev_flow_confirm_gate`（不可同回合确认）。  
6. 需要 `feature-check` 的路线通过检查后才 `finalize`；**logic-complete 之前 hooks 会拦截 Git 写操作**。

需求确认不等于需求拷问：标准 M/L 的 `missing-or-unclear` 与 `documented-unconfirmed` 需求会在 `requirements` 步骤内先进入 `dev-flow-grillme` 的逐题澄清；只有 `grill_status: complete` 且 requirements 已登记，才能展示需求确认门禁。`provided-confirmed` 默认不自动拷问，但可显式调用 `dev-flow-grillme` 压测。

项目侧状态（示意）：

```text
.dev-flow/
  project.json
  active.json
  features/<feature-id>/
    state.json
    events.jsonl
    <路线要求的 Markdown 资产>
```

---

## 分级与路线（必读摘要）

**规模与风险独立**：风险标签**不抬高** level，只加强该路线内的证据；拓扑不满足时**拒绝启动**并建议级别，不静默升级。

| 路线 | 何时（简要） | 主要步骤 | 强制 Markdown | feature-check |
|------|----------------|----------|---------------|---------------|
| **XS** | 局部、local、无风险 | 定位 → 实现 → 验证 | 无 | 否 |
| **S** | 单模块、local、无风险 | 边界 → 实现 → 验证 → 自审 | 无 | 否 |
| **risk-minimal** | XS/S 或 light M 且带风险标签 | 风险卡 → 控制项 → **实现批准** → 实现 → 代码审查 → 验证 | status、risk-card | **是** |
| **light M** | M + light + 无风险 | 边界/短计划 → 实现 → 代码审查 → 验证 | 无（审查为步骤，不强制独立 md） | 否 |
| **standard M** | M + standard + 需求状态 | 需求（含强制 grill 子流程）→ **需求确认** → 计划 → 覆盖 → 回撤 → 计划审查 → **实现批准** → 实现 → 代码审查 → 验证 | requirements、plan、status、coverage | **是** |
| **light L** | L + light | 边界卡 → 回撤/安全 → **实现批准** → 实现 → 代码审查 → 验证 | boundary、rollback-safety、verification | **是** |
| **standard L** | L + standard + 需求状态 | 与标准 M 同骨架，含强制 grill 子流程，证据/独立资产更全 | 需求/计划/覆盖/回撤/计划审查/代码审查/验证 | **是** |

分类输入要点：

- XS/S：**不要**传 `execution`  
- M/L：**必须** `execution: light | standard`  
- standard M/L：**必须** `requirements`：`missing-or-unclear` / `documented-unconfirmed` / `provided-confirmed`  
- 拓扑：`local` 最低 XS；`shared-contract` 最低 M；`multi-chain` / `coordinated-rollback` 必须 L  

完整步骤名、资产 kind、`plan_review`≠`code_review` 等以 [docs/routes.md](docs/routes.md) 与 `plugins/dev-flow/policy/contract.json` 为准。

---

## 入口与 Skills

| 用途 | Skill（两端共用名） |
|------|---------------------|
| 开任务 / 分类 | `dev-flow-task` |
| 状态 / 接力 | `dev-flow-status` |
| 诊断 | `dev-flow-doctor` |
| 收尾 | `dev-flow-finish` |
| 需求采集与登记 | `dev-flow-requirements` |
| 需求/方案逐题拷问（grillme） | `dev-flow-grillme` |
| 风险 / 计划 / 覆盖 / 回撤 / 计划审查 / 实现 / 代码审查 / 验证 / feature-check | 对应 `dev-flow-*` |

`dev-flow-requirements` 是需求链唯一编排者与 MCP 写入者；`dev-flow-grillme` 只做逐题压测（可写 `requirements.md` 的 Decision Log / Open Questions / `grill_status`，**禁止** mutation/gate）。触发词含 grillme、拷问、压测方案等。

状态只通过 MCP（如 `dev_flow_start`、`dev_flow_next`、`dev_flow_confirm_gate`、`dev_flow_finalize` 等）变更。

---

## 开发本仓库

```bash
npm ci
npm test                 # typecheck + 单测 + 路线 E2E + dist/版本检查
HOST_E2E=1 npm run test:host-e2e   # 真机 marketplace（需本机 claude/codex）
```

插件运行时为零 npm 依赖；`dist/*.mjs` 随包发布。

---

## 许可

MIT。详见 [LICENSE](./LICENSE)。
