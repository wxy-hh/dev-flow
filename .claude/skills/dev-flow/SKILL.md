---
name: dev-flow
description: 新开发需求的默认入口。收到新增功能、业务改动、bug 修复、重构、UI 修改、接口联动、登录/订单/权限等请求时优先使用；先判断 XS/S/M/L，再尊重用户轻量覆盖并调度 openspec、req-probe、grillme、writing-plans、requirements-coverage、plan-review、rollback-units、subagent-driven-development、executing-plans、code-review、requesting-code-review、verification-before-completion 和 finishing-a-development-branch。纯解释、闲聊、查看状态、用户明确只要求某个非开发动作时不要使用。
---

# 开发工作流

用这个技能把项目开发请求先分级，再选择最小足够流程。目标是拦住模糊需求、计划偏差、缺少自审、无法回撤和缺少自验，同时避免小改动被完整流程拖慢。

本技能是流程层。具体目录、台账路径、验证命令和当前项目能力，先从项目适配层读取；Claude 环境默认读取 `.claude/rules/project-workflow.md`。迁移到其他项目时优先改适配层，不改本流程。

## 核心规则

先判断风险和范围，再行动。

```text
XS：直接实现并自验。
S：轻量确认边界，可手动触发单个技能。
M：按轻量/标准 M 分流；轻量 M 复述边界后实现，标准 M 进入需求和计划流程。
L：完整流程或轻量 L 路径 + HUMAN GATE + 风险维度门禁 + 最终审查和验证。
```

用户明确说“轻量流程”“只用某个技能”“直接改”时，优先遵守。涉及登录、鉴权、订单、支付、数据删除、跨系统跳转时，先提示风险，再按用户确认后的路径执行。

每次开始处理 M/L 或涉及交接资产的任务前，先读取项目适配层，确认 `<FEATURE_ROOT>`、`<REVIEW_ROOT>`、`<RUNTIME_ROOT>`、`<SDD_PROGRESS>`、`<SCOPED_SPEC_ROOT>`、feature-id 规约、测试策略、OpenSpec 策略、context manifest 路径和验证配置。技能正文中的路径模板都以适配层为准。

如果流程中断后恢复，先找 `<FEATURE_ROOT>/<feature-id>/status.md`。存在时先读 `dev_flow_status`、状态摘要、其中列出的资产和 `context/*.jsonl`，再参考上一段 `[HANDOFF]` 与对话中的审查结论；不存在时再按项目适配层的约定目录查找最近产物。不要重跑已完成且仍然可信的步骤。

## 轻量三件套边界

机器可读 `status.md`、context manifest 和 scoped specs 只服务恢复、审查和验证，不改变任务分级：

- XS/S 不创建 `status.md`、context manifest 或局部规范引用。
- 轻量 M 默认不创建；只有用户要求记录、已经产生落盘资产或流程升级时才维护。
- 轻量 L 和标准 M/L 维护 `status.md` 的 `dev_flow_status`，以及 `<FEATURE_ROOT>/<feature-id>/context/implement.jsonl`、`review.jsonl`、`verify.jsonl`。
- scoped specs 是可选规则库；只有 M/L 明确命中 `<SCOPED_SPEC_ROOT>/<scope>/index.md` 时才读取。找不到匹配 scope 不报错，也不阻塞。
- context manifest 只登记需求、计划、局部规范、研究、审查和验证文件，不登记源码文件。

## Claude 项目 onboarding

首次在一个项目里使用 dev-flow，或 `.claude/rules/project-workflow.md` 缺失、明显过期时，按项目适配层里的「Claude 项目 onboarding」规则生成或更新适配层。

本流程只负责触发 onboarding，不在这里维护第二份能力检测清单。新增项目能力、验证命令、测试策略或版本管理边界时，优先更新 `.claude/rules/project-workflow.md`，然后重新读取适配层再继续。

## 半自动门禁模式

标准 M/L 默认使用半自动门禁模式：自动读取上一步产物，按风险维度自动推进已触发且无副作用的检查门禁，在关键决策点停下来让用户确认。半自动只适用于读取、分析和生成审查证据；不得跨过需求确认、计划审查后的实现确认，或任何已经声明的 HUMAN GATE。

自动继续的场景：

