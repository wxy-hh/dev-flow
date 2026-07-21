---
name: verification-before-completion
description: 在声称完成、修复、通过、可提交、可合并之前使用。要求先运行新鲜验证命令并读取结果；没有证据就不能声明成功。
---

# 完成前验证

完成声明必须先有证据。不要用"应该""看起来""大概"代替验证。

## 铁律

```text
没有新鲜验证证据，就不要声明完成。
```

## 项目适配层

先读取当前项目的工作流适配配置。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<FEATURE_ROOT>`、`<REVIEW_ROOT>`、验证命令矩阵和当前项目未启用的测试能力。

## 资产读取

按 `dev-flow/references/protocol.md` 的资产读取优先级；本技能额外读取当前 `git status`、`git rev-parse HEAD`、`git diff --stat` 和本次 diff 涉及的文件。已登记的资产只负责列出应读取的材料，不代表验证通过；完成结论必须由本次运行的命令、人工测试记录或验证报告支撑。

## 验证门禁

在说"完成 / 修复 / 通过 / 没问题 / 可以提交"之前：

1. 识别：什么命令或检查能证明这个结论？
2. 运行：执行完整验证命令。
3. 阅读：看完整输出、退出码、失败数量。
4. 判断：输出是否支持结论？
5. 汇报：带证据说明结果。

## 验证配置

具体命令和默认矩阵以项目适配层为准。不要把当前项目的命令复制到本技能正文；迁移项目时只更新适配层。若完整 lint/build 过慢，优先使用适配层的 `lint_changed` 或等价目标文件检查；这只能补充快速反馈，不能把未运行的完整验证伪装成通过。

运行时行为验证也以项目适配层为准：

- `webapp-testing: enabled` 时，使用 `webapp-testing` 跑关键路径，并把截图、trace 或操作记录写入验证报告。
- `webapp-testing: disabled` 时，L 级行为改动保存 `<REVIEW_ROOT>/<feature-id>-manual-test.md`。
- `automated-tests: present` 时，同时运行相关自动化测试；`automated-tests: none` 时，不把测试命令缺失视作通过证据。

### manual-test 是唯一 MT 步骤源

手动测试步骤**只**写在 manual-test 资产中。verification 报告只引用 MT ID、命令、verdict 与异常，**禁止**把步骤表双写进 verification 报告、status 或 completion。

手动测试脚本固定七列表格，并优先提供机器可读 frontmatter：

```markdown
---
manual_test_steps:
  - id: MT-001
    method: browser   # browser|device|api|cli|automated；full behavior 必填
    result: passed   # passed|failed|skipped
    risk_id: null    # skipped 时必填 AR-xxx
    observed: "..."
    evidence: "..."
---

# 手动行为验证

| ID | 操作 | 预期 | 结果 | 实测 | 证据 | 风险 ID |
|----|------|------|------|------|------|---------|
| MT-001 | ... | ... | passed | ... | ... | |
```

`结果` 仅允许 `passed|failed|skipped`。pending、空实测、`待执行`、缺风险关联或 `failed` 一律使 feature-check 失败。`passed` 须有非空 observed/evidence；`behavior_verification: full` 时 frontmatter 须有 method。**禁止** `static-review` / 纯 lint / type-check 作为 passed method。`skipped` 步骤必须关联唯一 `AR-xxx`，并由 `node .claude/skills/dev-flow/scripts/dev-flow-status.mjs accept-risk <feature-id> …`（在仓库根目录执行）写入 `accepted_risks` 与 `<REVIEW_ROOT>/<feature-id>-partial-acceptance.md`。三方（手测步骤、`accepted_risks`、partial-acceptance）不一致时不得声称 verified。

文档/技能改动至少执行适配层列出的文档检查，并人工确认：路径模板没有绕过 `<FEATURE_ROOT>`、`<REVIEW_ROOT>`、`<RUNTIME_ROOT>`、`<SDD_PROGRESS>`；没有新增和当前项目能力不符的测试、E2E 或文档生成前提；没有把某个项目的代理、目录结构或验证命令写进可复用流程层。

## severity 与 promote

**severity 识别属于本 skill**：行为验证失败、关键路径未覆盖、证据过期等阻塞态由本 skill 判定；CLI 不扫描自然语言、不自动 promote。当 `behavior_verification` 为 light 且出现 CRITICAL/HIGH（如关键路径失败、证据不可信），必须先调用 `node .claude/skills/dev-flow/scripts/dev-flow-status.mjs promote-gate <feature-id> behavior_verification --to full --reason <text>`（在仓库根目录执行），再落盘 full 验证资产；即使随后修复，也保留 full 证据。

## 验证失败处理

验证失败时不要声称完成：

1. 判断是代码问题、环境问题，还是验证命令不适用。
2. 验证命令不适用时，调整为能证明结论的正确验证方式并重新运行。
3. 代码问题时修复后重新运行完整相关验证，不只跑失败的那一条。
4. 同一问题连续 3 轮仍失败时，停止并汇报失败证据、已尝试修复和建议下一步。
5. 环境问题无法自行排除时，说明阻塞原因、已检查内容和剩余风险。

## 输出（findings + 引用，不双写 MT 步骤）

小功能可以只在对话中汇报。L 级保存到 `<REVIEW_ROOT>/<feature-id>-verification.md`：

```markdown
# 验证报告

