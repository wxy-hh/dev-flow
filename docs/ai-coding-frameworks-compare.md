# AI 编程框架四方对决：Spec Kit、OpenSpec、Superpowers、Dev Flow 谁才是你的菜？


## 1. 四大框架全景速览

| 维度 | Spec Kit | OpenSpec | Superpowers | Dev Flow |
| --- | --- | --- | --- | --- |
| **维护方** | GitHub / Microsoft | Fission-AI（独立开发者） | Jesse Vincent（社区驱动） | 个人开发者（wxy-hh） |
| **Stars** | ~93K | ~34K | ~204K | —（个人项目） |
| **首版发布** | 2025 年 9 月 | 2025 年 9 月 | 2025 年 10 月 | 2026 年 7 月 |
| **技术栈** | Python + uv | TypeScript + npm | Markdown + Shell（零依赖） | TypeScript + Node（运行时零 npm 依赖） |
| **AI 工具** | 30+ | 25+ | 5+（专注 Claude Code） | 40 个 MCP 工具（Claude + Codex 双宿主） |
| **核心理念** | 阶段门控，规范可执行化 | 轻量规范层，增量变更驱动 | 流程纪律，技能自动触发 | 规模×拓扑×风险选路线，机器门禁强制义务 |
| **TDD 强制** | 否（可选） | 否（可选） | 是（强制） | 否（验证义务按路线与风险决定） |
| **许可证** | MIT | MIT | MIT | MIT |

---

## 3. 源码级架构拆解

### 3.1 Spec Kit：把规范变成「编译器」

Spec Kit 的哲学中最核心的一点是：**规范不是写给人看的，是写给 AI 执行引擎看的**。

#### 源码结构

```bash
spec-kit/
  ├── src/specify_cli/
  │   ├── __init__.py          # 入口，AGENT_CONFIG 注册表
  │   ├── extensions.py        # 插件管理器（YAML schema 校验）
  │   ├── presets.py           # 预设模板覆盖系统
  │   └── integrations/        # 30+ AI 代理适配层
  ├── .specify/
  │   ├── templates/           # 核心模板（spec/plan/tasks）
  │   └── scripts/             # Shell 脚本（环境检查、分支创建）
  ├── templates/               # 用户可覆盖的模板
  └── specs/                   # 项目规范产物目录
```

#### 关键设计：模板优先级栈

Spec Kit 的核心是一个**模板解析引擎**。它不是硬编码命令，而是通过运行时模板发现机制工作：

```bash
模板解析顺序（从高到低）：
  1. .specify/templates/overrides/    ← 项目级覆盖
  2. .specify/presets/templates/      ← 预设覆盖
  3. .specify/extensions/templates/   ← 扩展覆盖
  4. .specify/templates/              ← 核心默认值
```

这意味着团队可以在不修改源码的情况下，完全定制每个命令的行为。

#### 工作流引擎

v0.7.0 引入了 `workflows/engine.py`——一个**可恢复的多步骤工作流引擎**。这使得 7 个阶段的工作流（constitution → specify → clarify → plan → checklist → tasks → analyze → implement）不会因为中断而丢失状态。

#### 8 步工作流

```bash
宪法与规格                    计划与任务                     实现
    │                           │                           │
    ├─ /speckit.constitution ─→ ├─ /speckit.plan       ─→   ├─ /speckit.implement
    ├─ /speckit.specify         ├─ /speckit.checklist
    └─ /speckit.clarify         ├─ /speckit.tasks
                                └─ /speckit.analyze
```

每个阶段产出明确的 Markdown 文件：

- `constitution.md` —— 不可变项目原则（技术栈、安全合规、测试标准）
- `spec.md` —— 用户故事与功能需求（只写 what/why，不写 how）
- `plan.md` —— 技术架构设计
- `research.md` —— 技术选型对比与决策记录
- `data-model.md` —— 数据模型
- `contracts/` —— API 契约
- `tasks.md` —— 依赖排序的任务列表

