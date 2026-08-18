---
name: plan-review
description: 执行 Dev Flow 动态角色、parallel-first 且可按 role basis 复用的计划审查。
---

角色由 Core 从事实派生；不要在 Skill 复制风险映射。coverage 只看需求/AC/TASK/TEST，architecture 只看组件、任务、测试与契约，rollback 只看 UNIT/REC、scope、dependency 与 recovery commands，专项角色只看对应风险切片。

`parallel-execution` 只描述执行/落账并发合同：先 `dev_flow_create_review_batch` 得到当前 plan phase batch，再用 `dev_flow_start_review_execution` 一次领取全部 job。每个 job 带一份可原样转发的 `dispatchPrompt`（含回收标记、角色冻结切片、完成 JSON 合同和「不得写文件」）。并行分发时不要改写提示，不要转抄 `capability`。宿主捕获 envelopes 后，用 `dev_flow_complete_review_execution` 一次聚合提交。零 envelope 不是成功。不要逐 job claim/release/submit。语义 basis 未变化的角色显示 `reused` 并引用旧提交；受影响角色创建新 job。Core 不再有 unknownDiff 全量重审兜底；Assurance 只按真实宿主/采样 envelope 来源计算，不把同一模型多次输出称为多代理。

blocking finding 先修计划并增量复审；warning/note 不阻塞。finding 的 target/evidence 必须遵守 frozen Trace/path 合同。禁止编辑只读 review projection、伪造 basis/assurance 或泄露 capability。

## 收敛判据（防死循环，最高优先级）

- **唯一推进判据**：`unresolvedBlockingCount === 0`。该值以 `dev_flow_inspect featureId review` 的 `unresolvedBlockingCount` 为准。
- warning / note **永远不阻塞**。只要没有未解决 blocking，就应按 `dev_flow_status` 的当前 recordable step 记录 planning（通常是 `record_step planning`）进入 execution_approval；不要为了清零 warning 再次 `revise_plan`。
- warning 驱动的计划加固必须**一次性成批修订**：把本轮所有非 blocking 问题集中到一次 `revise_plan`，不要每发现一个 warning 就修订一轮。
- 修订后只做一次增量复审；复审再产生的 warning/note 只记入 ledger 与 audit-log，不再触发下一轮修订。
- 真实 blocking 应一次性修完；修正后复审只看该 blocking 的 resolution，不要把新出现的 warning 当作“继续加固、继续复审”的信号。
- `inspect review` 中的 `readyWhen` 是 Core 给出的收敛说明；当 `unresolvedBlockingCount === 0` 时不得继续停留在 planning。
