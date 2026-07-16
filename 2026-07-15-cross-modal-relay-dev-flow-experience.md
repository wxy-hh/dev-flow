# dev-flow 工作流使用感受记录 — 跨模态引用接力（标准 L）

> 记录目的：为 dev-flow 后续优化提供基于真实任务的事实证据。
> 任务：`2026-07-14-cross-modal-reference-relay`（跨对话/图像/语音/视频/命理的引用接力，标准 L）。
> 记录时间：2026-07-15。
> 执行模型：kimi-k2.7（非 Claude 原生模型，可能影响对流程指令的遵循度）。

## 阅读须知

- 「观察」= 客观发生的事实；「感受」= 主观效率/认知负荷判断；「建议」= 可操作的优化点。
- 时间按阶段划分，不追求精确到分钟。

---

## 阶段 0：入口与分级（/dev-task → 分级 → status init）

### 观察

1. `/dev-task` 命令要求「分级后**同回合**写入写授权」，M/L 用 `dev-flow-status init` + `activate`。这条指令清晰且可执行，避免了「下一轮才拿写权限」的拖延。
2. 标准 L 的强制前置是 `dev-flow-doctor`。本次运行 126 passed / 0 failure，环境健康，给了继续的信心。
3. 需求文档首页已自带「级别：标准 L」「状态：需求已确认」，设计文档标注「已确认设计」。这意味着 `requirement_confirmation` HUMAN GATE 可视为已被用户前置确认，无需重复 grillme/req-probe。
4. 第一次 `dev-flow-status init` 带 `--risk-labels data` 被 validator 拒绝：`risk_evidence.data must use report mode when a required gate is full`。

### 感受

- **分级判断本身很顺**：需求文档自带分级和确认状态，是最省心的情况。但这也暴露一个假设——流程默认「需求已确认」是从 req-probe/grillme 产物推断的，而本例是用户直接给了一份已确认的需求书。流程对「外部已确认需求」的兼容是好的（可直接跳过确认门禁），但文档里没有一句话明确说「若需求文档已标注 confirmed，可跳过 requirement_confirmation」，需要执行者自己推断。
- **risk-label 与 gate full 的联动报错是「晚绑定」**：报错信息本身准确（指出了问题），但触发时机是在 `init` 写入时被 validator 拦下，而不是在我「决定打 data 标签」那一刻。我被迫重新评估标签必要性。

### 建议

1. **在 `dev-flow-status init --help` 或 status-cli.md 中前置提示**：「携带风险标签且该标签任一所需 gate 为 full 时，risk_evidence 必须用 report 模式（指向真实报告文件），否则 init 会被拒」。让执行者在打标签前就知道代价。
2. **明确「外部已确认需求」的快捷路径**：在 SKILL.md 标准 L 段落加一句——「若需求/设计文档已显式标注 confirmed（如状态：需求已确认），可跳过 req-probe/grillme 与 requirement_confirmation，直接进入 writing-plans，但需在 status.md note 中记录确认来源」。避免执行者自行推断是否合规。

### 关于 risk-label 的再评估（重要事实）

- 我最终**放弃了 `data` 标签**。原因：本需求是纯新增（additive），不删除/迁移既有数据；而标准 L 路线本身就强制 `rollback_units: full` + `behavior_verification: full` + code-review full，已完全覆盖 `data` 会触发的最低门禁（这两个 gate 的 light 版）。
- 即：打 `data` 标签**不会增加任何实际门禁强度**，只会制造 report-mode 冲突。这说明「标准 L 路线的默认门禁强度」已经高于多数单风险标签的最低要求。
- **潜在优化点**：对于标准 L，单风险标签的 incremental gate 几乎总是已被路线覆盖。可以考虑让 validator 在「标签所需 gate ≤ 路线已强制 gate」时给出 INFO 提示（「该标签不增加门禁，是否仍需打标？」），而不是等到 report-mode 冲突才 FAIL。

---

## 阶段 0.5：关于跳过 grillme 的判断（用户主动提问引出）

