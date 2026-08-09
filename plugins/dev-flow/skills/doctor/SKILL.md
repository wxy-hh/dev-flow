---
name: doctor
description: 诊断 Dev Flow schema、MCP、hook、投影与恢复状态，并安全 repair 派生数据。
---

使用 `dev_flow_doctor`、status 和 diagnostics inspect。每个错误向用户给出稳定 code、中文原因、影响、恢复动作和白名单安全细节；不展示 capability、hash、token 或秘密。

发现 4.x state/project/review/checkpoint schema 时返回 `UNSUPPORTED_*_SCHEMA`：要求先用 4.x finalize/abandon，备份 `.dev-flow` 审计目录，再用 5.0 重新初始化，不运行迁移器。

doctor 还要检查 Claude/Codex 项目级 hook 健康：`missing` 表示尚未收到可信 SessionStart/UserPromptSubmit，`stale` 表示最近信号超过 15 分钟，`healthy` 表示当前窗口内有信号。SessionStart 只恢复健康信号，不修改 active feature；随后重试原操作，若 Core 报未知路径则调用 `dev_flow_reconcile_workspace`。不要手工注入 host event 或编辑控制状态。

只有 active pointer、current stage、freshness、review/status projection 等派生状态损坏时，才调用 `dev_flow_repair_feature`。repair 不得改变用户决策、ownership、原始证据或 checkpoint 历史；无法证明安全时停止并报告。
