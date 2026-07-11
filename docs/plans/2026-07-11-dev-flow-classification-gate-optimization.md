# dev-flow 分级、风险门禁与受管强化优化方案

> 状态：已根据评审修订，待确认后实施。本文只定义流程层与文档层改动；不修改任何宿主项目业务代码。

## 1. Context（为什么做这件事）

dev-flow 是复制进**宿主项目**使用的工作流迁移包。它必须读取当前宿主项目的代码、配置和验证能力，不能把某个历史项目的场景结论当作通用事实。

真实失败是：一个 SSO 登录需求被低估，且在边界未确认、没有计划、没有计划审查时直接开始写业务代码。

根因分为三类：

1. **分级欠拟合**：当前分级仍主要由“场景 → 等级”、失败后果和评分表驱动，而不是先读宿主项目的真实入口、契约和调用拓扑。
2. **风险与规模混轴**：认证、数据、支付等后果既被当作风险，也被直接用来抬高等级，造成“小而险”和“大而低风险”都无法被准确表达。
3. **门禁不可证伪**：HUMAN GATE 主要是自然语言协议；现有完成检查只覆盖 M/L，风险 XS/S 既没有最小机器记录，也没有收尾后的长期证据。

目标不是把流程变重，而是让：

- 同一句需求在不同宿主项目中，可以因真实拓扑不同得出不同规模结论；
- 小而高风险的改动得到最小、可查的审批与验证，而不是被伪装成 L；
- 高风险不会只靠模型自评就静默越过；
- 新失败模式优先进入结构化契约、脚本和测试，而不是继续堆叠 prose。

## 2. 不可回归的验收基线

1. **普通小任务不过度治理**：无风险标签的 XS/S 不创建流程资产；单文件局部 bug 修复不得因为“可能有调用方”而被强制全仓追踪。
2. **高风险不可静默越级**：风险任务必须在实现前留下用户审批证据，并在完成前被机器检查。默认层保证“可查、可拦截收尾”；只有启用 P8 的受管环境才承诺工具级阻断。
3. **规模与风险解耦**：规模只反映改动形状与扩散；风险只反映改错后的后果和需要的门禁。允许 S + security、XS + critical_correctness。
4. **规则不膨胀**：分类、证据和门禁的稳定字段进入项目适配层、状态契约和脚本；SKILL.md 只保留短不变量、流程和 worked example。
5. **迁移包不假装是安全边界**：宿主项目内可被 agent 改写的设置、Hook 和标记只能算护栏，不能宣称“真正不可绕过”。

## 3. 作用域、非目标与信任边界

### 3.1 本轮作用域

- 重写分级为“先证据、后映射”的拓扑流程。
- 增加风险标签、风险 XS/S 最小状态档案、完成前检查和完成后摘要。
- 为分类证据增加结构化、可复跑的有限校验。
- 将所有“auth/SSO 直接等于 L”的活动路由改为“security 风险信号 + 拓扑调查”。
- 重构 smoke test，使门禁顺序测试与分类正确性测试分离。
- 将 P8 更名为“受管强化门禁”，作为可选部署配置，而不是默认迁移包承诺。

### 3.2 非目标

- 不把 XS/S 普遍升级为落盘流程。
- 不用通用文本搜索假装完成了完整调用图或语义分析。
- 不在默认迁移包中引入常驻服务、CI、数据库或强制组织级策略。
- 不把宿主项目的路径、风险 glob、业务术语或测试命令写入通用 SKILL。
- 不宣称本地仓库内 Hook 能防止仓库所有者或具备同等写权限的主体绕过。

### 3.3 两层门禁模型

| 层级 | 适用范围 | 承诺 | 不承诺 |
|---|---|---|---|
| 默认可审计门禁 | 所有迁移项目 | 风险卡、实现前用户确认、完成前机器检查、完成后摘要 | 阻止所有工具或人工写入 |
| 受管强化门禁（P8） | 有受管配置和可信审批记录的团队 | 在声明的受保护范围内阻止未批准的工具写入 | 保护仓库所有者绕过、识别所有未知业务后果 |

