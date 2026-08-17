---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '27a2ee52-4279-4ea8-90c5-cb1801667fc4'
  PropagateID: '27a2ee52-4279-4ea8-90c5-cb1801667fc4'
  ReservedCode1: '49e34d78-3e0c-47a4-9f19-2e1cd16856b3'
  ReservedCode2: '49e34d78-3e0c-47a4-9f19-2e1cd16856b3'
---

# OpenSpec 深度技术调研报告

> 调研日期：2026-08-17
> 调研对象：Fission-AI/OpenSpec — 面向 AI 编程助手的规格驱动开发框架
> 数据来源：GitHub 官方仓库、官方文档、源码分析、社区技术文章

---

## 一、项目概览

| 维度 | 数据 |
|------|------|
| **GitHub 仓库** | https://github.com/Fission-AI/OpenSpec |
| **官网** | https://openspec.dev/ |
| **Stars** | 65.1k（截至 2026-08-17） |
| **Forks** | 4.5k |
| **Commits** | 777+ |
| **Issues** | 101 open |
| **Pull Requests** | 100 open |
| **许可证** | MIT |
| **主要语言** | TypeScript（98.7%） |
| **npm 包** | `@fission-ai/openspec` |
| **运行环境** | Node.js >= 20.19.0 |
| **发布时间** | 2025 年 8 月开源 |
| **最新活跃** | 持续活跃，2026 年 6-8 月仍有频繁提交 |

OpenSpec 由 **Fission-AI** 团队开发，是目前 GitHub 上最受关注的规格驱动开发（Spec-Driven Development, SDD）开源框架之一。其定位是"为 AI 编程助手设计的轻量级规格层"——在 AI 写任何代码之前，先让人和 AI 就"做什么"达成一致，并把这份共识写成结构化的 Markdown 文件。

---

## 二、核心理念与设计哲学

OpenSpec 的设计围绕四条哲学原则展开（来源：官方 README 与 `concepts.md`）：

### 2.1 流动而非僵化（fluid not rigid）

传统规格流程将你锁定在固定阶段：先规划→再实现→后收尾，一步不能乱。OpenSpec 明确反对这种硬性阶段闸门。其实现落点是"依赖是 enabler，不是 gate"——依赖关系只告诉你"现在能做什么"，而不强制"必须先做什么"。流程可以跳过可选环节，也可以并行推进。

### 2.2 迭代而非瀑布（iterative not waterfall）

需求会变，理解会加深。一开始看着对的方案，看到代码后可能就不成立了。OpenSpec 承认这种现实，允许随时回头修改任何产物。`design.md`、`tasks.md` 都能在实现过程中回改，而不是一次定死。

### 2.3 简单而非复杂（easy not complex）

有些规格框架要大量前置配置、严格格式、繁重流程。OpenSpec 主张几秒钟初始化、最小仪式感。对应"渐进严格"（Progressive Rigor）机制：默认用最轻的 Lite spec，只有高风险变更才升级到 Full spec，不为小改动强加官僚流程。

### 2.4 存量场景优先（brownfield-first）

大多数真实开发不是在白纸上从头搭建，而是在已上线运行的系统上做改动。OpenSpec 优先服务这种存量场景，催生了 **Delta Spec**（增量规格）设计——只描述"相对现状改了什么"，而不是重写整份规格。

---

## 三、工作流架构

### 3.1 两大组件架构

OpenSpec 由两个协同工作的组件构成：

**① CLI 引擎（跑在命令行里）**
- 程序名 `openspec`，负责初始化项目、解析 change 结构、校验、合并 delta、归档
- 是所有工具通用的规则中枢，无论用哪个 AI 助手，规则都一样

**② Slash 命令 / Skill（跑在 AI 对话框里）**
- 如 `/opsx:propose` 等命令，在聊天窗口输入，指导 AI 按 OpenSpec 流程工作
- Skill 本质是一份可被宿主发现并按需加载的工作流说明（Markdown 指令）

两者通过 `openspec init` 连接：在命令行运行它，把对话框要用的 skill/command 文件"安装"进 AI 工具。此后日常操作主要在聊天窗口完成。

**关键执行链路：**

