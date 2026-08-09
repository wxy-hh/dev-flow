# 07 — 提前发现 hook 中断并自动恢复对账

**What to build:** 让用户在任务开始和关键推进前获知 Claude/Codex hook 是否正常工作；接线中断时安全暂停，恢复后由 Core 自动对账并只询问真正未知的工作区归属。

**Blocked by:** 02 — 批量确认并持续追踪工作区归属

**Status:** implemented; ready-for-review

- [x] 支持宿主在没有 active feature 时也记录项目级 SessionStart 或 UserPromptSubmit 健康信号。
- [x] 开始任务前能够区分健康接线与缺少可信健康信号，缺失时不创建一个无法留证的 active feature。
- [x] checkpoint、implementation 完成和 finalize 前检查近期宿主健康与未知归属，异常时返回可恢复阻塞。
- [x] doctor 分别报告未安装或未接线、曾接线但信号过期、当前健康和恢复后健康状态。
- [x] hook 恢复后自动执行 workspace reconciliation，并将无法证明来源的路径交给正式归属交互。
- [x] 恢复过程不创建手工 host-event 注入入口，不自动接纳文件，也不要求直接编辑控制状态。
- [x] Claude 与 Codex adapter 对等记录健康信号和恢复证据，跨宿主时保持来源限制。
- [x] 宿主协议和公开 MCP 旅程覆盖健康、中断、恢复及后续正常推进。