## 结论
- 通过 / 失败 / 部分验证

## 输入资产
- 需求 / 计划 / 代码审查 / 回撤清单 / manual-test：（路径指针）

## 验证命令和结果
- `<command-or-check>`：exit N；关键输出摘要

## Manual-test 引用（不复制步骤表）
- MT-001: passed
- MT-002: skipped → AR-001
- 异常 / 未覆盖：...

## Remaining risks / 未验证项
- ...
```

保存验证报告后，不手改 `status.md`。验证达到 verified/partial 的闭环条件时运行 `node .claude/skills/dev-flow/scripts/dev-flow-status.mjs complete-verification <feature-id> --command <actual-command> --report <path> [--manual-test <path>]`（在仓库根目录执行），由 CLI 在同一原子路径登记资产、`validation.last_at`/`commands`、fingerprint 和 `verification-before-completion`。CLI 校验失败会恢复原 status。用户跳过完整验证且未形成合规 partial 时，报告结论必须为"部分验证"，不得调用 `complete-verification` 假装闭环。

如果 `status.md` 已有 `validation.last_at`，声称完成前先比较当前 `Head SHA` 和 `business_diff_fingerprint`（用 `dev-flow-fingerprint` 脚本重新计算）；任一项与上次验证记录不一致，已有验证证据视为过期，必须重新运行相关验证。`business_diff_fingerprint` 只覆盖业务改动，排除 `<FEATURE_ROOT>`、`<REVIEW_ROOT>` 和 `.claude/runtime` 生成的流程资产，同时覆盖未暂存和已暂存改动。

`complete-verification` 成功后，M/L 任务和携带风险标签（risk-minimal profile）的任务必须由编排层另行运行：

```text
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

两者不得互相调用：CLI 只调 validator/fingerprint，check-ok 只由 feature-check 写。

检查失败时只能输出部分验证或阻塞结论，不得进入"验证通过"的分支收尾。`outcome: partial` 时 completion、check stamp 与收尾输出必须写 `partial`，展示未验证步骤和风险摘要，禁止使用「验证通过」；partial 在 **logic-complete** 后仍允许正常提交/推送/合并/PR（finalization 可选）。`outcome: verified` 时 `accepted_risks` 必须为空且不得保留未关闭 partial-acceptance。

验证通过或 partial 可收尾时按 `dev-flow/references/protocol.md` 输出 `[HANDOFF]`（`Current gate: verification-before-completion`，`Next skill: finishing-a-development-branch`，`Auto-continue: no`，`Stop reason: verification verified|partial; logic-complete then optional asset finalization / Git`），但不要自动提交、合并、推送或创建 PR。验证失败时同样 `Auto-continue: no`，`Stop reason` 写失败命令和推荐下一步。
