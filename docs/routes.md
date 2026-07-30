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

## 风险 evidence 与可发现性（1.4.0+）

- risk 标签来自 `policy/contract.json`；MCP schema、非法标签提示和 classify 的 riskRequirements 共用该事实源。
- `security` 在有 `risk_controls` 的路线落到该步，否则落到 `code_review.checks`。
- `rollback` / `full-rollback` 优先落到 `risk_controls`，否则落到 `rollback_safety` 或 `rollback_unit`。
- `full-code-review` 永不写入 `evidence.checks`，只转换为 `code_review.reviewDepth: "full"`。
- 无风险路线的 verification 基线为 `targeted`；风险路线使用派生的 behavior / integration / full。
- `recordStep` 首次校验，feature-check 从 `state.steps.*.evidence` 二次校验；路线轻重不能绕过风险义务。

HUMAN GATE 只接受 status `replyHint` 所列整句批准词；trim 后英文大小写不敏感，但不接受前缀、子串或附加说明。present 前不得邀请确认，present 后必须等待下一条用户消息。

verification 命令 attempt 与人类可读 narrative 分轨：protected-root 指纹决定命令 fresh/stale；已登记的 `verification.md` 更新只重开 feature-check。需求明确要求人工/UI 验收时，verify Skill 在 finalize 前保存 browser evidence；无浏览器时可保存逐场景 user-signoff，禁止声称已执行浏览器。

补充约定：

- `plan_review` 与 `code_review` 是不同步骤，证据类型不兼容，不可互替。
- standard M/L **必须** feature-check；XS/S 与 light M **不**强制。
- v1 **不**集成 OpenSpec；相关文件仅可当作普通需求输入。
- **grill 子流程（1.1.0+）**：不增加独立 route step。技能 `grillme`（`/dev-flow:grillme`）做逐题拷问；`requirements`（`/dev-flow:requirements`）负责登记与需求确认门禁。机器字段 `grill_status`（`not_required|pending|in_progress|complete`）及可选 `grill_question_id` / `grill_response_hint` / `grill_question_limit` 由 core 校验；`dev_flow_status` 的 `progress` 用其报告等待状态。详见 [architecture.md](./architecture.md)。
- **Trace source（1.8.0+）**：standard M/L 的 requirements、implementation plan、coverage matrix、rollback units 必须用 `dev_flow_record_artifact_with_trace` 登记；调用方只提供 REQ/AC、TASK/RU、TEST→AC 等业务关系，不能提交 edges、status、hash 或 pointer。
- standard M 的 RU 来自 implementation plan；standard L 的 RU 来自 rollback-units。两条路线都由 Core 在 implementation / approval 前检查完整图，不需要 checkpoint。
- generated status 只能由 Core scaffold/refresh，不能人工登记；standard L 没有 status Markdown，请读取 `dev_flow_status`。
- **Review 2a（`review: 1`）**：standard M/L 的 `plan_review` 走不可变 review batch。Core 按路线与 risk labels 派生角色（M：`requirements-coverage` + `architecture-testability`；L 另加 `rollback-operability`；`security` / data-money 类 risk 再追加对应角色）。`plan-review` 为 generated 投影；`recordStep(plan_review)` 的 evidence 由 Core 派生为 `{ batchId, basisHash, assuranceLevel }`，2a 默认 `assuranceLevel: "multi-perspective"`。
- **`review: 0` 兼容**：插件升级前已启动的 feature 继续旧合同——standard M 仍可无 plan-review artifact 并以 `{ reviewType: "plan" }` 记步；standard L 仍使用可编辑 plan-review artifact。不发生中途迁移。
- **Checkpoints（1.7.0+，`checkpoints: 1`）**：standard M/L 启用后，implementation 步骤内由 rollback unit 管理写入权限。必须先 `begin-implementation-unit` 再写入 protected 文件，完成后 `checkpoint-implementation-unit`。Hook 基于 `implementationUnitWriteBlock` 在 logic-complete 前拦截未经 unit 授权的文件修改。回撤预览通过 `dev_flow_preview_rollback` 只读查看检查点状态与有效目标；可执行回撤与确认门禁属于后续阶段，当前 `rollbackExecution` 为 0。standard M 的 RU 来自 implementation plan；standard L 的 RU 来自 rollback-units。checkpoints 同时依赖 `trace: 1`。

### 如何选 light vs standard（1.3.0+）

| 信号 | 建议 |
| --- | --- |
| 单文件 / 纯样式文案、范围清晰 | XS 或 S |
| 多文件但边界清晰、无契约、需求够做 | **M + light** |
| 需求分叉多、跨模块行为、需 prioritization | M + standard + 合适 requirements 态 |
| 截图 + 参考实现 + 明确视觉目标 | 优先 light；勿默认 missing-or-unclear standard |
| multi-chain 且范围/接口/回滚/验收均锁定 | 保持 L，优先 light-L |

### reclassify（1.3.0+）

- **升严**：始终允许（既有规则）。
- **降级**：仅同 level / topology / risk 的 **standard → light**；须 `userEvidence`；implementation 未做；`implementation_approval` 既未 present 也未 confirmed；`startBusinessFingerprint` 与当前 protected roots 一致。不允许 `M → S`。指纹已变时只能走完 standard 或 abandon 重开。

机器权威：`plugins/dev-flow/policy/contract.json`。本文件须与 contract 一致（由 `tests/unit/routes-doc.test.mjs` 核对）。
