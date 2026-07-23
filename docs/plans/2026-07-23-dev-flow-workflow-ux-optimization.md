# Dev Flow 插件工作流 UX 与严格性优化实施计划

| 字段 | 内容 |
| --- | --- |
| 状态 | 已实施（1.3.0 代码落地；双宿主人工回放仍为发布阻断项） |
| 日期 | 2026-07-23 |
| 依据 | 真实会话 `ziwei-result-glass-align`（误分为 `standard-M` 的视觉对齐小改） |
| 对话记录 | 仓库根目录 `2026-07-23-171017-local-command-caveatcaveat-the-messages-below.txt` |
| 审查基线 | `2f1ba13` / `1.2.0`；`npm test` 已通过（33 unit、16 e2e，通过；2 native 安装测试按配置跳过） |
| 目标版本 | `1.2.0` → `1.3.0`（可见流程行为与 MCP 响应增强） |

---

## 1. 背景、结论与范围

真实需求为「紫微白昼结果页参考八字页，改为拟态磨玻璃与低光效果」。用户已经提供截图、参考实现、`DESIGN.md` 与明确范围，预计业务改动约两个文件；但会话被分类为 `standard-M`，经过五轮 grill、两个 HUMAN GATE 和多份流程资产才开始改 CSS。

用户认可需求不清时保留 grill 与人工门禁；真正痛点是：

1. grill 问题重复、粒度过细；
2. 被阻塞或等回复时像「流程中断」，不知道当前阶段和继续方式；
3. 小任务被分到偏重路线，流程与思考成本过高。

审查另外确认了两项必须先修的严格性漏洞：

1. `dev_flow_start` 当前接受任意 `scope` 对象并直接写入 `state.json`，读取时才校验。一次错误输入可由 MCP 自己制造不可读的 active state，随后诱发 agent 手改状态文件。
2. 允许 agent 写整个 `.dev-flow/**` 与「状态只由 MCP 推进」互相矛盾；`state.json`、`active.json`、events、锁文件都不应成为可写工作流资产。

本计划保留严格模式、grill 和 HUMAN GATE；优先修复 state 完整性、hook 误伤与可解释等待，然后降低无意义的流程成本。

---

## 2. 目标与非目标

### 2.1 目标

1. **状态可信**：MCP 不会创建非法 state；agent 不能直接改工作流控制文件；已有损坏 state 有保守、可审计的退出路径。
2. **阻塞可理解**：合法等待与错误拦截都能说明 feature、阶段、原因、继续动作和剩余路线。
3. **grill 高质量**：不问仓库可推导事实，不重复拆问同一决策；有参考页和截图的视觉任务默认最多三题。
4. **分级成本可控**：小任务默认选较轻路线；start 后解释路线；只允许在安全边界内、用户明确要求时降级。
5. **不削弱严格模式**：implementation approval 前仍禁止写 protected business roots；Git guard、CAS、gate provenance 与 artifact integrity 继续生效。

### 2.2 非目标

- 取消 grillme、HUMAN GATE 或 strict enforcement。
- 新增路线 ID（例如 `standard-m-lite`）。
- OpenSpec 集成、跨宿主架构重写、state schema v2。
- 对损坏 state 自动猜测并重建业务流程；恢复只允许备份并安全放弃。
- 自动判断所有任务何时该选 light/standard；本轮仅提供 skill 启发式和受限降级。

---

## 3. 已锁定的设计决策

| 项 | 决策 |
| --- | --- |
| `.dev-flow` 写入权限 | **控制文件仅 MCP 可写**。agent 仅可编辑 active feature、已由 MCP 脚手架并登记的非生成 Markdown artifact；不能写 `state.json`、`active.json`、`project.json`、`events.jsonl`、`.lock/**`、`status.md`，也不能写其他 feature。 |
| Bash 判定 | 只根据解析出的写目标判断，绝不扫描 heredoc 正文；同一命令全部写目标都必须可解析。含写语法但无法完整解析时 fail closed。 |
| 损坏 state | 新 feature 在写盘前验证。旧损坏 state 只能经带 digest 和用户证据的 MCP recovery 备份并 abandon；不允许手修或自动重建。 |
| progress | 不修改 feature state schema。`dev_flow_status` 返回 `StatusView = state + progress`；grill 等待信息来自 requirements artifact 的受限 front matter，而非猜测 Markdown 正文。 |
| 降级 reclassify | 1.3 仅允许**同 level、同 topology、同 risk labels**的 `standard → light`；禁止 `M → S`、`L → M`、降低 topology 或移除风险。必须未进入/确认 implementation approval、implementation 未 satisfied、protected roots 自 start 起未变且有用户原话。 |
| 审计 | 所有 reclassify event 记录旧/新 classification、reason、userEvidence、失效的步骤/资产；现有「只可升严」行为继续支持且不要求 userEvidence。 |