#### 扩展系统

Extension 是 Spec Kit 的杀手锏。它是一个模块化 ZIP 包，通过 `extension.yml` 声明：

```yaml
# extension.yml (schema v1.0)
commands:
  - speckit.myext.command-name    # Markdown 模板定义
hooks:
  - before_specify                # 生命周期钩子
  - after_tasks
  - before_implement
requirements:
  speckit_version: ">=0.9.0"
effects: read-only | read-write
```

105+ 社区扩展已经构建了完整的生态——从多 Agent 协作（MAQA）到领域特定的 Spring Boot / Go 微服务预设。

---

### 3.2 OpenSpec：轻就是最大的重

如果说 Spec Kit 是一台精密的工业机床，OpenSpec 就是一把趁手的美工刀。它的哲学是：**用最小的规范摩擦，换取最大的开发确定性**。

#### 源码结构

```bash
openspec/
  ├── src/
  │   ├── cli/                     # CLI 入口（init, propose 等）
  │   ├── workflow/                # 工作流引擎
  │   │   ├── propose.ts           # 提案生成
  │   │   ├── apply.ts             # 实施执行
  │   │   └── archive.ts           # 归档合并
  │   ├── artifact-graph/          # 产物依赖图
  │   ├── context/                 # 上下文加载器
  │   └── instructions/            # AI 指令生成器
  ├── specs/                       # 主规范库（"真相源"）
  │   └── [capability]/
  │       └── spec.md
  ├── changes/                     # 活跃变更
  │   └── [change-name]/
  │       ├── proposal.md          # 为什么做、改什么
  │       ├── tasks.md             # 实施清单
  │       ├── design.md            # 技术设计
  │       └── specs/               # 增量规范补丁
  └── project.md                   # 项目上下文
```

#### 核心创新：Delta Spec（增量规范）

这是 OpenSpec 最精妙的设计——规范以**增量补丁**的形式存在，标记 ADDED / MODIFIED / REMOVED：

```markdown
## ADDED
- 新增用户登录功能，支持邮箱+密码两种方式

## MODIFIED
- 将原来的 session 认证改为 JWT token 认证

## REMOVED
- 移除旧版 basic auth 接口
```

归档（Archive）阶段会自动将这些增量合并到主规范库。这意味着：

- 规范**永远不会过时**——每次变更都有迹可循
- 代码评审可以直接对照规范检查——你改了什么，规范就记录了什么
- 特别适合在存量代码上做增量开发

#### 三步工作流

```bash
/opsx:propose  →  /opsx:apply  →  /opsx:archive
   提案生成         实施执行          归档合并
```

只有 3 步，没有强制的前置条件。你可以在 propose 之后再自由加入 `/opsx:explore`（探索模式）来和 AI 讨论方案——这在 Spec Kit 的严格门控流程下几乎做不到。

#### 核心数据流

OpenSpec 内部有一个**产物依赖图（Artifact Graph）**，它追踪 spec ↔ proposal ↔ design ↔ tasks 之间的依赖关系。当你在 apply 阶段执行时，AI 会自动加载所有相关上下文，而不是把整个项目倒给 AI。

---

### 3.3 Superpowers：把工程纪律「编译」进 AI 的执行流程

Superpowers 与前两者有本质不同：**它不管理「规范是什么」，它管理「你怎么做」**。它不是规范工具，是流程工具。

#### 源码结构

```bash
superpowers/
  ├── skills/                # 14 个核心技能
  │   ├── brainstorming/
  │   │   └── SKILL.md       # 头脑风暴流程定义
  │   ├── writing-plans/
  │   │   └── SKILL.md
  │   ├── test-driven-development/
  │   │   └── SKILL.md       # RED-GREEN-REFACTOR 强制执行
  │   ├── subagent-driven-development/
  │   │   └── SKILL.md       # 子代理 + 双阶段审查
  │   └── ... (14 in total)
  ├── agents/                # 子代理角色模板
  ├── commands/              # 斜杠命令（v5.1 起已废弃）
  ├── hooks/                 # 会话生命周期脚本
  │   ├── hooks.json         # SessionStart 钩子配置
  │   └── session-start      # 引导注入脚本
  ├── tests/                 # 技能集成测试
  └── package.json           # v5.1.0, type: "module"
```

