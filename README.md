# Dev Flow

Dev Flow 5.0 是面向 **Claude Code** 与 **Codex CLI** 的动态治理插件。Claude 与 Codex 共用 `.dev-flow/` 状态，可以跨宿主接力；Skills 只调用 MCP，不能手改控制文件。

模型负责读取代码、文档、测试和 Git 完成调查。Core 根据变更表面、行为复杂度与拓扑计算 `XS / S / M / L` 最低级别，再独立派生需求、计划、Trace、计划审查、执行确认、checkpoint、恢复、代码审查与验证控制，编译确定的完整路线。风险只增加控制，不抬高 level；5.0 不再有 `light/standard` 轴。

详细合同见 [路线说明](docs/routes.md)、[架构](docs/architecture.md)。

## 宿主支持

| 宿主 | 支持条件 | 可信能力 |
| --- | --- | --- |
| Claude Code | plugin manifest + MCP + `claude-hook.mjs` | 写门禁、可信用户事件、可信写入归属 |
| Codex CLI | plugin manifest + MCP + `codex-hook.mjs` | 写门禁、可信用户事件、可信写入归属 |
| 其他 MCP 客户端 | 只用于诊断 | 不得执行 governed write 或冒充可信确认 |

Hook 只处理能可靠识别的目标；复杂 wrapper、管道或变量展开仍由宿主 sandbox/permissions 判断。确定的 `.dev-flow` 写入、未批准的 governed write、开放恢复事务和禁止的 Git 操作始终 fail-closed。插件不会自动 stash/reset、删除缓存、接纳人工文件或发布变更。

## 安装与升级

### Claude Code 用户级

```bash
claude plugin marketplace add wxy-hh/dev-flow
claude plugin install dev-flow@dev-flow-marketplace
```

### Claude Code 项目级

在业务仓库根目录执行：

```bash
claude plugin marketplace add wxy-hh/dev-flow --scope project
claude plugin install dev-flow@dev-flow-marketplace --scope project
```

升级：

```bash
claude plugin marketplace update
claude plugin update dev-flow@dev-flow-marketplace
claude plugin update dev-flow@dev-flow-marketplace --scope project
```

升级后新开会话或执行 `/reload-plugins`。卸载时 scope 必须与安装一致；卸载插件不会自动删除业务仓的 `.dev-flow/`。

### Codex CLI

```bash
codex plugin marketplace add wxy-hh/dev-flow
codex plugin add dev-flow@dev-flow-marketplace
```

Codex 的安装与升级参数以 `codex plugin --help` 为准。

## 5.0 升级硬切换

5.0 不兼容 4.x active state、project config、review/checkpoint schema 或旧 MCP 调用合同，也不提供迁移器。升级前：

1. 使用 4.x finalize 或 abandon 所有未完成 feature。
2. 备份业务仓 `.dev-flow/` 审计目录。
3. 升级插件并重新初始化项目。
4. 用 `dev_flow_doctor` 确认 schema 与宿主接线。

5.0 发现旧数据会返回明确的 `UNSUPPORTED_*_SCHEMA`，不会静默转换。

## 初始化业务仓

插件安装和项目初始化是两件事。每个 Git 业务仓都要调用一次 MCP 工具 `dev_flow_init_project`，生成 `.dev-flow/project.json`。推荐明确要求：

```text
请用 dev_flow_init_project 初始化当前 Git 仓库：
- governedRoots 覆盖需要写门禁、归属、指纹、checkpoint、验证和交付的目录或精确文件
- 构建输出和临时文件放入 governedRootsExclude
- verification.commands 为每条命令声明 provides: targeted / behavior / integration / full
- preflightCommands 只登记环境准备命令，不计验证证据
- enforcement 使用 strict
```

初始化后运行 `dev_flow_doctor`。项目必须有真实 Git HEAD；第三方无可信 Hook 客户端只能诊断。

## 分类与动态路线

Core 使用三个下限的最高值：

| 信号 | XS | S | M | L |
| --- | --- | --- | --- | --- |
| `changeSurface` | single-site | single-component | multi-component | system-wide |
| `behaviorChange` | mechanical | bounded-rule | new-capability | systemic-change |
| topology | local | — | shared-contract | multi-chain / coordinated-rollback |

锁定前必须提交 `boundaryAudit`，扫描默认假设、自由空间、TBD、fallback、范围和验收留白。每项只能以仓库 evidence 或已解决的用户 decision 处置。M/L 或含风险时，Core 先展示事实、level、完整路线和控制原因，再通过 route-confirmation 原子锁定；普通无风险 XS/S 直接锁定。

用户要求更严格治理时，通过 `classificationBasis.controlEnhancements`（或分类平铺参数中的同名字段）显式追加控制；该合同只能增强，不能关闭 Core 派生的最低控制。若请求 executable rollback，仓库事实还必须证明操作真实可逆且不存在不可逆风险。

