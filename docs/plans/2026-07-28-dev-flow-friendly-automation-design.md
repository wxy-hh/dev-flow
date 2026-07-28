# Dev Flow 友好自动化与可靠交互设计

> **状态：** 已实施，自动化与双宿主 E2E 已通过；macOS 通知横幅的实际显示仍取决于本机通知权限。  
> **日期：** 2026-07-28

## 目标

保持 Dev Flow 的路线、人工需求/实现门禁、机器验证和交付快照约束，同时消除交互字段不一致与审批依据失效问题。浏览器协助与用户签收改为可选的质量辅助：它们绝不阻塞自动化验证、feature check 或 finalize。

## 已确认决策

1. gate 与 grill 仍优先使用原生结构化控件；无控件时使用一次性文本 token。用户点“提出修改意见”后由 agent 修改已登记资料，不要求用户编辑 Markdown。
2. 真正的 gate 可以等待用户的原生控件回复，不设置墙钟超时。普通对话同时说明“已打开选择卡片；看不到时可直接说明”，以便 agent 从 status 取回文本 token。
3. 所有交互 MCP 工具返回统一信封：`state`、`interaction`、`interactionOutcome` 与可选 `response`。skills 不再猜测 `progress.wait` 或私有 state 路径。
4. implementation approval 的依据集中定义；任一依据 artifact（包括 `risk-card`）更新都会撤销该批准并清除旧 interaction。
5. 浏览器协助只是非阻塞建议。检测到 browser/MCP 能力时，verify skill 可以提示用户并在获得后续明确请求后执行真实场景与 UI 核对；不回复、拒绝或环境缺失均继续既有自动化流程直到 finalize。
6. `manualAcceptanceRequired` 不再是推进门槛。新分类字段为 `acceptanceAssistSuggested`；旧输入/旧 state 的 `manualAcceptanceRequired: true` 仅迁移为建议。`browser`、`user-signoff`、`code-path-audit` 仍可作为可选验证记录；其缺失不阻塞流程。money 风险仍强制运行全部已配置的 `behaviorCommands`。
7. 仅在真正等待用户决策（gate/grill）和成功 finalize 时发送一次注意力提示，不播放背景音乐。提示为 best-effort：MCP `notifications/message` 始终发送；macOS 额外尝试系统通知与一次提示音；任何通知失败或不受支持均不影响状态机。

## 流程

```text
implementation approval gate ── user decision ──> implementation
implementation → code_review → automated verification
  └─ acceptanceAssistSuggested 且有 browser 能力：非阻塞提示“可协助验收”
verification → feature_check（若路线需要）→ finalize → 一次完成提示
```

可选浏览器协助不创建 gate、不调用等待型 elicitation、也不占用 `next`。用户在后续回合请求协助时，agent 才使用浏览器工具；若 feature 已 finalize，结果作为交付后观察报告，发现问题后由用户决定是否新开修复 feature。

## 兼容与边界

- 保留 `manualAcceptanceRequired` 作为 classify/start 的兼容输入；新 state 只写 `acceptanceAssistSuggested`。读取旧 state 时，缺少新字段但旧字段为 true 等价于建议为 true。
- 继续接受 legacy `dev_flow_confirm_gate`；新 interaction 工具和现有 gate/grill 控件都使用统一返回信封。
- 不新增 commit-confirm 生命周期、不改变中文 artifact 文件名、delivery snapshot 或 Git 语义。
- MCP 标准允许客户端选择自己的 elicitation UI，但 server-to-client elicitation 必须关联原始 client request，因此不能把它用于“用户可忽略且流程继续”的浏览器建议。注意力提示采用单向 notification，而非新的等待型 elicitation。[MCP Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)

## 验收摘要

- 无原生控件时，gate/grill 返回的 `interaction.fallback` 能直接回复；原生“提出修改意见”在 `response.comment` 返回，并能重新登记后重开 gate。
- `risk-card` 更新后，旧 implementation approval 不能继续放行受保护文件写入。
- `acceptanceAssistSuggested`、旧 `manualAcceptanceRequired: true`、用户不回复浏览器建议都不能阻止自动化验证、feature check 与 finalize；money 行为命令仍不能跳过。
- 每个新 gate/grill 和一次 finalize 仅发一条注意力通知；无通知能力、通知命令失败、非 macOS 均不改变 MCP 结果或 revision。