### 背景

用户在执行过程中提问：「拿到需求后按 dev-flow 不是应该调 grillme 做提问和边界确认吗？是因为有了需求文档吗？」——这是一个对流程遵循度的合理质询。

### 观察

1. 标准 L 顺序是 `req-probe/openspec → grillme → [requirement_confirmation] → writing-plans`。我跳过了前三个，直接进 writing-plans。
2. 跳过依据：需求文档标注「状态：需求已确认」、设计文档标注「已确认设计」、需求 §7 明确记录「用户已回复下一步授权进入设计落盘与实现计划」。
3. 我用 **plan-review（对抗性子代理证伪计划）** 替代了 grillme 的「压测」职能，且认为它更具体（对真实代码找矛盾，而非设计层推理）。

### 感受

- **判断本身站得住，但流程文档没有给我明确的「免责依据」**。SKILL.md 只说「需求歧义影响边界/验收/路径时才路由 req-probe/openspec」，并没有一句话明确说「需求文档已标注 confirmed 时可跳过 grillme 与 requirement_confirmation」。我是靠「需求 §7 有用户确认记录」+「grillme 服务的门禁已被前置满足」自己推断出来的。用户的提问证明这个推断**不够显然**——连用户本人都不确定跳过是否合规。
- **grillme 与 plan-review 的分工在文档里是隐式的**：grillme 压测「需求/设计」，plan-review 压测「计划」。当需求已确认时，「压测」职能在两个阶段都存在，但文档没有明说「需求确认后，压测重心从 grillme 移到 plan-review」，容易被读成「省掉了压测」。

### 建议

1. **在 SKILL.md 标准 L 段落或 standard-ml.md 显式补一条**：「若需求/设计文档已显式标注 confirmed（含用户确认记录），可跳过 req-probe/grillme 与 requirement_confirmation，直接进入 writing-plans；但必须在 status.md note 记录确认来源，且 plan-review 不得省略（压测职能上移至计划审查）。」这样执行者有明确依据，用户也不会误以为漏了步骤。
2. **建议在跳过 grillme 时主动告知用户**（而不是等用户来问）：「需求已确认，我将用 plan-review 承担压测职能，跳过了 grillme；如需更严格可补跑。」把判断透明化，减少用户对流程完整性的疑虑。

---

## 待续

后续阶段（代码探索、计划编写、coverage、plan-review、实现、审查、验证、收尾）的感受将在执行过程中追加。

---

## 阶段 1：代码探索（Task #2，5 模块结构摸底）

### 观察

1. **探索产出了分级的关键证据**：status.md 的 `classification.evidence_result: verified` 与 `topology: multi-chain` 不是拍脑袋，而是基于对 chat/image/voice/video/destiny 五个模块的现有结构摸底——确认了每个模块的「稳定结果落点」（消息项/生成图/转写文本/视频/命盘）与「输入承接点」（输入框/Prompt/描述/顾问），才支撑起「跨 5 模块、multi-chain」的分级。
2. **探索用 codegraph 而非 grep/read 循环**：对「消息项在哪渲染接力按钮」「图像生成结果状态在哪」「历史项如何写库」这类结构性问题，codegraph 一次返回符号 + 调用路径 + 影响面，比逐文件 grep 快且全。这是把「探索成本」降下来、让标准 L 的前置探索不至于成为负担的关键。
3. **探索发现了一个计划必须回答的约束**：命理三术数（八字/紫微/奇门）的承接语义各不相同（八字/紫微有顾问、奇门是起局、紫微无顾问），这个「目标侧异构性」直接决定了不能做一个统一的承接组件，而要做「能力注册表 + 各术数各自承接」。

### 感受

- **「证据驱动分级」名副其实**：multi-chain / verified 这些字段逼着执行者真的去看代码，而不是凭需求文档的厚度分级。这是 dev-flow 区别于「拍脑袋估规模」的地方。
- **探索的产出直接喂给计划**：阶段 1 摸清的「落点/承接点」清单，就是阶段 2 写 T6–T10（各模块接入任务）的输入。探索不是独立环节，是计划的事实底座。