```
你（在聊天框输入 /opsx:propose）
        │
        ▼
① Skill：聊天框里的入口（一份写给 AI 的 markdown 指令）
        │
        ▼
② AI：按 skill 指令，执行 openspec CLI 命令
   如 openspec new change / status --json / instructions --json
        │
        ▼
③ CLI 引擎：返回结构化数据
   哪些 artifact 就绪、用什么模板、写到哪个路径
        │
        ▼
   AI 据此写出 proposal.md / design.md / tasks.md 等文件
```

Skill 并不直接调用 CLI，真正发起调用的是"按 Skill 指令行事的 AI"。正因为隔着 AI 这层、且 Skill 只依赖 CLI 的稳定输出而非某个模型的内部行为，这套 Skill 才能跨模型、跨工具复用。

### 3.2 目录与文件体系

OpenSpec 的全部状态都落在项目的 `openspec/` 目录：

```
openspec/
├── specs/                          # source of truth：系统当前的行为
│   └── <domain>/
│       └── spec.md
├── changes/                        # 进行中的变更，每个 change 一个文件夹
│   ├── <change-name>/
│   │   ├── proposal.md             # why & what
│   │   ├── design.md               # how（技术方案）
│   │   ├── tasks.md                # 实现清单
│   │   ├── .openspec.yaml          # change 元数据
│   │   └── specs/                  # delta spec（本次变更的增量）
│   │       └── <domain>/
│   │           └── spec.md
│   └── archive/                    # 已归档的 change
│       └── YYYY-MM-DD-<change-name>/
└── schemas/                        # workflow schema 定义（可自定义）
```

**最关键的设计是 `specs/` 和 `changes/` 的分离：**
- `specs/` 是 source of truth，描述系统"现在"如何工作
- `changes/` 是提案，描述"想怎么改"，在归档前不会污染主规格

这种分离带来三个直接好处：多个 change 可以并行而互不冲突；change 在合并前可被独立 review；归档时增量干净地并入 source of truth。

### 3.3 Spec 的生成 → 驱动实现 → 验证全流程

**完整生命周期：**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              OPENSPEC FLOW                                   │
│                                                                              │
│   ┌────────────────┐                                                         │
│   │  1. START      │  /opsx:propose (core) 或 /opsx:new (expanded)          │
│   │     CHANGE     │                                                         │
│   └───────┬────────┘                                                         │
│           ▼                                                                  │
│   ┌────────────────┐                                                         │
│   │  2. CREATE      │  /opsx:ff 或 /opsx:continue                            │
│   │     ARTIFACTS   │  创建 proposal → specs → design → tasks               │
│   │                 │  （基于 schema 依赖）                                   │
│   └───────┬────────┘                                                         │
│           ▼                                                                  │
│   ┌────────────────┐                                                         │
│   │  3. IMPLEMENT  │  /opsx:apply                                           │
│   │     TASKS      │  按 tasks.md 逐项实现                                   │
│   │                 │◄──── 实现中可更新 artifact                             │
│   └───────┬────────┘                                                         │
│           ▼                                                                  │
│   ┌────────────────┐                                                         │
│   │  4. VERIFY     │  /opsx:verify（可选）                                   │
│   │     WORK       │  检查实现是否与规格一致                                   │
│   └───────┬────────┘                                                         │
│           ▼                                                                  │
│   ┌────────────────┐     ┌──────────────────────────────────────────────┐    │
│   │  5. ARCHIVE    │────►│  Delta specs 合并进主 specs                   │    │
│   │     CHANGE     │     │  Change 文件夹移至 archive/                    │    │
│   └────────────────┘     │  Specs 成为更新后的 source of truth            │    │
│                          └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Spec 如何生成：**

1. 用户输入 `/opsx:propose <change-name>` 或 `/opsx:explore`（探索式）
2. AI 调用 CLI 创建 change 骨架
3. 查询 artifact 依赖图，确定生成顺序
4. 逐个生成 artifact：proposal → specs（delta）→ design → tasks
5. 每写完一个 artifact，重新查询状态，直到所有 `applyRequires` 完成

**Spec 如何驱动实现：**

1. 用户输入 `/opsx:apply`
2. AI 读取 `tasks.md` 中的实现清单
3. 逐个完成 task，写代码、建文件、按需跑测试
4. 完成一项就把 checkbox 标成 `[x]`
5. 进度记录在 `tasks.md` 的 checkbox 里，中断后可续跑