默认层的措辞必须是“不得静默跳过、收尾可查”，不能称为 harness 级硬阻断。

## 4. 核心模型与结构化契约

### 4.1 规模轴：XS / S / M / L

规模只描述改动的**形状与扩散**，不描述错误后果：

| 等级 | 拓扑信号 | 默认执行方式 |
|---|---|---|
| XS | 单点、私有或局部、契约稳定、可立即验证 | 直接修改和验证 |
| S | 单模块局部行为变化，边界清楚，可独立回滚 | 简短确认后修改和验证 |
| M | 一个功能内有多个协同步骤、状态或错误分支，但共享契约稳定 | 轻量 M 或标准 M |
| L | 跨架构层传播、改共享契约/协议、多条链路必须一致、存在部分成功状态或跨单元协调回滚 | 轻量 L 或标准 L |

“协调回滚”仅指多个部分必须按序协同回退的结构事实；“删错数据能否挽回”属于风险。文件数量只能提供调查线索，不能决定等级。

### 4.2 风险轴：独立标签与触发规则

标签是粗粒度风险信号，不提升规模：

- `security`：登录、鉴权、权限、token/session、敏感信息。
- `data`：删除、迁移、数据完整性、不可逆状态变化。
- `money`：支付、计费、价格、余额、结算。
- `external`：外部协议、回调、第三方 API、跨系统跳转。
- `availability`：可用性、队列、限流、关键降级或恢复。
- `critical_correctness`：即使改动很小，错误结果本身也会造成重大业务、合规、健康或资格判断后果。
- `irreversible_consequence`：后果不可逆但不属于已有 data/money 标签的情形。

后两项是开放式兜底，但不是“任何 bug 都算高风险”。命中它们时必须在风险卡中写清：错误结果是什么、谁会受影响、为什么不能由普通验证覆盖。

所有风险标签至少触发：

1. 一个只包含范围、风险、回撤/恢复方式和验证方式的最小风险卡；
2. `implementation_approval` 的后续用户确认及原话/接受风险理由；
3. 与标签匹配的最小审查和验证证据；
4. `dev-flow-feature-check --finish` 对上述事实的校验。

风险本身不强制 `requirement_confirmation`、完整计划、context manifest 或 L 路径。需求不清、拓扑复杂或共享契约变化时，才按规模规则升级到标准 M/L。

### 4.3 风险门禁映射

风险标签决定“需要什么证明”，实现者根据宿主项目能力选择 light/full：

| 标签 | 最低证明方向 |
|---|---|
| security | 安全审查结论、认证/授权负面路径或等价行为验证 |
| data / irreversible_consequence | 回撤或恢复说明、迁移/状态前后验证 |
| money / critical_correctness | 关键不变量、边界值、人工或自动结果验证 |
| external | 协议输入输出、错误/超时/重试或回调验证 |
| availability | 失败路径、降级/恢复、可观测性或行为验证 |

这是门禁选择表，不是新的评分表；多个标签取所需证明的并集。

### 4.4 最小风险状态档案

风险 XS/S 复用既有 `status.md`，不新建平行资产。新增 `profile: "risk-minimal"`：

- 允许 `level: "XS" | "S"`；
- 必填：feature_id、level、classification、risk_labels、风险理由、实现前审批、验证记录、accepted_risks；
- 不要求需求说明书、实现计划、三个 context manifest 或 requirements-coverage；
- 完成时仍生成简短 `feature.md` 与 `completion.md`，后者必须摘要保留风险标签、审批证据、验证结论和接受风险。

标准 M/L 和轻量 L 继续使用现有完整状态档案。完成后的 compact 收尾会移除中间 `status.md`，因此 `completion.md` 是长期可查事实源，不能只在 status 中保留审批证据。

## 5. P1：分级改为拓扑推导，不把 req-probe 变成 XS/S 的前置程序

### 改法

在 dev-flow 的“分级”步骤内定义一个**零资产分类探查**，而不是直接调用 req-probe：

