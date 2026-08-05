# Dev Flow 从入门到精通:设计讲解与常见问题

> 本文档是一份面向初学者的完整教程,基于 Dev Flow 源码(3.0.x)逐层讲解
> 项目的设计、流程与实现机制,并收录了使用过程中最常见的疑问与解答。
> 文中所引 `file:line` 均为 `plugins/dev-flow/src/` 下的源码位置。
>
> **定位说明**:本文档是教程与 FAQ,不是权威契约。契约以
> [routes.md](routes.md)、[architecture.md](architecture.md) 与源码为准;
> 教程内容可能随版本滞后,引用规则请以权威文档为准。

## 目录

1. [项目定位:这是什么,解决什么问题](#1-项目定位)
2. [五个核心概念](#2-五个核心概念)
3. [代码分层:五层架构](#3-代码分层)
4. [一次完整工作流走查](#4-一次完整工作流走查)
5. [关键机制深挖](#5-关键机制深挖)
6. [常见问题 FAQ](#6-常见问题-faq)
7. [操作速查](#7-操作速查)

---

## 1. 项目定位

### 1.1 一句话

Dev Flow 是面向 **Claude Code** 与 **Codex CLI** 的预构建双宿主插件,给 AI 编程助手装上"工作流监管":按任务规模与风险选择路线,强制阶段、记录证据、设置门禁。

### 1.2 解决什么问题

AI 编码助手很强,但没有工程纪律:

- 小任务(改错别字)走一堆过场流程,浪费时间;
- 高风险任务(改支付接口)不做计划、不审查、不验证就提交;
- 模型可能直接写 `.dev-flow/` 控制文件、任务没做完就 `git commit`。

### 1.3 设计哲学(README 第 7 行)

> **小任务不过度治理,高风险任务不能轻易越级。**

配套的三条铁律:

- **流程推进走 MCP,写入守卫走 hook**——状态只能通过 MCP 工具改,写文件由 hook 拦;
- **风险只加义务,不建路线**——风险标签不抬升等级,只加强该路线内的证据;
- **目标是"纪律 × 审计 × 自治"的平衡**,不是把每个小任务变成重流程。

---

## 2. 五个核心概念

### 2.1 状态目录 `.dev-flow/`(插件的"账本")

```
.dev-flow/
  project.json              ← 项目配置:验证命令、protectedRoots、enforcement
  active.json               ← 唯一 active feature 指针(一次只做一个任务)
  features/<feature-id>/
    state.json              ← 该任务的完整状态(schema v2)
    events.jsonl            ← 追加式事件账本(谁在何时干了什么)
    <路线要求的 Markdown 资产,如 需求文档.md>
```

**铁律**:这套文件**只能由 MCP 工具(Core)修改**,模型不得手写;hook 会拦截一切对控制文件的直接写入。每次修改带 `revision` + CAS 校验,防止并发覆盖。

`state.json` 对应 `FeatureState` 接口(`core/state-store.ts:27`),含:路线、分类、义务、决策台账、各步骤证据、验证指纹、checkpoint、logicComplete 等——**新会话的模型读它一个文件即恢复全部上下文**。

### 2.2 六条基础路线

路线是**分类的产物**,三个维度决定:

1. **规模 level**:XS / S / M / L;
2. **拓扑 topology**:`local`(最低 XS)→ `shared-contract`(最低 M)→ `multi-chain` / `coordinated-rollback`(最低 L),**只许升不许降**(`policy/route.ts:26` `assertTopologyLevel` 抛 `TOPOLOGY_LEVEL_MISMATCH`);
3. **执行方式 execution**:M/L 必须选 `light` / `standard`(XS/S 不许传,传了报矛盾,`route.ts:127`)。

六条路线定义在 `policy/contract.json`(纯数据,机器权威):

| 路线 | 阶段(orderedSteps) | 强制文档 |
|------|-------------------|---------|
| `xs` | locate → implementation → verification → finalize | 无 |
| `s` | boundary → implementation → verification → finalize | 无 |
| `light-m` | planning → implementation → code_review → verification → finalize | 无 |
| `standard-m` | requirements_alignment → planning → implementation → code_review → verification → finalize | 需求文档.md + 实施计划.md |
| `light-l` | planning → implementation → code_review → verification → finalize | 实施计划.md |
| `standard-l` | 同 standard-m | 同 standard-m |

**风险标签不改变路线**,只通过 `riskEnhancements`(contract.json:46)增加审查/验证/回滚/批准义务。

### 2.3 阶段与步骤

- 阶段是路线里的大格子,`dev_flow_next` 告诉你当前在哪个格子;
- 阶段内等价操作自由排序,但**不能跳阶段**;
- 每个步骤在 `state.steps` 里标记 `pending` / `satisfied` + 证据。

### 2.4 义务(obligation)

"待办清单",由 `policy/obligations.ts` 的 `deriveObligations` 纯函数推导:

| 路线 | 默认义务 |
|------|---------|
| XS / S | checkpoint(自动) |
| light M | checkpoint |
| light L | **approval + checkpoint + rollback** |
| standard M | **approval + checkpoint + review** |
| standard L | **approval + checkpoint + review + rollback** |

义务未满足时 `dev_flow_finalize` 返回 `OBLIGATIONS_INCOMPLETE` 拒绝收尾——这就是"留证据"的强制力。

### 2.5 MCP 工具是唯一入口

模型不知道走哪条路线,必须调 MCP 问插件。`mcp/server.ts:830` 的 `call()` 是全部工具的分发入口:`dev_flow_start`、`dev_flow_classify`、`dev_flow_lock_classification`、`dev_flow_next`、`dev_flow_status`、`dev_flow_verify`、`dev_flow_finalize` 等。

注意:**分类和锁定是两个工具**——先"预览"再"原子锁定",因为分类必须基于事实调查,不能拍脑袋。

---

## 3. 代码分层

```
skills/            教模型"怎么干活"(task、plan、implement、verify、finish…)
mcp/               MCP 服务器:唯一对外入口,参数校验与分发(server.ts、tools/)
core/              状态机与业务逻辑:state-store.ts(1461 行)等
policy/            纯函数:路线/义务/阶段/证据推导(route.ts、obligations.ts、derive-next.ts)
hosts/             宿主适配器(hook):claude-adapter.ts、codex-adapter.ts、adapter-policy.ts
policy/*.json      合同数据:contract.json + 各类 schema
dist/              构建产物(受版本控制,只能通过 npm run build 更新)
```

依赖方向(单向,干净):

```
skills → mcp → core → policy
hosts  → core(记录事件)、policy(评估写入)
```

- **policy 是纯函数,无 I/O**——规则可回归测试;
- **core 依赖 policy 不依赖 hosts**——状态机不知道"宿主是谁";
- **hosts 独立打包**(`dist/claude-hook.mjs`),不经过 MCP 也能做写入守卫。

一个请求的完整旅程:

```
模型调 dev_flow_start
  → MCP server call() 分发 → core/startFeature() → policy 校验
模型执行 "git commit"
  → PreToolUse hook → hosts/claude-adapter.ts → adapter-policy.ts 评估
  → 未 logic-complete?→ block(DEV_FLOW_GIT_GUARD)
```

**状态推进走 MCP(前台)、写入守卫走 hook(门卫)**,双通道各司其职。

---

## 4. 一次完整工作流走查

以 **standard-m** 为例,从开任务到收尾:

### 第 0 幕:初始化(每个仓库一次)

`dev_flow_init_project` → 写 `.dev-flow/project.json`(验证命令、protectedRoots、enforcement)。没初始化,`dev_flow_start` 直接报 `PROJECT_NOT_INITIALIZED`(state-store.ts:216)。

### 第 1 幕:开任务(`startFeature`, state-store.ts:379)

1. 检查无开放恢复/回滚事务、无已存在的 active feature(`ACTIVE_FEATURE_CONFLICT`);
2. 对 protectedRoots 做指纹 + 交付基线;
3. 写 `state.json`:mode `intake`、revision 0;**此刻没有路线**;
4. 记事件账本 + 写 active 指针。

### 第 2 幕:调查与决策

模型读代码/文档/测试收集事实;用户拍板的问题记入决策台账:

```
dev_flow_record_decision(question, factRefs)    → 打开决策
dev_flow_resolve_decision(evidence, conclusion) → 闭合决策
```

`dev_flow_next` 此时返回 `intake: resolve-decision`(有未决决策)或 `intake: investigate`(该锁分类了)。

### 第 3 幕:锁定分类(`lockClassification`, state-store.ts:449)

四道检查 + 一次重算:

1. `selectBaseRoute` 重算,有矛盾 → `CLASSIFICATION_CONTRADICTION`;
2. CAS:revision 不匹配 → `STATE_REVISION_CONFLICT`;
3. mode 非 intake → `CLASSIFICATION_ALREADY_LOCKED`;
4. 影响分类的决策未解决 → `OPEN_CLASSIFICATION_DECISIONS`。

通过后初始化:mode `routed`、route、classification、obligations、全部 steps 置 pending,standard 路线同时建 traceability/review 快照指针。

### 第 4 幕:推进循环(状态机引擎)

`dev_flow_next` → `nextAction()`(core/next.ts:138)→ 纯函数 `deriveNext`(policy/derive-next.ts,全文 39 行):

```
if finalized        → done
if repair 卡住       → waiting-user
if blocking finding → stop
if approval 未满足 && implementation 之前步骤全完成 → present-human-gate
逐个查 steps:第一个 pending 的 → run-step / scaffold-artifact
全部完成 → feature-check → finalize → done
```

各阶段实际动作:

| 阶段 | 工具 | 内容 |
|------|------|------|
| requirements_alignment | scaffold_artifact + record_artifact | 生成并登记 `需求文档.md`(带 sha256) |
| planning | record_artifact_with_trace | 登记 `实施计划.md` + trace 增量 |
| planning(内嵌) | create_review_batch → claim/submit_review_job | 三角色独立计划审查,blocking 必须闭合 |
| 审批(动态) | present_approval / confirm_approval | 实现前最后一道人闸 |
| implementation | begin/checkpoint_implementation_unit | 自动捕获基线/检查点,hook 审计每次写入 |
| code_review | record_step(reviewType: "code") | 轻量审查证据 |
| verification | dev_flow_verify | 跑 project 验证命令 + 指纹比对 |
| finalize | dev_flow_finalize | 义务全满足才 logic-complete |

### 第 5 幕:统一 mutation 流水线(`mutatePreparedLocked`, state-store.ts:587)

所有 mutation 工具走同一记账方式:读状态 + schema 校验 → 无开放回滚事务 → CAS → 变更(revision+1)→ 预写投影 → 整体校验 → `writeAtomic`(临时文件 → fsync → rename → 目录 fsync)→ 写投影/事件/active 指针。

### 第 6 幕:收尾

`dev_flow_finalize` 检查验证未失效、义务全满足、步骤在 finalize、trace gate current,通过后 logicComplete = true、清空 active 指针。**收尾前 hook 一直拦 Git 写入**。

---

## 5. 关键机制深挖

### 5.1 分类:需求如何变成路线

四步:`start 建卡(intake)` → `调查事实` → `分类(预览)` → `锁定(原子)`。

分类依据必须携带五类事实(`route.ts:67` `validateBasis`):`scopeFacts`(范围)、`topologyFacts`(拓扑)、`uncertaintyFacts`(不确定项)、`riskFacts`(风险事实,必须逐标签给证据)、`decisionRefs`(决策台账引用)。

推荐模式(`recommendClassification`, route.ts:218)的推导规则:

```
impactScope: single-location → XS | single-module → S | cross-module → M
topology:    coordinatedRollback → coordinated-rollback(最低 L)
             independentChains>=2 → multi-chain(最低 L)
             sharedContract → shared-contract(最低 M)
             否则 → local
level = max(影响范围级别, 拓扑最低级别)
execution(M/L 时): requirements ≠ provided-confirmed 或 formalControls 非空 → standard,否则 light
```

**用户能不能指定路线?** 能(模式 B 直接传 level/topology),但有三个天花板:拓扑最低级别(只能向上)、结构矛盾校验(XS/S 不许带 execution 等)、风险标签必须给事实。锁定后 `dev_flow_reclassify` 只能更严或受限的 standard→light(需用户明确要求 + `userEvidence`,state-store.ts:1351)。

### 5.2 grillme 与需求固化

**两个场景**:

| 场景 | 时机 | 目的 | 产物 |
|------|------|------|------|
| 场景 1 | intake(锁定路线前) | 澄清影响分类的边界决策 | Decision Ledger,lock 时校验 |
| 场景 2 | requirements_alignment(锁定后,仅 standard M/L 强制) | 逐题压测需求 | 决策台账 + 需求文档 `grill_status` |

**需求固化 = 需求文档 front matter 的 `grill_status: complete`**,硬门禁 `assertRequirementsGrillSatisfied`(requirements-grill.ts:347)挂在 record_step / approval / verify 等所有关键动作上。时序:

```
intake(可选 grill 澄清分类决策)→ lock → requirements_alignment 阶段内:
scaffold 需求文档(模板带 grill_status)→ grillme 逐题 → complete → 登记 → 记录步骤
→ planning(此后需求变更会作废其后所有步骤与批准)
```

`provided-confirmed`(需求已确认)时:模板直接给 `not_required`(artifact-templates.ts:24),门禁允许 `not_required`/`complete`——**不 grill 是设计好的绿灯路径**;但仍可显式调 grillme。

### 5.3 用户确认门禁地图(grillme 之外)

| # | 门禁 | 工具 | 触发 |
|---|------|------|------|
| 1 | 执行批准 | present_approval → confirm_approval | approval 义务 + 实现前条件齐备 |
| 2 | 回滚确认 | present_rollback_gate | 每次执行回滚前 |
| 3 | 审查风险接受 | present_review_risk_acceptance | blocking finding 选择接受风险 |
| 4 | 修复卡住 | waiting-user | 验证失败连续无进展 |
| 5 | 宿主原生确认 | PermissionRequest | 写操作/Git(所有路线兜底) |
| 6 | 异常路径 | reclassify / abandon / recover / switch | 需用户理由/证据 |

**XS/S/light M 没有义务门禁**(无 approval/review/rollback),但有:宿主 PermissionRequest、分类决策、修复卡住时问人。**风险标签是开关**:`security`/`money`/`critical_correctness`/`irreversible_consequence` 会给任何路线加 approval 义务(obligations.ts:78)。

### 5.4 计划审查(plan-review)

- **只属于 standard M/L**(obligations.ts:66);
- 角色:基础 3 个(requirements-coverage / architecture-testability / rollback-operability),`security` 加 security、`data`/`money`/`irreversible_consequence` 加 data-irreversibility,**最多 5 个**(review.ts:336);
- 输入是创建批次时**冻结的不可变快照**,`basisHash` 幂等(计划没改永不重审,review-jobs.ts:384);
- **同一个模型分饰多角**(默认),保证等级四阶(review.ts:184):

```
multi-perspective(默认,诚实标注最低)
→ independent-sampling(服务端采样,请求哈希独立)
→ multi-agent-attested(宿主 subagent,≥2 个不同 agentId + raw)
→ multi-agent-verified(可信验证器)
```

- blocking finding 必须闭合(修复或用户风险接受),warning/note 不阻塞;
- **code_review 阶段与 plan-review 不同**:code_review 全路线统一轻量(证据只有一个 `reviewType: "code"` 字段,evidence.ts:31),standard 的重心在计划审查。

### 5.5 checkpoint 与回滚引擎

**捕获**:单元开始时拍 protectedRoots 全量快照,文件字节按内容寻址存 blob(`checkpoints.ts`),完成时 diff 产出"恢复指令表"。

**执行**(`rollback.ts`,事务化四阶段):

```
① captureBackup    回滚前全量快照到事务目录(补偿的底牌)
② applyFilePlan    按 journal 从 nextFileIndex 逐条执行:
                   restore → 从 blob 恢复(回来还要验 digest)
                   delete  → 移入事务 trash(绝不 unlink)
③ 回滚验证          跑 journal 的 rollback_verification 命令
④ 失败 → 补偿      用全量备份还原工作区
```

**恢复保障**:journal 先行 + 前缀推进(崩溃 resume 跳过已完成);drive lease 租约(同一时刻只有一个驱动者);全程四道 fail-closed 漂移检查(`ROLLBACK_HASH_MISMATCH`,宁可停下也不覆盖用户编辑)。

**使用边界**:

| 时机 | 能否回滚 |
|------|---------|
| 实现中/实现后未 finalize | ✅ 引擎回滚到任意已确认 checkpoint |
| **finalize 之后** | ❌ 引擎已结束;走 git revert + 新任务(delivery snapshot 是交付层证据) |

用户操作:自然语言说"回滚到 XX 检查点" → 模型 `preview_rollback` 展示影响面 → 你确认门禁 → `execute_rollback` → 单元标记 rolled_back,重新实现。**不需要用户发任何文档**。

### 5.6 失败路径设计

核心哲学:**"确定危险就挡(fail-closed),不确定就放行(fail-open)"——靠确定性分界,不靠猜**。

| 层 | 机制 |
|----|------|
| 数据层 | 原子写(临时文件+fsync+rename+目录 fsync)、revision CAS、死锁回收(30s)、events.jsonl 追加+fsync;失败不落库,已提交则保留(`STATE_COMMITTED_PROJECTION_FAILED`) |
| hook 层 | 无法解析的命令 → 放行交给宿主 sandbox;hook 自身异常 → advisory + allow(`DEV_FLOW_HOOK_EVALUATION_FAILED`);控制文件写入任何情况都拦;Git 写入门禁;状态不可读时 protected 目标 fail-closed |
| 恢复层 | `dev_flow_doctor` 只读诊断 → `recoverCorruptFeature`:digest 匹配校验、开放回滚事务拒绝、状态可读拒绝;恢复事务日志先行,中断可 resume,整目录备份到 `.dev-flow/recovered/` |
| 修复层 | 验证失败保留工作与尝试记录,有进展自动继续,无进展才 `waiting-user`(derive-next.ts:7) |

每处代码都有 `options.fault?.()` 故障注入点,测试可模拟任意时刻崩溃验证不产生半状态。

### 5.7 中断与恢复(会话丢失怎么办)

- 状态实时落盘,原子写保证任何瞬间文件完整;**会话关闭只是模型失忆,账本还在**;
- 新会话:`dev_flow_status`(读 active 指针、看 progress 是否在等人)→ `dev_flow_next`(拿下一个 action)照着做;
- 状态损坏:doctor → recover(备份 abandon);指针损坏需用 doctor 给的 `activeSha256` 证据续办,**禁止手改 `.dev-flow/`**;
- **跨宿主接力**:账本共用,`lastUpdatedBy` 记录宿主——Claude 开任务 Codex 收尾(或反向)均可。

### 5.8 触发边界:不用 Dev Flow 时它完全隐身

- MCP 工具纯被动:模型不调不执行;
- Skills 按 description 匹配,模型自主选用;
- **hook 无 active feature 时全放行**(adapter-policy.ts:817 `loaded.kind === "none" → return undefined`),唯一例外:直接写 `.dev-flow/` 控制文件仍被拦;
- Git 门禁只在有 active workflow 时生效。

所以"AGENTS.md + 自定义 hook"的轻量用法与 Dev Flow 完全兼容——**装上 ≠ 被管住,开了任务才被管住**。唯一意外被管住的场景:仓库残留未 finalize 的 active feature。

---

## 6. 常见问题 FAQ

### Q1: 需求是怎么确定路线的?分类依据是什么?

分类 = 模型调查的仓库事实 + 用户拍板的决策(五类 facts + decisionRefs)。路线由 规模 × 拓扑 × 执行方式 查表得出;拓扑有最低级别硬约束;风险标签只加义务不改路线。详见 [5.1](#51-分类需求如何变成路线)。

### Q2: 风险不影响路线,standard 只是多文档和更严校验?

方向对。精确说 standard 比 light 多三样:**强制文档(需求+计划)、独立 plan-review、approval+review 义务**。且 risk 标签可给任何路线追加义务。

### Q3: 用户能自己指定走哪条路线吗?

能(直接传 level/topology),但只能向上不能向下:拓扑最低级别锁死下限;锁定后 reclassify 只能升级或受限的 standard→light(需用户证据),想大幅降级只能 abandon 重开。

### Q4: 流程中途断线/关机,状态会丢吗?下次怎么继续?

不会丢:状态原子落盘,账本在磁盘。新会话说"继续",模型先 `dev_flow_status` 再 `dev_flow_next` 接着做;等待用户确认时 status 会显示 Q-id/gate 提示。损坏走 doctor + recover。

### Q5: 需求固化发生在写需求文档前还是 planning 后?

发生在 **requirements_alignment 阶段内、写需求文档的过程中**:grillme 逐题压测 → `grill_status: complete` 即固化 → 登记文档 → 记录步骤(有硬门禁)→ 才能进 planning。需求文档一变,其后所有步骤和批准全部作废。

### Q6: provided-confirmed(需求已确认)不触发 grillme 正常吗?

正常且是设计好的绿灯:模板默认 `not_required`,门禁允许;但随时可显式调 grillme。

### Q7: XS 这种小任务边界不清也会触发 grillme 吗?

**提问与否由"决策缺口"决定,与分级无关**。但机制上:X/S/light M 的 grill 工具只在 intake(锁定前)可用(锁定后无需求文档载体,`MISSING_REQUIRED_ARTIFACT`);锁定后遇到边界问题,模型直接对话问 + `record_decision` 记台账。standard 锁定后还有强制 grill 流程。

### Q8: light 路线锁定后突然遇到边界问题,模型怎么办?

模型直接问用户(对话层面),回答用 `record_decision`/`resolve_decision` 记入台账;注意 routed 后 open 决策不阻塞状态机——台账是审计记录不是门禁(light 路线的自治哲学)。问题动摇了分类则 reclassify 升级或 abandon。

### Q9: 计划审查用同一个模型审自己,效果打折吗?

打折,但系统不假装解决:默认等级 `multi-perspective` 被诚实标注为最低;输入是冻结快照(改不了);finding 有结构化协议;可选升级到采样 / subagent attestation。保证等级按证据推导,不可自报。

### Q10: 写实施计划之后会发生什么?

planning 内:三角色 plan-review(创建批次 → 认领 → 提交 → blocking 闭合)→ 记录步骤(门禁:审查必须 complete)→ **approval 人闸**(动态义务)→ 进入 implementation(自动基线 checkpoint → 按依赖顺序 begin/checkpoint 单元)→ code_review(轻量)→ verification(指纹保护)→ finalize。

### Q11: 验证场景是 TDD 测试先行吗?

不是。计划里的 TEST 是"验收条件 ↔ 验证场景"的 trace 映射,不是测试代码;验证在实现后统一跑 project 验证命令 + 支持人工验收(manualAcceptance);"不绿不放行"靠**指纹**实现——验证后改任何 protected 文件,验证自动变 stale 必须重验。

### Q12: 回滚什么时候用?用户怎么操作?

**finalize 前**:发现做错 → 自然语言"回滚到 XX 检查点" → 模型预览影响面 → 你确认门禁 → 执行。finalize 后引擎不可用,走 git revert + 新任务。详见 [5.5](#55-checkpoint-与回滚引擎)。

### Q13: finalize 是 code_review 之后自动执行的吗?人工来不及验证怎么办?

**不是自动的**:`dev_flow_finalize` 是显式工具调用,`deriveNext` 只返回"建议 finalize"。时序是 code_review → **verification(人工验证的位置,支持 manualAcceptance 三模式)** → finalize。finalize 本身还有一串门禁(验证指纹、义务、步骤、trace)。模型会先展示"建议收尾",你喊停它就停。

### Q14: XS/S 和 light M/L 中间没有确认门禁吗?

义务门禁(approval/review/rollback)默认没有(XS/S/light M),但:宿主 PermissionRequest 永远兜底、分类决策要人工、验证失败会停人。light L 默认就有 approval + rollback。风险标签可随时给任何路线开 approval。

### Q15: light M 的"没有 review"是没有 code_review 阶段吗?

不是。code_review **阶段** M/L 都有(XS/S 才没有),但全路线统一是轻量记录(一个 `reviewType: "code"` 字段);standard 的 review **义务**指 planning 内的三角色 plan-review,与 code_review 阶段是两回事,互不顶替。

### Q16: 插件自带 code-review 技能和强审查技能(AI-aggregation 版)比,哪个效果好?

插件版是"流程壳"(8 行,只教登记),强审查版是"方法论本体"(双轴子代理 + Fowler 坏味道 + 固定点 diff)——**论审查效果强审查版明显更强**。最佳实践:让强技能干活、Dev Flow 记账(审查完 `record_step(code_review)` 登记),可通过增强技能正文或 AGENTS.md 绑定,与流程自动绑定。注意适配:实现期代码未提交,固定点应改用 checkpoint 基线;subagent 措辞要宿主无关。

### Q17: 不用 Dev Flow 的话,它会影响我正常使用吗?

不会。装上不触发 = 零拦截(唯一例外:手改 `.dev-flow/` 控制文件);只要不调 `dev_flow_start` 开任务,hook 无 active feature 时全放行。它是可选治理,不是强制监工。

---

## 7. 操作速查

### 日常

| 目的 | 怎么做 |
|------|--------|
| 初始化项目 | 对话中让模型调 `dev_flow_init_project`(每个业务仓一次) |
| 开任务 | `/dev-flow:task` 或自然语言 → `dev_flow_start` 建 intake |
| 看状态 | `/dev-flow:status` 或「Dev Flow 状态」 |
| 下一步 | 始终参考 `dev_flow_next` 的返回 |
| 诊断 | `/dev-flow:doctor` |
| 收尾 | `/dev-flow:finish`(所有义务满足后) |
| 需求拷问 | 标准 M/L 自动进 `/dev-flow:grillme`,或显式说"拷问" |

### 门禁交互

- **执行批准**:模型展示执行摘要 → 你确认或提修改意见;
- **回滚确认**:模型展示预览(恢复/删除哪些文件)→ 确认 → 执行;
- **grill 决策**:逐题选择/回复(支持"合并剩余按推荐答案一次确认");
- **修复卡住**:模型问你怎么处理(修订/回滚/调整计划),回答后自动继续。

### 断线/换宿主

```
新会话:说"继续" → 模型先 status 再看 next → 照着做
等待中的确认:status 会显示 Q-id/gate,回复即可(合法等待不是失败)
换宿主:直接在另一个宿主打开说"继续",账本共用
```

---

## 附:源码速查表

| 想找什么 | 文件 |
|---------|------|
| 路线合同 | `policy/contract.json` |
| 路线选择/分类 | `policy/route.ts` |
| 义务推导 | `policy/obligations.ts` |
| 下一步推导(状态机引擎) | `policy/derive-next.ts`、`core/next.ts` |
| 阶段能力视图 | `policy/stages.ts` |
| 证据要求 | `policy/evidence.ts` |
| 状态存储/全部 mutation | `core/state-store.ts` |
| 需求拷问/固化门禁 | `core/requirements-grill.ts` |
| 计划审查批次 | `core/review-jobs.ts` |
| 回滚引擎 | `core/rollback.ts` |
| checkpoint | `core/checkpoints.ts` |
| 验证 | `core/verification.ts` |
| 收尾/完备检查 | `core/feature-check.ts` |
| hook 写入评估 | `hosts/adapter-policy.ts` |
| 宿主适配器 | `hosts/claude-adapter.ts`、`hosts/codex-adapter.ts` |
| MCP 工具分发 | `mcp/server.ts` |