**Spec 如何验证：**

通过 `/opsx:verify`（expanded profile），在三个维度检查：
- **Completeness**：所有 task 完成、所有 requirement 有对应实现、scenario 被覆盖
- **Correctness**：实现符合 spec 意图、边界情况被处理
- **Coherence**：design 决策在代码中体现、命名与模式一致

---

## 四、关键特性深度分析

### 4.1 状态机与门禁机制

**Artifact 依赖图（DAG）——OpenSpec 的核心引擎**

OpenSpec 内部维护一张 artifact 依赖有向无环图（源码在 `src/core/artifact-graph/`），由 schema 配置定义。默认的 `spec-driven` schema：

```yaml
name: spec-driven
artifacts:
  - id: proposal
    generates: proposal.md
    requires: []                 # 无依赖，可最先创建
  - id: specs
    generates: specs/**/*.md
    requires: [proposal]
  - id: design
    generates: design.md
    requires: [proposal]         # 与 specs 并列，都只依赖 proposal
  - id: tasks
    generates: tasks.md
    requires: [specs, design]    # 需要 specs 和 design 都就绪
```

依赖图结构：
```
        proposal
        /      \
     specs    design
        \      /
         tasks
```

**引擎分工：**
- **resolver**：比对每个文件的当前状态，计算每个 artifact 是 `done`（已完成）、`ready`（依赖齐了可以做）还是 `blocked`（依赖没齐）
- **instruction-loader**：当某 artifact 要生成时，装配 `template`、`rules`、`instruction` 等

**门禁（Gate）机制的关键设计：**

OpenSpec 的门禁设计有一个微妙但核心的区分：**"依赖是 enabler，不是 gate"**。

- **硬约束（真正的 gate）只有一条**：写代码（`apply`）之前，规格必须就绪。这条落在 schema 的 `applyRequires` 上——`propose` / `ff` 会一直循环生成 artifact，直到 `applyRequires` 列表全部 `done` 才停，跳不过去。
- **结构约束由 DAG 保证**：`tasks` 依赖 `specs` 和 `design`，所以你无法在没有 specs 的情况下凭空生成 tasks。
- **能"跳过"的只是可选环节**：比如 `design`（官方原话"You can skip design if you don't need it"），以及路径顺序。

**一句话总结：OpenSpec 约束的是"什么必须在什么之前具备"（工程纪律），而不是"你必须按什么顺序操作"（官僚流程），它刻意只要前者。**

### 4.2 回滚机制

OpenSpec **没有传统意义上的运行时回滚/检查点机制**（如数据库事务回滚或快照恢复）。它的"回滚"是通过以下设计实现的：

**① 文件系统级的版本控制**
- 所有状态都是项目仓库里的 Markdown 文件
- 回滚 = `git revert` / `git checkout`，利用 Git 的版本控制能力
- 没有额外的运行时状态需要管理

**② 可随时回改的 artifact**
- 实现过程中发现 design 错了？直接编辑 `design.md` 继续走
- 发现 scope 应该缩小？更新 proposal
- 没有任何阶段会"锁定"你

**③ 归档前不污染主规格**
- 在 change 归档前，delta specs 不会影响 `specs/` source of truth
- 如果中途放弃一个 change，直接删除 change 文件夹即可，主规格不受影响

**④ tasks.md 的断点续跑**
- 进度记录在 `tasks.md` 的 checkbox 里
- 中断后重新运行 `/opsx:apply`，从上次断点继续

**与 Dev Flow 5.0 的对比：** OpenSpec 的回滚是"文件系统 + Git"层面的轻量方案，不具备 Dev Flow 5.0 那种"三层恢复保证"（checkpoint、rollback、archive）的运行时能力。OpenSpec 的定位决定了它不需要运行时回滚——它管的是"规划文档"，不是"执行引擎"。

### 4.3 证据追踪与可审计性

OpenSpec 的证据追踪体现在几个层面：

**① 归档即审计轨迹**
- 归档时 change 文件夹完整移动到 `changes/archive/YYYY-MM-DD-<change-name>/`
- 保留完整的 proposal、design、tasks、delta specs
- 可以随时回溯"为什么做这个变更""当时怎么设计的""做了哪些工作"

