# 01 — 以路线确认为首条统一可信交互

**What to build:** 让用户通过路线确认完整走通新的统一交互 seam：Core 先登记问题，再以真实事件先后顺序或原生表单接受一次可信回答，不再要求回答处于更高的 feature revision。

**Blocked by:** None — can start immediately.

**Status:** implemented; ready-for-review

- [x] 路线锁定需要确认时只创建一个权威 interaction，并向现有状态读取方提供兼容的 pending decision 投影。
- [x] 每次呈现生成稳定的 presentation 标识，并在 append-only 事件账本中留下可定位记录。
- [x] 同一 feature revision 中、位于 presentation 之后的同宿主文本回答可以成功确认路线。
- [x] 原生 MCP 表单接受后在同一次工具调用中完成确认，不要求用户再发送相同文本。
- [x] 不支持原生表单、表单超时或协议失败时，问题保持 pending，并可通过统一文本入口完成回答。
- [x] presentation 之前的消息、跨宿主消息、已消费消息和多个候选消息均被拒绝且不改变状态。
- [x] 通过公开 MCP 工作流接口覆盖成功、回退、防重放与 revision 0/同 revision 场景。
