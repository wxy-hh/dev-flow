# Dev Flow 4.0 入门与 FAQ

Dev Flow 4.0 同时支持 Claude Code 与 Codex CLI。Core 共享路线、阶段、用户决策、审查、验证、Git 对账和交付状态；Skills 只通过 MCP 推进，不能编辑 `.dev-flow`。

## 最短路径

1. 调用 `dev_flow_init_project` 初始化当前业务仓库。
2. 调用 `dev_flow_start` 创建需求了解状态。
3. 调查代码、文档、测试和 Git 事实，调用 `dev_flow_classify` 预览，再调用 `dev_flow_lock_classification` 锁定路线。
4. 日常只调用 `dev_flow_status`。它返回中文状态、中文路线、中文阶段、当前进度和下一步。
5. 需要细节时一次调用一个 `dev_flow_inspect` topic：`classification`、`artifacts`、`trace`、`review`、`implementation`、`verification`、`delivery`、`history` 或 `diagnostics`。
6. 需要用户决定时只展示一道问题和 2-3 个选项，用户用中文回答，统一调用 `dev_flow_answer`。
7. 完成验证、审查和交付收尾后调用 `dev_flow_finalize`。

### 恢复动作：手动删除 `.dev-flow` 后

升级插件后手动删除业务目录下的 `.dev-flow/`（隔离旧任务状态）属正常操作。此后若直接调用 `dev_flow_start` 会返回「项目尚未初始化」。标准恢复动作：

1. 调用 `dev_flow_init_project` 重新初始化。
2. 调用 `dev_flow_start` 开启新需求（旧 feature 状态已被删除，无需清理）。

## 路线

| 内部路线 | 用户显示 | 主要阶段 |
| --- | --- | --- |
| `xs` | XS：极小改动 | 需求了解、开发实现、验证、交付收尾 |
| `s` | S：小型改动 | 需求确认、开发实现、验证、交付收尾 |
| `light-m` | light-m：中型变更（轻量治理） | 实施规划、开发实现、代码审查、验证、交付收尾 |
| `standard-m` | standard-m：中型变更（标准治理） | 需求确认、实施规划、开发实现、代码审查、验证、交付收尾 |
| `light-l` | light-l：大型变更（轻量治理） | 实施规划、开发实现、代码审查、验证、交付收尾 |
| `standard-l` | standard-l：大型变更（标准治理） | 需求确认、实施规划、开发实现、代码审查、验证、交付收尾 |

每次分类都必须附事实原因。风险只增加审查、验证、回滚、检查点或批准义务，不创建第二条路线。

## 单一用户决策

Core 同一 active feature 最多保存一个 pending decision。grill、执行批准、审查风险接受、回撤确认、质量例外、启动脏树归属和任务切换都进入同一入口：

```text
dev_flow_answer({ featureId, expectedRevision, userReply, host })
```

正常用户不需要知道 interaction ID、approval ID、event ID、hash、revision 或任何 token。文本回答的 provenance 由 Core 从当前宿主、呈现之后、唯一未消费的用户事件自动解析；没有唯一事件时只返回一个中文重新回答动作。

## 需求与 grill

需求文档只保存真实需求内容，不保存 `grill_status`、`grill_question_id` 或 `grill_response_hint`。grill 完成态由 Decision Ledger 推导：需求工件 current、没有 open decision、没有 pending decision、追溯 current 且必需确认已满足。

每回合只问一道题。系统不提供“合并剩余问题”自动选项，也不会因为用户停止澄清就替剩余问题选择推荐答案。

## Review

standard M/L 的 review batch 和 job package 不可变。finding history 使用 append-only finding events，`effectiveFindingState` 和 `unresolvedBlockingFindings` 是唯一归约与门禁函数。新 successor 会携带同 role 的未解决 blocker，每个 carried finding 都必须显式提交 resolved、still-blocking 或 risk-acceptance-required 结果。新批次没有新发现不能清除历史 blocker。

没有独立代理时只能显示“已完成多视角审查”；额度不足可以透明降级，不能夸大保证等级。ledger 合法而 projection 损坏时使用 `dev_flow_rebuild_review_projection`，不改变 finding 状态。

## Git 与交付

- schema v3 允许启动时工作树脏，但范围相交的预存路径必须逐题选择纳入或排除。
- implementation 获得授权后可以存在 WIP commit；本仓库规则禁止智能体实际执行 commit，系统只提供归属审计和用户提示。
- 用户手动 commit 后，status/resume/finalize 会自动执行 workspace reconcile，不重复询问“是否刚刚提交”。
- 只有文件内容相对最后证据变化时才标记相关 review、verification、checkpoint 或 implementation evidence stale；仅 HEAD 前进不自动 stale。
- `dev_flow_pause` 不要求 commit、验证或 finalize；`dev_flow_resume` 先检查分支、祖先提交链和工作区变化。
- finalize 允许 `baseHead` 是当前 HEAD 的祖先，交付快照表示 base tree 到当前工作树的最终差异，覆盖已提交、staged、unstaged、untracked、rename、delete、mode 和 binary 变化。

系统不会自动 stash、reset、restore 用户文件，也不会改写用户 Git 历史。分支切换、历史重写或无法确定交付内容属于完整性阻塞，不能通过质量例外伪装成功。

## 失败与恢复

默认错误只说明正在做什么、事实原因、影响和一个推荐动作。技术细节只在 `dev_flow_inspect({ topic: "diagnostics" })` 或 doctor 中查看。

- 可重试：系统自动重试，但必须记录进展。
- 需刷新：返回当前 revision 和安全刷新提示，不盲目重放 mutation。
- 需修复：保持当前状态，修复当前单元或投影。
- 需用户决定：只呈现一道中文问题。
- 完整性阻塞：只能 repair、pause、abandon 或导出诊断，不能接受风险后 finalize。

同一失败签名连续两次没有状态、文件 hash 或证据进展，或变体累计五次，自动修复停止并给出一个中文恢复动作。

## FAQ

### 为什么看不到完整 state？

这是 4.0 的设计。日常 status 保持短小，按主题 inspect 获取所需事实，避免默认响应携带控制字段和大段历史。

### 为什么不能直接输入批准 ID？

ID、hash 和 token 是内部控制数据。用户只需回答中文选项，Core 自动绑定当前唯一 pending decision 和可信宿主事件。

### 为什么旧 feature 不能继续？

schema v3 是硬切换，没有运行时迁移器。请运行 doctor 按说明结束旧测试 fixture，然后重新开始 feature。

### 真机宿主测试没有运行怎么办？

自动协议测试通过不等于真机验收通过。没有本机 Claude/Codex 时必须报告“自动协议测试通过，真机验收待用户执行”，不能伪报通过。