#### 核心创新：Hook 驱动的自动技能激活

Superpowers 真正的魔法在 `hooks/session-start` 脚本：

```bash
会话启动 → hooks.json SessionStart 触发 →
session-start 脚本执行 →
注入 skills/using-superpowers/SKILL.md →
AI 获得「在每次行动前自动检查是否有可用技能」的元能力
```

这就是 Superpowers 不需要你手动调用技能的原因——它在会话一开始就把「使用技能」变成了一条不可违抗的系统指令。

#### 三大铁律

**铁律 1：强制头脑风暴** 在任何代码被写出来之前，必须先完成设计澄清。一次只问一个问题，提出 2-3 种方案及权衡。`<HARD-GATE>` 标签确保在用户批准设计之前，AI 不会写任何代码。

**铁律 2：强制 TDD**

skill 中明确指出：如果 AI 先写了实现代码而没有先写测试，需要**删除代码重新来**。

**铁律 3：子代理 + 双阶段审查** 每个 task 派发到一个全新的子代理（干净上下文），完成后经过两阶段审查：

1. **Spec Compliance Review**：是否满足规范要求？
2. **Code Quality Review**：代码质量是否达标？

Critical 问题会**阻断后续步骤**，直到修复完成。

#### 零依赖哲学

Superpowers 本质上是 14 个 Markdown 文件。没有 Python 环境，没有 Node 版本要求，不需要安装任何包（除了插件市场本身）。它的"引擎"是 Claude Code 自己的指令理解能力——这是一种极致的简洁。

---

### 3.4 Dev Flow：把流程写成「机器可校验的合同」

前三者的共同点是：流程能不能走对，**依赖 AI 的自觉**。Spec Kit 靠提示词让模型按模板走，Superpowers 靠注入指令让模型记住用技能。Dev Flow 走了另一条路——**它不写提示词，它写合同，然后让机器（MCP 状态机 + hooks）强制执行**。

#### 源码结构

```bash
dev-flow/
  ├── src/
  │   ├── core/          # 状态机、事务、门禁、追溯账本
  │   ├── policy/        # 路线合同解析（读 policy/contract.json）
  │   ├── mcp/           # 40 个 MCP 工具（状态变更的唯一入口）
  │   └── hosts/         # Claude / Codex 适配器（事件归一化 + 门禁拦截）
  ├── policy/contract.json  # 机器权威：六条基础路线 + 风险义务
  ├── skills/            # 各步骤 Skill（只通过 MCP 推进状态）
  └── dist/              # 受版本控制的预构建 bundle
```

运行时零 npm 依赖、只用 Node 标准库；流程状态全部落在业务仓 `.dev-flow/`，Claude Code 与 Codex CLI 两个宿主共用同一份状态，可跨宿主接力。

#### 特色 1：grillme → 需求固化

Dev Flow 不假设需求一开始就是清晰的。`dev_flow_start` 只创建一个 intake 状态的 feature；intake 阶段先**查仓库事实**——代码、文档、测试、diff——只有仓库查不到、且确实属于用户拥有的边界/优先级/取舍的问题，才通过 `grillme` 提问。问题必须带事实、冲突、选项和推荐（A/B/C），**能用工具查明的绝不问人**。每个决策写入 Decision Ledger；等影响分类的决策全部收敛后，`dev_flow_lock_classification` 才以 CAS 原子地锁死路线。这就是「需求固化」：动手之前，需求被事实和决策台账钉死，而不是停留在对话记忆里。

#### 特色 2：计划对抗审查

