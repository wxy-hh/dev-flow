---
name: doctor
description: 诊断 Dev Flow 5.0 schema、MCP、hook、投影与恢复状态，并安全 repair 派生数据。
---

使用 `dev_flow_doctor`、status 和 diagnostics inspect。每个错误向用户给出稳定 code、中文原因、影响、恢复动作和白名单安全细节；不展示 capability、hash、token 或秘密。

发现 4.x state/project/review/checkpoint schema 时返回 `UNSUPPORTED_*_SCHEMA`：要求先用 4.x finalize/abandon，备份 `.dev-flow` 审计目录，再用 5.0 重新初始化，不运行迁移器。

只有 active pointer、current stage、freshness、review/status projection 等派生状态损坏时，才调用 `dev_flow_repair_feature`。repair 不得改变用户决策、ownership、原始证据或 checkpoint 历史；无法证明安全时停止并报告。
