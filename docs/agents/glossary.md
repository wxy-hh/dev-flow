# Dev Flow 可信交互词汇表

- **可信回答**：由 Core 呈现的问题绑定到同宿主、呈现之后、唯一且未消费的用户事件；原生表单回答在同一次调用内以同一 interaction 落账。
- **执行授权依据**：决定是否允许进入实现的稳定语义摘要，包含 scope、执行相关任务/RU、文件范围、恢复语义和当前阻断风险，不包含 review batch id 或阶段投影。
- **证据失效**：已记录的验证、Trace、Review 或 checkpoint 不再满足其引用依据时的显式 stale 状态；失效不会被自动当作风险接受。
- **工作区归属**：路径是否属于当前 feature 的用户结论。已观察不等于已归属；未知路径必须通过批量或逐个 interaction 处理。
- **宿主接线健康**：Claude/Codex adapter 在项目级记录的 SessionStart 或 UserPromptSubmit 信号。健康信号不替代 Core 决策，也不会授权自动接纳文件。

