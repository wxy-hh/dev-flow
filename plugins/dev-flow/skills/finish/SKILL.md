---
name: finish
description: 完成验证与 finalize，生成交付快照。
---

只在 `dev_flow_status` 显示交付收尾且能力合同允许时调用 finalize。Finalize 会重新校验实际 diff、验证新鲜度、风险义务、审查结论和交付快照；失败时按中文恢复动作修复并继续，不假装完成。implementation 获得授权后可存在 WIP/manual commit，但本仓库禁止智能体实际 commit，最终由用户审核提交。