---

## 4. 现状根因与修复映射

| 痛点 / 漏洞 | 已确认根因 | 修复阶段 |
| --- | --- | --- |
| MCP 启动后直接卡死 | `startFeature` 未验证 input scope，写出无效 state，之后 `readState` 才失败 | Phase 0 |
| 写 requirements 时被拦 | Bash hook 在整段 command 上匹配 `protectedRoots`；heredoc 正文包含 `apps/...` 即误判 | Phase 1 |
| 手改 state 破坏严格性 | `.dev-flow/**` 被视为整体可写；skill 禁令不是 enforcement | Phase 1 |
| 「继续」后仍不知道怎么做 | state 未表达 grill 当前题；status 只返回 raw state，无法生成可靠提示 | Phase 2 |
| implementation gate 没有统一说明 | 实际负责该 gate 的是 `plan` skill，而非 `plan-review` 或 `implement` | Phase 2 |
| grill 连环提问 | skill 只限制每轮一题，没有可推导性、去重和合并规则 | Phase 3 |
| 错分后只能硬走 standard | `reclassifyFeature` 仅允许升严；现有 event payload 固定为空对象，无法审计降级证据 | Phase 4 |

---

## 5. Phase 0 — 启动输入完整性与损坏 state 恢复（P0）

### 5.1 写入前验证 `dev_flow_start`

**文件**：

- `plugins/dev-flow/src/mcp/server.ts`
- `plugins/dev-flow/src/core/state-store.ts`
- `tests/unit/state-store.test.mjs`
- `tests/unit/mcp-server.test.mjs`

**实施**：

1. 将 `dev_flow_start.scope` schema 固定为对象，要求 `inScope`、`outOfScope` 两个字段，值均为 `string[]`，并拒绝额外字段。
2. 在 `startFeature` 内独立验证 scope，不能只依赖 MCP schema；所有入口在写 feature directory、`state.json`、event 与 `active.json` 前完成验证。
3. 允许省略 scope 时仍使用 `{ inScope: [], outOfScope: [] }`。
4. 验证失败返回 `INVALID_START_INPUT`（或现有 `INVALID_STATE_SCHEMA` 的明确子错误），附 `details.recoveryHint`：修正 `scope.inScope/outOfScope` 后重新调用 `dev_flow_start`。

**验收**：非法 scope 被拒绝后不存在 active pointer、feature state 或 started event；合法 start 的 state 可立即被 `dev_flow_status` 读取。

### 5.2 已损坏 state 的保守恢复

**文件**：

- `plugins/dev-flow/src/core/state-store.ts`
- `plugins/dev-flow/src/mcp/server.ts`
- `plugins/dev-flow/src/mcp/doctor.ts`
- `plugins/dev-flow/src/core/errors.ts`
- `tests/unit/state-recovery.test.mjs`

**新增 MCP**：`dev_flow_recover_corrupt_feature`

| 入参 | 约束 |
| --- | --- |
| `featureId` | 必须是 `active.json` 指向的 feature |
| `stateSha256` | 必须等于 doctor 报告的当前损坏 state digest，避免过期/误目标恢复 |
| `action` | 1.3 只允许 `abandon` |
| `reason`、`userEvidence`、`host` | 均必填；evidence 为用户明确同意放弃并重开 |

**行为**：