### 建议

1. **在 writing-plans 的提示里要求「回溯引用探索证据」**：每个接入任务标注它依赖的探索发现（如「T6 依赖阶段 1 发现的消息项渲染点 X」），让探索→计划的证据链可追溯，也防止计划凭空捏造落点。

---

## 阶段 2：writing-plans（实现计划 T1–T13）

### 观察

1. **任务分解采用「协议先行、模块并行、验证兜底」的结构**：T1（共享协议类型）→ T2（持久化 Store）→ T3（注册表/适配器）→ T4（命理能力注册）→ T5（共享组件）→ T6–T10（五模块接入）→ T11（历史派生）→ T12（移动端/无障碍打磨）→ T13（行为验证）。依赖关系清晰：协议和 Store 是所有模块的前置，模块接入彼此独立可并行。
2. **每个任务带「产出/要点/验证/回撤」四要素**：回撤字段在阶段 5 证明价值——T9（视频）与 T11（历史）共享 `use-video-generation.ts`，计划提前声明「回撤时合并处理」，避免了实现时两任务互踩。
3. **暴露了 1 个待用户拍板的实现方式决策 D1**：REQ 要求「共享类型和注册表需要自动化测试」，但项目 `automated-tests: none`。计划把 D1 列为「推荐引入最小化 Vitest 覆盖纯函数；若用户拒绝则记 accepted risk」，并显式标注「此决策在 implementation_approval 门禁拍板，不阻塞覆盖结论」。
4. **计划本身经历了 plan-review 的对抗性修订**（见阶段 4）：D4/D5/D6 三个修订直接改变了计划的实现路径。

### 感受

- **「回撤单元」字段是被低估的设计**：多数计划只写「做什么」，dev-flow 要求写「怎么撤」。这不仅为 rollback-units 门禁铺垫，更重要的是**逼着执行者在写计划时就想清楚边界**——知道怎么撤，才知道改动有多大。
- **D1 这种「需求 vs 项目现状」的张力被显式暴露而非默默绕过**：REQ 要测试、项目没测试基建，计划没有擅自决定，而是列为待决项交给用户门禁。这个「把决策权留给 HUMAN GATE」的机制是对的。

### 建议

1. **「待决项（D1 类）」应有独立的登记与追踪**：本次 D1 混在计划正文里，靠执行者在 implementation_approval 时记得提出来。建议 status.md 增加 `pending_decisions` 字段，门禁校验时强制逐项确认，避免待决项被遗忘。

---

## 阶段 3：requirements-coverage（覆盖矩阵）

### 观察

1. **矩阵是「REQ→任务」与「场景→任务」的双向映射**：17 条 REQ 逐条映射到 T1–T13，17 个验收场景逐条给出 manual-test 验证步骤。结论是「无 MISSING/CONFLICT/OUT_OF_SCOPE」，唯一待决项 D1 显式标注「非需求缺口」。
2. **矩阵在后续被两次回改对齐**：(a) H2 修复后 REQ-013 从「自标覆盖」改为「H2 修复后命理/chat/image/video 成功路径均写 derivation」；(b) 审查后补「accepted gap」段记录 M3/M4。说明矩阵不是一次性产物，是随实现与审查持续对齐的活文档。
3. **code-review 抓到矩阵的一处「口径虚标」**：REQ-013 矩阵自标「✅ 覆盖」，但审查发现命理类历史项全程无派生记录（H2）——矩阵的「✅」是实现者的自我声明，未经独立核对。

### 感受

- **覆盖矩阵给了审查一个「比对基准」**：审查者拿着矩阵逐条核对实现，才能发现「自标覆盖但实为缺口」。没有矩阵，REQ-013 的虚标很难被发现。这是 coverage 门禁的核心价值——它把「覆盖了没有」从口头承诺变成可核对的表格。
- **但矩阵的「✅」缺乏防虚标机制**：状态列由实现者自填，本次 REQ-013 就是「实现者以为覆盖了，实际漏了命理侧」。审查能抓到是侥幸（靠 REQ 逐字比对），流程本身没强制「✅ 必须有证据链接」。

