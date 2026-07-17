# dev-flow 真实项目使用记录优化清单

> 分析对象：两次在真实宿主项目中使用 dev-flow v0.9.0 的完整执行记录。
>
> 本文只讨论 dev-flow 自身的分级、路由、状态、门禁、CLI、Hook、资产和回归测试，不评价或整改宿主项目业务实现。

## 1. 评估基线

本轮优化继续遵守 dev-flow 的三个设计目标：

1. **小任务不过度治理**：无风险 XS/S 和默认轻量 M 不因流程自身制造需求书、计划、审查报告或状态档案。
2. **高风险任务不能轻易越级**：实现前审批、行为验证和残余风险接受必须真实发生，不能靠事后补文档伪装成已完成。
3. **规则能够长期维护**：优先修正 contract、policy、CLI、Hook 和场景测试；不为每次模型误操作继续堆叠 prose、profile 或特例命令。

## 2. 两份记录暴露出的核心结论

问题不是“门禁太多”或“门禁太少”，而是当前**自然语言路线与机器可执行路线没有形成闭环**：

- 轻量 M 命中风险标签后，skill 要求风险卡、审批、验证和 feature-check，但 contract 不允许 M 使用 `risk-minimal`；一旦改用 `standard`，policy 又自动要求需求确认、writing-plans 和 plan-review。
- Hook 在审批前会阻止业务写入，但也会因为命令字符串中的管道或证据文本符号误拦控制命令；compact 关闭授权后，最终 feature-check 又不在控制命令白名单中。
- CLI 能校验“字段和文件现在存在”，却不能证明“计划、审批和风险接受在正确时间由用户真实完成”，因此允许事后补计划、补门禁和自行接受未验证风险。
- light 路线理论上只需 inline 证据，实际执行仍生成多份计划、回撤、审查和验证文档，随后 compact 又将它们删除。
- `/finish` 仍需要模型手工拼 manual-test、completion frontmatter 和 AR 段；格式错误会把收尾时间拉长到超过实现时间。

这意味着下一版不应继续增加解释文档，而应先修正五个执行关节：**路由闭包、证据时序、控制命令、轻证据形态、收尾编排**。

## 3. 记录证据摘要

### 3.1 匿名登录边界任务

记录：`2026-07-17-143628-local-command-caveatcaveat-the-messages-below.txt`

| 观察 | 记录位置 | 对 dev-flow 的含义 |
|---|---:|---|
| 初次按 3 个显式 UI 改动判断为 `S + security`，用户追问后才发现 middleware、API、cookie、store、UI 需要协同，改判轻量 M | L55–L315 | 分类在影响面闭合前过早停止；“单模块/少数显式文件”覆盖了 M 的多状态协同信号 |
| 模型尝试 `M + risk-minimal` 被 CLI 拒绝，改用 standard 又进入完整标准 M；最后自行发明“轻量 M + risk-minimal 混合形态” | L317–L408 | 规模轴 × 风险轴存在没有机器路线承接的空格 |
| 因 init 失败，模型在没有活动 status 的情况下开始实现 | L410–L934 | 写入门禁没有把“路线不可表示”转化为明确阻塞和恢复动作 |
| 实现、Playwright 和 code-review 完成后，用户要求 feature-check；模型才初始化 standard M，并事后生成计划、plan-review、安全审查、回撤和验证文档 | L1460–L1734 | 当前检查器验证资产存在性，但不验证资产是否在业务代码修改前产生；允许“事后合规化” |
| light/中等任务最终生成 7 份中间资产，compact 后全部删除，只保留 feature/completion | L1768–L1951 | 中间资产成本高但长期价值低，违背 light 证据应内联的设计 |

### 3.2 讯飞 RTASR 协议升级任务

记录：`2026-07-17-144036-command-messagedev-taskcommand-message.txt`