1. `dev_flow_doctor` 检测到 active state 不可读时，不吞掉错误；返回 `corruptFeature`、`stateSha256`、唯一推荐动作和 recoveryHint。
2. recovery 与 `mutate` 使用同级 feature/recovery lock；持锁后再次校验 active pointer 与 state digest，防止 doctor 输出过期时误恢复。
3. recovery 不解析或修补 state，也不声称跨文件事务原子。它使用可恢复 journal：写入并 fsync `.dev-flow/recovery-transaction.json` 的 `prepared` 记录 → 原子 rename 整个 feature directory 到 `.dev-flow/recovered/<featureId>-<timestamp>/` → 仅在 active pointer 仍指向该 feature 时原子清除 `active.json` → 追加 `.dev-flow/recovery-events.jsonl` 的 `completed` 审计记录并清除 journal。
4. 任一步失败时保留 journal；doctor 必须报告已完成的阶段和唯一安全的 resume/rollback 动作。active pointer 指向缺失或损坏 feature 的中间状态继续 fail closed，绝不能靠手改绕过。
5. recovery 成功后用户可用正常的 `dev_flow_start` 开新 feature；原始损坏数据始终保留供人工排查。

**验收**：doctor → recovery → start 新 feature 的完整流程不需手改 `.dev-flow`；digest 不匹配、非 active feature、缺 userEvidence、并发 recovery 都拒绝且不移动文件。模拟 rename/clear-active/append-event 任一阶段失败时，journal 可被 doctor 识别，且不会出现可继续写 protected roots 的 fail-open 路径。

---

## 6. Phase 1 — Hook 写入边界、目标解析与错误提示（P0）

### 6.1 以 artifact allowlist 取代 `.dev-flow/**` 放行

**文件**：

- `plugins/dev-flow/src/hosts/adapter-policy.ts`
- `plugins/dev-flow/src/hosts/claude-adapter.ts`
- `plugins/dev-flow/src/hosts/codex-adapter.ts`
- `tests/unit/adapter-policy.test.mjs`

**规则**：

1. 读取 active state 后，构建可编辑路径集合：仅 `state.artifacts` 内、非 `status`、路径为 active feature 目录直属的已登记 Markdown artifact。
2. Direct Write/Edit/Patch 的每个目标都走 canonical project-relative path 检查；拒绝路径穿越、符号链接和其他 feature 路径。
3. 控制文件写入始终返回 `DEV_FLOW_STATE_MUTATION_FORBIDDEN`，无论 implementation approval 是否已确认。
4. 非 `.dev-flow` 目标维持既有策略：目标在 protected roots 且未批准时返回 `DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED`；非 protected 目标放行。

### 6.1.1 Active workflow 损坏时必须 fail closed

adapter 不得再笼统 catch `preToolBlockReason` 的任意错误后放行。必须区分「没有工作流」与「工作流损坏」：

| 状态 | hook 行为 |
| --- | --- |
| `.dev-flow` / `active.json` 不存在，或没有 active feature | 放行；没有可执行工作流。 |
| active feature 存在，state 不可读、state digest 不一致或 project config 不可读 | 拒绝所有 `.dev-flow` 写入；拒绝 protected-root 写入。project config 也不可读时，因无法可靠识别 protected roots，拒绝全部写入。 |
| active feature 的 state 与 project config 均可读 | 按 6.1、6.2 的 artifact allowlist 与 approval 规则执行。 |

损坏路径统一返回 `DEV_FLOW_WORKFLOW_STATE_UNREADABLE`，提示运行 `dev_flow_doctor`；若 doctor 识别到 corrupt active feature，则按 Phase 0 的 recovery 流程处理。该 code 不得被 implementation approval 覆盖。

未由 MCP scaffold 并登记在 `state.artifacts` 的 artifact 路径不在 allowlist，即使路径名是 `requirements.md` 也必须拒绝；建议返回专用 code `DEV_FLOW_ARTIFACT_NOT_REGISTERED`，使用户能区分控制文件与尚未脚手架的证据文件。

### 6.2 Bash 写目标解析

将现有布尔函数替换为返回全部写目标及解析状态的内部结果，例如：

```ts
type WriteTargetAnalysis =
  | { kind: "read-only" }
  | { kind: "resolved"; targets: string[] }
  | { kind: "unresolved"; syntax: string };
```

