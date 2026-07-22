# dev-flow 收尾可靠性实现计划

> **使用说明：** 按照 `Depends on` 依赖关系执行。每步使用 checkbox (`- [ ]`) 语法跟踪进度。

**目标：** 让已通过审查的状态型任务自动收尾至 logic-complete，同时收紧批准范围、风险证据时机与资产删除确认。

**技术方案：** 只调整现有技能的交接协议和 doctor 静态断言。复用 `/finish` 的既有 feature-check、最终资产与 finalizer dry-run；自动链路仅在无阻塞时继续，仍在资产处置前等待用户。

**技术栈：** Markdown 技能协议、Bash doctor、现有 Node 状态/验证脚本。

## 输入资产

- 需求说明书：`docs/plans/2026-07-22-closeout-reliability-design.md`
- OpenSpec：无
- grillme 结论：用户已确认“自动推进至 logic-complete，资产处置前停止”。

## 全局约束

- 不增加 gate、状态字段、CLI 命令或项目适配配置。
- 不自动 compact/full、提交、推送、合并或接受残余风险。
- 高风险的全量证据仍须在实现前准备；阻塞审查/验证立即停止。

---

### Task 1: 收紧实现批准与资产处置协议

- [x] Completed

**Requirements:** R-001, R-002, R-003
**Depends on:** none
**Writes:**
- Modify `.claude/skills/dev-flow/SKILL.md`
- Modify `.claude/skills/dev-flow/references/protocol.md`
- Modify `.claude/skills/finishing-a-development-branch/SKILL.md`

**Change:** 要求 implementation approval 固定列出实施范围和不做范围，可选项默认排除；full 风险证据在输出该 gate 前登记；资产 finalization 禁止纠错、模糊匹配或推断，包括 `compack` 一类输入。
**Verification:** 检查三份文档中不存在与协议冲突的自动推进或模糊确认表述；运行 doctor。
**Rollback:** 回退三份 Markdown 文件的本任务 diff。

### Task 2: 自动推进至 logic-complete

- [x] Completed

**Requirements:** R-004
**Depends on:** Task 1
**Writes:**
- Modify `.claude/skills/code-review/SKILL.md`
- Modify `.claude/skills/verification-before-completion/SKILL.md`
- Modify `.claude/commands/finish.md`

**Change:** 通过的 code-review 必须同回合进入 verification；verified/partial 的 verification 必须同回合进入 `/finish`，由其完成 feature-check、最终资产生成和 finalizer dry-run。仅 `[ASSET FINALIZATION]`、失败、残余风险或 Git 操作停止。
**Verification:** 检查交接方向为 code-review → verification → finish，且 finalization 仍为 `Auto-continue: no`。
**Rollback:** 回退三份技能/命令文件的本任务 diff。

### Task 3: 为关键协议增加自检

- [x] Completed

**Requirements:** R-001, R-002, R-003, R-004
**Depends on:** Task 1, Task 2
**Writes:**
- Modify `.claude/skills/dev-flow/scripts/dev-flow-doctor`
- Modify `.claude/skills/dev-flow/scripts/tests/dev-flow-doctor-test`

**Change:** 断言实现范围、full 风险证据前置、禁止模糊资产确认、自动交接至 `/finish` 和 finalization 停止点都存在；不引入 Markdown 语义解析器。
**Verification:** 运行 doctor test、其余 dev-flow 脚本测试、doctor preflight/full；重新生成 manifest 并确认仅受管变更存在。
**Rollback:** 回退 doctor 及其测试的本任务 diff。

## 风险点与依赖项

- 纯说明无法验证对话中用户身份；规则应明确边界而不引入伪安全机制。
- 自动收尾必须以现有失败/partial 停止语义为准，不能覆盖人工风险接受。

## 验证总览

- `.claude/skills/dev-flow/scripts/tests/dev-flow-doctor-test`
- `.claude/skills/dev-flow/scripts/tests/dev-flow-status-test`
- `.claude/skills/dev-flow/scripts/tests/dev-flow-feature-check-test`
- `.claude/skills/dev-flow/scripts/tests/dev-flow-finalize-test`
- `.claude/skills/dev-flow/scripts/tests/dev-flow-execution-test`
- `.claude/skills/dev-flow/scripts/tests/dev-flow-hooks-test`
- `.claude/skills/dev-flow/scripts/tests/dev-flow-upgrade-test`
- `.claude/skills/dev-flow/scripts/dev-flow-doctor --preflight`
- `.claude/skills/dev-flow/scripts/dev-flow-doctor`

## 回撤边界草案

- Task 1: 协议文字与风险证据时序。
- Task 2: 技能自动交接与 `/finish` 入口说明。
- Task 3: doctor 的静态契约检查。