standard M/L 路线的实施计划不是 AI 写完就行的。Core 基于**不可变的 planning snapshot** 创建独立的审查批次（requirements-coverage、architecture-testability、rollback-operability 三个角色），让计划的覆盖度、可测性和回滚可操作性被对抗性检查；blocking finding 必须在 planning 阶段闭合才能进入实现。审查是机器编排的义务，不是「建议做」，且同一义务只向用户呈现一个门禁。

#### 特色 3：最小回撤单元

实现被拆成带 `rollbackUnit` 的单元，每个单元同时声明**正向验证**（怎么证明它生效）与**回滚验证**（怎么证明能安全撤回）命令。Core 在进入实现时自动捕获基线 checkpoint，实现边界再捕获完成 checkpoint——模型不需要手动记这些。只有明确进入恢复流程时，回滚操作才暴露给用户，避免日常开发被回滚仪式打扰。

#### 特色 4：门禁不是提示，是拦截

hooks 层在宿主事件流上直接拦截：logic-complete 之前 Git 写（add/commit/push）直接拒绝；intake、控制面文件、开放恢复事务的写入一律拒绝；实现期的普通业务写入按真实影响归一化放行——同样的效果不会因为命令写法不同而被误拦。等价实现不被骚扰，越界行为溜不过去。

#### 特色 5：规模自适应，风险只叠义务

`dev_flow_classify` 按 规模（XS/S/M/L）× 拓扑 × 执行（light/standard）× 需求状态 × 风险标签 选路线，基础路线只有六条；7 个风险标签（security / data / money / external / availability / critical_correctness / irreversible_consequence）**不创建新路线**，只追加 review、verification、rollback、checkpoint 或 approval 义务。30 分钟的小改动走 XS 路线不背任何强制文档；金融支付类改动在 standard L 上被追加确认与审查义务——**流程重量永远和改动的重要性成正比**。

---

## 4. 核心哲学对比

| 维度 | Spec Kit | OpenSpec | Superpowers | Dev Flow |
| --- | --- | --- | --- | --- |
| **类比** | 工业机床 | 趁手美工刀 | 工程纪律手册 | 智能交通管制系统 |
| **管什么** | 规范产物（spec/plan/tasks） | 规范变更（proposal/delta/archive） | 开发流程（brainstorm→TDD→review） | 流程的执行契约（分类→阶段→义务→门禁→状态） |
| **怎么管** | 阶段门控，按序推进 | 增量补丁，自由迭代 | Hook 触发，自动激活 | 机器强制：MCP 状态机 + hooks 拦截，不靠提示词自觉 |
| **核心数据** | Markdown 文档 + YAML 扩展 | Delta Spec + Artifact Graph | SKILL.md 流程定义 | contract.json 路线合同 + `.dev-flow/` 原子状态/事件账本 |
| **扩展机制** | Extension ZIP + Preset YAML | 无 | 编写新 Skill（用 TDD 方式） | 无需扩展；风险标签自动追加义务 |
| **规范落点** | 项目内 `.specify/` + `specs/` | 项目内 `openspec/` | 规范是副产品，存在 `docs/superpowers/` | 项目内 `.dev-flow/` |
| **升级兼容性** | 可能覆盖自定义模板 | 无破坏性升级 | 纯 Markdown，无兼容性问题 | 显式版本合同，dist 受版本控制 |

---

## 5. 实战体验：同一个需求，四个框架的真实表现

为了写这篇文章，作者搭建了一个真实的实验环境——一个基于 Flask + SQLite 的博客系统，包含文章列表、详情、创建功能。然后用地地道道的方式，分别用四个框架实现同一个需求：**「给博客添加文章标签功能」**——文章可打多个标签、标签可点击筛选、提供 `/tags` API。

每个框架从**干净基线**开始，走完各自的标准流程。前三个为真实记录，Dev Flow 为按设计推演（见 5.5）。

### 5.1 实验环境