1. 定位最可能的入口、目标文件或配置边界。
2. 阅读直接相关文件，判断改动是否影响模块边界、共享契约、链路一致性、部分成功或协调回滚。
3. 按 P3 的触发条件决定是否做一次范围受控的引用/消费者搜索。
4. 分别输出规模、风险标签、分类证据和下一路径。
5. 只有需求歧义会影响边界、验收或路径时，才路由到 req-probe / openspec；它们仍负责需求固化和提问，不承担所有任务的分类搜索。

分类输出的最小格式：

```text
规模：S
拓扑依据：只修改 <文件/私有符号>；模块对外契约不变。
风险标签：security
证据：读取 <文件>；引用搜索：不适用（私有符号且契约不变）。
路径：risk-minimal，等待 implementation_approval。
```

普通 XS/S 只在对话中输出该结论。M/L 与风险 XS/S 将结构化结论写入 status，以便 P4 和完成检查读取。

### 必须保留

- 需求明显模糊时，仍可路由 req-probe。
- auth 的调查清单保留为调查辅助，不作为等级规则。
- “展示局部”与“守卫/拦截器/共享鉴权参数”之间的拓扑差异保留为 worked example。
- 验证能力从旧评分表迁移为风险门禁选择的输入，不随评分表删除。

## 6. P2：风险与规模解耦，并使风险 XS/S 的生命周期闭环

### 问题

现有 S 路径默认没有 status；现有 status 模板只接受 M/L；完成检查对 XS/S 会直接失败；compact 收尾又会清理 status。仅修改一段“风险不抬级别”的 prose，无法满足可查/可拦。

### 改法

同一批提交中完成以下契约：

1. 模板和状态读写规则支持 `risk-minimal`。
2. `feature-check` 在 `--finish` 时识别风险 XS/S，要求实现前审批、标签对应验证和新鲜验证证据。
3. `finish`、`verification-before-completion`、`finishing-a-development-branch` 对“风险 XS/S 或 M/L”运行相同的完成检查；不要继续只写 M/L。
4. `completion.md` frontmatter 与正文保留风险摘要和审批证据；finalized 形态的 feature-check 也校验它。
5. 为缺审批、空证据、过期验证、compact 后丢风险摘要、错误 level/profile 追加回归用例。

这意味着“普通 XS/S 轻量”应明确为“**无风险标签的** XS/S 轻量”；高风险 XS/S 是有意保留的窄例外。

## 7. P3：渐进探索、搜索地板与停止条件

### 基线

先读直接文件；不把“每个行为改动”当成搜索理由。行为改动几乎覆盖所有 bug 修复，会破坏 XS/S 的成本目标。

### 一次引用搜索的强制条件

当同时满足以下条件时，必须运行一次范围明确的引用/消费者搜索：

1. 被改对象是已导出符号、路由/注册入口、共享配置、公开协议或框架约定入口；并且
2. 改动会改变其对外可观察契约，例如签名、返回结构、抛错、认证语义、状态副作用或协议字段。

私有函数内部修复、契约不变的重构、文案/样式、局部配置值可以跳过搜索。若搜索暴露共享消费者、全局状态或跨层传播，再逐层扩展；证据已表明局部且契约稳定时停止。

### 证据地板

- 不能声称“没有外部调用方”，除非实际执行了声明范围内的查询并评估完整结果集。
- “搜索为空”不是结论本身；记录目标符号、查询范围、排除规则和结果文件列表。
- 动态注册、反射、生成代码或语言服务器信息无法被通用文本搜索可靠覆盖时，记录 `evidence_partial`，不伪造“完整调用方”。

## 8. P4：分类证据可复跑校验（采用结构化记录，不重放模型命令）

P4 是核心主张的一部分，不再作为“要么半做、要么删除”的装饰项。它验证证据的可证伪性，不声称自动验证模型的全部工程判断。

### 记录格式

在 M/L 与风险 XS/S 的 status 中增加 `classification`：

