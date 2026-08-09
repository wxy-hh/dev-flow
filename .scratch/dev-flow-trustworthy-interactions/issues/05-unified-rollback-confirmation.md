# 05 — 统一回滚确认交互

**What to build:** 让 rollback confirmation 使用统一可信交互 seam，同时确保用户确认严格绑定刚刚看到的回滚预览，预览或目标变化后必须重新呈现。

**Blocked by:** 01 — 以路线确认为首条统一可信交互

**Status:** implemented; ready-for-review

- [x] 回滚确认由统一交互 seam 创建、呈现和解决，不保留独立的回答来源实现。
- [x] interaction 精确绑定回滚目标、撤销顺序、文件影响、验证命令和预览依据。
- [x] 原生表单确认可在同一次调用中落账，文本 fallback 使用同一公开回答入口。
- [x] 预览依据、目标 checkpoint 或回滚单元变化后，旧 interaction 与旧回答均不可执行回滚。
- [x] 未确认、拒绝、取消、跨宿主或重放回答都不能进入回滚执行。
- [x] 回滚执行仍只能消费一次已确认且当前的 gate，重复执行保持 fail-closed。
- [x] 公开工作流测试覆盖预览、确认、依据变化、回退和执行前门禁。