| 项目 | 详情 |
| --- | --- |
| 基线项目 | Flask + SQLite 博客，单文件 `app.py`，106 行 |
| 基线功能 | 文章列表、详情、创建 |
| 需求任务 | 添加 tags 字段、显示标签、按标签筛选、`/tags` API |
| 测试用例 | 7 条（创建/展示/筛选/API），四个框架共用同一套 |
| 运行环境 | macOS + Python 3.11 + Node.js 24 |

### 5.2 Superpowers —— 流程最严谨，安全感最强

**实际流程**：

1. **brainstorming**：AI 先问「标签存储方式选独立关联表还是内嵌文本」，选了内嵌。然后直接呈现设计——改动范围、数据模型、UI 交互——确认后立即进入编码。
2. **TDD 红色阶段**：AI 写了 7 条测试（`test_app.py`），跑一遍，全部失败——符合预期。
3. **TDD 绿色阶段**：AI 重写 `app.py`，加入 tags 字段、索引过滤、标签展示、`/tags` API。跑测试，6 通过 1 失败——因为创建文章后 `redirect` 和测试 fixture 重建 DB 导致新数据丢失。修复 fixture 后 7/7 全部通过。

**实验数据**：

| 指标 | 数值 |
| --- | --- |
| 交互轮次 | 2 次（2 个选择问题 + 确认设计） |
| 测试首次运行 | **7 failed**（TDD 红色阶段） |
| 测试最终结果 | **7 passed** |
| 产出文件 | `app.py`（新增 6 行），`test_app.py`（新建，142 行） |
| 规范产物 | 无独立文档，设计要点保留在对话上下文中 |

**真实感受**：最大的感受是**安全**。TDD 强制意味着每一步都有验证——不是「AI 看起来写对了」，而是「测试真的通过了」。但 TDD 过程也有额外成本，比如创建文章后重定向的边界情况导致测试都过了之后还要回过来修 fixture——这个调试时间可能比直接写代码还长。

### 5.3 OpenSpec —— 最轻量的仪式感，速度最快

**实际流程**：

1. **init**：`openspec init --tools claude`，6 秒完成。
2. **propose**：`openspec new change "add-article-tags"` 创建变更目录，然后写 `proposal.md`（Why/What/Impact）、`design.md`（技术方案）、`tasks.md`（6 个实施步骤）。
3. **apply**：按 tasks.md 逐条实现——加 tags 列、改模板、加过滤、加 API、写测试。一气呵成，7/7 全部通过。
4. **archive**：`openspec archive add-article-tags`，变更被归档到 `openspec/changes/archive/2026-07-03-add-article-tags/`。

**实验数据**：

| 指标 | 数值 |
| --- | --- |
| 规范文件 | `proposal.md` + `design.md` + `tasks.md`（3 个文件） |
| 归档产物 | `openspec/changes/archive/` 下完整历史记录 |
| 测试结果 | **7 passed** |
| 产出文件 | `app.py` + `test_app.py` + `openspec/` 目录（19 个文件） |

**真实感受**：OpenSpec 是四个框架里**摩擦最小**的。没有 Constitution、没有强制 plan、没有 TDD 门禁——你想怎么写就怎么写。但反过来，**没有任何防护**。如果不写测试，AI 不会提醒你。如果 proposal 写得太随意，apply 出来的质量就靠运气。它是一个「给你结构但不给你纪律」的工具。

### 5.4 Spec Kit —— 最完整的工程仪式，但也最重

**实际流程**：

1. **init**：`specify init . --here --integration claude --force`，生成 `.specify/`（模板/脚本/工作流）+ `.claude/skills/speckit-*`（10 个技能）。
2. **constitution**：填充 `.specify/memory/constitution.md`——定义「简单优先」「向后兼容」「模板驱动 UI」「测试覆盖」四个原则。
3. **specify**：写 `specs/001-article-tagging/spec.md`，四条用户故事，每条带验收标准。
4. **plan**：写 `plan.md`，包含技术决策表、数据模型变更、API 契约。
5. **tasks**：拆出 6 个实施任务。
6. **implement**：逐任务实现，7/7 测试通过。

