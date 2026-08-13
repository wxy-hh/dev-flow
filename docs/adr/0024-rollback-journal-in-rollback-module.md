# 回撤日记是 rollback 的 implementation

可恢复回撤的 drive、预览、确认已在 rollback module；日记写入、校验、lease、heartbeat 却住在状态库，rollback 每推进一步就回调 store。

**决定：** 写日记、校验形状、lease 与 heartbeat 搬进 rollback。状态库只留只读门禁：有没有未完成回撤日记，供 `mutate` fail-closed。rollback 继续调用 `mutate`，单向依赖。不抽通用 journal persist。不把日记写入塞进 `mutatePrepared`。损坏 feature 的恢复日记仍留在 store。回撤确认交互归 ADR-0019 下一刀。

**为什么：** 恢复知识需要 locality。store 调 `rollback.hasOpen` 会成环。通用 journal 或把日记当 FeatureState 都会撑破现有 CAS。留下日记在 store 则架构审查会反复建议这一刀。

**后果：** 测试仍打 preview / executeRollback / 打开日记时其它 mutate 被拒。不新增公开 journal API 当测试面。用户可见回撤行为不变。
