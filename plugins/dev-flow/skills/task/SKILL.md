---
name: task
description: 启动 Dev Flow 5.0 任务、调查仓库并锁定动态治理路线。
---

只使用 Dev Flow MCP 改变流程状态，禁止手改 `.dev-flow`。先 `dev_flow_start` 创建 intake，再读取代码、文档、测试、Git 与项目配置完成取证。

分类时提交完整 `classificationBasis`：`changeSurface`、`behaviorChange`、`topology`、`unitCount`、需求状态与恢复事实都必须有仓库依据。Core 取三类下限的最高级别；可以有证据地向上加强，风险只增加控制，不能抬高或绕过最低 level。

锁定前必须完成 `boundaryAudit`：逐项扫描默认假设、自由空间、TBD、fallback、范围与验收留白。每个发现只能绑定仓库 evidence，或绑定已解决的用户 decision；不得把“未发现”当作未扫描。先调用 `dev_flow_classify` 查看 level、控制原因和完整 `orderedRoute`，再调用 `dev_flow_lock_classification`。

无风险 XS/S 可直接锁定。M/L 或含风险时，Core 生成 route-confirmation；向用户完整展示事实依据、level、路线、启用与未启用控制原因，再通过原生 elicitation 或 `dev_flow_answer` 接受“确认这条路线”。用户要求加严时，把具体要求放入 `classificationBasis.controlEnhancements` 并重新预览；该字段只能增加控制。要求减弱控制时，只能修正触发事实后重新分类；实现开始后控制只能增加。

锁定后明确告知用户 XS/S/M/L、动态控制和完整实际路线，不再使用 light/standard 或六路线术语。后续只按 `dev_flow_status` / `dev_flow_inspect` 返回的动作推进。