```yaml
classification:
  schema_version: "1"
  topology: "local|shared-contract|multi-chain|coordinated-rollback"
  target_files: ["repo-relative-path"]
  symbols: ["symbol-or-entry"]
  search_required: true
  evidence_result: "verified|partial|not-applicable"
  external_references: ["repo-relative-path"]
  scope_note: "why this search scope is sufficient or partial"
```

不记录可执行的自由文本 shell 命令。验证器接收受限字段后，以固定参数、仓库相对路径和受控的 `rg` 查询重跑；绝不执行模型写入资产中的命令字符串。

### 校验边界

- **分类前/实现前**：检查字段完整性、路径安全性、符号/目标文件真实存在，以及声明的引用文件确实可由固定查询找到。
- **完成前**：检查业务 diff 与 target_files 有交集；若实际实现合理偏离目标，必须在 status / completion 中记录偏离理由和重新分类结论。
- **不做的事**：不把文本出现次数等同于调用方数量，不把 `rg` 结果称为完整语义调用图，不强制所有 XS/S 创建分类证据。

实现方式复用 `dev-flow-validate.mjs` 的子命令和 `feature-check`，避免另起一套平行程序。

## 9. P5：auth 从“等级关键词”改为“security 风险信号 + 定向调查”

所有活动规则统一为：

- 登录、鉴权、SSO、token/session、守卫、HTTP 拦截器、跨系统入口先命中 `security`；
- 随后检查认证中心/回跳配置、token 生命周期、Authorization、所有 /login 跳转、成功/失败/缺参/401/403/登出清理、URL 与本地状态清理、门户副作用；
- 规模由该调查得到的实际共享契约、消费者和链路决定，不由关键词决定。

必须同步替换所有含有“auth/SSO 直接为 L”语义的路由，不限于 dev-flow 和 dev-task。特别包括 writing-plans、plan-review、项目模板、onboarding、README、迁移后使用说明、smoke test 与命令说明。

doctor 钉死的文本和项目模板中的 SSO 验证矩阵、/login grep 必须保留；只改变其**分类含义**，不能误删验证义务。

实施前先用全仓搜索建立命中清单，并把每一项标为“分类路由”“风险/验证义务”或“普通示例”。只改前者的等级语义；后两者保留原有安全检查，避免为了消除关键词误删认证、token、session 等真实工程约束。

## 10. P6：smoke test 拆分为门禁顺序与分类正确性

### A. 门禁顺序回归

保留 `HUMAN GATE 回归用例` 和 `writing-plans 后必须自动进入 requirements-coverage` 两个 doctor 锚点，但将场景表述改为“一个已指定走标准 L 的 fixture”。它只验证：

- 需求确认、writing-plans、requirements-coverage、plan-review、implementation approval 的顺序；
- 任何 HUMAN GATE 后不继续写源码；
- 不用实现后的 code-review 替代 plan-review。

它不再断言“SSO 一定是标准 L”。

### B. 宿主项目分类 rubric

在迁移 smoke test 中新增人工审查项：

1. 同一需求、不同真实拓扑：分类可不同，且各自引用当前宿主项目证据。
2. 不同措辞、同一真实拓扑：分类应相同或给出明确的事实差异。
3. 导出共享契约变化：有搜索和分类证据。
4. 私有局部修复：不被强制调用方搜索。
5. S + security：最小风险档案、审批、验证和完成检查均闭环。

这是一份宿主项目验收 rubric，而不是在迁移包仓库中伪造业务样本。

## 11. P7：去重等级定义，建立单一事实源

- `dev-flow/SKILL.md` 是规模与风险定义的唯一事实源。
- `dev-task.md`、README、使用说明仅引用/概述该定义，不复述场景 → 等级表。
- 不修改 doctor 钉死的 writing-plans、implementation Todo、feature-check 收尾约束；必要时只重写其前后说明。

## 12. P8：受管强化门禁（可选部署能力）

P8 的目标是给已经具备受管配置的团队提供工具级阻断，不是把本地迁移包包装成不可绕过的安全边界。

### 12.1 启用前提

只有同时满足以下条件时，项目可声明启用 `enforcement_mode: managed`：

