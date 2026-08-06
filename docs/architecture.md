# Dev Flow 4.0 架构

Dev Flow 4.0 是一个同时服务 Claude Code、Codex CLI 与 Kimi Code（实验性）的本地插件。三个宿主共享同一套 Skills、MCP 与 policy 合同；宿主只归一化工具事件，Core 才拥有路线、阶段、义务、决策、审查和交付状态的判断权。

## 分层

| 层 | 职责 | 不负责 |
| --- | --- | --- |
| Skills | 理解任务、调用 MCP、生成计划和代码 | 直接编辑状态或自行决定路线 |
| MCP/Core | intake、事实分类、阶段推进、ledger、审查、checkpoint、修复和收尾 | 依赖某个宿主的对话格式 |
| Policy | 纯函数解析六条基础路线、风险义务和阶段能力 | 读取文件、调用宿主或使用业务关键词 |
| Host adapter | 解析写入意图、阻止控制路径和 Git 越权、转发事件 | 复制 route allowlist、独立推进步骤 |

## State v3

项目状态位于 `.dev-flow/`：

- `project.json`：验证命令、受保护根目录和项目级约束；
- `active.json`：唯一 active feature 指针；
- `features/<id>/state.json`：schema v3 原子状态；
- `features/<id>/events.jsonl`：追加式事件账本。

受保护根目录枚举在 Git worktree 中以 `git ls-files --cached --others --exclude-standard` 为权威语义，因此嵌套 `.gitignore`、global excludes 和 tracked-but-ignored 文件都按 Git 结果处理；Git worktree 枚举失败会 fail closed，不静默递归回退。非 Git 目录才使用递归回退，并继续排除 `.git/.dev-flow/node_modules`。`protectedRootsExclude` 在两种模式的枚举结果上统一优先过滤；受保护根中的 symbolic link 一律拒绝。

Feature 先处于 `mode: intake`，保存 objective、scope、调查摘要、唯一 pending decision、Decision Ledger 和 workspace lineage；只有分类事实完整、影响分类的决策已解决后，`lockClassification` 才以 CAS 写入 `mode: routed`、基础路线、classificationBasis、obligations 和初始 stages。读取 schema v1/v2 立即返回 `LEGACY_STATE_UNSUPPORTED`，没有迁移执行器。

所有 mutation 使用进程锁、revision CAS、fsync 和原子 rename。失败不得关闭阶段、消费用户事件或移动未提交 pointer。

## 路线、义务与阶段

基础路线只有 `xs`、`s`、`light-m`、`standard-m`、`light-l`、`standard-l`。风险标签不会创建新路线，只能基于用户事实增加 review、verification、rollback、checkpoint 或 approval obligation；相同 basis 的 obligation 合并，避免重复确认。

`dev_flow_status` 是唯一日常入口，返回 compact 中文状态；`dev_flow_inspect` 按九个固定主题提供细节，禁止 full/all。内部 mutation control 只放 structured content，不进入默认用户文案。

用户决定只有一个入口 `dev_flow_answer`。Core 保存一个 pending decision，按问题类型分派；文本回答从同宿主、呈现后、唯一未消费的用户事件自动完成 provenance，不要求用户输入 ID 或 token。

执行批准不是固定 route stage，而是动态覆盖层：当 approval obligation 仍待确认且 implementation 的前置条件已满足时，Core 生成一次基于需求、分类、计划、trace/review 和验证策略的 decision basis。basis 未变化时幂等复用，新的事实才生成新的 decision。

## 产物与可追溯性

只有 standard M/L 强制 `需求文档.md`，standard M/L 还强制 `实施计划.md`，light L 强制实施计划；XS、S、light M 不强制 Markdown。内部 artifact kind 仍使用英文，文件名固定为中文并按 NFC 归一化。

Trace、review、coverage、rollback 和 verification 是 Core 结构化投影，不要求模型维护重复的独立 Markdown。artifact、trace pointer 和 planning obligation 通过同一 CAS 登记；`plan-review` 是只读投影，不能被宿主直接写入。

## Review 与 grillme

standard M/L 默认执行 requirements-coverage、architecture-testability 与 rollback-operability 审查。审查基于不可变 planning snapshot 创建独立 role jobs，finding history 以 append-only finding events 为权威；successor 必须显式处置 carried blocker，不能用新批次零发现后台清空。`multi-perspective` 只表示多个角色完成，不夸大为已验证的多代理身份。

