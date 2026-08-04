---
name: grillme
description: 先查事实、再高质量澄清用户决策。可独立调用，也可在 Dev Flow 任意阶段按需调用。
---

`grillme` 不属于任何 level、route 或固定步骤。用户可以直接调用；使用 Dev Flow 时，intake、planning、implementation、verification 或 finalize 只要出现真实用户决策缺口，都可以调用。

## 提问准入

1. 先读取代码、文档、测试、已有决策和当前状态；能自行查明的事实不问用户。
2. 只询问会改变范围、拓扑、风险、验收、优先级或不可逆取舍的问题。
3. 每题说明已知事实、冲突/未知、互斥选项、影响和推荐答案；将同一主题的子问题合并。
4. 没有固定题数上限，直到决策树收敛；用户可以合并剩余问题、裁剪问题或结束访谈。
5. 工作流模式下，需求文档为 current 且 `grill_status: pending` 时直接调用 `dev_flow_request_grill_decision`，Core 会自动 upsert decision ledger；用户回答后用对应 resolve 工具一次 CAS 同步保存 interaction、证据和结论。不要自行锁定分类、伪造确认或修改控制文件。

## 两种模式

- 独立模式：只输出澄清问题与收敛摘要，不创建 Dev Flow 状态。
- 工作流模式：读取 `dev_flow_status`，只对当前真实缺口提问；决策影响分类时，未解决前不得 `dev_flow_lock_classification`。

合法等待不是失败。技术问题、命令差异或可自行查明的边界不应打断用户；只有用户必须决定的取舍才等待。