- `writing-plans` 完成后，必须按 `[HANDOFF]` 的 `Next skill` 继续；标准 L 或登录/鉴权/跨系统入口类任务的下一跳通常是 `requirements-coverage`，不得直接停在实现确认。
- 需求覆盖门禁被触发且无阻塞缺口时，标准 M/L 至少继续到 `plan-review`；不得等待用户追问“是不是要 plan-review”。
- `plan-review` 被触发且无 CRITICAL/HIGH 时，可以自动进入仍在实现前的回撤、安全等检查门禁；如果下一步会写业务代码，必须先停在 `implementation_approval`。
- `rollback-units` 被触发为 `full` 时，完成设计后停在实现前；被触发为 `light` 时，把回撤证据写入 `status.md` 或最终审查。
- 安全审查被触发时，按项目适配层决定 `light` 或 `full`。
- `rollback-units` 为 `full` 时，实现完成后先运行 `rollback-units` 审计，再进入 `code-review`；代码审查无 Critical/Important 阻塞项时，进入 `verification-before-completion`。

必须停下来询问用户的场景：

- 任意 `[HUMAN GATE:<gate-id>]` 已输出，或上一段 `[HANDOFF]` 写了 `Auto-continue: no`。
- 标准 M/L 需求边界固化后、进入 `writing-plans` 前。
- 标准 M/L 完成 `plan-review` 和已触发的实现前门禁后、开始写业务代码前。
- 轻量 L 输出边界确认卡后、开始写 `status.md` / context 或业务代码前。
- L 级需求边界固化后、进入计划前。
- `requirements-coverage` 出现 `MISSING`、`CONFLICT`、`OUT_OF_SCOPE`，或 L 级出现未接受的 `PARTIAL` / `UNVERIFIABLE`。
- 被触发的 `plan-review` 出现 CRITICAL/HIGH。
- 标准 L 或登录/鉴权/跨系统入口类任务写完计划后，尚未完成 `requirements-coverage` 和 `plan-review`。
- `rollback-units` 为 `full` 且完成设计后、开始实现前。
- 安全审查发现高风险残留，或用户需要选择是否接受风险。
- 验证失败且需要选择修复范围、降级验收或接受风险。
- 需要提交、回滚、合并、推送、创建 PR、删除文件或其他会改变分支状态的动作。
- 中途重分级、跳过已触发门禁或接受高风险残留。

用户可以覆盖默认衔接：

- `全自动继续到实现前`
- `每一步都问我`
- `只跑到 plan-review 停下`
- `手动引用这些文件作为输入：...`

### HUMAN GATE 硬协议

所有需要用户确认的停顿点都使用同一协议：

```text
[HUMAN GATE:<requirement_confirmation|implementation_approval>]
请确认 <需要确认的边界、计划或风险>。
确认后我会进入 <next step>。
[/HUMAN GATE]
```

规则：

- 一旦输出 `[HUMAN GATE:<gate-id>]` 或 `[HANDOFF]` 中 `Auto-continue: no`，当前回合必须停止；不得继续写计划、执行代码、运行后续门禁，或在同一回合把 `auto_continue: false` 改成 `true`。
- 只有用户后续明确回复“确认”“继续”“接受风险”或“跳过并接受风险”后，才能把 `dev_flow_status.human_gates.<gate-id>.status` 写为 `confirmed` 或 `skipped`，并把用户原话或接受风险理由写入 `evidence`。
- 标准 M/L 的 `requirement_confirmation` 和 `implementation_approval` 都是必需 gate。轻量 L 也必须有边界确认卡和实现前确认；同一条用户回复可以同时作为两个 gate 的证据，但必须明确覆盖边界和开始实现。
- `plan-review` 是实现前计划审查，不能由实现后的 `code-review` 替代；`code-review` 只审查已写代码，不能倒填为计划门禁通过。

## 资产交接协议

