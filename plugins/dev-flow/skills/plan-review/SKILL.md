---
name: plan-review
description: 执行 Dev Flow 动态角色、parallel-first 且可按 role basis 复用的计划审查。
---

角色由 Core 从事实派生；不要在 Skill 复制风险映射。coverage 只看需求/AC/TASK/TEST，architecture 只看组件、任务、测试与契约，rollback 只看 RU/scope/dependency/recovery commands，专项角色只看对应风险切片。

job 标记 parallel-safe 时，宿主支持子代理或 sampling 就并行优先，否则顺序回退。语义 diff 未影响的角色应显示 `reused` 并引用旧提交；受影响角色创建新 job；未知 diff 保守全量重审。Assurance 只按真实 attestation/sampling 证据计算，不把同一模型多次输出称为多代理。

blocking finding 先修计划并增量复审；warning/note 不阻塞。finding 的 target/evidence 必须遵守 frozen Trace/path 合同。禁止编辑只读 review projection、伪造 basis/assurance 或泄露 claim capability。