**首批支持的确定形式**：shell 重定向（`>` / `>>`）、`tee`、`cat >`、`touch`、`mkdir`、`rm`、`mv`、`cp`、`sed -i`、`perl -pi` 与分号/`&&`/管道连接的多命令。必须枚举整段命令的全部写目标，不能因为第一个目标合法就放行后续目标。

**fail-closed**：带写语法但存在变量展开、`sh -c`、`xargs`、解释器内联写盘、未支持重定向或其他无法确定的写目标时，返回 `DEV_FLOW_WRITE_TARGET_UNRESOLVED`。该 code 不表示 approval 缺失，提示拆分为可识别命令或改用 MCP artifact 流程。

### 6.3 Hook 错误的机器 code 与人类提示

保持宿主 `reason` 的字符串兼容性：第一个 token 永远是稳定 code，其后可附 `: <recovery hint>`。内部先返回 `{ code, recoveryHint }`，adapter 最后序列化，避免业务逻辑依赖拼接字符串。

| code | recovery hint |
| --- | --- |
| `DEV_FLOW_STATE_MUTATION_FORBIDDEN` | 状态只由 MCP 推进；编辑已登记 artifact，或用 doctor/recovery 处理损坏 state。 |
| `DEV_FLOW_ARTIFACT_NOT_REGISTERED` | 先由 MCP scaffold 当前步骤要求的 artifact，再编辑并 record artifact。 |
| `DEV_FLOW_WORKFLOW_STATE_UNREADABLE` | active workflow 无法安全读取；运行 doctor，必要时按 recovery abandon 后重开。 |
| `DEV_FLOW_WRITE_TARGET_UNRESOLVED` | 拆分成可解析写入命令；不要把 workflow artifact 与业务写入混在一条 Bash 中。 |
| `DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED` | 目标在 protected root；完成当前路线并等待 implementation approval。 |
| `DEV_FLOW_GIT_GUARD` | feature 未 logic-complete；先完成 verify、feature check 和 finalize。 |

### 6.4 Phase 1 必测矩阵

| 场景 | 期望 |
| --- | --- |
| heredoc 写已登记 `requirements.md`，正文含 `apps/web` | 放行 |
| Write 尚未 scaffold/登记的 `requirements.md` 或其他 artifact | `ARTIFACT_NOT_REGISTERED` |
| Direct Write / Bash 写 `state.json`、`active.json`、`events.jsonl`、其他 feature artifact | `STATE_MUTATION_FORBIDDEN` |
| active 指针存在但 `state.json` 损坏 → Write `apps/...` 或任意 `.dev-flow` 路径 | `WORKFLOW_STATE_UNREADABLE`；不得 fail open |
| active 指针存在但 `project.json` 损坏 → 任意 Write/Bash 写入 | `WORKFLOW_STATE_UNREADABLE`；不得因无法判断 protected roots 而放行 |
| Bash `echo hi > apps/x.ts` 或第二个命令写 `apps/x.ts` | `IMPLEMENTATION_APPROVAL_REQUIRED` |
| `tee` / 重定向写已登记 artifact 后再重定向 protected root | 拦截 |
| `out=apps/x; echo x > "$out"`、`sh -c`、`xargs` | `WRITE_TARGET_UNRESOLVED` |
| `rg apps/web`、仅读 Git 命令 | 放行 |
| approval 已确认后写 business root | 放行；写 workflow control file 仍拦截 |

`task`、`requirements` 与 `grillme` skill 必须写明唯一合法顺序：`dev_flow_scaffold_artifact` → 编辑已登记 artifact → `dev_flow_record_artifact`。禁止抢先 Write 未登记路径；grillme 本身仍不调用 MCP mutation，登记由 requirements 接力完成。

---

## 7. Phase 2 — 可解释的等待与 `dev_flow_status` progress（P0）

### 7.1 明确 progress 的数据源

**文件**：

- 新建 `plugins/dev-flow/src/core/status.ts`
- `plugins/dev-flow/src/core/next.ts`
- `plugins/dev-flow/src/core/requirements-grill.ts`
- `plugins/dev-flow/src/mcp/server.ts`
- `tests/unit/status-progress.test.mjs`

`dev_flow_status` 不再只返回 `FeatureState`；返回向后兼容的 `StatusView`，保留所有原字段并附加 `progress`。`dev_flow_next` 仍只返回唯一动作。