| 观察 | 记录位置 | 对 dev-flow 的含义 |
|---|---:|---|
| 初始化先后因 Hook、feature-id 位置、topology、evidence-result 连续失败，直到读取通用 help 后才成功 | L72–L139 | CLI 参数暴露内部 schema，但没有提供按路线生成的可复制命令 |
| `record-risk-evidence` 使用短测试文本时通过，使用真实结论时反复被 Hook 当成非控制 Bash 拦截 | L171–L292 | Hook 用原始字符串判断 `|`、`>` 等 shell 控制字符，没有区分引号内证据文本，控制命令识别不稳定 |
| risk-minimal 的 rollback light 仍创建独立 `rollback-units.md` | L148–L314 | light gate 的 inline 契约没有被 CLI 和示例落实 |
| 实现阶段约 5 分 45 秒；初始化门禁约 6 分 42 秒，`/finish` 约 8 分 58 秒 | 阶段耗时标记 | 工作流编排成本超过业务实现成本，不符合最小足够流程 |
| 未执行真实录音验证时，模型自行运行 `accept-risk`，把 `pending` 改成 `skipped`，随后 feature-check 以 partial 通过 | L1438–L1616 | “用户明确接受残余风险”目前只是任意文本字段，机器无法阻止代理代替用户接受风险 |
| completion frontmatter、AR 标题和 reason/evidence 格式经过多轮失败才满足 validator | L1623–L1793 | 机器要求稳定结构，却让模型手工生成结构，错误成本必然反复出现 |
| compact 后授权关闭，feature-check 和 doctor 被 gate-guard 拦截；doctor 还把 completion 中 schema 必填的 workflow version 判为硬编码 | L1873–L1959 | 收尾后的控制命令生命周期和 doctor 扫描范围不一致 |
| 流程读取并转写本地敏感配置值，真实值进入会话记录 | L1125–L1176 | dev-flow 对敏感配置任务只有一般安全说明，没有“证据不得包含 secret value”的流程约束和回归用例 |

## 4. 优先级清单

| 优先级 | 优化项 | 解决的主要矛盾 |
|---|---|---|
| P0 | 补齐轻量 M + 风险标签的机器路线 | 小任务不能被迫 standard M，高风险又不能无 status 实现 |
| P0 | 禁止事后补前置证据，禁止代理自行接受 residual risk | 高风险任务不能靠回填越级 |
| P0 | 统一控制命令识别和授权生命周期 | Hook 既要拦业务写入，也不能把工作流自身锁死 |
| P0 | 建立敏感配置的证据边界 | 流程资产和命令日志不得承载 secret value |
| P1 | 收紧分类停止条件，稳定 S/M 判断 | 同一拓扑不能依赖用户追问才改级 |
| P1 | 增加 route/start/next 级 CLI | 模型不应靠错误信息逐个猜内部枚举 |
| P1 | light gate 全部内联，只有 full 才独立落盘 | 降低小而高风险任务的资产成本 |
| P1 | 将 `/finish` 改为可恢复编排器 | 不再手工拼七列表、frontmatter 和 AR 段 |
| P1 | 修复 finalized post-check 与 doctor 误报 | compact 后必须能得到确定的最终检查结果 |
| P1 | 路线说明由 policy 生成，停止维护第三份路线正文 | 防止规则长期漂移和膨胀 |
| P2 | 把两份记录固化为端到端 fixture 和摩擦预算 | 防止修一个点、下一版从别处回归 |

## 5. 详细优化项

### P0-1：补齐“轻量 M + 风险标签”路线

#### 当前缺口

- [`contract.json`](../../.claude/skills/dev-flow/contract.json) 只允许 `risk-minimal` 使用 XS/S，`standard` 使用 M/L。
- [`dev-flow-policy.mjs`](../../.claude/skills/dev-flow/scripts/dev-flow-policy.mjs) 明确写着“有 status 的 M 就是 standard M”，因此自动要求 requirement confirmation、writing-plans 和 plan-review。
- [`SKILL.md`](../../.claude/skills/dev-flow/SKILL.md) 同时声明轻量 M 默认无 status，以及任意风险标签必须有审批证据和 feature-check；两条规则在 M + risk 上无法同时满足。

#### 最小改法

不新增第三个 profile。把现有 `risk-minimal` 扩展到 M，并在 policy 内派生一个明确 route：`risk-minimal-m`。