1. Hook 配置位于组织受管策略或 agent 不可修改的外部可信位置；仓库内 `.claude/` 文件不能作为唯一信任根。
2. 审批记录与具体 feature、会话和允许改动路径绑定，且不是 agent 可自行写出的“存在即批准”标记。
3. 受保护范围内所有写入路径均被覆盖：至少是 `Edit|Write`，且 Bash 写入要么被受管权限策略禁止，要么被同一策略可靠拒绝/拦截。
4. 已在实际 Claude Code 版本上验证 Hook 的 matcher、输入字段和拒绝语义。

任一前提不满足时，P8 只能以“项目内护栏”运行，文档不得称为强化门禁。

### 12.2 行为

- 对非工作流资产的受保护风险路径，未找到**匹配当前 feature 与批准路径**的可信审批记录时拒绝写入，并返回下一步指引。
- 风险路径规则来自宿主项目的受管配置；迁移包只提供字段说明、验证器和安装指引。
- 已批准 A feature 不能放行 B feature，也不能放行批准范围外的文件。
- `critical_correctness` 之类无法通过路径粗筛发现的后果仍依赖默认风险卡；P8 不夸大其覆盖率。
- Hook 实现使用 Node 解析 stdin JSON，不执行来自 tool input、status 或项目配置的 shell 片段；所有路径必须归一化、拒绝穿越和符号链接逃逸。

### 12.3 必测情形

在真实 CLI 的隔离 fixture 中验证：

1. 无审批时对受保护文件的 Edit/Write 被拒绝；
2. 匹配 feature 和允许路径的审批可放行；
3. 另一个 feature 的审批不能放行；
4. Bash 写入尝试不能绕过声明的保护范围；
5. Hook 或审批解析失败时，在受管范围内按 fail-closed 处理；
6. 工作流安装/升级有受管管理员路径，不要求 agent 先绕过门禁改配置。

没有这组端到端验证时，P8 不进入发布说明。

## 13. 完整影响面与脚本约束

### 13.1 必须同步更新的流程层

- `.claude/skills/dev-flow/SKILL.md`：分类、路径、风险门禁、收尾条件。
- `.claude/commands/dev-task.md`、`finish.md`、`onboard-dev-flow.md`、命令 README。
- `.claude/skills/req-probe/SKILL.md`、`writing-plans/SKILL.md`、`plan-review/SKILL.md`、`verification-before-completion/SKILL.md`、`finishing-a-development-branch/SKILL.md`。
- `.claude/rules/project-workflow.template.md`：风险最小档案、completion 摘要、可选 enforcement 配置和迁移说明。
- `dev-flow-feature-check`、`dev-flow-feature-finalize`、`dev-flow-validate.mjs`、现有 shell 测试与 doctor。

### 13.2 必须同步更新的文档

- README、迁移说明、迁移后使用说明、smoke test。
- `docs/claude-dev-flow-migration.md` 中仍将鉴权 middleware/session/redirect 直接归为 L 的说明。
- 任何仍把登录、鉴权、SSO、token/session、支付、删除等直接映射为 L 的用户入口说明。
- 版本说明：先核实模板、状态 schema 和发布文档的当前单一版本；这是资产契约变更，必须提升到下一个兼容性版本，不能让 `0.3/0.4` 等版本号并存。

### 13.3 不能破坏的静态约束

- `dev-task.md` 中“不要用对话里的实现计划代替 writing-plans”、实现 Todo 在 implementation approval 后才能开始、L 收尾调用 feature-check 的约束。
- smoke test 的 HUMAN GATE 和 writing-plans → requirements-coverage 锚点。
- 项目模板中的 SSO 验证矩阵和 /login grep。
- `feature-check` 的只读属性、路径穿越保护、manifest 严格解析和验证新鲜度校验。

doctor 除了继续检查这些不变量，还应检查模板包含风险最小档案/完成摘要字段，并避免活动路由残留“关键词直接抬 L”的规则。

## 14. 兼容性与迁移