```ts
type Progress = {
  stepIndex: number;       // route orderedSteps 中当前 step，1-based；done 时为 stepTotal
  stepTotal: number;
  currentStep?: string;
  nextAction: NextAction;
  wait:
    | { kind: "none" }
    | { kind: "human-gate"; gate: "requirement_confirmation" | "implementation_approval"; replyHint: string }
    | { kind: "grill"; questionId: string; responseHint: string; questionLimit: number };
};
```

grill 当前题不从自由格式 Markdown 猜测。requirements front matter 在保持 `schema_version: 1` 的前提下增加受限字段：

```yaml
dev_flow:
  grill_status: in_progress
  grill_question_id: Q-002
  grill_response_hint: "回复 A / B / C，或补充偏好"
  grill_question_limit: 3
```

`requirements-grill.ts` 负责解析和校验字段；`grillme` 负责在每一轮同步它们。`grill_status: complete/not_required` 时不允许残留当前题字段。不存在 requirements artifact 时 progress 不报告 grill wait。

每轮集成 grill 的写入和等待顺序固定为：

```text
grillme 更新 requirements front matter 与 Open Questions
  → 交回 requirements skill
  → requirements 立即 dev_flow_record_artifact(requirements)
  → 输出统一停步话术并等待用户
```

禁止只改文件、不登记就等待。否则磁盘中的 Q/hint 与 state 保存的 artifact SHA 会不一致，后续 status、gate basis 和恢复过程会再次表现为「中断」。`grillme` 保持只读 MCP 约束；它通过交接而不是直接 mutation 完成登记。

### 7.2 统一停步话术与正确 skill 归属

每次等待用户必须使用以下紧凑结构：

```text
当前：<featureId> · <route>
阶段：<grill Q-002/≤3 | HUMAN GATE: implementation_approval>
为何等待：<不可由仓库推出的决策 | 需要明确批准>
继续：<responseHint | 确认需求 | 批准实现>
后续：<压缩后的剩余 route steps>
```

**修改 skill 与职责**：

| Skill | 责任 |
| --- | --- |
| `grillme` | 更新受限 grill 元数据，并交回 requirements 完成 artifact 登记；登记后才输出停步话术。 |
| `requirements` | 登记每轮 grill 更新；在 `requirement_confirmation` 给出需求业务摘要。 |
| 当前推进 skill | 当其调用 `dev_flow_next` 得到 `present-human-gate` / `wait-human-gate` 时，负责输出统一停步话术。 |
| `plan-review` / plan 证据链收尾方 | 通常在 `plan_review` 记步后发现 `implementation_approval`，给出计划/风险摘要并 present gate；不是只有 `plan` skill 可以处理。 |
| `implement` | gate 未确认时禁止实现；确认后才可处理 implementation。 |
| `status` | 用户说「继续 / 当前进度」时先调用 status；若 `progress.wait` 非 none，复述该 wait，不重新 start、classify 或直接推进。 |
| `task` | start 成功后输出路线摘要。 |

gate 的归属是**当前 next action**，不是硬编码 skill 名称。`requirements` 对 requirement gate 保留专属业务摘要；implementation gate 由完成 plan 证据链后第一个获得 gate next action 的 skill，或用户后续触发的 `status`，负责解释和继续。这样不会在 `plan_review` 与 approval 之间形成责任断档。

### 7.3 Progress 验收

单测覆盖每种 `NextAction`、requirements 尚未脚手架、grill in progress、grill complete、两个 human gate、finalized、invalid grill metadata。覆盖每轮 grill 编辑后必须先 `record_artifact` 再等待，保证 state SHA 与磁盘一致。E2E 覆盖「用户只说继续」时，status 返回当前 `Q-xxx` 和 response hint，且该只读调用不改变 revision。

---

## 8. Phase 3 — Grill 质量与轻量分类（P1）

### 8.1 Grill 提问准入与合并

**文件**：

- `plugins/dev-flow/skills/grillme/SKILL.md`
- `plugins/dev-flow/skills/requirements/SKILL.md`
- `tests/unit/skills.test.mjs`

一个问题必须同时满足：

