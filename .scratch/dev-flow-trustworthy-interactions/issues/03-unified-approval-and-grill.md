# 03 — 统一执行批准与现场取舍交互

**What to build:** 让 execution approval 与 grill decision 使用和路线确认相同的呈现、回答、来源验证及防重放行为，使用户无论遇到哪类普通决策都只需理解一套交互合同。

**Blocked by:** 01 — 以路线确认为首条统一可信交互

**Status:** implemented; ready-for-review

- [x] execution approval 和 grill decision 都由统一交互 seam 创建、呈现和解决。
- [x] 原生表单选择在同一次调用内落账，文本 fallback 通过同一个公开回答入口落账。
- [x] approval 继续接受公开的明确批准短语；grill 继续要求完整正式选项及必需的补充说明。
- [x] 同宿主、presentation 之后、唯一且未消费的来源约束对两类决定完全一致。
- [x] decline、cancel、request-changes 和表单失败不会被错误记录为确认，并保留正确下一步。
- [x] 状态、interaction outcome 与审计事件使用一致的公开动作语义，不暴露内部 option 标识作为用户合同。
- [x] 已有 approval 与 grill 用户旅程改由公开统一 seam 测试，重复的浅层匹配测试被替换或收缩。