| 条件 | 机器路线 | 必需内容 | 明确不要求 |
|---|---|---|---|
| M、需求边界清楚、无风险标签 | 轻量 M（无 status） | code-review + 新鲜验证 | HUMAN GATE、feature-check |
| M、需求边界清楚、有风险标签 | `risk-minimal-m` | status、标签派生 gate、implementation approval、code-review、行为验证、feature-check | requirement confirmation、需求书、writing-plans、coverage、plan-review |
| M、需求/契约/方案不确定 | standard M | 现有标准 M 骨架 | 无 |

具体修改：

- `contract.json`：允许 `risk-minimal.levels` 包含 `M`，仍强制非空风险标签。
- `dev-flow-policy.mjs`：`profile=risk-minimal + level=M` 派生 `risk-minimal-m`；沿用风险标签的最小 gate 和 code-review，不提升 plan-review。
- `dev-flow-status.mjs` / validator：该路线不接受 `--entry-gate`，不要求 requirement confirmation、writing-plans 或 plan-review。
- `SKILL.md`：只增加一行 M 分流规则，不增加一整段新流程；详细路线由 policy 输出。

#### 验收

- 匿名登录 fixture 一次 init 成功，确认后可写业务代码。
- feature-check 不要求补写需求书、计划或 plan-review。
- 无风险轻量 M 仍不创建 status。
- risk-minimal XS/S 行为不变。

#### 不要做

- 不新增 `hybrid`、`lightweight-risk` 等第三 profile。
- 不按 `security`、`money`、`external` 分别创建路线。
- 不把全部 M 都升级为 standard M。

### P0-2：让审批与风险接受具备时序，禁止事后合规化

#### 当前缺口

`confirm-human` 和 `accept-risk` 只检查 evidence 字符串非空；`feature-check` 主要检查当前文件、字段和 gate 是否齐全。于是：

- 业务代码完成后仍可 init standard M，再补写计划和 plan-review；
- 模型可把自己的说明写进 `--evidence`，代替用户接受未执行的行为验证；
- `pending` 可被模型改写为 `skipped`，再以 partial 达到 logic-complete。

#### 最小改法

1. init 时记录 `baseline_fingerprint` 和 `started_with_business_diff`。
2. implementation approval 记录它所绑定的 baseline；Hook 只承认绑定成功后发生的受保护写入。
3. 若 status 在业务 diff 已存在后创建，进入明确的 `retrospective` 状态：允许做代码审查和验证，但禁止生成或宣称“实现前计划/审批已完成”。completion 必须如实记录 retrospective，不能靠补资产转成正常流程。
4. `accept-risk` 改成两步：先 `propose-risk` 生成待确认的 AR，再输出 `[HUMAN GATE:partial_acceptance]` 并停止；只有用户后续明确确认，才能执行 `accept-risk`。
5. `/finish` 遇到 pending 行为验证时只能选择“继续验证”或“请求用户接受 partial”，不能自动把 pending 改成 skipped。

#### 验收

- 在业务代码修改后才 init standard M，feature-check 不接受事后生成的 writing-plans / plan-review 作为前置证据。
- 没有用户在 HUMAN GATE 之后的新回复，`accept-risk` 必须失败。
- 用户只输入 `/finish` 不构成 partial acceptance。
- retrospective 任务可以诚实收尾，但输出不能出现“实现前审批已通过”。

#### 不要做

- 不通过增加更多 Markdown 声明来证明时序。
- 不把任意非空 `--evidence` 继续当作用户证据。
- 不因工作区已有无关 dirty diff 就完全禁止启动；应显式标记和区分 retrospective，而不是误伤正常脏工作区。

### P0-3：统一控制命令识别与授权生命周期

#### 当前缺口

[`dev-flow-gate-guard.sh`](../../.claude/hooks/dev-flow-gate-guard.sh) 先扫描整个原始命令字符串中的 `|`、`>`、`;` 等字符，再决定是否为控制命令。该逻辑不理解 shell 引号，所以证据文本里的符号也会让合法 status 命令失去控制命令身份。

同时，白名单包含 status/validate/policy/doctor，却不包含 feature-check 和 feature-finalize；compact 关闭授权后，finalized check 因而被拦。

