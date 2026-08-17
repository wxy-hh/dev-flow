---
name: doctor
description: 诊断 Dev Flow schema、MCP、hook、投影与恢复状态，并安全 repair 派生数据。
---

使用 `dev_flow_doctor`、status 和 diagnostics inspect。每个错误向用户给出稳定 code、中文原因、影响、恢复动作和白名单安全细节；不展示 capability、hash、token 或秘密。

发现 4.x/5.x active state、project、review 或 checkpoint 旧 schema 时返回 `UNSUPPORTED_*_SCHEMA`：要求回到产生该状态的版本 finalize/abandon，完整备份 `.dev-flow` 审计目录，再用 6.0 重新初始化；doctor 不迁移旧 active feature，也不猜测式覆盖旧审计状态。

doctor 还要检查 Claude/Codex 项目级 hook 健康与能力：`missing` 表示尚未收到可信 SessionStart/UserPromptSubmit，`stale` 表示最近信号超过 15 分钟，`healthy` 表示当前窗口内有信号。Claude SessionStart 同时记录 adapter version 与 `review-result-envelope-v1` 能力；旧会话缺能力时按诊断要求更新插件并重新开会话。SessionStart 只恢复健康信号，不修改 active feature；随后重试原操作，若 Core 报未知路径则调用 `dev_flow_reconcile_workspace`。不要手工注入 host event 或编辑控制状态。

Evidence Store 诊断按 hot/cold/orphan 分别处置：只有 orphan backlog 时继续正常 mutation 或重开会话触发下一轮有界维护；reachable object/pack 损坏时停止写入并定位具体 ref，指示从备份恢复或使用 recover_corrupt_feature；体积来自可达审计历史时明确不可删除、只能等待无损 cold packing，不得建议 compact 或手删 pack。

只有 active pointer、current stage、freshness、review/status projection 等派生状态损坏时，才调用 `dev_flow_repair_feature`。repair 不得改变用户决策、ownership、原始证据或 checkpoint 历史；无法证明安全时停止并报告。