1. 先定义新 status/completion schema 的版本和默认值；旧 M/L status 缺失新字段时按 `risk_labels: []`、无分类复跑义务处理，不应误报为损坏。
2. 新创建的风险 XS/S 使用 `risk-minimal`；不自动迁移历史普通 XS/S。
3. 已完成的旧 feature 可按旧 finalized 规则读取；新版本只对新生成或明确迁移的 completion 强制风险摘要。
4. onboarding 只在宿主项目确有受管前提时填写 `enforcement_mode: managed`；否则明确为 `none`。
5. 迁移/升级后先运行 doctor、脚本回归和宿主项目 smoke test，再开始真实高风险任务。

## 15. 验证方案

### 15.1 自动回归

1. doctor 为零 failure，并验证所有钉死文本和新增 schema 锚点。
2. feature-check 测试覆盖：
   - S + security 缺 implementation approval；
   - S + critical_correctness 缺风险理由或验证；
   - 风险最小档案通过后，业务 diff 变化导致验证过期；
   - classification 引用不存在、范围/路径不安全、声称空引用但固定查询命中；
   - 完成后 `completion.md` 缺风险/审批摘要；
   - 旧 M/L fixture 与 finalized compact/full fixture 仍通过。
3. validate 子命令的单测覆盖符号、路径、重复引用、部分证据、目标文件与 diff 偏离。
4. 文本一致性检查确保活动路由不再以 auth/SSO 关键词直接升 L，同时保留认证调查与验证义务。
5. 对 P5 的全仓命中清单逐项复核：分类路由均已改写，风险/验证义务与普通示例均未被误删。

### 15.2 宿主项目人工验收

1. 本地私有 bug 修复：XS/S，无调用方搜索、无流程资产。
2. 同一业务需求在两个不同真实拓扑中：证据不同，规模允许不同。
3. 共享守卫/拦截器契约变化：搜索证据、security 标签和正确门禁。
4. 小范围安全改动：S + security，只有最小档案，不被强行扩成标准 L。
5. 数据/金额/关键正确性改动：风险标签、对应验证和收尾摘要完整。
6. 标准 L fixture：所有 HUMAN GATE 顺序与实现前停止行为保持不变。

### 15.3 受管强化门禁验收（仅 P8）

只有在受管配置真实可用时运行第 12.3 节的 CLI 集成测试。没有条件时，P8 标为未启用，不影响默认层发布。

## 16. 落地顺序

### 批次 A：先建契约与测试底座

1. 核实当前发布版本，确定 schema/version 迁移策略。
2. 扩展状态模板、completion 模板、validate 子命令和 feature-check fixture。
3. 扩展 finish/finalization，使风险 XS/S 的最小档案能从审批一直保留到 completion。

### 批次 B：一次性发布默认可审计门禁

1. 落地 P1、P2、P3、P4、P5、P7。
2. 同步更新所有下游 skill、command、模板和用户文档，而非只改 dev-flow/dev-task。
3. 改造 P6，执行 doctor、脚本测试与宿主项目 smoke test。

不得出现“文档已宣称 S + security 有可查门禁，但脚本或收尾资产尚不支持”的中间发布状态。

### 批次 C：受管强化门禁（可选）

1. 先验证组织受管配置、可信审批记录和 Bash 写入限制。
2. 实现 P8 的 Hook、安装说明和端到端 fixture。
3. 仅在第 15.3 节通过后，将该宿主项目标记为 `enforcement_mode: managed`。

## 17. 已决策与剩余决策

### 已决策

- P8 更名为**受管强化门禁**，不是默认迁移包的“真正不可绕过”承诺。
- 风险与规模完全解耦；风险 XS/S 使用最小状态档案。
- P4 采用受控的结构化证据复跑，不执行模型记录的 shell 命令。
- smoke test 将分类验收与标准 L 门禁顺序回归分开。

### 实施前仍需确认

- 当前发布基线与下一个 schema/version 号。
- 哪些宿主项目具备受管 Hook 与可信审批状态，因而可以启用 P8。
- 每个宿主项目的风险路径规则、Bash 写入权限策略和审批记录的管理员归属。

在这些决策未确认前，默认层仍可实施；P8 保持关闭并在文档中明确其边界。