1. 不能从用户原文、截图、代码、现有 Decision Log 或已知设计规范推导；可推导事实直接记录为 `Source: codebase`，不问用户。
2. 答案会改变实现路径、范围、不可逆风险或成本；否则写入验收条件。
3. 不与既有用户决定语义重复；同一主题只能有一题。

同一主题的子决策合为 2–3 个互斥组合包。对于「截图 + 参考实现 + 明确视觉目标」的任务，`grill_question_limit` 固定为 **3**；只有出现新架构分支、不可逆风险或预算/配额选择时可扩至 5，且必须在 Decision Log 记录扩展原因。

真实会话中的「背景/低光动效」与「ambient tone」应合为同一题，不得顺序追问。

### 8.2 requirements 状态启发式

| 输入质量 | requirements | grill 行为 |
| --- | --- | --- |
| 一句话、范围或目标不清 | `missing-or-unclear` | 仅问满足准入条件的缺口 |
| 目标、参考与范围已经给出，只缺 1–2 个真实决策 | `documented-unconfirmed` | 补缺口，不重开访谈 |
| 用户提供书面规格且明确确认 / LGTM | `provided-confirmed` | 不自动 grill |

`task` skill 必须先选择 requirements 状态，再决定是否 standard；不能把 `missing-or-unclear` 当作标准路线的默认值。

### 8.3 分类启发式与路线摘要

**文件**：`plugins/dev-flow/skills/task/SKILL.md`

| 信号 | 默认 classification |
| --- | --- |
| 单文件或纯样式/文案；范围清晰；无契约 | `XS` 或 `S`，`topology: local` |
| 多文件但边界清晰；无 API/数据契约；需求足够执行 | `M + execution: light` |
| 真实需求分叉、跨模块行为变化、需明确优先级 | `M + execution: standard`，并按上表选 requirements 状态 |
| 多服务、共享契约或协调回滚 | 按既有 topology minimum 抬级 |

start 成功后、执行 next 之前输出路线摘要：路线和原因、压缩 steps、预计最多的用户交互次数，以及「若范围已锁，可要求在安全边界内降为 light」。不得为此增加一次额外确认。

### 8.4 验收方法

`skills.test` 的 token 断言只能防止技能文本回退，不能证明 agent 行为。除保留 token 断言外，新增一份固定的人工回放脚本（见 Phase 5）：使用本次真实请求，预期默认 `light-m`、0 个 grill 题；若显式设为 standard，最多 3 题且不出现主题重复。

---

## 9. Phase 4 — 受限 reclassify 与可审计降级（P1）

### 9.1 状态与 API 设计

**文件**：

- `plugins/dev-flow/src/core/state-store.ts`
- `plugins/dev-flow/src/core/fingerprint.ts`
- `plugins/dev-flow/src/mcp/server.ts`
- `tests/unit/reclassify.test.mjs`
- `tests/e2e/routes/reclassify-standard-to-light.test.mjs`

1. 新 feature 在 start 时计算并写入可选的 `startBusinessFingerprint`；该字段为 v1 加性字段，旧 state 仍可读取。
2. `dev_flow_reclassify` input 新增可选 `userEvidence`。严格化沿用现有 `reason` 规则；只有降级时强制 `userEvidence`。
3. 将 `mutate` 扩展为能接收 event data；不得再固定写 `{}`。
4. 降级仅在下列条件全部满足时允许：
   - `level`、`topology`、`riskLabels` 完全相同；
   - execution 从 `standard` 改为 `light`；
   - lifecycle 为 active；implementation step 未 satisfied；`implementation_approval` 在 state 中**既未 present（含 pending），也未 confirmed**；
   - `startBusinessFingerprint` 存在，且当前 protected roots fingerprint 相同；旧 feature 缺失 baseline 时 fail closed；
   - `reason` 与用户明确原话 `userEvidence` 均非空。
5. 不允许 `M → S`：它会从 `code_review` 降为 `self_review`，不是单纯减少文档；这类路线降级留给后续有独立风险评估的版本。

### 9.2 失效、审计与用户反馈

降级时按新 route 清除 state 内不再适用的 pending gates、steps、verification 和 artifact registrations；物理 Markdown 文件不删除。event data 至少包含：