`grillme` 可独立调用，也可在任何阶段针对真实决策缺口调用。能通过仓库或工具查明的事实不提问；问题必须包含事实、2-3 个选项和推荐。问答结果写入 Decision Ledger，需求文档不保存 grill 状态字段。

## 自动 checkpoint 与修复

Core 在所有路线进入 implementation 时自动捕获基线，在实现边界捕获完成 checkpoint；模型不把 begin/checkpoint 当作日常路线步骤。实现期普通 protected-root 写入按真实影响放行并记录 actual diff，控制路径和恢复事务始终 fail closed。

verification 失败保留当前工作，不自动丢弃或静默 rollback。Repair loop 记录 failure signature、尝试次数和 progress evidence；有进展就继续，连续无进展、达到上限或出现 material/uncertain drift 才请求用户。局部回撤仍使用现有事务日志、备份和补偿机制，finalize 的 delivery snapshot 是另一层级的交付回退证据。

## Workspace 与生命周期

启动允许脏工作树，但与范围相交的预存路径必须逐题完成归属决策。implementation 获得授权后可存在 WIP commit；用户手动 commit 由 `dev_flow_reconcile_workspace` 自动对账，只有文件内容变化才使相关证据 stale。`dev_flow_pause` 不要求 commit、验证或 finalize，`dev_flow_resume` 先对账再恢复原阶段；finalize 接受 base HEAD 的祖先提交链并生成 base tree 到当前工作树的交付快照。

## Hooks、诊断与发布

Host adapter 对普通实现写入只做语义审计；intake、`.dev-flow` 控制文件、开放恢复事务和 Git 写入继续拒绝。Bash target analyzer 是辅助分析器，不是第二套权限系统：wrapper、解释器、管道、heredoc、变量展开、复杂重定向或仓库外日志无法静态解析时默认 fail-open，由宿主 sandbox、permissions 和原生确认负责安全判断，不产生 `DEV_FLOW_WRITE_TARGET_UNRESOLVED`。能确定归属的 protected roots、控制区、已登记/未登记资产和 logic-complete 门禁仍按现有工作流合同处理。

策略层返回显式 `allow` / `block` outcome。block 固定携带原因、影响、解决方案、确认模式和 `retryOriginal`，adapter 不再把异常或字符串猜测映射成状态损坏。`DEV_FLOW_WORKFLOW_STATE_UNREADABLE` 只在 active、project、state、revision 或 recovery 读取证据失败时使用，并给出来源；普通意外分析失败 fail-open 并作为诊断 advisory。Claude PreToolUse 使用 `hookSpecificOutput.permissionDecision = "deny"`，Codex 使用 `{ decision: "block", reason }`；允许且无 advisory 时两个宿主都退出 0 且无 stdout，Codex 不使用 `continue`、`stopReason` 或伪造 ask。

`PermissionRequest` 只在宿主本来准备询问时参与：首次风险请求不代决，成功的 `PostToolUse` 才能把 `task-reusable` 风险指纹追加到 active feature 的 Core 事件账本；`always-confirm`、feature 切换、finalize/abandon 和宿主 bypass 模式不产生或不复用 grant。宿主支持矩阵只有 Claude Code（manifest+MCP+claude-hook）与 Codex CLI（manifest+MCP+codex-hook）为「支持」；**Kimi Code（实验性）**需 `.kimi-plugin` manifest（MCP+hooks+`sessionStart.skill`），其 `PermissionRequest`/`PermissionResult` 是观察型事件，只写入审计账本、不代发 allow，授权记忆不生效，且 hook 脚本错误/超时默认放行（fail-open）；其他 MCP 客户端未支持，直连仅诊断，不具备写入守卫与可信用户证据。模型代决、手工调 hook、仅 MCP happy path、`doctor` 静态检查都不是兼容证据。`dev_flow_doctor` 只读报告损坏状态、开放恢复事务、遗留 v1 feature、插件接线和 bundle 完整性，并给出可执行 recovery action。

发布包包含 `dist/mcp-server.mjs`、`dist/claude-hook.mjs`、`dist/codex-hook.mjs`、`dist/kimi-hook.mjs`（实验性），版本由根 `package.json` 统一同步；发布前必须通过 schema、路线、跨宿主和构建检查。