M/L 每个阶段结束时都输出一个简短交接块。下一阶段优先读取交接块里的路径；用户手动给了路径时，以用户路径为准；都没有时，再按项目适配层的约定目录自动查找。

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <XS|S|M|L>
Current gate: <gate-name>
Generated assets:
- <path>
Next skill: <skill-name>
Next inputs:
- <path>
Auto-continue: yes/no
Stop reason: <only when Auto-continue is no>
[/HANDOFF]
```

L 级资产契约：

| 阶段 | 默认产物 | 下一步 |
|------|----------|--------|
| `req-probe` / `openspec` | `<FEATURE_ROOT>/<feature-id>/需求说明书.md` 或 `openspec/changes/<change-id>/` | 输出 `[HUMAN GATE:requirement_confirmation]` 并停止；用户确认后进入 `grillme` / `writing-plans` |
| `writing-plans` | `<FEATURE_ROOT>/<feature-id>/初步实现计划.md`，更新 `<FEATURE_ROOT>/<feature-id>/status.md` | 自动进入已触发的 `requirements-coverage` |
| `requirements-coverage` | `<FEATURE_ROOT>/<feature-id>/requirements-coverage.md` 或 `status.md` 轻量结论 | 标准 M/L 通过后至少进入 `plan-review` |
| `plan-review` | `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-plan-review.md` 或 `status.md` 轻量结论 | 无 CRITICAL/HIGH 后可进入实现前回撤/安全门禁；写代码前必须输出 `[HUMAN GATE:implementation_approval]` |
| `security-reviewer` / 安全审查 | `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-security-review.md` 或 `status.md` 安全结论 | 高风险残留需停下确认 |
| `rollback-units` | `<FEATURE_ROOT>/<feature-id>/rollback-units.md` 或 `status.md` 轻量回撤证据 | `full` 时停下询问是否开始实现 |
| `subagent-driven-development` / `executing-plans` | `<SDD_PROGRESS>`，任务报告，回撤证据 | 仅在 `implementation_approval.status` 为 `confirmed` 或用户明确跳过并接受风险后执行；完成后按风险进入 `rollback-units` 审计或 `code-review` |
| `rollback-units` audit | `<FEATURE_ROOT>/<feature-id>/rollback-units.md` | `full` 回撤门禁实现后必须补齐真实 diff/patch/commit 证据；无未解释 `pending` 后进入 `code-review` |
| `code-review` / `requesting-code-review` | `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md` | 无阻塞后进入 `verification-before-completion` |
| `verification-before-completion` | `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md`，必要时 `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md` | 停下询问分支收尾方式 |
| `finishing-a-development-branch` | 当前分支状态、用户选择的收尾动作和最终验证结论 | 按用户选择合并、推送 PR、保留或丢弃 |

`<feature-id>` 按项目适配层命名。新功能默认使用 `YYYY-MM-DD-<short-kebab-name>`；已有产物或 OpenSpec change id 已明确时继续沿用。

M/L context manifest 默认位于：

```text
<FEATURE_ROOT>/<feature-id>/context/implement.jsonl
<FEATURE_ROOT>/<feature-id>/context/review.jsonl
<FEATURE_ROOT>/<feature-id>/context/verify.jsonl
```

`writing-plans` 负责创建或刷新这些清单；后续覆盖、计划审查、回撤、代码审查和验证门禁只追加真实存在或本次明确生成的上下文资产。

## 第 1 步：分级

快速阅读相关项目文件和规范。按失败后果、影响范围和可回滚性判断级别；关键词只作为辅助信号。不要先问一串问题；如果需求明显模糊且会影响分级，直接路由到 `req-probe` 或 `openspec` 固化需求。只有一个关键边界会影响流程选择时，才问一个问题。

命中登录、鉴权、SSO、token/session、路由守卫、HTTP 拦截器或跨系统回跳时，需求固化阶段至少检查认证中心/回跳配置、token 生命周期与传递方式、公开接口 Authorization、所有 `/login` 跳转点、成功/失败/缺失参数/401/403/登出清理、URL query 和本地状态清理、门户菜单等既有登录副作用。任一项未决都要留在需求确认门禁，不用占位符推进计划。

| 级别 | 判断信号 | 默认动作 |
|------|----------|----------|
| XS | 文案、样式、简单配置、单文件小 bug；没有业务行为变化 | 直接改，运行相关验证 |
| S | 改动局部、行为清楚、风险低；通常是少量小文件；最多有一个关键边界 | 复述需求，必要时问一个问题，然后轻量实现 |
| M | 失败主要影响当前功能、当前页面或当前表单；涉及接口、路由、状态、权限展示/控制点、错误分支、表单或业务规则 | 按轻量 M / 标准 M 分流 |
| L | 失败会影响登录态、鉴权链路、权限守卫、订单、支付、数据删除、数据完整性、跨系统入口、关键用户链路或多个功能 | 进入完整流程并建议子任务执行 |

辅助评分表只用于减少分级漂移，不替代工程判断：

| 维度 | 0 | 1 | 2 |
|------|---|---|---|
| 失败后果 | 文案、样式、局部展示 | 当前功能异常 | 安全、数据、支付、鉴权或关键链路 |
| 影响范围 | 单点文件或局部 UI | 页面、模块或单个流程 | 跨模块、共享能力或多个关键路径 |
| 需求清晰度 | 完全清楚 | 有一个边界不清 | 多分支、契约或验收标准不清 |
| 可回撤性 | 直接 revert 或局部 patch | 需要任务边界或顺序 | 涉及数据、状态、依赖或外部系统 |
| 验证能力 | 有明确自动验证或简单检查 | 需要手动行为验证 | 难验证且失败后果高 |

参考规则：总分 0-1 通常 XS，2-3 通常 S，4-6 通常 M，7+ 通常 L 候选。任一“失败后果”为 2，且涉及登录、鉴权、订单、支付、数据删除、数据完整性或跨系统入口时，至少按 L 候选处理，再判断轻量 L 还是标准 L。

权限相关按失败后果区分：权限文案、展示状态、页面内按钮可见性通常是 M；路由守卫、token/session、角色判定、鉴权参数或会影响其他功能的权限逻辑是 L。

文件数量不是决定项。少量文件但改动巨大、跨关键路径或难回滚时升级；文件较多但只是机械性局部替换且验证明确时可以降级。

简短告知判断结果：

```text
我判断这是 M 级常规功能，因为它涉及接口、状态和异常分支。我会先固化需求，再写计划。
```

## 第 2 步：尊重手动覆盖

识别这些用户意图：

- `这是小功能，走轻量流程`
- `只用 grillme 拷问这个方案`
- `先不要写代码，只做 plan-review`
- `跳过需求文档，直接给短计划`
- `代码写完了，只做 code-review 和自验`
- `这个需求不清楚，先用 req-probe`
- `这是高风险功能，走完整流程`
- `只做需求覆盖门禁`
- `只做回撤单元设计`
- `代码写完了，只补回撤清单`
- `跳过需求覆盖/计划审查/回撤单元，直接改`

如果用户只要求某个技能，就不要额外启动完整流程。执行用户指定的技能，并在必要时提醒缺失的风险门禁。需求覆盖、计划审查、回撤单元、安全审查和行为验证都可以被单独手动触发；单独触发时只输出结论，不自动继续到下一阶段。

标准 M/L 中用户要求跳过任一门禁时，先说明风险；L 级需用户明确确认后才可跳过。

## 第 3 步：选择路径

### XS 路径

1. 读取直接相关文件。
2. 做最小修改。
3. 运行最相关验证。
4. 汇报改动文件和验证结果。

不创建 md 产物，不创建 `status.md`，不创建 context manifest。

### S 路径

1. 复述需求和一两个关键边界。
2. 如有必要，最多问一个阻塞问题。
3. 如果用户只要求单个技能，只使用该技能。
4. 边界清楚后实现。
5. 运行相关验证。

默认不创建 md 产物、`status.md` 或 context manifest。只有用户明确要求，或手动触发 `req-probe`、`openspec`、`writing-plans`、审查文档时才创建。

### M 路径

先判断轻量 M 还是标准 M：

- 轻量 M：需求已清楚、影响局部、接口/状态/权限语义没有不确定性，改动可直接验证。
- 标准 M：存在需求分支、接口契约、状态流转、权限语义、错误分支或业务规则不确定性。

#### 轻量 M

1. 复述需求边界和不做的范围。
2. 必要时使用 `req-probe` 做轻量澄清；需求已经明确时不创建 md。
3. 实现。
4. 完成后使用 `code-review`；`code-review` 会委托 `requesting-code-review`。轻量 M 可用对话内需求摘要、diff、涉及文件和验证证据作为审查输入，不强制补落盘需求或计划。
5. 声称完成前执行 `verification-before-completion` 证据门禁。

轻量 M 默认不创建 md 产物、`status.md` 或 context manifest。用户要求记录、出现重要决策、已有落盘资产，或执行中升级为标准 M/L 时再补产物和清单。

#### 标准 M

1. 使用 `openspec` 或 `req-probe` 固化需求。
2. 使用 `grillme` / `grilling` 压测需求或设计。
3. 输出 `[HUMAN GATE:requirement_confirmation]`，等待用户确认需求边界；确认前不得写实现计划。
4. 使用 `writing-plans` 创建实现计划。
5. 创建或刷新 `status.md` 的 `dev_flow_status` 和 context manifest。
6. 按第 4 步风险维度表决定哪些门禁启用，以及使用 `light` 还是 `full`；标准 M 至少执行 `plan-review light`。
7. 对需求覆盖、计划审查、安全审查和回撤单元按顺序执行；未触发的不为了仪式强行生成大文档。
8. 输出 `[HUMAN GATE:implementation_approval]`，等待用户确认计划、风险和回撤边界；确认前不得写业务代码。
9. 按项目适配层的 test strategy 决定是否使用 `test-driven-development`。
10. 按批准后的计划实现。
11. `rollback_units: full` 时先运行 `rollback-units` 审计模式，补齐真实回撤证据。
12. 完成后使用 `code-review`；`code-review` 会委托 `requesting-code-review`。
13. 声称完成前执行 `verification-before-completion` 证据门禁和 `dev-flow-feature-check --finish`。

必需产物：

```text
<FEATURE_ROOT>/<feature-id>/需求说明书.md
<FEATURE_ROOT>/<feature-id>/status.md
<FEATURE_ROOT>/<feature-id>/context/implement.jsonl
<FEATURE_ROOT>/<feature-id>/context/review.jsonl
<FEATURE_ROOT>/<feature-id>/context/verify.jsonl
<FEATURE_ROOT>/<feature-id>/初步实现计划.md
```

除非用户要求保存或风险较高，需求覆盖结论、回撤单元、计划审查、安全审查和代码审查可以只保留在对话或 `status.md` 中。

标准 M 的加速条件：

- `grillme` 未发现新分支或阻塞问题时，可以减少追问轮次，但仍必须停在 `requirement_confirmation`。
- 需求覆盖门禁无缺口，且 `plan-review` 没有 CRITICAL/HIGH 阻塞项时，记录结论后继续到实现前门禁，不逐条等待审批。
- `code-review` 没有 Critical/Important 阻塞项时，直接进入验证；有阻塞项时先修复或明确接受风险。

### L 路径

先判断轻量 L 还是标准 L：

- 轻量 L：触及登录、鉴权、token/session、权限守卫、订单、支付、数据删除或跨系统入口，但需求边界清楚、设计自明、改动范围小、可用明确行为验证证明。
- 标准 L：存在需求分支、接口契约不确定、跨模块设计、多方案取舍、共享状态/权限结构变化、任务依赖或难回撤。

#### 轻量 L

1. 输出边界确认卡：高风险点、改动范围、不做范围、回撤方式、验证方式和为什么可走轻量 L。
2. 输出 `[HUMAN GATE:implementation_approval]`，等待用户确认轻量 L 路径；确认前不得写 `status.md`、context manifest 或业务代码。
3. 用户确认后更新 `<FEATURE_ROOT>/<feature-id>/status.md` 的 `dev_flow_status`；如果没有稳定 feature-id，先按项目适配层生成一个。
4. 创建或刷新 `context/implement.jsonl`、`review.jsonl`、`verify.jsonl`。
5. 按风险维度至少触发：安全审查 `light/full`、行为验证 `full`、回撤证据 `light`。
6. 设计自明时不强制 `grillme`、完整 `writing-plans`、`requirements-coverage full` 或 `plan-review full`。
7. 用户确认后按轻量 L 路径实现；如果执行中发现需求分支、接口契约不明、多模块方案取舍、共享状态/权限结构变化或难回撤，立即升级标准 L 并重新停在相应 HUMAN GATE。
8. 完成后执行 `code-review` 和 `verification-before-completion`。
9. 行为验证在当前项目 `webapp-testing: disabled` 时必须落盘 `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md`。

轻量 L 必需证据：

```text
<FEATURE_ROOT>/<feature-id>/status.md
<FEATURE_ROOT>/<feature-id>/context/implement.jsonl
<FEATURE_ROOT>/<feature-id>/context/review.jsonl
<FEATURE_ROOT>/<feature-id>/context/verify.jsonl
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md（行为改动时）
```

#### 标准 L

1. 使用 `openspec` 或 `req-probe` 固化需求。
2. 使用 `grillme` / `grilling` 压测需求或设计。
3. 输出 `[HUMAN GATE:requirement_confirmation]`，等待用户明确确认需求边界；确认前不得写实现计划。
4. 用户确认后使用 `writing-plans` 创建实现计划。
5. 创建或刷新 `status.md` 的 `dev_flow_status` 和 context manifest。
6. 设计不确定性高时，先在 OpenSpec `design.md` 或实现计划中写 2-3 个候选方案与取舍；设计自明时跳过。
7. 按第 4 步风险维度表启用门禁。L 级默认至少保留 `status.md`，触及安全或运行时行为时必须保留相应证据。
8. `requirements-coverage` 对标准 L 通常为 `full`；有阻塞缺口时，不进入实现。
9. `plan-review` 对标准 L 至少为 `light`，涉及架构、跨模块、权限/登录/数据完整性时为 `full`；CRITICAL/HIGH 必须修复、反驳或由用户明确接受风险。
10. 已触发的 `rollback-units` 为 `full` 时落盘，明确任务依赖、回撤顺序和回撤后验证；为 `light` 时至少写入 `status.md`。
11. 涉及登录、鉴权、token/session、权限守卫、订单、支付、数据删除、跨系统入口或数据完整性时，按项目适配层加入安全审查。
12. 输出 `[HUMAN GATE:implementation_approval]`，等待用户确认计划、风险、回撤和验证方式；确认前不得写业务代码。
13. 按项目适配层的 test strategy 决定是否使用 `test-driven-development`。
14. 可拆分时按子任务执行；平台支持时使用 `subagent-driven-development`，否则使用 `executing-plans`。
15. `rollback_units: full` 时先执行 `rollback-units` 审计，再执行 `code-review`。
16. 按项目适配层运行最强相关验证；L 级运行时行为改动必须包含 `webapp-testing` 证据或填写完整的手动测试脚本。
17. 运行 `dev-flow-feature-check <feature-id> --finish`；失败时不得进入“验证通过”的分支收尾。
18. 进入 `finishing-a-development-branch`，停下询问分支收尾方式。

标准 L 中，`writing-plans -> requirements-coverage -> plan-review` 是实现前固定骨架。`requirements-coverage` 只回答“需求和计划是否一一覆盖”；`plan-review` 再回答“这个计划是否安全、可回撤、符合项目结构”。两者都完成前，不进入 `implementation_approval`。

必需产物：

```text
<FEATURE_ROOT>/<feature-id>/需求说明书.md
<FEATURE_ROOT>/<feature-id>/status.md
<FEATURE_ROOT>/<feature-id>/context/implement.jsonl
<FEATURE_ROOT>/<feature-id>/context/review.jsonl
<FEATURE_ROOT>/<feature-id>/context/verify.jsonl
<FEATURE_ROOT>/<feature-id>/初步实现计划.md
<FEATURE_ROOT>/<feature-id>/requirements-coverage.md（触发 full 时）
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-plan-review.md（触发 full 时）
<FEATURE_ROOT>/<feature-id>/rollback-units.md（触发 full 时）
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md（需要手动行为验证时）
```

L 级不使用“干净就过”跳过需求边界确认、实现前确认或最终强验证。L 级但架构自明、只改少量高风险逻辑时，允许安全审查 `light/full` + 行为验证 `full` + 回撤说明 `light`，不强制生成 plan-review/rollback-units 大文档；但轻量 L 仍必须先输出边界确认卡并获得用户确认。标准 L 或 `rollback_units: full` 的实现完成后，必须经过回撤审计和 `dev-flow-feature-check --finish`，不能只靠对话中的“已完成”结论收尾。

### 中途重分级

实现、审查或验证中发现实际风险与初始判断不符时，先停下并告知用户：

- 初始级别和实际级别。
- 已完成的步骤和已经可信的结论。
- 建议接下来切换到哪条路径。

升级到 L 时，除非用户已经明确授权高风险轻量处理，否则等待用户确认后继续。降级时，说明理由并保留已经完成的有效门禁。

## 第 4 步：风险维度门禁

级别决定停顿、落盘和失败严格度；门禁由风险维度触发。不要因为任务是 L 就自动套满所有大文档，也不要因为改动文件少就跳过真实风险。

| 门禁 | 触发条件 | 默认形态 |
|------|----------|----------|
| 需求覆盖 | 存在需求分支、多条业务规则、接口契约不确定、OpenSpec/需求文档与计划需要追踪 | 标准 M `light/full`；L 通常 `full` |
| 计划审查 | 标准 M/L 的实现计划；或计划中存在架构选择、多个候选方案、共享模块改造、跨页面/跨状态流转 | 标准 M/L 至少 `light`；L 按不确定性升为 `full` |
| 回撤单元 | 任务间有依赖，或改动共享接口、状态、权限、路由、数据结构、构建配置 | 标准 M `light/full`；L 至少 `light` |
| 安全审查 | 触及登录、token/session、鉴权、权限判定、订单、支付、数据删除、跨系统入口、敏感信息 | M/L 默认触发；复杂或高后果为 `full` |
| 行为验证 | 改动会改变运行时行为，尤其是路由、接口、登录态、权限、表单、错误分支 | M/L 默认触发；L 行为改动必须 `full` |

门禁形态：

- `none`：不触发。
- `light`：把结论写入对话、`status.md`、代码审查或验证报告，不生成独立大文档。
- `full`：落盘为项目适配层定义的标准资产，并作为后续门禁输入。

示例：一个“碰 auth 但只改一行守卫、设计自明”的 L 级任务，可以走安全审查 `light/full` + 行为验证 `full` + 回撤说明 `light`，不强制生成 plan-review/rollback-units 大文档；但不能完全没有安全、行为和回撤证据。

登录、鉴权、SSO、token/session、路由守卫、HTTP 拦截器或跨系统入口的标准 L 默认：

- `requirements_coverage: full`
- `plan_review: full`，除非计划只改单点且无共享状态、接口契约或跳转链路变化
- `security_review: light/full`
- `behavior_verification: full`
- `rollback_units: light/full`

### 需求覆盖门禁

复用 `requirements-coverage`。在实现计划生成后、计划审查前执行。检查每条需求是否有对应计划任务和验证方式：

```text
需求条目 -> 来源 -> 对应计划任务 -> 验收方式 -> 验证命令/检查 -> 状态
```

阻塞条件：

- 需求没有对应任务。
- 任务找不到需求来源，且不是明确的技术支撑任务。
- 需求没有验收方式或验证方式。
- 需求文档内部存在冲突。
- 计划触碰了明确不做的范围。

通过时只把覆盖报告作为 `plan-review` 输入；默认不把覆盖矩阵追加到 `context/verify.jsonl`，避免把“计划对齐证据”误当成完成前验证证据。

### 计划审查门禁

复用 `plan-review`。标准 M/L 中，计划审查是实现前门禁，不能由实现后的 `code-review` 替代。CRITICAL/HIGH 是阻塞项；必须修复、反驳，或由用户明确接受风险后才进入实现。审查输入应包含需求说明书、实现计划、需求覆盖结论和相关源码/规范。

### 最小回撤单元门禁

复用 `rollback-units`。在实现前先为每个任务定义回撤边界，执行后补齐真实提交、diff 文件或等价 patch 策略。不要默认替用户提交；优先建议任务级 commit，用户不希望提交时用落盘 patch 或清晰回撤说明。

模板：

```markdown
### Task <id> Rollback Unit
- Purpose:
- Requirement IDs:
- Files:
- Produces:
- Consumed by:
- Commit / Diff range:
- Revert order:
- Revert command or patch strategy:
- Post-revert verification:
- Risks:
```

阻塞条件：

- 任务之间存在依赖，但没有说明回撤顺序。
- 任务修改共享接口、状态、权限或数据结构，但没有回撤后验证。
- L 级任务没有记录提交、diff 范围或等价回撤策略。

### 安全审查门禁

触发后优先使用 `security-reviewer`。如果当前环境没有可用智能体，把安全清单写进 `plan-review`、`status.md` 和最终 `code-review`。

检查重点：

- token/session 是否安全读写和清理。
- 权限判断是否只依赖可信来源，是否存在绕过路径。
- 登录回跳、跨系统参数、URL code 等入口是否校验和兜底。
- 订单、支付、删除等高后果动作是否有权限和状态保护。
- 是否引入硬编码凭据、敏感日志或过宽错误泄露。

`full` 形态保存到 `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-security-review.md`；`light` 形态至少把结论写入 `status.md` 或最终代码审查。

### 行为验证门禁

触发后按项目适配层执行运行时验证策略：

- `webapp-testing: enabled`：使用 `webapp-testing` 跑关键路径，并把截图、trace 或操作记录写入验证报告。
- `webapp-testing: disabled`：落盘手动测试脚本 `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md`，包含步骤、预期和实测结果。
- `automated-tests: present`：同时运行相关自动化测试。

L 级运行时行为改动不能只用 type-check 或 lint 作为完成证据；必须说明真实页面、路由、接口、状态或权限路径如何被验证。用户跳过完整 lint/build 时可以记录 accepted risk，但 verification 只能标记为 partial，不能加入 `completed_gates` 或输出“验证通过”。

## 第 5 步：控制产物数量

不要每一步都生成文档。只有当文档会成为决策记录或交接产物时才生成。

- XS：不生成 md。
- S：默认不生成 md。
- 轻量 M：默认不生成 md、`status.md` 或 context manifest；出现重要决策、用户要求记录、已有落盘资产或流程升级时再生成。
- 标准 M：需求说明书、`status.md`、context manifest 和实现计划；必要时保存覆盖、审查、回撤、安全和行为验证资产。
- L：需求说明书、`status.md`、context manifest、实现计划、代码审查、验证证据；其它门禁按风险维度决定 `light` 或 `full`。

如果 grill 过程产生重要决策，把结论合并到需求或计划，不单独保存长对话记录。

## 第 6 步：验证门禁

在声称完成前：

1. 找出能证明结论的命令或检查。
2. 重新运行。
3. 读取输出和退出码。
4. 报告证据。
5. 对 M/L 运行 `.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish`；该检查失败时停止收尾。

按项目适配层的验证配置和 test strategy 选择默认验证；混合改动取并集。不要把某个项目的验证命令当作 dev-flow 本体规则。

如果触发了行为验证门禁，验证报告必须包含运行时证据：

- 自动化可用时：`webapp-testing` 或项目测试命令的结果。
- 自动化不可用时：手动测试脚本路径、步骤、预期、实测结果和无法覆盖的残留风险。

如果没有适用命令，检查改动文件并说明这是文档或流程改动。

验证失败时：

1. 先判断是代码问题、环境问题，还是验证命令不适用。
2. 验证命令不适用时，调整为能证明结论的正确验证方式并重新运行。
3. 代码问题时修复后重新运行完整相关验证，不只跑失败的那一条。
4. 同一问题连续 3 轮仍失败时，停止声称完成，汇报失败证据、已尝试修复和建议下一步。
5. 环境问题无法自行排除时，说明阻塞原因、已检查内容和剩余风险。

## 回复格式

路由判断：

```text
我判断这是 <level>，原因是 <short reason>。我会走 <route summary>。
```

M/L 阶段结束时更新 `<FEATURE_ROOT>/<feature-id>/status.md` 和 `dev_flow_status`，并追加 `[HANDOFF]`。如果 `Auto-continue: yes`，可以直接调用下一技能；如果 `Auto-continue: no` 或输出了 `[HUMAN GATE:<gate-id>]`，必须停止当前回合，等待用户确认。恢复后先把对应 `human_gates` 状态更新为 `confirmed` 或 `skipped`，再继续。

完成汇报：

```text
已更新 <files>。
验证：<command/check>，结果 <passed/failed/not run with reason>。
```

XS/S 简短说明即可。M/L 需要附当前产物路径、下一道门禁和是否自动继续。