**实验数据**：

| 指标 | 数值 |
| --- | --- |
| 工作流步骤 | 5 步（constitution → specify → plan → tasks → implement） |
| 规范产物 | `constitution.md` + `spec.md` + `plan.md` + `tasks.md`（4 个文件） |
| 生成文件总数 | **34 个**（含 `.specify/` 基础设施、`.claude/skills/` 技能定义） |
| 测试结果 | **7 passed** |
| 基础设施 | 5 个 Shell 脚本、4 个模板文件、YAML 工作流引擎 |

**真实感受**：Spec Kit 是非常**严肃**的工具。它的模板引擎、扩展系统、工作流引擎这些基础设施意味着它可以支撑大型项目和团队——但代价是你必须接受它带来的 **34 个文件的项目膨胀**。对于一个 106 行代码的小项目来说，这套仪式感确实过度了。但如果是 10 万行的企业项目，这些模板、规范、脚本就是可追溯性的基础。

### 5.5 Dev Flow —— 设计推演（本节未实测）

> 说明：5.2–5.4 是同一台机器上的实测记录；dev-flow 需要先安装插件才能实测，本节按官方设计与路线合同推演它在同一需求上的表现，**不编造实验数据**。

同一需求「给博客添加文章标签功能」，dev-flow 的设计会这样走：

1. **intake**：`dev_flow_start` 创建 feature，先读 `app.py`、测试与仓库事实，不急着动手。
2. **grill**：仓库查不到的唯一真实决策是——标签存内嵌文本还是独立关联表。`grillme` 提一个带 A/B/C 推荐的问题，答案写入 Decision Ledger。
3. **分类固化**：按规模 XS（单文件、单位置改动）选 `xs` 路线，需求状态 provided-confirmed，无风险标签；决策收敛后 `lock_classification` 原子锁定。
4. **实现**：xs 路线为 定位 → 实现 → 验证 → 完成，不强制任何 Markdown；Core 自动捕获 checkpoint；实现期普通写入放行，Git 写在 logic-complete 前被拦截。
5. **验证**：把 7 条测试作为验证命令运行，全部通过。
6. **finalize**：义务全部满足（xs 只需 checkpoint）才放行，交付快照登记。

与三者的设计差异：

- **vs Superpowers 的 brainstorming**：同样先问「内嵌还是关联表」，但 dev-flow **能查明的绝不问**——只问用户真正拥有的取舍，少打扰。
- **vs OpenSpec 的轻量**：同样不背文档，但 dev-flow 有机器门禁——测试没跑、Git 提前写都会被拦，不是靠自觉。
- **vs Spec Kit 的重**：小改动不会被迫生成 34 个文件，流程重量由路线自适应；而 standard M/L 又能拿到不输 Spec Kit 的计划对抗审查与追溯。

### 5.6 四框架对比

| 指标 | Superpowers | OpenSpec | Spec Kit | Dev Flow（设计推演） |
| --- | --- | --- | --- | --- |
| **必须的流程步骤** | brainstorming → TDD | propose → apply → archive | constitution → specify → plan → tasks → implement | 定位 → 实现 → 验证 → 完成（xs）；standard L 为 需求对齐 → 实施计划 → 实现 → 代码审查 → 验证 → 完成 |
| **流程步骤数** | 2 | 3 | 5 | 4（xs）~ 6（standard L，不含前置 intake/分类） |
| **规范产物** | 无独立文件（留对话中） | proposal + design + tasks | constitution + spec + plan + tasks | 无（xs）；standard M/L 强制需求文档 + 实施计划 |
| **生成文件总数** | 2 | 19 | 34 | 仅 `.dev-flow/` 状态，不新增业务文档 |
| **强制测试** | 是（RED-GREEN-REFACTOR） | 否 | 否（可选） | 否（验证义务按路线与风险决定） |
| **测试结果** | 7 passed | 7 passed | 7 passed | —（未实测） |
| **安装复杂度** | 插件市场一键安装 | `npm install -g` 一行 | 需 Python 3.11+ + uv + `specify init` | 插件市场一键安装（Claude / Codex 双宿主） |
| **适合项目规模** | 中小（注重质量） | 中小（注重速度） | 中大型（注重规范） | XS → L 全覆盖，流程重量自适应 |

