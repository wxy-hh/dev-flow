# 路线契约

`dev_flow_classify` 是**唯一**的路线选择器。规模与风险**独立**判断：拓扑决定最低规模；风险只改变证据义务，**不会**静默改 level。

| 路线 | 有序步骤 | 强制 Markdown | feature-check |
| --- | --- | --- | --- |
| XS | locate → implement → verify | 无 | 否 |
| S | boundary → implement → verify → self-review | 无 | 否 |
| risk-minimal | risk review → controls → approval → implement → code review → verify | status、risk card | 是 |
| light M | boundary plan → implement → code review → verify | 无 | 否 |
| standard M | requirements（`missing-or-unclear` / `documented-unconfirmed` 含强制 grill 子流程）→ requirement gate → plan → coverage → rollback → plan review → approval → implement → code review → verify | requirements、implementation plan、status、coverage matrix | 是 |
| light L | boundary → rollback safety → approval → implement → code review → verify | boundary card、rollback safety、verification | 是 |
| standard L | requirements（同 standard M 的强制 grill 子流程）→ requirement gate → plan → coverage → rollback → plan review → approval → implement → code review → verify | requirements、plan、coverage、rollback units、plan review、code review、verification | 是 |

补充约定：

- `plan_review` 与 `code_review` 是不同步骤，证据类型不兼容，不可互替。
- standard M/L **必须** feature-check；XS/S 与 light M **不**强制。
- v1 **不**集成 OpenSpec；相关文件仅可当作普通需求输入。
- **grill 子流程（1.1.0+）**：不增加独立 route step。技能 `grillme`（`/dev-flow:grillme`）做逐题拷问；`requirements`（`/dev-flow:requirements`）负责登记与需求确认门禁。机器字段 `grill_status`（`not_required|pending|in_progress|complete`）及可选 `grill_question_id` / `grill_response_hint` / `grill_question_limit` 由 core 校验；`dev_flow_status` 的 `progress` 用其报告等待状态。详见 [architecture.md](./architecture.md)。

### 如何选 light vs standard（1.3.0+）

| 信号 | 建议 |
| --- | --- |
| 单文件 / 纯样式文案、范围清晰 | XS 或 S |
| 多文件但边界清晰、无契约、需求够做 | **M + light** |
| 需求分叉多、跨模块行为、需 prioritization | M + standard + 合适 requirements 态 |
| 截图 + 参考实现 + 明确视觉目标 | 优先 light；勿默认 missing-or-unclear standard |

### reclassify（1.3.0+）

- **升严**：始终允许（既有规则）。
- **降级**：仅同 level / topology / risk 的 **standard → light**；须 `userEvidence`；implementation 未做；`implementation_approval` 既未 present 也未 confirmed；`startBusinessFingerprint` 与当前 protected roots 一致。不允许 `M → S`。指纹已变时只能走完 standard 或 abandon 重开。

机器权威：`plugins/dev-flow/policy/contract.json`。本文件须与 contract 一致（由 `tests/unit/routes-doc.test.mjs` 核对）。
