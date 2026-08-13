---
name: status
description: 查看 Dev Flow 的动态路线、控制原因、新鲜度与恢复动作。
---

先调用 `dev_flow_status`。向用户展示 level、逐项控制理由、完整 `orderedRoute`、当前阶段、待办义务和最早恢复阶段；不要只显示当前一步。需要细节时一次读取一个 `dev_flow_inspect` topic：classification、artifacts、trace、review、implementation、verification、delivery、history 或 diagnostics。

如果用户要求加强控制，说明可在首次 governed write 前通过重新分类的 `controlEnhancements` 追加；实现开始后只允许单调增加。启动时预存脏文件默认排除，不弹归属问题。任务期间新出现的未知路径才通过正式 interaction 处理。hook health 缺失或过期时，先恢复宿主接线并重试原操作；若仍有未知路径，调用 `dev_flow_reconcile_workspace`。不要建议直接编辑状态、伪造事件或用风险接受绕过下限。

用户只应看到安全细节：具体文件、缺失字段、允许范围、失败命令与恢复动作。不要暴露内部 hash、capability、token 或秘密。存在 pending decision 时只呈现当前唯一问题，并用原生 elicitation 或 `dev_flow_answer` 落账；普通宿主问答面板没有可信事件时不能冒充已确认。
