---
name: dev-flow
description: 新开发需求的默认入口。收到新增功能、业务改动、bug 修复、重构、UI 修改、接口联动、登录/订单/权限等请求时优先使用；先判断 XS/S/M/L 与风险标签，再调度 openspec、req-probe、grillme、writing-plans、requirements-coverage、plan-review、rollback-units、executing-plans、code-review、verification-before-completion 和 finishing-a-development-branch。纯解释、闲聊、查看状态、用户明确只要求某个非开发动作时不要使用。
---

# 开发工作流

先分级再选择最小足够流程：拦住模糊需求、计划偏差、缺少自审、无法回撤和缺少自验，同时不让小改动被完整流程拖慢。

本技能是流程层。目录、台账路径、验证命令和项目能力从项目适配层读取（默认 `.claude/rules/project-workflow.md`）；风险标签、门禁、schema、行数预算等契约常量的唯一权威是 `.claude/skills/dev-flow/contract.json`。首次在项目中使用，或适配层缺失/明显过期时，按适配层的「Claude 项目 onboarding」规则生成或更新它，再继续。

## 不可回归的三条底线

1. `requirement_confirmation`、`implementation_approval` 两个 HUMAN GATE 输出后必须停止当前回合，不得同回合继续写计划或业务代码。协议全文、`[HANDOFF]` / `[ASSET FINALIZATION]` 格式和恢复顺序见 `references/protocol.md`。
2. 风险标签只触发最小门禁，不抬高规模等级；命中标签必须有风险卡、审批证据、匹配的审查/验证证据，并通过 `dev-flow-feature-check --finish`。标签定义和门禁细则见 `references/risk-gates.md`。
3. 计划审查（`plan-review`）不能被代码审查（`code-review`）替代；两者分别把守实现前、实现后。

## 脚本调用分层（只定义一次）

| Layer | 脚本 | 可调用 | 禁止 |
|-------|------|--------|------|
| 0 | policy、fingerprint | 无上层 | 写 status/stamp/资产 |
| 1 | validate | Layer 0 | 写 status/stamp/资产 |
| 2 | status / feature-check / feature-finalize | Layer 0–1 | 互相调用；status ↛ check/finalize；check ↛ status/finalize；finalize ↛ status/check |
| 3 | `/finish`、verification、finishing skill | 编排 Layer 2 | 下层不得套壳编排 |

Layer 3 顺序：`complete-verification` → `feature-check --finish` → final assets → finalizer dry-run → 停等 `compact`/`retain full`/`not now` → `--confirm --inventory` → finalized check → Git。severity 与 promote 由 skill 判定（见 risk-gates）；CLI 不扫 Markdown。

## 规模轴 × 风险轴

规模描述改动形状与扩散；风险描述改错后果。两者独立判断，风险不抬高规模。

| 等级 | 拓扑信号 | 默认执行方式 |
|------|----------|--------------|
| XS | 单点、私有或局部、契约稳定、可立即验证 | 直接修改和验证 |
| S | 单模块局部行为变化，边界清楚，可独立回滚 | 简短确认后修改和验证 |
| M | 功能内多个协同步骤/状态/错误分支，共享契约稳定 | 轻量 M 或标准 M |
| L | 跨层传播、改共享契约、多链路一致、协调回滚 | 轻量 L 或标准 L |

文件数量只是调查线索，不决定等级。风险标签（`security`/`data`/`money`/`external`/`availability`/`critical_correctness`/`irreversible_consequence`）命中后必须在风险卡中写清错误结果、受影响范围、为何普通验证不够；命中 `security` 且涉及登录/鉴权/SSO 时参考 `references/risk-gates.md` 的验证矩阵。

用户明确要求轻量流程或指定单个技能时优先遵守；命中风险标签仍需提示最小门禁要求。

## 分级前置：零资产分类探查

1. 定位最相关入口、目标文件或配置边界，实际阅读后再判断。
2. 判断改动是否影响模块边界、共享契约、链路一致性、部分成功或协调回滚。
3. 被改对象是导出符号/注册入口/公开协议，且会改变对外契约时，运行一次范围明确的引用/消费者搜索；私有函数、契约不变重构、文案样式可跳过。
4. 不能声称"没有外部调用方"，除非实际执行了声明范围内的查询；结果不完整时记录 `evidence_partial`，不伪造"已全覆盖"。
5. 只有需求歧义影响边界、验收或路径时才路由到 `req-probe`/`openspec`。

普通 XS/S 只需对话内输出结论（规模、拓扑依据、风险标签、证据、路径），并**同回合**运行 `dev-flow-status authorize --level XS|S` 写入有限授权；M/L 与风险 XS/S 用 `dev-flow-status init` 创建 `status.md` 并 `activate`。status 机器字段禁止手改，一律走 CLI（见 `references/status-cli.md`）。

## 尊重手动覆盖

用户只要求某个技能（如"只用 grillme""只做 plan-review""跳过需求覆盖直接改"）时，只执行该技能，不额外启动完整流程；必要时提醒缺失的风险门禁。标准 M/L 中用户要求跳过门禁时先说明风险，L 级需用户明确确认。

## 路径总览