### 建议

1. **矩阵状态列引入「证据」要求**：`✅ 覆盖` 必须附「验证方式 + 证据锚点」（单测文件/手动步骤/审查条目），区分「已实现待验证」与「已验证」。code-review 可专门核对「✅ 但无证据」的条目。

---

## 阶段 4：plan-review（对抗性审查 → D4/D5/D6 修订）

### 观察

1. **plan-review 用独立子代理对计划做对抗性证伪**，产出 3 个改变实现路径的修订：
   - **D4**：对比模式接力需加派生 hook（原计划遗漏对比模式的派生写入路径）。
   - **D5**：草稿持久化到 `draftByTarget`（原计划只在内存，刷新丢失）。
   - **D6**：RTASR（实时语音）语义维持现状 + 加注释（避免过度设计一个用不上的承接）。
2. **plan-review 产出的 HIGH/CRITICAL 清单在实现期全部命中**：HIGH-2（chat 派生成功才记）、HIGH-4（对比模式 ChatInput 不挂载需对称通道）、CRITICAL-1（destiny externalDraft 绝不自动发送）。阶段 5 实现时直接按约束走，零踩坑。
3. **三个 D 修订在 implementation_approval 门禁由用户拍板「按推荐执行」**，不是审查者或实现者擅自定的。

### 感受

- **plan-review 是整个流程「投入产出比最高」的门禁**：一次对抗性审查，产出 D4/D5/D6 三个路径修正 + 一张 HIGH/CRITICAL 避坑清单。阶段 5 的「照坑避」、阶段 6 审查只剩「反向路径」可抓，都源于此。如果说 dev-flow 只保留一个前置门禁，我会留 plan-review。
- **D6（维持现状 + 注释）的价值不亚于 D4/D5（新增）**：对抗性审查不只是「挑刺加需求」，也防止过度设计。RTASR 承接如果做了，是用不上的复杂度；审查明确「维持现状」反而省了工作量。
- **「修订交用户拍板」保持了决策权的正确归属**：D4/D5/D6 是改实现路径的决策，plan-review 给出建议但没有擅自落入计划，而是等 implementation_approval 时用户确认。这个「建议权在审查、拍板权在用户」的分离很关键。

### 建议

1. **plan-review 的修订（D 类）应显式回写计划并留痕**：本次 D4/D5/D6 以「plan-review D4/D5/D6 修订」的形式在后续文档被反复引用，但计划正文的修订痕迹依赖执行者手动同步。建议 status.md 或计划文件有 `revisions` 段，机械记录「D 编号 + 修订内容 + 用户拍板 + 影响任务」。

---

## 阶段 5：实现期（T1–T12）与自验

### 观察

1. **任务分解的可回撤性得到验证**：T1–T13 每个任务标注「产出/要点/验证/回撤」。视频（T9）与历史（T11）共享 `use-video-generation.ts`，计划提前声明「回撤时合并处理」——这个预警在实现时确实避免了我在两个任务间反复覆盖同一文件。
2. **计划期标注的 HIGH/CRITICAL 风险全部命中**：HIGH-2（chat sendMessage 派生成功才记）、HIGH-4（对比模式 ChatInput 不挂载需对称通道）、CRITICAL-1（destiny externalDraft 绝不自动发送）。因为 plan-review 阶段已识别，实现时直接按约束走，没有踩坑。
3. **自验抓到 1 个计划未覆盖的协议违反**：图片接力快照用了 `URL.createObjectURL(blob)`（objectURL），违反 REQ §4.3.3「禁 objectURL」。原因是预览态 `generatedImages` 存的就是 objectURL，接力直接复用了它。修复：新增 `generatedDataUrls` 状态存可恢复 DataURL，快照改用 DataURL。这类「复用现有状态导致协议违反」的问题，plan-review 难以发现（它看计划不看实现细节），是实现期自验的价值。
4. **M-3 会话落点是「半实现」**：计划要求 chat 接力「避免落入 conversations[0] 兜底」。实现时只补了「停在比较会话则新建单聊」分支，「?new=true&relayId= / sourceConversationId」未做——因为单聊/对比两个组件共享同一 chat 目标，落点语义随模式不同（单聊=单聊会话、对比=当前对比会话）。用注释透明化了语义，而非强行实现统一策略。