**② Spec 即可验证契约**
- 每个 requirement 使用 RFC 2119 关键词（MUST/SHALL/SHOULD/MAY）表达强度
- 每个 scenario 用 Given/When/Then 描述可验证的具体场景
- scenario 要求"可测试"——你可以据此写自动化测试

**③ Verify 命令的三维校验**
- 搜索代码库找实现证据
- 问题分为 CRITICAL / WARNING / SUGGESTION 三级
- 注意：verify **不阻断** archive，它只把问题暴露出来供人判断

**④ 变更全链路可追溯**
```
proposal（为什么做）→ specs（改了什么）→ design（怎么做）→ tasks（做了哪些）→ archive（留档）
```

### 4.4 变更失效传播

OpenSpec 的变更传播机制通过 **Delta Spec + 归档合并** 实现：

**Delta Spec 格式：**
```markdown
## ADDED Requirements        → 归档时追加到主规格
### Requirement: ...
#### Scenario: ...

## MODIFIED Requirements      → 归档时替换主规格中对应 requirement
### Requirement: ...

## REMOVED Requirements      → 归档时从主规格删除
### Requirement: ...
```

**智能合并机制（`src/core/specs-apply.ts`）：**
- 不是简单的复制粘贴，而是智能合并
- 能往已有 requirement 里追加 scenario 而不重复
- 保留 delta 未提及的既有内容

**批量归档的冲突处理：**
- `bulk-archive` 处理跨 change 的规格冲突
- 当两个 change 都改了 `specs/ui/` 时，会检查代码库实际实现了什么
- 按创建时间顺序合并

**Spec 的演进循环：**
1. Specs 描述当前行为
2. Changes 提出修改（作为 delta）
3. 实现使修改成为现实
4. Archive 将 delta 合并进 specs
5. Specs 现在描述新行为
6. 下一个 change 基于更新后的 specs

### 4.5 治理问题处理

OpenSpec 对 AI 编程治理问题的处理方式有其鲜明特点：

**① "结果治理"而非"路径治理"**
- OpenSpec 约束的是"什么必须在什么之前具备"，不是"你必须按什么顺序操作"
- 这与重量级方案（如 Spec Kit 的 rigid phase gates）形成刻意差异

**② 渐进严格（Progressive Rigor）**
- 默认用 Lite spec（简短的行为优先要求 + 清晰范围 + 几条验收点）
- 只有高风险变更（跨团队、API/契约变更、迁移、安全隐私）才升级到 Full spec
- 避免为小改动引入官僚流程

**③ context/rules 不写进产物**
- 项目背景和规则只作为 AI 的约束（"constraints for YOU, not content for the file"）
- 不污染 spec 文件本身，保证产物纯净

**④ Spec 是行为契约，不是实现计划**
- 官方判断标准：如果实现可以改变而外部可见行为不变，那它就不该进 spec
- 类名、库选型、执行步骤属于 `design.md` / `tasks.md`
- 这保证 spec 长期稳定、可测试

**⑤ Stores（beta）：跨仓库的治理方案**
- 规划放在独立仓库（Store），通过 `git push` 共享
- 平台团队拥有 specs，产品团队只读引用
- 一个变更可以横跨 API server、web app、shared library
- 基于变更失效传播机制确保一致性

---

## 五、命令体系

### 5.1 Core Profile（默认安装）

| 命令 | 作用 |
|------|------|
| `/opsx:explore` | 动手前的"思考伙伴"，读代码、比较方案，不产出任何文件 |
| `/opsx:propose` | 一步创建 change 并生成全部规划产物 |
| `/opsx:apply` | 按 `tasks.md` 实现，逐项勾选 |
| `/opsx:sync` | 把 delta spec 合并进主规格（通常自动触发） |
| `/opsx:archive` | 完成并归档一个 change |

### 5.2 Expanded Profile（需 `openspec config profile` 开启）

| 命令 | 作用 |
|------|------|
| `/opsx:new` | 只创建 change 骨架，等待后续生成 artifact |
| `/opsx:continue` | 按依赖顺序一次创建一个 artifact |
| `/opsx:ff` | fast-forward，一次性创建全部规划 artifact |
| `/opsx:verify` | 校验实现与 artifact 是否一致 |
| `/opsx:bulk-archive` | 批量归档多个 change |
| `/opsx:onboard` | 用真实代码库走一遍完整流程的教学向导 |

