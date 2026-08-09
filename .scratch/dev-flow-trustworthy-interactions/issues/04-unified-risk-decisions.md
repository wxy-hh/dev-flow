# 04 — 统一风险决定交互

**What to build:** 让 review risk acceptance 与 quality exception 使用统一交互合同，同时继续把用户回答绑定到当时展示的精确风险集合，避免过期或不同风险之间的确认重放。

**Blocked by:** 01 — 以路线确认为首条统一可信交互

**Status:** implemented; ready-for-review

- [x] review risk acceptance 与 quality exception 都通过统一交互 seam 呈现和解决。
- [x] 原生表单与文本 fallback 产生相同的领域结果、来源记录和下一步。
- [x] 每个风险决定绑定当时展示的风险依据、目标集合与稳定摘要，依据变化后旧回答失效。
- [x] 接受风险必须包含合同要求的用户说明；缺少说明时保持 pending 且不写入 disposition。
- [x] decline、cancel、超时和协议失败不会被记录为接受风险。
- [x] 跨宿主、presentation 之前和已消费事件继续被拒绝，且风险账本保持不变。
- [x] 公开 MCP 测试覆盖接受、拒绝、依据变化、文本回退和原生表单路径。