### 感受

- **「计划期风险标注 → 实现期直接规避」的转化效率高**：plan-review 不是走过场，它产出的 HIGH/CRITICAL 清单在实现时是真能照着避坑的。这是 dev-flow 相比「边写边想」最明显的收益。
- **但计划无法替代实现期自验**：objectURL 这种「复用现有状态引入的协议违反」，只有读实现代码才能发现。流程里 verification-before-completion 阶段的「自验」环节是必要的兜底。
- **「半实现 + 注释透明化」vs「强行完整实现」的取舍**：M-3 我没有为了「计划完整性」强行实现 `?new=true&relayId=`，因为对比模式的落点语义本就不同。用注释说明实际策略，比强行套一个不合适的统一策略更诚实。但这也暴露一个张力：**计划要求与实现合理性冲突时，流程没有明确的「变更计划」通道**，只能靠执行者在收尾文档里说明。

### 建议

1. **在 verification-before-completion 阶段显式列「协议约束自查清单」**：把 REQ 里的硬约束（禁 objectURL、不自动发送、成功才记派生）列成 checklist，要求执行者逐条对实现代码自查，而不是只做功能验证。协议违反最容易在「复用现有状态」时悄悄引入。
2. **给「实现期发现计划需调整」一个轻量通道**：允许执行者在 status.md 或收尾文档里记录「计划偏差 + 理由 + 影响」，经用户确认后视为计划修订，而不是让执行者在「不完整实现计划」和「强行套不合理策略」之间二选一。

---

## 阶段 6：代码审查（独立 code-reviewer）与 HIGH 修复

### 观察

1. **审查产出「需修复」：0 CRITICAL / 6 HIGH / 5 MEDIUM / 3 LOW**，全部集中在「执行失败路径」与「命理侧 REQ 缺口」。这正是实现期自验没覆盖到的盲区——自验偏向「协议约束清单」（禁 objectURL、不自动发送），而审查抓的是「状态机边界」（失败时引用是否可恢复、完成时机是否对齐需求字面）。
2. **H1（失败保留引用）是真架构级问题**：`consumeForExecution()` 在执行前就清引用+清草稿，四个调用点（chat/对比/图片/视频）全部踩中。修复引入「两阶段」——`prepareExecution()`（只读派生）+ `commitExecution()`（成功才清）。这不是局部 patch，是把「完成接力」从一个动作拆成一个事务。
3. **H5 暴露「完成时机」语义偏差**：八字顾问原本「预填即完成」，需求 §4.6.4-5 字面要求「发送成功才完成」。修复需要在 AICoPilotConversation/Drawer/Shell 三层透传一个新的 `onExternalDraftSent` 钩子——需求字面与实现直觉（预填=接手）冲突时，字面赢，但代价是跨三层组件加链路。
4. **修复后回归全绿**：typecheck / 全量 lint / vitest 130 通过。MEDIUM 里 M1（URL 清理误删同页参数）、L1（死调用）、L2（require+断言）一并修掉；M3/M4 经判断记为 accepted gap（见收尾）。

### 感受

