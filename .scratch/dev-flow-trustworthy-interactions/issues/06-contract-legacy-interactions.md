# 06 — 收缩旧交互路径并兼容现有 5.0 任务

**What to build:** 在所有决策类型迁移完成后收缩重复的 pending、匹配和 provenance 路径，使统一 interaction 成为唯一事实来源，同时让升级前已经进行中的 5.0 任务无需人工迁移即可继续。

**Blocked by:** 02 — 批量确认并持续追踪工作区归属；03 — 统一执行批准与现场取舍交互；04 — 统一风险决定交互；05 — 统一回滚确认交互

**Status:** implemented; ready-for-review

- [x] 所有用户问题都从同一种 interaction 记录派生，pending decision 仅作为兼容读取投影存在。
- [x] 删除或内聚各问题类型重复的文本匹配、时序验证、来源消费和错误恢复逻辑。
- [x] 新状态不再产生两份可能漂移的 pending truth，也不能同时存在多个权威待决问题。
- [x] 缺少 presentation 标识的现有 5.0 interaction 可从不可变事件顺序确定性推导并继续回答。
- [x] 兼容推导幂等；重复 status、doctor、answer 或恢复不会生成新问题、不同依据或重复事件。
- [x] 已解决的旧 interaction 不会在升级后重新呈现，仍 pending 的旧 interaction 不会静默视为已确认。
- [x] 公开状态形状保持兼容，现有 Skills 不需要知道内部交互迁移细节。
- [x] 统一 seam 的行为测试替代已失去价值的浅模块测试，完整单测与跨宿主测试保持通过。