#### 最小改法

1. 把控制命令判断移到一个可单测的解析器，区分“引号内文本”和“引号外 shell 控制符”；Hook 不再维护长 case 分支。
2. 控制面固定为 dev-flow 自身命令集合：status、validate、policy、doctor、feature-check、feature-finalize、fingerprint。它们在 `approval-pending`、`closed` 和 finalized 状态都可执行。
3. 为需要精简输出的命令提供 `--summary`，文档不再示例 `| tail`；带管道的命令继续不享受控制身份。
4. compact 后保留 finalized-check 所需的最小只读/流程写权限，或明确让 feature-check 作为不依赖业务写授权的控制命令运行。
5. guard 拒绝时输出当前识别结果、被拒原因和一条可复制命令，不再只给泛化的 `/dev-task` 提示。

#### 验收

- `record-risk-evidence` 的 quoted conclusion 含 `> 0`、`a|b` 时稳定通过。
- 相同命令重复执行不会出现一次通过、一次被拦。
- 未确认时业务 Edit/Write 和可写 Bash 仍被拒绝。
- compact 后 `feature-check <id> --finish` 可运行并通过 finalized 校验。

#### 不要做

- 不增加任意 Bash 通用白名单。
- 不靠继续补 case pattern 处理每一种命令写法。
- 不允许带管道、重定向或多命令拼接的控制命令获得特权。

### P0-4：建立敏感配置的证据边界

#### 当前缺口

风险标签和 security review 关注业务安全，但 dev-flow 没有限制流程本身如何读取和记录 `.env*`、`.dev.vars` 或 secret。第二份记录因此把配置值带入命令、会话和过程说明。

#### 最小改法

在流程契约中增加一条全局证据不变量，而不是新建一套 secret 工作流：

```text
流程资产、status evidence、命令参数和最终报告只允许记录 secret 名称、来源类别与 presence/missing；禁止记录或转写 secret value。
```

配套修改：

- `security.md` 与 dev-flow 分类探查：敏感配置只检查变量名和是否存在，不读取值。
- status/feature-check：对新增流程资产扫描常见 secret 赋值形态；命中时 FAIL 并只报告文件和键名。
- smoke fixture：模拟 `.env.local` 存在真实值，执行结果只能出现 `XUNFEI_API_SECRET: present`，不能出现值。

#### 验收

- 风险卡、risk evidence、manual-test 和 completion 均不包含 secret value。
- 仍可验证变量是否存在、是否已配置以及运行时是否能连接。
- 不把宿主项目所有 `.env*` 纳入版本管理或流程资产。

### P1-1：收紧分类停止条件，稳定 S/M 判断

#### 当前缺口

当前分类说明已经写明 M 是“功能内多个协同步骤/状态/错误分支”，但执行时仍容易用“文件少、单模块、对外契约不变”直接判 S。

#### 最小改法

保留零资产分类探查，只增加两个有停止条件的强信号：

- 同一行为需要两个及以上状态生产者/消费者保持一致，例如 cookie、API response、client store、middleware、UI；即使文件都在一个功能目录，也至少是 M。
- 外部协议替换同时改变鉴权、会话状态、结束语义或错误分派中的两个及以上环节，即使浏览器侧契约不变，也至少是 M。

探查仍然只做一跳影响面：列出状态的写入点、读取点和清理点；全部局部且无协同后立即停止，不扩大为全仓调用图。

#### 验收

- 匿名登录任务稳定得到 M + security，不需要用户追问后重分级。
- RTASR fixture 按“签名 + session + end + error”多状态协同得到 M + external/money。
- 单文案、局部样式、私有纯函数修复仍为 XS/S，不触发一跳搜索。

### P1-2：增加面向路线的 `start`、`explain` 和 `next`

#### 当前缺口

status CLI 直接要求模型提供 profile、topology、evidence-result、entry-gate 等内部字段，通用 `--help` 又只列语法，不给合法组合。模型只能通过多次失败学习枚举值。

#### 最小改法

在现有 CLI 上增加三个高层入口，底层 schema 命令继续保留给调试和迁移：