| 路径 | 何时 | 产物 |
|------|------|------|
| XS | 无风险标签 | 无 |
| S | 无风险标签 | 默认无，用户要求才留 |
| risk-minimal（XS/S + 风险标签） | 命中任一风险标签 | `status.md`（profile: risk-minimal）+ `completion.md` |
| 轻量 M | 需求清楚、影响局部 | 默认无；升级或用户要求才留 |
| 标准 M | 需求分支/契约/状态不确定 | 需求书 + `status.md` + 计划，详见 `references/standard-ml.md` |
| 轻量 L | 跨层但边界清楚、设计自明 | `status.md` + 审查 + 验证，见下 |
| 标准 L | 跨层且存在方案取舍/依赖 | 全套资产，详见 `references/standard-ml.md` |

标准 M、标准 L 的完整编排步骤、加速条件、L 级资产契约表和中途重分级规则在 `references/standard-ml.md`；只在真正走标准路径时读取，轻量路径不需要付这部分上下文。

## XS 路径

1. 读取直接相关文件。2. 最小修改。3. 运行最相关验证。4. 汇报改动文件和验证结果。不创建任何 md 产物或 `status.md`。

## S 路径（无风险标签）

1. 复述需求和关键边界。2. 最多问一个阻塞问题。3. 用户只要求单个技能时只用该技能。4. 边界清楚后实现并验证。默认不创建产物；用户明确要求或手动触发 `req-probe`/`writing-plans`/审查文档时才创建。

## risk-minimal 路径（XS/S + 风险标签）

1. 输出最小风险卡：范围、风险、回撤/恢复方式、验证方式。
2. 输出 `[HUMAN GATE:implementation_approval]`，等待用户确认；确认前不得写业务代码。
3. 确认后创建 `status.md`（`profile: "risk-minimal"`，`level: "XS"|"S"`），按标签写 `risk_evidence`。
4. 按 `references/risk-gates.md` 执行匹配的最低审查/验证。
5. 实现并运行匹配验证。
6. 收尾前执行 `verification-before-completion` 和 `dev-flow-feature-check --finish`。

不要求：需求说明书、实现计划、requirements-coverage、plan-review、grillme。

## 轻量 M 路径

1. 复述需求边界和不做范围。2. 必要时用 `req-probe` 轻量澄清。3. 实现。4. 完成后用 `code-review`。5. 收尾前执行 `verification-before-completion`。默认不创建 `status.md`，也**不**要求 `dev-flow-feature-check`；出现重要决策、用户要求记录或升级为标准 M/L 时再补产物并纳入完成检查。

## 轻量 L 路径

跨层但需求边界清楚、设计自明、可用明确行为验证证明时使用：

1. 输出边界确认卡：高风险点、改动范围、不做范围、回撤方式、验证方式、为何可走轻量 L。
2. 输出 `[HUMAN GATE:implementation_approval]`；确认前不得写 `status.md` 或业务代码。
3. 确认后创建/更新 `status.md`：`level: "L"`，`profile: "standard"`，`human_gates.requirement_confirmation.required: false`，`implementation_approval.required: true`。
4. 按风险维度至少触发：安全审查 light/full、行为验证 full、回撤证据 light。
5. 设计自明时不强制 `grillme`、完整 `writing-plans`、`requirements-coverage full` 或 `plan-review full`。
6. 实现中发现需求分支、接口不明、多方案取舍、共享状态变化或难回撤时，立即升级标准 L 并重新停在对应 HUMAN GATE。
7. 完成后执行 `code-review`（路线派生 `required: true`、`evidence_level: light`；`gate_evidence.code_review` path+heading；CRITICAL/HIGH 时独立报告 + `complete-gate`，禁止 `promote-gate code-review`）、`verification-before-completion` 和 `dev-flow-feature-check --finish`；`webapp-testing: disabled` 时落盘 manual-test。

## 验证门禁（所有路径收尾前）

1. 找出能证明结论的命令或检查并重新运行，读取输出和退出码，报告证据。
2. **必须**运行 `dev-flow-feature-check --finish` 的路径：标准 M/L、轻量 L、risk-minimal（携带风险标签的 XS/S）。失败时停止收尾。
3. **不强制** feature-check 的路径：无风险 XS/S、默认轻量 M（无 `status.md`）。它们以新鲜验证证据和（轻量 M）code-review 收尾。
4. 触发了行为验证门禁时，验证报告必须有运行时证据；手测与 partial 规则见 `references/partial-verification.md`。
5. 验证失败：先判断代码/环境/命令适用性问题；代码问题修复后重跑完整相关验证；同一问题连续 3 轮失败则停止声称完成并汇报；命令不适用则换用能证明结论的验证方式。
6. 没有适用命令时，说明这是文档或流程改动。

按项目适配层的验证配置和 test strategy 选择默认验证命令；混合改动取并集。写入门禁见 `references/status-cli.md`。

## 回复格式

路由判断：`我判断这是 <level>，原因是 <reason>。我会走 <route>。`

M/L 阶段结束时更新 `status.md` 并追加 `[HANDOFF]`（格式见 `references/protocol.md`）；`Auto-continue: no` 或已输出 HUMAN GATE 时必须停止当前回合，等待用户确认后再把对应 `human_gates` 状态更新为 `confirmed`/`skipped`。

完成汇报：`已更新 <files>。验证：<command>，结果 <passed/failed/reason>。` XS/S 简短说明；M/L 附产物路径、下一道门禁和是否自动继续。