### 5.3 跨工具适配

OpenSpec 支持 **30+ AI 编程工具**，通过适配器机制实现：

- **Claude Code**：冒号式 `/opsx:propose`
- **Cursor / Windsurf / Copilot**：连字符式 `/opsx-propose`
- **Amazon Q**：`@opsx-propose`
- **Codex**：`$openspec-propose`
- **Kimi、Trae 等**：以 skill 名义暴露

源码中对应 `src/core/command-generation/adapters/` 下的 20+ 适配器文件（`claude.ts`、`cursor.ts`、`windsurf.ts`、`codex.ts`、`gemini.ts` 等）。规则（CLI 引擎）只写一遍，方向盘（各工具 skill）由适配器批量生成。

---

## 六、与竞品对比

| 维度 | OpenSpec | Spec Kit (GitHub) | Kiro (AWS) |
|------|----------|-------------------|------------|
| **设计哲学** | 轻量、流动、迭代 | 严谨、完整、可控 | 强大但封闭 |
| **阶段闸门** | 无硬性 gate（enabler 模式） | 刚性 phase gates | IDE 内置流程 |
| **工具兼容** | 30+ AI 助手，跨工具 | Python 设置，较重 | 锁定 Kiro IDE + Claude |
| **存量支持** | Delta Spec，brownfield-first | 需要先文档化全貌 | 有限 |
| **自定义** | Schema 可自定义，换工作流不改代码 | 固定流程 | 封闭 |
| **跨仓库** | Stores（beta）支持跨仓库规划 | 不支持 | 不支持 |
| **开源** | MIT | 开源 | 闭源 |

---

## 七、社区活跃度与生态

### 7.1 GitHub 数据

- **Stars**：65.1k（2026-08-17），是 SDD 领域 star 数最高的项目
- **增长趋势**：从 2025-12 的 34.9k → 2026-05 的 58.5k → 2026-07 的 61k → 2026-08 的 65.1k，增长迅速
- **Forks**：4.5k
- **Commits**：777+
- **Issues**：101 open，社区讨论活跃
- **Pull Requests**：100 open，外部贡献活跃

### 7.2 生态衍生项目

- **OpenSpec-cn / OpenSpec-tw**：中文汉化版（社区维护）
- **Comet**：将 OpenSpec + Superpowers 融合的 AI 开发工作流插件
- **awesome-openspec**：社区维护的资源列表
- **多个行业实践文章**：腾讯云、知乎、CSDN 等平台有大量深度技术文章

### 7.3 维护状态

项目持续活跃，有自动化发布机器人（`openspec-release-bot`），CI/CD 完善，使用 changeset 管理版本，有 Discord 社区支持。

---

## 八、技术实现亮点

### 8.1 Skill = Markdown 指令 + CLI 调用

OpenSpec 的 skill 不是一段程序，而是**一份写给 AI 的自然语言指令**。它把 AI 变成一个听命于 CLI 的执行器：每一步都先调 `openspec` CLI，拿到结构化数据，再照着数据干活。

```typescript
export function getOpsxProposeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-propose',
    instructions: `... 一大段步骤化的自然语言指令 ...`,
    // ...
  };
}
```

**跨模型/跨工具复用的根本原因：** skill 不赌某个模型的"聪明程度"，只依赖 CLI 稳定的结构化输出与 artifact 依赖图。

### 8.2 Schema 可替换的工作流引擎

工作流不是硬编码的，而是由 schema 配置定义。引擎读 schema、照着搭图。换套 schema 就能换一套工作流，引擎代码一行不用动。

```yaml
# 自定义 "研究先行" schema
name: research-first
artifacts:
  - id: research
    generates: research.md
    requires: []
  - id: proposal
    generates: proposal.md
    requires: [research]
  - id: tasks
    generates: tasks.md
    requires: [proposal]
```

### 8.3 Delta Spec 的智能合并

归档时的合并逻辑不是简单的文件覆盖，而是解析 spec 结构，按 requirement 级别智能合并——能追加 scenario 而不重复，能保留未提及的既有内容。