```text
dev-flow-status explain --level M --risk-labels security --clarity clear
dev-flow-status start <feature-id> --level M --risk-labels security --topology shared-contract
dev-flow-status next <feature-id>
```

- `explain` 只读输出派生 route、必需 gate、资产上限和 start 示例。
- `start` 由 policy 推导 profile、entry gate 要求和初始 next_action，一次完成 init + activate，避免半初始化。
- `next` 输出当前 gate、阻塞原因和一条可复制的下一命令。
- 每个子命令拥有独立 help；错误一次性列出全部缺失参数和合法组合，不逐个失败。

#### 验收

- 两份记录从分类到 HUMAN GATE 前均不超过 3 个控制命令。
- 不再出现先试 `--feature-id`、再猜 topology、再猜 evidence-result 的序列。
- 高层命令完全由 `dev-flow-policy.mjs` 派生，不复制第二套路由判断。

### P1-3：light gate 全部使用 inline 证据

#### 当前缺口

`risk-gates.md` 定义 light 只需 inline，真实执行却为 rollback light、code-review light 和 verification light 分别创建文件，最后 compact 又删除。

#### 最小改法

- light rollback/security/code-review 统一写入 status 的结构化 `gate_evidence.inline`。
- light verification 记录命令、关键观察和最多 3–5 个行为步骤；只有需要用户离线执行时才创建 reusable `manual-test.md`。
- full gate 才要求独立报告。
- completion 由 CLI 从 status 提炼长期摘要，不要求模型重新抄写。

#### 验收

- risk-minimal XS/S/M 的默认长期资产只有 `completion.md`，需要功能说明时再加 `feature.md`。
- 活动期最多一个 `status.md`；无用户离线手测时不创建 review 文件。
- full security/rollback/behavior verification 的独立报告规则保持不变。

### P1-4：把 `/finish` 变成可恢复编排器

#### 当前缺口

当前 Layer 3 只由自然语言命令编排，completion schema、manual-test 七列表和 AR 段都由模型手工拼装。validator 很严格，但生成端不提供模板，因此收尾必然反复试错。

#### 最小改法

新增单一 Layer 3 编排命令，例如：

```text
dev-flow-finish prepare <feature-id>
dev-flow-finish resume <feature-id>
```

职责限定为调用现有 Layer 2，不把校验逻辑复制进去：

1. 读取 policy/status，输出缺失 gate。
2. 自动生成或更新 schema 正确的 completion、manual-test 和 partial-acceptance 骨架。
3. 有 pending 手测时停在用户验证或 partial acceptance，不自动写 skipped。
4. 验证闭环后运行 feature-check，生成 final assets，再执行 finalizer dry-run。
5. 每次中断都可由 `resume` 从 status.next_action 恢复。

#### 验收

- completion frontmatter 和 `## AR-xxx` 不再由模型自由拼写。
- pending 手测不会因为执行 `/finish` 自动变 partial。
- 相同状态重复运行 prepare/resume 幂等，不重复资产、不重复 gate。
- 收尾失败只报告一个真实阻塞点和下一动作。

### P1-5：修复 compact 后检查和 doctor 误报

#### 最小改法

- finalizer confirm 成功后输出明确的 finalized 状态；feature-check 在无 active status、存在合法 completion 时走 finalized validator，且不依赖 write authorization。
- doctor 的 workflow-version 单源扫描排除受 validator 管理的 feature completion，或只扫描迁移包受管路径；completion 中 contract 要求的版本不是“流程源码硬编码”。
- finalizer、feature-check、finish-guard 和 doctor 共用同一个“active / logic-complete / finalized”状态判定函数或 fixture，不各自解释。

#### 验收

- compact 后 finalized feature-check 一次成功，不需要重试或改跑 doctor。
- 合法 completion 不触发 workflow-version hardcode FAIL。
- 真正在 SKILL、command 或模板中硬编码版本仍被 doctor 捕获。

### P1-6：路线说明从 policy 生成，避免第三份规则源

#### 当前缺口