> 注：四个框架的目标产出物（`app.py` 和 `test_app.py`）功能等价。**差异不在最终代码，在于「如何到达那里」的过程。** 其中 dev-flow 一列为按设计推演，未实测。

---

## 6. 选型建议：哪个框架适合你？

| 你的情况 | 推荐 | 原因 |
| --- | --- | --- |
| 从零开始的新项目，有充裕时间 | **Spec Kit** | 7 阶段门控保证质量上限，宪法机制确保架构不跑偏 |
| 已有项目需要快速迭代新功能 | **OpenSpec** | 3 步工作流最快，Delta Spec 天然适配增量开发 |
| 对代码质量有极致要求（金融/医疗/基础设施） | **Superpowers** | 强制 TDD + 双阶段审查，安全防线最严密 |
| 团队协作、需要可追溯的技术决策 | **Spec Kit** | research.md + constitution.md 构建完整的决策链 |
| 个人开发者、追求效率 | **OpenSpec** | 学习曲线最低，最快上手，最轻量的仪式感 |
| 需要跨多个 AI 工具使用 | **OpenSpec** | 25+ 工具支持，切换成本最低 |
| 重度 Claude Code 用户 | **Superpowers** | 为 Claude Code 深度优化，整合度最高 |
| 遗留系统改造、技术债清理 | **OpenSpec** | 明确打出 "built for brownfield" 旗号 |
| 需要 Claude Code 与 Codex 双宿主接力 | **Dev Flow** | 同一份 `.dev-flow/` 状态跨宿主共用，可接力开发 |
| 流程要求机器强制，不接受靠提示词自觉 | **Dev Flow** | hooks + MCP 状态机拦截越界，逻辑未完成禁 Git 写 |
| 项目里从 XS 到 L 的改动都有，不想为小改动背重流程 | **Dev Flow** | 路线按规模×拓扑×风险自适应，小改动零文档 |
| 需要可审计追溯与最小回撤单元 | **Dev Flow（standard M/L）** | REQ/AC → TASK → TEST/RU 可审计图 + 单元级双向验证回滚 |

---

## 7. 深度思考：四个框架背后的范式之争

在跑完四个框架之后，有一些超越「哪个更好」的思考：

### 7.1 「重流程」vs「重规范」vs「重纪律」vs「重状态」

**Spec Kit 相信规范**：只要规范写得足够好，代码就能生成得足够好。它的设计重心在 spec 产物的质量和一致性上——analyze 命令会检查 spec ↔ plan ↔ tasks 之间的一致性，constitution 作为最高原则约束一切。

**OpenSpec 相信变更**：需求会变，代码会改，规范也会过时。所以它不追求「完美的初始规范」，而是追求每一个变更都被追踪、记录、归档。Delta Spec 是这个哲学的最好体现。

**Superpowers 相信流程**：规范写得再好，没有好的执行流程也会跑偏。TDD 不是为了测试，是为了倒逼 AI 先理解需求再写代码。Code Review 不是为了找 bug，是为了确保每一行代码都经过了第二双眼睛的审视。

**Dev Flow 相信状态**：规范写得再好、纪律喊得再响，只要执行状态只能靠 AI 自己记，就总会漂移。Dev Flow 把流程写成机器可校验的合同——路线、阶段、义务、门禁都以 `.dev-flow/` 的原子状态存在，模型不记得、或想抄近路，都会被状态机与 hooks 拦下。它不抬高流程的「质量上限」，它压低流程的「失守概率」。

### 7.2 关于 Token 成本

一个很多人忽视的维度是 Token 消耗。四者的差距相当大：