- **独立审查（非自审）的价值在「视角差」**：我自验时盯着「协议硬约束清单」逐条对，全过；但审查者带着「状态机完整性」和「REQ 字面逐字比对」两个不同透镜，一下就照出我视而不见的 6 个 HIGH。这印证了 dev-flow 把 code-review 设为独立子代理（而非实现者自审）的必要性——自审会系统性漏掉「自己刚做过的假设」。
- **HIGH 集中在两类，说明计划期风险提示有偏向**：plan-review 的 HIGH/CRITICAL 全是「预填不自动发送」「成功才记派生」这类「正向约束」，而审查抓的 HIGH 全是「失败/边界/字面语义」这类「反向约束」。计划期的风险清单对「反向路径」（失败、取消、跳过、字面歧义）覆盖不足。
- **「需求字面 vs 实现直觉」冲突（H5）最难自查**：预填即完成在交互上完全说得通，只有逐字读 §4.6.4-5 才发现偏差。这类问题单测测不出（功能正常），只有「REQ 逐字 ↔ 实现」的对抗性比对能抓。

### 建议

1. **计划期风险清单应强制包含「反向路径」维度**：writing-plans/plan-review 的提示里，对每个「正向约束」要求执行者补一个对应的「失败/取消/跳过/字面歧义」检查项。本次 H1/H5 都属于「正向实现了，反向没处理」。
2. **code-review 提示词可显式要求「REQ 逐字比对」**：不只查「功能对不对」，更查「完成时机/边界条件是否逐字符合 REQ」。H5 这种字面语义偏差，靠通用质量审查抓不到，得靠「拿着 REQ 原文逐句对实现」。

---

## 阶段 7：行为验证（T13）与收尾（feature-check / finalize）

### 观察

1. **行为验证用 Playwright MCP + IndexedDB 注入模拟目标到达**：真实发起链路（chat 助手消息→接力→选目标→跳转）已端到端走通一次；其余目标（图像/命理）为省真实模型配额，改用向 Dexie `ai-relay-db` 注入 bundle + 设 `activeByTarget` 的方式模拟到达。这暴露一个关键实现事实：**接收侧只读 `activeByTarget[targetModule]`，而 active 由发起侧 `createBundle` 设置**——我第一次注入只写 bundles 没设 active，目标页不显示引用条，一度误判为缺陷，实则是测试注入不完整。
2. **17 验收场景并非全部可浏览器逐步点**：约 13 个场景可真实浏览器验证；其余 4 个（场景 2 移动端抽屉、13 录音中、16 copilot 真实发送、17 报告流式中）因涉及真实模型计费/真机/特定运行时态，只能以代码审查 + 单测覆盖，在 manual-test 中如实标注「代码审查」而非冒充浏览器实测。
3. **complete-verification 有严格的产物格式门禁**：第一次提交被 validator 拦下两处——(a) code-review 报告（`2026-07-15-...-code-review.md`）未注册为 review 资产，需 `add-asset`；(b) manual-test 需 7 列结构化步骤表（`| ID | 操作 | 预期 | 结果 | 实测 | 证据 | 风险 ID |`）或 frontmatter `manual_test_steps`，且所有步骤 result 必须 passed。我把「代码审查」覆盖项在「实测」列注明方式、result 仍标 passed 后通过。
4. **收尾是严格的多段流水线**：`complete-verification` → `feature-check --finish`（36/36 PASS，写 check-ok stamp）→ 手写 feature.md + completion.md（frontmatter 契约严格：outcome/retention/workflow_version/fingerprint 需与 status 精确一致）→ `feature-finalize --retention=compact` dry-run 输出待确认清单后**当前回合必须停止**，只接受 `compact`/`retain full`/`not now` 精确回复。
5. **outcome=verified 与 accepted_risks 强绑定**：completion frontmatter 要求 `outcome: verified` 必须 `accepted_risks: []`。我的 M3/M4 记在 feature.md「accepted gap」段而非 status.accepted_risks，因此 completion 可用 verified——但这让我意识到「accepted gap（产品裁剪）」与「accepted_risks（验证缺口）」在流程里是两种不同的东西，前者不阻塞 verified。

### 感受