同为 M 的任务可能有不同流程：本地单单元可以只有正式计划、独立代码审查和 targeted/integration 验证；共享契约或多 RU 会增加需求证据、Trace、角色审查、执行确认、unit-chain 与 operational recovery。以 `dev_flow_classify/status` 返回的 `orderedRoute` 为准。

## 文件治理与恢复

- `governedRoots` 同时决定写门禁、ownership、fingerprint、checkpoint、verification 和 delivery snapshot；exclude 先于 symlink 安全检查。
- 只允许 Git tracked、目标仍在仓内且不进入 `.git/.dev-flow` 的 symlink。checkpoint 保存链接类型与 link target，rollback 重建链接本身。
- Hook 为可信智能体写入记录规范化路径、宿主、事件和前后摘要，并自动归属。implementation 不接受手填 files。
- IDE、人工与无法归因的变化创建唯一 ownership decision；多个路径先展示完整清单，可一次选择“全部纳入当前任务”“全部排除并先处理”或“逐个确认”。位于 scope 内不代表自动接纳；已观察但未归属的路径会持续待决。
- 普通决策的表单与文本入口共享同一语义匹配器：完整标签、唯一可判定的简称和已登记同义表达效果相同；含糊简称继续待决。执行批准仍使用严格整句白名单，带附加条件的文本不会被误认成无条件授权。
- `.git`、`.dev-flow` 和 `node_modules` 是业务指纹的内建排除项，即使 governed root 是仓库根目录、且这些路径未写入 `.gitignore` 也不会污染证据。
- 所有任务都有自动 baseline 和 delivery reverse。只有真实可逆且有 unit-chain 时才声明 executable rollback；不可逆变更使用 backup/preview/abort/compensation/full verification。

## 决策、审查与验证

- 现场取舍：`dev_flow_request_grill_decision` → 原生 elicitation / `dev_flow_answer`。
- 已有用户结论：`dev_flow_record_decision` 一次性记录 evidence/conclusion，并绑定 feature 启动后的可信用户事件。
- 不存在公开 `dev_flow_resolve_decision`、`dev_flow_feature_check`；finalize 内建完整性检查。
- Elicitation 使用 `oneOf + const + title`。最长等待 60 秒；超时取消并对当前 MCP 会话降级为文本，迟到响应忽略。
- Review v2 按角色保存 `roleBasisHash`；语义 diff 未影响的角色显示 `reused`，未知 diff 才全量重审。parallel-safe 在宿主支持时并行，否则顺序回退。
- `dev_flow_update_project` 通过 `expectedSha256` 做 CAS 更新；新增未引用命令或扩充 `provides` 只更新验证能力，被 Trace/RU 引用的命令变化只使对应切片 stale，治理范围、enforcement 和 preflight 变化拒绝走普通增量入口。
- 执行批准保存稳定的执行授权依据（范围、执行语义、REQ/AC/TASK/RU、文件范围、恢复语义和当前阻断风险），不因阶段重进、review batch 重建或无关配置变化重复询问。
- Review finding 的修复结论绑定原审查角色依据；相关语义变化派生为 `needs-revalidation` 并交回原角色，不能直接改写为风险接受。
- RU 只运行计划声明的 targeted forward verification。Final verification 从命令 `provides` 中选择覆盖 guarantee 集的最小去重集合；preflight 永不算 evidence。

开始任务、进入 implementation、checkpoint 和 finalize 前，Core 要求当前 Claude/Codex hook 在 15 分钟内有可信健康信号；缺失或过期会返回可恢复的 `HOOK_HEALTH_REQUIRED` / `HOOK_HEALTH_STALE`。`dev_flow_doctor` 会分别报告各宿主的 missing、stale、healthy 状态。SessionStart 只记录健康，不修改 active feature；恢复 hook 后重试原操作，Core 会检查工作区，真正未知的路径再由 `dev_flow_reconcile_workspace` 创建正式归属问题。

## Skills

Claude 斜杠形式为 `/dev-flow:<skill>`。

| 用途 | Skill |
| --- | --- |
| 启动、调查、分类 | `task` |
| 状态与接力 | `status` |
| 需求证据 / 决策澄清 | `requirements` / `grillme` |
| 计划 / Trace 覆盖 | `plan` / `coverage-review` |
| 动态角色计划审查 | `plan-review` |
| 实现 / 代码审查 / 验证 | `implement` / `code-review` / `verify` |
| 恢复保证 | `rollback-safety` |
| 诊断与派生修复 | `doctor` |
| finalize 与交付 | `finish` |

## 开发与验证

```bash
npm ci
npm run typecheck
npm run test:unit
npm run test:routes
npm run test:interop
npm test
npm run build:check
```

只有源码与测试稳定后才运行 `npm run build` 更新三个受版本控制的 bundle。智能体不执行 commit、push、PR 或发布。

## 许可

MIT。详见 [LICENSE](./LICENSE)。
