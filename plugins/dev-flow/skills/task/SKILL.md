---
name: task
description: 启动 Dev Flow 任务、调查仓库并锁定动态治理路线。
---

只使用 Dev Flow MCP 改变流程状态，禁止手改 `.dev-flow`。先 `dev_flow_start` 创建 intake，再读取代码、文档、测试、Git 与项目配置完成取证。

分类时提交完整 `classificationBasis`：`changeSurface`、`behaviorChange`、`topology`、`unitCount`、需求状态与恢复事实都必须有仓库依据。Core 取三类下限的最高级别；可以有证据地向上加强，风险只增加控制，不能抬高或绕过最低 level。

锁定前必须完成 `boundaryAudit`：逐项扫描默认假设、自由空间、TBD、fallback、范围与验收留白。每个发现只能绑定仓库 evidence，或绑定已解决的用户 decision；不得把“未发现”当作未扫描。多条仓库事实一次调用 `dev_flow_record_repository_facts`，用返回的 `recordIds` 填 `classificationBasis` / `boundaryAudit`；不要对同一 revision 连发单条。先调用 `dev_flow_classify` 查看 level、控制原因和完整 `orderedRoute`，再调用 `dev_flow_lock_classification`。classify 预览（`dev_flow_classify` 输出）是给模型的分类依据，不向用户讨确认；路线确认只由 lock 后 route-confirmation gate 承担一次。

待决问题只能由用户真实回复解析，模型不得用转述自答；失败时只呈现一次问题并等待新用户消息。

无风险 XS/S 可直接锁定。M/L 或含风险时，Core 生成 route-confirmation；向用户完整展示事实依据、level、路线、启用与未启用控制原因，再通过原生 elicitation 或 `dev_flow_answer` 接受确认。`dev_flow_answer` 不接受任何 caller 提交的回复文本：只传 featureId/expectedRevision/host，由 Core 读取呈现后最后一条未消费的同宿主用户事件并精确匹配；模型不得转述或自答。不要因入口从表单降级为文本而重复追问。用户要求加严时，把具体要求放入 `classificationBasis.controlEnhancements` 并重新预览；该字段只能增加控制。要求减弱控制时，只能修正触发事实后重新分类；实现开始后控制只能增加。

锁定后明确告知用户 XS/S/M/L、动态控制和完整实际路线，不再使用 light/standard 或六路线术语。后续只按 `dev_flow_status` / `dev_flow_inspect` 返回的动作推进。
