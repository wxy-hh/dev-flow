# 风险标签证据契约实现计划

> **使用说明：** 按照 `Depends on` 依赖关系执行。每步使用 checkbox (`- [ ]`) 语法跟踪进度。

**目标：** 让风险标签、风险门禁与最小证据形成可验证的 v2 状态契约，同时保持 `light` 路径不新增独立报告。

**技术方案：** 在状态 frontmatter 中增加 `risk_evidence` 映射；Node 校验器负责 v2 的 profile/level、标签、最低 gate 和证据契约，shell 完成检查调用该校验器。旧 v1 状态继续按现有逻辑读取。

**技术栈：** Bash、零依赖 Node.js、Markdown/YAML 受限格式。

## 输入资产

- 需求说明书：用户确认采用“内联最小证据”方案。
- OpenSpec：无。
- grillme 结论：无。
- 设计：`docs/plans/2026-07-12-risk-evidence-contract-design.md`。

## 全局约束

- `risk-minimal` 仅适用于携带风险标签的 XS/S；M/L 可以带风险标签但保持 `profile: standard`。
- 每个风险标签必须有对应 `risk_evidence`，`light` 使用 status 内联证据，`full` 使用仓库内报告路径。
- 多个标签合并其最低 gate；任何最低 gate 不得为 `none`。
- v1 历史状态与已 finalized 的历史资产保持兼容。
- 不引入 hook、CI、第三方 YAML 依赖或新的独立 light 报告。

---

### Task 1: 定义 v2 状态模板与文档契约

**Requirement IDs:** REQ-001, REQ-002

**Depends on:** none

**Files:**
- Modify: `.claude/rules/project-workflow.template.md`
- Modify: `.claude/skills/dev-flow/SKILL.md`
- Modify: `.claude/commands/dev-task.md`
- Modify: `docs/claude-dev-flow-migration.md`
- Modify: `docs/claude-dev-flow-post-migration-usage.md`

**Interfaces:**
- Consumes: 已确认设计中的 profile、标签、最低 gate 与证据契约。
- Produces: `dev_flow_status.schema_version: "2"` 与稳定的 `risk_evidence.<label>` 数据形状。

**Rollback idea:** 回退这些文档和模板修改即可恢复 v1 写入行为；脚本兼容层不受影响。

- [x] **Step 1: 更新状态模板和版本说明**

  将新建状态模板的 `schema_version` 升为 `"2"`，增加空的 `risk_evidence: {}`，并明确标准 M/L 可带风险标签而无需 `risk-minimal`。保留风险完成摘要字段，并说明它不替代进行中状态证据。

- [x] **Step 2: 发布最低 gate 与 evidence 表**

  在默认流程、迁移说明和日常使用说明中同步列出七个标签的最低 gate、`inline|report` 模式和升级规则；明确 `light` 只写 status，而 `full` 必须引用现有报告。

- [x] **Step 3: 验证**

  验证方式: 使用 `rg` 确认所有用户入口均表达“XS/S + risk label 才是 risk-minimal”，并确认模板中包含 `risk_evidence`、v2 schema 和最低 gate 表。

### Task 2: 实现受限 risk-contract 校验器

**Requirement IDs:** REQ-001, REQ-003, REQ-004

**Depends on:** Task 1

**Files:**
- Modify: `.claude/skills/dev-flow/scripts/dev-flow-validate.mjs`

**Interfaces:**
- Consumes: `<status.md>`、仓库根路径和 v2 `dev_flow_status`。
- Produces: `risk-contract <repo-root> <status-path>` 子命令；成功退出或输出具体契约错误。

**Rollback idea:** 删除子命令和调用点；现有 `feature-id`、`asset`、`roots`、`manifest`、`classification` 子命令不变。

- [x] **Step 1: 解析受限 v2 字段**

  使用现有零依赖行级解析风格，读取 `schema_version`、`level`、`profile`、内联 `risk_labels`、`risk_gates` 和按标签组织的 `risk_evidence`。拒绝未知标签、未知模式、未知 gate 等级和重复证据条目。

- [x] **Step 2: 校验 profile、最低 gate 与证据**

  仅对 v2 状态执行新规则：风险 XS/S 必须为 `risk-minimal`；M/L 必须为 `standard` 且允许风险标签；每个标签验证最低 gate。`inline` 要求非空 `conclusion` 和 `verification`；`report` 还要通过现有路径/符号链接检查并确认文件存在；标签所需 gate 被提升为 `full` 时只接受 `report`。