```ts
{
  before: Classification,
  after: Classification,
  previousRoute: RouteId,
  nextRoute: RouteId,
  reason: string,
  userEvidence: string,
  invalidatedSteps: string[],
  invalidatedArtifacts: string[]
}
```

返回值与 status progress 必须提示用户：已切换路线、旧文档保留但不再作为当前证据、下一步是什么。

如果 protected roots 的当前 fingerprint 与 `startBusinessFingerprint` 不同，返回 `RECLASSIFICATION_PROTECTED_ROOTS_CHANGED`，并给唯一 recovery hint：不能降级；要么完成当前 standard route，要么 abandon 该 feature 后以更轻 classification 重开。该提示同样适用于 implementation 前的误写业务文件，不能建议用户通过手改 state 或重置 fingerprint 绕过。

### 9.3 必测场景

- standard-M → light-M：用户证据完整、无 protected root 变化，成功并进入 light-M 的 `boundary_plan`。
- implementation approval 已 present（含 pending）或 confirmed、implementation 已 satisfied、protected fingerprint 改变、缺 baseline、缺 userEvidence、试图 `M → S`：全部拒绝；fingerprint 改变时返回上述唯一 recovery hint。
- 严格化 reclassify 仍按原行为可用，event 仍记录 reason。
- 成功降级的 event 包含完整 payload；原 artifact 文件还在，但新 state 不登记无关 asset。

---

## 10. Phase 5 — 验证、回放与发布（P0/P1）

### 10.1 自动化测试清单

| 测试 | 覆盖 |
| --- | --- |
| `tests/unit/state-store.test.mjs`、`mcp-server.test.mjs` | start scope 正反例、失败原子性、MCP schema |
| `tests/unit/state-recovery.test.mjs` | doctor digest、abandon recovery、recovery lock/journal、错误证据和无副作用失败 |
| `tests/unit/adapter-policy.test.mjs` | allowlist、未登记 artifact、控制文件拒绝、损坏 active state/project 时 fail closed、复合 Bash、未知写目标、approval 后仍保护 state |
| `tests/unit/status-progress.test.mjs` | 全部 next/wait 状态、受限 grill metadata |
| `tests/unit/requirements-grill.test.mjs` | 新 front matter 元数据、每轮登记顺序与旧 grill_status 兼容性 |
| `tests/unit/reclassify.test.mjs` | 受限降级、fingerprint、event payload、严格化回归 |
| `tests/unit/skills.test.mjs` | skill owner、停步结构、grill 准入、分类启发式的静态防回退 |
| route / cross-host e2e | standard-M、light-M、reclassify、后续宿主能继续 status 与 gate |

### 10.2 人工回放（发布阻断项）

使用本次真实请求、截图、八字参考页和 `DESIGN.md` 在 Claude 与 Codex 各跑一次：

1. 默认应为 `light-m`（或 XS/S，取决于实际文件边界），不得无解释进入 standard-M。
2. 强制 standard-M 时，视觉任务 grill 最多三题；每次等待都显示统一五行结构。
3. 中途输入「继续」不改变 revision；返回当前 Q/gate 和可执行回复提示。
4. 对已登记 requirements 使用 heredoc 写入、正文包含 `apps/web` 时不误拦；任何 state/control file 写入均拦截。
5. 用户要求「太重了，改 light」时，只在 Phase 4 的所有前提满足下成功；否则给出唯一失败原因。

将回放结果（host、route、题数、wait 文案、是否有误拦）记入 release note，不把 token 测试当作行为证明。

### 10.3 发布步骤

1. 实现各 PR 后依次运行对应 unit/e2e，再运行 `npm test`。
2. 将根 `package.json` 升至 `1.3.0`，运行 `npm run version:sync` 更新两个 plugin manifest。
3. 运行 `npm run build`，提交三份 `plugins/dev-flow/dist/*.mjs`；运行 `npm run build:check` 确认 dist 无漂移。
4. 更新 `README.md`（等待/恢复简述）和 `docs/routes.md`（light/standard 与 reclassify 边界）。
5. 完成 10.2 的双宿主回放后才发布 1.3.0。

---

## 11. 实施顺序与 PR 切分