- **Spec Kit**：Token 消耗最高，因为每个阶段都把前面的所有产物当上下文重新灌入。7 个阶段跑完，上下文已经非常长。
- **OpenSpec**：Token 消耗最低，因为只加载当前变更相关的 spec 增量，Artifact Graph 帮 AI 精确定位需要的上下文。
- **Superpowers**：Token 消耗中等偏高，子代理模式让每个子代理的上下文干净，但 brainstorming + TDD + code review 多轮消耗加起来不少。v6.0.0 优化后子代理评审成本下降约 50%。
- **Dev Flow**：分路线。XS/S 几乎零额外 Token——不强制文档，状态只读当下阶段；standard M/L 的计划审查批次与追溯图会抬升成本，接近 Spec Kit 的中高区间。总体介于 OpenSpec 与 Spec Kit 之间。

### 7.3 它们不是互斥的

最有趣的发现是：这四个框架解决的是不同层面的问题，理论上可以组合使用。

社区已经有了这样的实践——**Comet** 工具尝试将 OpenSpec（管 WHAT）和 Superpowers（管 HOW）组合成完整流水线（管 WHEN & NEXT）。你也可以用 Spec Kit 来管理项目级的规范和计划，同时用 Superpowers 的 TDD 技能来约束具体的代码实现质量。Dev Flow 补上的正是「WHEN & NEXT」这一环：它不生产规范（WHAT 交给 OpenSpec），也不规定编码纪律（HOW 交给 Superpowers 的 TDD），它决定**何时该做什么、还差哪些义务、门禁卡在哪一步**——并把这一环做成了状态机，而不是另一段提示词。

### 7.4 关于「规范会不会成为新的负担」

这是作者最深的感受。写规范本身是有成本的——Spec Kit 的 7 阶段走下来，写文档的时间可能比写代码的时间还长。如果一个功能只需要 30 分钟写完，花 2 小时写规范就不划算。

关键在于**根据项目的重要性和复杂度选择合适的工具**：

- 核心基础设施 → Spec Kit 或 Superpowers
- 常规功能迭代 → OpenSpec
- 快速原型验证 → 直接用 AI，不需要框架

规范不是目的，是正确的代码才是目的。不要让规范变成新的形式主义。

---

## 8. 总结

| 维度 | Spec Kit | OpenSpec | Superpowers | Dev Flow |
| --- | --- | --- | --- | --- |
| **一句话** | 规范可执行，生成代码 | 规范轻量化，追踪变更 | 流程纪律化，强制质量 | 流程合同化，机器强制履行 |
| **最佳场景** | 新项目、大团队 | 存量迭代、快速开发 | 质量优先、Claude Code | 双宿主接力、规模多样、要求可追溯 |
| **学习成本** | 中-高 | 低 | 中 | 中（概念多，但按路线自动收敛） |
| **Token 成本** | 高 | 低 | 中-高 | 低-中（XS/S 极低，standard L 中高） |
| **产出质量上限** | 高 | 中-高 | 最高 | 高 |
| **灵活性** | 低（门控严格） | 高（自由迭代） | 中（流程绑定） | 中（路线自选，门禁强制） |

**作者建议**：

- 如果是做一个**需要长期维护的项目**，用 Spec Kit 搭框架，建立 constitution 和初始 spec
- 如果是**日常迭代新功能**，OpenSpec 的 3 步流程最顺手，速度最快
- 如果写的是**安全敏感、不允许有 bug 的代码**，Superpowers 的 TDD 强制 + 双阶段审查无可替代
- 如果流程要求**机器强制而非自觉遵守**，或需要在 Claude Code 与 Codex 之间接力，Dev Flow 的合同化路线最合适

最后说一句：框架再好也只是工具。真正拉开差距的，是你花多少心思去写清楚「你到底要什么」。AI 写不好代码，很多时候不是它不够聪明，而是我们的需求表达得不够清晰。规范驱动开发的本质，就是逼我们自己先把问题想清楚。
