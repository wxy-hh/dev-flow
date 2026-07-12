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
- `webapp-testing: disabled` 时，L 级行为改动必须保存手动测试脚本：`<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md`。
- `automated-tests: present` 时，同时运行相关自动化测试；`automated-tests: none` 时，不把测试命令缺失视作通过证据。

手动测试脚本固定七列表格，并优先提供机器可读 frontmatter：

```markdown
---
manual_test_steps:
  - id: MT-001
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

`结果` 仅允许 `passed|failed|skipped`。pending、空实测、`待执行`、缺风险关联或 `failed` 一律使 feature-check 失败。`skipped` 步骤必须关联唯一 `AR-xxx`，并由 `dev-flow-status accept-risk` 写入 `accepted_risks` 与 `<REVIEW_ROOT>/<feature-id>-partial-acceptance.md`。三方（手测步骤、`accepted_risks`、partial-acceptance）不一致时不得声称 verified。

文档/技能改动至少执行适配层列出的文档检查，并人工确认：路径模板没有绕过 `<FEATURE_ROOT>`、`<REVIEW_ROOT>`、`<RUNTIME_ROOT>`、`<SDD_PROGRESS>`；没有新增和当前项目能力不符的测试、E2E 或文档生成前提；没有把某个项目的代理、目录结构或验证命令写进可复用流程层。

## 验证失败处理

验证失败时不要声称完成：

1. 判断是代码问题、环境问题，还是验证命令不适用。
2. 验证命令不适用时，调整为能证明结论的正确验证方式并重新运行。
3. 代码问题时修复后重新运行完整相关验证，不只跑失败的那一条。
4. 同一问题连续 3 轮仍失败时，停止并汇报失败证据、已尝试修复和建议下一步。
5. 环境问题无法自行排除时，说明阻塞原因、已检查内容和剩余风险。

## 输出

小功能可以只在对话中汇报。L 级必须保存到 `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md`：

```markdown
# 验证报告

## 结论
- 通过 / 失败 / 部分验证

## 输入资产
- 需求：
- 计划：
- 代码审查：
- 回撤清单：

## 验证命令和结果
- `<command-or-check>`：

## 页面或人工检查
- ...

## 未验证项和原因
- ...
```

保存验证报告后，同步更新 `status.md` 的 `current_gate`、`completed_gates`、`next_action`、`assets`（追加报告路径，`kind: "verification"`）、`validation.last_at` 和 `validation.commands`。`last_at`/`commands` 至少包含一条实际执行的命令或一条填写了实测结果的人工检查；用户跳过完整验证时，报告结论必须为"部分验证"，不得把 `verification-before-completion` 追加到 `completed_gates`。

如果 `status.md` 已有 `validation.last_at`，声称完成前先比较当前 `Head SHA` 和 `business_diff_fingerprint`（用 `dev-flow-fingerprint` 脚本重新计算）；任一项与上次验证记录不一致，已有验证证据视为过期，必须重新运行相关验证。`business_diff_fingerprint` 只覆盖业务改动，排除 `<FEATURE_ROOT>`、`<REVIEW_ROOT>` 和 `.claude/runtime` 生成的流程资产，同时覆盖未暂存和已暂存改动。

验证报告保存后，M/L 任务和携带风险标签（risk-minimal profile）的任务必须运行：

```text
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

检查失败时只能输出部分验证或阻塞结论，不得进入"验证通过"的分支收尾。`outcome: partial` 时 completion、check stamp 与收尾输出必须写 `partial`，展示未验证步骤和风险摘要，禁止使用「验证通过」；partial 仍允许正常提交/推送/合并/PR。`outcome: verified` 时 `accepted_risks` 必须为空且不得保留未关闭 partial-acceptance。

验证通过或 partial 可收尾时按 `dev-flow/references/protocol.md` 输出 `[HANDOFF]`（`Current gate: verification-before-completion`，`Next skill: finishing-a-development-branch`，`Auto-continue: no`，`Stop reason: verification verified|partial; choose branch finishing action`），但不要自动提交、合并、推送或创建 PR。验证失败时同样 `Auto-continue: no`，`Stop reason` 写失败命令和推荐下一步。