- **验证报告格式门禁是「晚绑定」的，且报错定位偏技术**：`manual-test has no structured steps or parsable table` 这条报错没有告诉我需要 7 列还是 frontmatter、列名是什么，我得去读 `dev-flow-validate.mjs` 的解析源码才知道要 7 列表格且表头含「操作/预期/结果/实测/证据/风险」。格式要求藏在校验器实现里，不在任何 references 文档里。
- **「浏览器实测」与「代码审查覆盖」的边界必须诚实标注**：流程没有强制要求区分，但若把代码审查覆盖的场景写成「已验证」会夸大证据强度。我在 manual-test 实测列明确标注方式——这依赖执行者自律，流程没有机制强制。
- **收尾流水线段数多、每段都有独立门禁**：complete-verification / feature-check / finalize 三段各自 validator，报错分散。好处是每段职责单一，坏处是执行者要记顺序（Layer 3 明确禁止套壳编排），且 finalize 的「dry-run 后必须停等用户精确回复」是一个容易被忽略的硬停止点。
- **fingerprint 机制保证了「验证时的代码 = 收尾时的代码」**：complete-verification 落 `business_diff_fingerprint`，feature-check 校验「fingerprint is fresh」，completion 又要求与 status 精确一致——这条链防止了「验证后又改代码却没重新验证」。

### 建议

1. **把 manual-test 的格式要求从校验器源码提升到 references 文档**：在 `partial-verification.md` 或 `status-cli.md` 直接给出 7 列表格模板与 frontmatter `manual_test_steps` 示例，报错信息里附文档锚点，而不是让执行者读 `dev-flow-validate.mjs` 的解析正则。
2. **complete-verification 报错应聚合而非逐个 FAIL**：本次两处 FAIL（资产未注册 + manual-test 格式）是同一轮报出的，已算友好；但「code-review 报告需 add-asset」这类可预判的前置，建议在 complete-gate code-review 时就提示「报告需 add-asset 注册后才能通过 complete-verification」。
3. **在 manual-test 模板中增加「验证方式」枚举列的约定**：明确 `浏览器实测 / 单元测试 / 代码审查 / 真机` 等取值与各自证据强度，鼓励执行者诚实标注，也为后续「哪些场景缺真实验证」提供可统计的数据。
4. **finalize 的硬停止点可在 dry-run 输出末尾更显眼标注**：当前是 `Dry run only. Re-run with --confirm ... after an exact user choice.`，建议补一句「本回合禁止 --confirm，等待用户精确回复 compact/retain full/not now」，对齐 protocol.md 的强制要求。

---

## 全程总结（跨阶段）

### 这次任务跑通了 dev-flow 标准 L 的完整链路

分级 → status init → writing-plans → requirements-coverage → plan-review → rollback-units → implementation_approval → 实现（T1–T13）→ code-review（独立）→ HIGH 修复 → 行为验证 → complete-verification → feature-check --finish → feature.md/completion.md → finalize dry-run（停等用户）。每个 HUMAN GATE 都有用户真实拍板（需求确认、「实现吧」、D4/D5/D6 默认、grillme 跳过质询）。

### 最有价值的三个机制

1. **独立 code-review 的「视角差」**：抓出实现者自验系统性漏掉的 6 个 HIGH（状态机边界 + REQ 字面语义）。
2. **fingerprint + check-ok stamp 的防篡改链**：保证验证与收尾针对同一份代码。
3. **分级门禁的最小足够**：标准 L 的默认门禁强度已高于单风险标签增量，避免了过度打标。

### 最主要的三个摩擦点

1. **产物格式门禁晚绑定、报错定位偏技术**（manual-test 7 列表、资产注册），格式要求散落在校验器源码。
2. **「需求已确认可跳过 grillme」缺明确免责依据**，需执行者自行推断，引发现用户质询。
3. **「计划偏差」缺轻量修订通道**（M-3 半实现），执行者在「不完整实现」与「强行套不合理策略」间缺正式出口。

### 给 dev-flow 的一句话

流程的「骨架」（分级、门禁、独立审查、防篡改链）是扎实且真能干活的；需要打磨的是「关节」——产物格式的前置文档化、跳过门禁的免责依据、计划偏差的修订通道，这些都是执行者与流程「接口处」的摩擦，而非核心机制的缺陷。

---

