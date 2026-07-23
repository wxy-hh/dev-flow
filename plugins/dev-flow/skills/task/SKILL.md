---
name: task
description: 开任务并分级 start。触发：开任务、开始功能、task、df-task、dev-flow-task。
---

仅使用 Dev Flow MCP。禁止手改 `.dev-flow` 控制文件（`state.json` / `active.json` / `events.jsonl` 等）。状态只由 MCP 推进。

## 合法写盘顺序

业务证据 Markdown：**`dev_flow_scaffold_artifact` → 编辑已登记路径 → `dev_flow_record_artifact`**。禁止抢先 Write 未登记路径。

## 分类启发式（先选 requirements，再决定是否 standard）

| 信号 | 默认 classification |
| --- | --- |
| 单文件或纯样式/文案；范围清晰；无契约 | `XS` 或 `S`，`topology: local` |
| 多文件但边界清晰；无 API/数据契约；需求足够执行 | `M` + `execution: light` |
| 真实需求分叉、跨模块行为变化、需明确优先级 | `M` + `execution: standard` + 下表 requirements |
| 多服务、共享契约或协调回滚 | 按 topology 最低 level 抬级 |

| 输入质量 | requirements | grill |
| --- | --- | --- |
| 一句话、范围或目标不清 | `missing-or-unclear` | 完整 grill（仅缺口） |
| 目标、参考与范围已给出，只缺 1–2 决策 | `documented-unconfirmed` | 短 grill |
| 书面规格且明确确认 / LGTM | `provided-confirmed` | 不自动 grill |

**禁止**把 `missing-or-unclear` 当作 standard 的无脑默认。截图 + 参考实现 + 明确视觉目标 → 优先 `light` 或 `documented-unconfirmed`，不要无解释进 `standard-M`。

## 启动步骤

1. `dev_flow_classify`（需要时）再 `dev_flow_start`。`scope` 必须是 `{ inScope: string[], outOfScope: string[] }` 或省略。
2. start 成功后、执行 `dev_flow_next` 之前，输出路线摘要：
   - 选定 route 与原因（1 句）
   - 压缩 steps
   - 预计最多用户交互次数（grill 上限 + gate 数）
   - 若偏重：提示「若范围已锁，可要求在安全边界内降为 light（同 level 的 standard→light）」
3. 再 `dev_flow_next`，只执行返回的唯一动作。

## 降级

用户明确要求「太重了 / 改 light」且尚未 present/confirm `implementation_approval`、未实现、protected roots 自 start 未变时，调用 `dev_flow_reclassify`（`userEvidence` = 用户原话）。若指纹已变：只能走完当前 standard 或 `abandon` 后以更轻 classification 重开——禁止手改 state。

v1 does not integrate OpenSpec；已有规格仅作需求输入。
