# Dev Flow 2.0 路线契约

`dev_flow_start` 只创建 intake；`dev_flow_classify` 是纯预览，`dev_flow_lock_classification` 在事实和决策收敛后原子锁定基础路线。基础路线只有六条，风险只增加义务，不创建路线。

| 路线 | 用户可见阶段 | 强制文档 |
| --- | --- | --- |
| XS | 定位 → 实现 → 验证 → 完成 | 无 |
| S | 边界 → 实现 → 验证 → 完成 | 无 |
| light M | 轻量计划 → 实现 → 代码审查 → 验证 → 完成 | 无 |
| standard M | 需求对齐 → 实施计划（内嵌独立审查）→ 实现 → 代码审查 → 验证 → 完成 | `需求文档.md`、`实施计划.md` |
| light L | 实施计划 → 实现 → 代码审查 → 验证 → 完成 | `实施计划.md` |
| standard L | 需求对齐 → 实施计划（内嵌独立审查）→ 实现 → 代码审查 → 验证 → 完成 | `需求文档.md`、`实施计划.md` |

## 默认义务与审查角色

| 路线 | 默认义务 | 默认审查角色 |
| --- | --- | --- |
| XS / S | checkpoint | 无；风险事实可追加 review、verification、rollback 或 approval |
| light M | checkpoint | 无；风险事实可追加 review |
| standard M | approval、checkpoint、review | requirements-coverage、architecture-testability |
| light L | approval、checkpoint、rollback | 无计划批次；planning 需提交 `rollback-strategy` 证据 |
| standard L | approval、checkpoint、review、rollback | requirements-coverage、architecture-testability、rollback-operability |

`workflowCapabilities` 表示 Core/宿主支持的能力，不等于当前路线已经满足的义务；实际是否阻塞以 `dev_flow_next` 的 `obligations` 为准。风险标签只基于用户需求和仓库事实追加义务，不使用业务案例名单分级。

风险覆盖层不会创建第二条路线：Core 会在现有路线最合适的阶段返回 `risk-review`、安全边界、回滚或领域验证等证据要求；完成该阶段证据后，相关义务自动变为 `satisfied`。完成前如果仍有义务未满足，`dev_flow_finalize` 会返回 `OBLIGATIONS_INCOMPLETE`，并列出可恢复的义务清单。

## 事实分级与需求澄清

分类依据必须包含 `scopeFacts`、`topologyFacts`、`uncertaintyFacts`、`riskFacts` 和 `decisionRefs`。能从仓库、文档、测试或工具查明的事实不得询问用户；只有用户拥有的边界、优先级和取舍才进入决策台账。任何阶段都可以按需调用 `grillme`，但不会因为调用过它而自动升级路线。

风险标签必须有对应事实依据。`security`、`money`、`critical_correctness` 和不可逆后果默认增加确认与审查义务；`data`、`external`、`availability` 增加相应验证/恢复义务。相同 basis 只产生一次决策，basis 变化才重新确认；执行确认是按义务动态呈现的单一门禁，不是固定路线阶段。

## 默认自治与恢复

- implementation 阶段的等价 Write、Edit、patch、heredoc 等按真实影响归一化，普通写入不因命令形式拦截。
- 控制文件仍由 Core 管理；未解析的影响标记为 `impact-unresolved`，不伪称越权。
- 验证失败保留当前单元和失败尝试；有进展则自动修复，无进展或达到上限才等待用户。
- 实际 diff 与计划不一致时生成 drift report；只有实质偏航、重大风险取舍或恢复路径耗尽才向用户确认。
- 连续在同一工作区启动多个 feature 时，启动瞬间已存在的受保护目录脏文件仍归属前一 feature；如需串行开发，请先提交或隔离工作区。`dev_flow_finalize` 会以 `DELIVERY_FILE_PREEXISTING_DIRTY` 阻止把这类文件误纳入当前交付快照。

内部的 review、Trace、checkpoint、rollback、feature-check 都是 Core 义务或只读投影，不再作为重复的用户路线步骤。Standard 路线的单元依赖顺序由 Core 编排；模型不应把它扩展成第二条用户路线。v2 不迁移旧状态；doctor 会报告遗留状态并建议在 1.10 完成/放弃后重新开始。

机器权威：`plugins/dev-flow/policy/contract.json`。运行 `npm test` 验证合同、单元、路线和跨宿主交接。