- [x] **Step 3: 保持 v1 兼容**

  对 v1 返回成功且不强制新字段，让已存在的 M/L、risk-minimal 和 finalized 资产继续由既有检查处理。

- [x] **Step 4: 验证**

  验证方式: 用临时状态文件调用 `node .../dev-flow-validate.mjs risk-contract`，覆盖合法 v2、缺少证据、门禁为 `none`、非法报告路径和 v1 兼容五种结果。

### Task 3: 将完成检查接入风险契约

**Requirement IDs:** REQ-003, REQ-005

**Depends on:** Task 2

**Files:**
- Modify: `.claude/skills/dev-flow/scripts/dev-flow-feature-check`
- Modify: `.claude/skills/dev-flow/scripts/dev-flow-doctor`

**Interfaces:**
- Consumes: `risk-contract` 校验结果与已有 full 资产检查。
- Produces: `--finish` 对 v2 风险任务的阻断结果，以及 doctor 对模板锚点的检查。

**Rollback idea:** 移除 risk-contract 调用和 doctor 新锚点；既有 feature-check 行为可独立运行。

- [x] **Step 1: 调用 risk-contract 并清理重复判断**

  在 status 安全校验后调用新子命令。保留现有 HUMAN GATE、新鲜验证、full rollback、full security 和手动测试检查；将仅靠非空标签判断的风险最小档案检查收敛到契约校验。

- [x] **Step 2: 扩展 doctor 的 schema 锚点**

  检查模板存在 `risk_evidence`、v2 profile 边界和最低 gate/evidence 描述，而不把完整自然语言措辞钉死。

- [x] **Step 3: 验证**

  验证方式: 对有效和无效 v2 风险 fixture 分别运行 `dev-flow-feature-check <id> --finish`，预期成功和失败；运行 doctor 预期零 failure。

### Task 4: 扩展回归 fixture 与兼容性覆盖

**Requirement IDs:** REQ-004, REQ-005

**Depends on:** Task 3

**Files:**
- Modify: `.claude/skills/dev-flow/scripts/tests/dev-flow-feature-check-test`

**Interfaces:**
- Consumes: 新 v2 validator 与 feature-check。
- Produces: 对风险证据、profile 边界、最低 gate、报告路径及旧资产兼容性的回归保护。

**Rollback idea:** 删除新增 fixture 块；现有路径穿越、JSONL、gate 和 finalized 测试仍保留。

- [x] **Step 1: 将风险 fixture 升为 v2 并保留 v1 fixture**

  为 S + security 添加有效 inline evidence；保留现有 v1 M/L fixture，证明旧状态仍通过。

- [x] **Step 2: 添加反例**

  覆盖缺失标签证据、最低 gate 降为 `none`、M/L 错用 `risk-minimal`、XS/S 带标签却使用 `standard`、full gate 使用 inline、report 缺失/穿越/符号链接等失败情形。

- [x] **Step 3: 添加 M/L 正例**

  增加 `profile: standard` 且带风险标签的 M 或 L fixture，验证此前的 schema 矛盾已消失。

- [x] **Step 4: 验证**

  验证方式: 运行 `.claude/skills/dev-flow/scripts/tests/dev-flow-feature-check-test`，预期 `Summary: 0 failure(s)`。

## 风险点与依赖项

- 受限 YAML 解析必须严格限定到模板支持的缩进与标量格式，避免把自由文本当作结构数据。
- `light` 证据可证明“结论已记录”，不能证明审查质量；后者仍属于人工/受管环境职责。
- 最低 gate 表属于流程契约，后续新增标签必须同时更新模板、默认流程、validator 和 fixture。

## 验证总览

- `node .claude/skills/dev-flow/scripts/dev-flow-validate.mjs risk-contract ...`：验证 schema 和证据契约。
- `.claude/skills/dev-flow/scripts/tests/dev-flow-feature-check-test`：回归 shell、路径安全和风险证据正反例。
- `.claude/skills/dev-flow/scripts/dev-flow-doctor`：流程层文档和模板静态一致性。

## 回撤边界草案

- Task 1: 回退文档与模板契约。
- Task 2: 回退 `risk-contract` 子命令；既有 validator 子命令独立保留。
- Task 3: 回退 feature-check/doctor 接线；保留旧完成检查。
- Task 4: 回退新增 fixture；保留历史兼容 fixture。