### 8.4 上下文纯净性

`context` 和 `rules` 只约束 AI 怎么写，不能出现在产物里。指令中反复强调"constraints for YOU, not content for the file"、"Do NOT copy them into the file"。产物因此保持干净。

---

## 九、局限性

### 9.1 没有运行时状态管理

OpenSpec 是"文件系统 + Git"层面的轻量方案。它不维护运行时状态、不执行代码、不跑测试——这些由 AI 助手和你的工程基础设施完成。

### 9.2 无运行时回滚/检查点

不像 Dev Flow 5.0 那样有运行时 checkpoint、rollback、archive 三层恢复保证。OpenSpec 的"回滚"就是 Git 操作。

### 9.3 依赖 AI 助手的质量

OpenSpec 是"协议层"，不是"执行层"。最终代码质量仍取决于你用的 AI 助手（Claude Code、Cursor 等）的能力。官方推荐使用高推理能力模型（如 Codex 5.5、Opus 4.7）。

### 9.4 对简单变更的过重感

官方也承认："对于真正简单的一行修复，这套仪式可能不值得。OpenSpec 是轻量的，但不是免费的。"

### 9.5 无强制验证阻断

`verify` 命令不阻断 `archive`，只是把问题暴露出来。是否处理 warnings 完全靠人工判断。

---

## 十、总结

### 10.1 核心价值

OpenSpec 真正提供的，不是一组更复杂的命令，而是一种让 AI 编程结果能够沉淀为长期工程资产的最小规格层。它的实现哲学可以浓缩成一句话：

> **把规则沉淀进 CLI 引擎，把编排交给 skill 指令，把事实沉淀进 specs 目录。**

### 10.2 适用场景

- ✅ 中大型功能开发（需求需要明确对齐时）
- ✅ 团队协作（多人 + 多 AI 助手并行工作）
- ✅ 存量代码库的增量开发（brownfield-first）
- ✅ 跨仓库/跨团队的功能规划（Stores beta）
- ✅ 需要审计轨迹和可追溯性的项目
- ⚠️ 简单一行修复可能过重
- ⚠️ 需要运行时回滚/检查点的场景不适合（OpenSpec 不提供此能力）

### 10.3 与 Dev Flow 5.0 的定位差异

OpenSpec 和 Dev Flow 5.0 解决的是不同层次的问题：

| 维度 | OpenSpec | Dev Flow 5.0 |
|------|----------|--------------|
| **定位** | 规格协议层（planning） | 执行引擎层（execution） |
| **状态管理** | 文件系统 + Git | 运行时状态机 |
| **门禁** | Artifact 依赖图（enabler 模式） | 硬性 gate（写门禁等） |
| **回滚** | Git 级别 | 三层恢复保证（checkpoint/rollback/archive） |
| **证据追踪** | 归档审计轨迹 | 追溯账本 |
| **变更传播** | Delta Spec 智能合并 | 变更失效传播机制 |
| **运行时依赖** | 零（纯文件 + CLI） | 宿主适配器 + Hook |
| **治理范式** | 结果治理 + 渐进严格 | 显式风险标注 + 状态调度 |

OpenSpec 适合作为"规划层"与 Dev Flow 5.0 这类"执行层"配合使用——OpenSpec 管需求规格的生成、对齐、沉淀，Dev Flow 管实现过程的门禁、回滚、传播。

---

## 参考来源

1. **GitHub 官方仓库**：https://github.com/Fission-AI/OpenSpec（65.1k stars，MIT License）
2. **官方文档 concepts.md**：https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md
3. **官方文档 overview.md**：https://github.com/Fission-AI/OpenSpec/blob/main/docs/overview.md
4. **npm 包**：https://www.npmjs.com/package/@fission-ai/openspec
5. **官网**：https://openspec.dev/
6. **源码实现原理深度解析**：CSDN 技录局，《OpenSpec实现原理深度解析》，2026-07-18
7. **腾讯云社区技术文章**：多篇 OpenSpec 实践指南与原理分析（2026-03 至 2026-07）
8. **知乎深度对比**：《Superpowers 对比 OpenSpec、Spec Kit》，2026-06
9. **Discord 社区**：https://discord.gg/YctCnvvshC

> AI生成