---
name: plan
description: 按 Dev Flow 动态计划控制生成定位、简报或正式计划。
---

读取 `classification.controls.plan`：`locate` 只记录定位，`brief` 给出边界简报，`formal` 才 scaffold/编辑/登记 `实施计划.md`。plan-review、unit-chain 或 operational recovery 会使计划采用正式结构；不要依据 level 名称复制另一套判断。

实施计划只使用 Core 模板的结构化 Markdown block；`dev_flow_validate_plan` 做只读预检并报告全部 named targeted verification 违规，`dev_flow_record_artifact` 自动编译并登记 Trace，没有独立 coverage/rollback 工件或旧 delta 输入。正式计划必须把 AC 覆盖到 TASK/TEST，并为每个 UNIT 声明 scope、dependency 与 targeted forward verification，为高风险步骤声明独立 REC 恢复命令。登记实施计划时 Core 会立即做完整 Trace 校验；缺 AC→TEST、TASK→UNIT、UNIT 引用或依赖闭环时先修计划，不能留到 implementation。

每个含行为变更的 TASK 声明测试执行顺序：TDD（测试先行：先写测试见红，再实现至绿）或明确无法 TDD 的理由（文档、类型导出、机械重构等）；TEST 锚点的验证场景须在实现前先行写出。

UNIT 是可独立前进和验证的行为切片；REC 只表达失败后的回滚/补偿安排，不与 UNIT 互相替代。只声明 targeted forward verification；preflight 是环境准备，不算证据。计划变化后接受 Core 的语义 diff：只重审受影响角色、只失效相关 approval/checkpoint/freshness。