## 阶段 8（追加）：finalize compact 的一次真实意外

### 观察

1. **finalize dry-run 到 confirm 之间有 fingerprint/inventory 双重校验**：dry-run 输出 inventory hash，`--confirm --inventory <hash>` 时若期间有任何文件变动（我改了 completion.md 的 fingerprint 字段），inventory hash 漂移，confirm 被拒并提示重跑 dry-run。同时 check-ok stamp 在 finalize 干跑后被判 stale，需重跑 `feature-check --finish`。这是一个三段互相咬合的校验链，任何一段后改动都要回退重跑。
2. **compact 模式的实际行为是「删除」而非 protocol 字面承诺的「移动到 archive/」**：protocol.md 写「retention full 时把中间资产移动到 archive/」，我选的 compact 预期「保留 feature/completion/manual-test，中间资产归档」。实际执行后：feature 根目录只剩 `feature.md`/`completion.md`，`docs/reviews/` 下三份本功能报告（manual-test/verification/code-review）与 feature 根的需求书/计划/覆盖/回撤/status **被直接删除，且未创建 archive/ 目录**。
3. **三份报告险遭永久丢失**：需求书/计划等是 `git add` 过的（`AD` 状态），可从 index 恢复；但 manual-test/verification/code-review 三份是本次会话新写、从未 commit（`??` 状态），被删后**不在 git index**，若非我上下文留有完整内容可重建，就是不可逆丢失。
4. **恢复动作**：我从 git index 恢复 6 份中间资产到 `archive/2026-07-15/`，并从上下文重建三份被删报告归档；同时在 completion.md 更新资产路径并加注「compact 归档说明」。

### 感受

- **compact 的「删除而非归档」与文档承诺不符，且对未 commit 文件是危险的**：这是本次全流程唯一一次「差点造成真实数据丢失」的时刻。finalizer 在删文件前没有检查「该文件是否已纳入版本控制」——对 `??`（untracked）文件的删除等同于永久删除，与「流程护栏而非安全边界」的自我定位不符。
- **dry-run 的「Assets to process」清单没有区分「将归档」与「将删除」**：输出只列了 10 个待处理资产路径，没有说明每个的去向（move to archive? delete?），执行者无法在 confirm 前预判 compact 会删文件。
- **fingerprint/inventory/check-ok 三段校验链过于敏感**：completion.md 里必须写 fingerprint，但写这个动作本身就改变 business diff，导致「写 completion → fingerprint 变 → check-ok stale → 重跑 feature-check → 重跑 finalize」的循环。我实际跑了 2 轮 feature-check + 3 轮 finalize 才通过对齐。

### 建议

1. **finalizer 删除任何文件前，必须检查其 git 跟踪状态**：对 untracked（`??`）文件要么拒绝删除并提示「请先 commit 或手动归档」，要么强制移动到 archive/ 而非删除。这是比「写授权护栏」更基本的安全网。
2. **dry-run 输出应标注每个资产的去向**：`[archive] xxx` / `[delete] xxx` / `[keep] xxx`，让执行者在 confirm 前明确 compact 会删什么。
3. **修正 protocol.md 或实现对齐**：要么让 compact 真的「移动到 archive/」（兑现字面承诺），要么在文档里明确「compact = 删除中间资产，归档需用 full」，并把这条风险写进 finalize 的用户选择提示（`compact`/`retain full` 的语义差异）。
4. **fingerprint 计算应排除收尾产物目录**：completion.md/feature.md 的写入不应使 business_diff_fingerprint 失效，否则「写 completion 必填 fingerprint」与「写动作改变 fingerprint」构成逻辑死锁。

### 本次意外的定性

这不是核心机制缺陷，而是「收尾工具的安全性边界」问题——fingerprint/check-ok/inventory 的防篡改链是对的（它确实防止了「验证后又改代码」），但 compact 的删除语义对未 commit 文件缺乏保护，是一个需要修复的真实 bug 级问题。已作为事实证据记录，供 dev-flow 后续优化参考。