| PR | 依赖 | 内容 | 完成条件 |
| --- | --- | --- | --- |
| PR-A | 无 | Phase 0：start 输入验证、doctor/recovery、错误提示 | 新旧错误路径均安全；无效 start 不留状态 |
| PR-B | PR-A | Phase 1：artifact allowlist、Bash target analysis、hook reason | heredoc 不误伤；所有 workflow control file 均不可直写 |
| PR-C | PR-A | Phase 2：StatusView、grill metadata、停步话术与正确 skill owner | `继续` 能可靠定位 Q/gate；不改 revision |
| PR-D | PR-C | Phase 3：grill 质量、requirements/classification 启发式 | 真实回放符合题数与默认路线目标 |
| PR-E | PR-A | Phase 4：fingerprint、受限 reclassify、审计 event | 仅标准→轻路线可安全降级；审计可读 |
| PR-F | PR-B–E | Phase 5：完整自动化、双宿主回放、文档、1.3.0 | `npm test`、build check 与发布回放全部通过 |

PR-C 与 PR-D 可并行；PR-E 可在 PR-A 后并行，但必须在 PR-F 前完成。不要将仅 skill 文本改动与 P0 hook/state 改动混在同一 PR。

---

## 12. 风险、约束与成功标准

| 风险 | 缓解 |
| --- | --- |
| Bash 解析不完整 | 只放行全部目标可解析的命令；其余 fail closed，并提供可操作提示。 |
| artifact allowlist 阻断正常写入 | allowlist 从 MCP 已登记 artifact 生成；先覆盖所有 artifact kinds 与两宿主工具形态。 |
| 恢复功能误删数据 | recovery 只 rename 到可审计备份目录，绝不删除或重建 state。 |
| active state 损坏导致 enforcement 失效 | active 存在即不得 fail open；state/project 不可读时拒绝 workflow control 与 protected 写入，project 不可读时拒绝全部写入。 |
| progress 元数据与正文漂移 | front matter 为唯一 machine source；requirements-grill 在登记/推进前校验。 |
| 降级跳过已发生的业务改动 | 以 start fingerprint 比较 protected roots；无 baseline 的旧 feature 禁止降级。 |
| skill 文本不等于 agent 行为 | 自动测试保护确定性 core；发布前执行固定双宿主人工回放。 |

同类「截图 + 参考页 + 明确视觉目标」任务达到以下条件，才可将本计划标为已完成：

1. 错误 scope 不能创建 active feature；已有坏 state 能通过 doctor/recovery 安全退出。
2. active 指针存在但 state/project 损坏时，hook 不得 fail open：控制文件与 protected root 写入均被拦，并导向 doctor/recovery。
3. 写已登记 workflow artifact 的 heredoc 即使含 `apps/...` 也不被误判；未登记 artifact 与任一控制文件写入始终被拦。
4. 每轮 grill 在等待前已通过 requirements 登记 artifact；用户在 grill/gate 中只说「继续」时，能看到当前 Q 或 gate、继续格式和剩余路线。
5. 默认不进入 standard-M；显式 standard 时视觉 grill 最多三题且没有语义重复。
6. `standard → light` 仅在用户证据、零业务变化、approval 未 present 且 implementation 未开始的条件下发生；指纹变化时只能完成当前路线或 abandon 重开；events 可完整审计。
7. `npm test`、`npm run build:check` 与双宿主人工回放全部通过，1.3.0 版本、manifest 与 dist 同步。

---

## 13. 审核结论与待拍板项

本计划可在以下边界获批后实施：

1. 接受「artifact allowlist」替代「`.dev-flow/**` 整目录可写」。
2. 接受 1.3 仅支持同级 `standard → light`，不支持 `M → S`。
3. 接受损坏 state 只支持备份 abandon，不在本版本自动重建。
4. 接受 progress 使用 requirements front matter 的受限元数据，而非自由 Markdown 解析。
5. 接受双宿主人工回放是发布阻断项，补足 skill token 测试无法覆盖的行为验证。
6. 接受：active state 损坏时 hook 不得 fail open；必须拦截 workflow control 与 protected 业务写入，并导向 doctor/recovery。

确认以上六项后，将文件状态改为「已批准，可实施」，并按 PR-A → PR-F 落地。
