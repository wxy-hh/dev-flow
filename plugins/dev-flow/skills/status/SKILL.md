---
name: status
description: 查看并接力 Dev Flow 状态。触发：查状态、继续任务、当前进度、status、df-status、dev-flow-status。
---

仅使用 Dev Flow MCP：`dev_flow_status` 与 `dev_flow_next`；禁止直接编辑工作流状态文件。

用户说「继续 / 当前进度」时：

1. 先调用 `dev_flow_status`（返回 `StatusView`：state + `progress`）。
2. 若 `progress.wait.kind !== "none"`：用人话复述 wait（Q-id / gate、继续格式、剩余 steps），**不要**重新 start、classify 或直接推进步骤。
3. 若 wait 为 none：再 `dev_flow_next`，只执行返回的唯一动作。

停步复述结构：

```text
当前：<featureId> · <route>
阶段：<grill Q-… | HUMAN GATE: …>
为何等待：…
继续：<progress.wait 中的 hint>
后续：<progress.remainingSteps 压缩>
```

合法等待不是失败/中断。若 status/doctor 报告 corrupt feature：引导 `dev_flow_recover_corrupt_feature`，禁止手改 `state.json`。

若用户要求降为 light：在安全边界内用 `dev_flow_reclassify` + `userEvidence`；指纹变化时说明只能走完 standard 或 abandon 重开。