当前权威已经分布在 contract、policy、SKILL 和 references。工作区新增的“各级别实现路线与进度判断”又把完整路线复制到用户指南，形成第三份需要人工同步的详细路线。

#### 最小改法

- contract + policy 保持唯一机器权威。
- README 只保留一屏路线速查。
- 完整路线表由 `dev-flow-policy` 对固定场景生成，并由测试校验文档快照；指南只解释 HUMAN GATE、status.next_action 和 light/full 的含义。
- 每新增一段路线 prose，必须删除或替换另一处重复定义；doctor 继续执行行数预算。

#### 验收

- 修改某条 gate 后，只改 contract/policy 和测试，路线快照自动更新或明确失败。
- SKILL 不再重复列完整标准 M/L 步骤。
- README、guide、status.next_action 对同一场景不会给出不同下一步。

### P2-1：固化真实场景回归与摩擦预算

在现有 status/hooks/finalize 测试之外增加两个端到端 fixture：

#### Fixture A：M + security 的匿名登录边界

期望：

- 分类为 M + security；
- 走 `risk-minimal-m`；
- 一个 implementation approval；
- 不需要 requirement confirmation、writing-plans 或 plan-review；
- 行为验证和 code-review 后 feature-check 通过；
- 无事后补资产。

#### Fixture B：M + external/money 的外部协议升级

期望：

- quoted 风险证据含 shell 元字符仍能登记；
- rollback light 内联；
- pending 真实行为验证时 `/finish` 停止；
- 没有用户接受，不得生成 AR 或 partial check-ok；
- 用户明确接受后可生成 partial；
- compact 后 finalized check 通过，doctor 无误报；
- 流程输出中只出现 secret key 名称，不出现值。

#### 摩擦预算

将下面的预算作为回归目标，不写进每条 skill prose：

| 指标 | risk-minimal XS/S/M 目标 |
|---|---:|
| 分类到 HUMAN GATE 的控制命令 | ≤ 3 |
| 实现前用户停顿 | 1 次 |
| 默认活动 Markdown 资产 | `status.md` 1 份 |
| 无离线手测时的 review 文档 | 0 |
| completion 格式试错 | 0 |
| compact 后最终检查重试 | 0 |

## 6. 建议实施顺序

1. **先修 P0-1 与 P0-3**：让 M + risk 有合法路线，并消除 Hook 自锁；否则后续场景测试无法稳定执行。
2. **再修 P0-2**：加入 baseline/retrospective 和 partial acceptance 时序，封住事后补证与代理代确认。
3. **随后修 P1-2、P1-3、P1-4**：用高层 CLI 和生成器降低流程成本，不改变已锁定的风险强度。
4. **最后修 P1-5、P1-6，并落地 P2 fixture**：收敛文档来源，确保 compact、doctor 和指南不会再次漂移。
5. **P0-4 与上述修改同批加测试**：它是一条跨路线证据不变量，不需要独立 profile 或新工作流。

## 7. 本轮明确不做

- 不删除高风险任务的 implementation approval。
- 不把 risk-minimal 升级成标准 M/L 的全套需求和计划治理。
- 不为每种风险标签新增路线、状态文件或文档模板。
- 不引入新的通用任务系统、数据库或远程审批服务。
- 不把所有 Bash 加入白名单，也不削弱受保护业务写入门禁。
- 不用更多提示词修补 CLI、Hook 和 validator 已能机器解决的问题。
- 不维护多份手写路线真相源。

## 8. 完成判据

本轮优化完成应同时满足：

1. 两份真实记录可由端到端 fixture 一次走通，不再需要用户纠正分级、路线或下一 CLI。
2. M + risk 不被迫进入 standard M，也不能绕过 implementation approval 和行为验证。
3. 任何前置 gate 都不能在业务实现后通过补文件伪装成按时完成。
4. 任何 residual risk 都必须有 HUMAN GATE 之后的用户明确证据。
5. light 路线不再生产随后立即 compact 删除的一组中间报告。
6. `/finish`、compact、finalized check 和 doctor 形成单向、幂等、无误报的闭环。
7. 新增规则主要落在 contract/policy/CLI/test，SKILL 和指南总量不因修复这些案例继续增长。
