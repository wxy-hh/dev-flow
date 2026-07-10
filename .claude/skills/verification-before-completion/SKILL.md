---
name: verification-before-completion
description: 在声称完成、修复、通过、可提交、可合并之前使用。要求先运行新鲜验证命令并读取结果；没有证据就不能声明成功。
---

# 完成前验证

完成声明必须先有证据。不要用“应该”“看起来”“大概”代替验证。

## 铁律

```text
没有新鲜验证证据，就不要声明完成。
```

## 项目适配层

先读取当前项目的工作流适配配置。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<FEATURE_ROOT>`、`<REVIEW_ROOT>`、context manifest、验证命令矩阵和当前项目未启用的测试能力。

## 资产读取

输入优先级：

1. 用户当前消息中手动引用的需求、计划、代码审查报告、回撤清单或验证要求。
2. 上一步 `[HANDOFF]` 的 `Next inputs`。
3. `<FEATURE_ROOT>/<feature-id>/context/verify.jsonl` 中登记的上下文文件。
4. 当前 feature 目录和审查目录的约定文件：
   - `<FEATURE_ROOT>/<feature-id>/需求说明书.md`
   - `<FEATURE_ROOT>/<feature-id>/初步实现计划.md`
   - `<FEATURE_ROOT>/<feature-id>/rollback-units.md`
   - `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md`
5. 当前 `git status`、`git rev-parse HEAD`、`git diff --stat` 和本次 diff 涉及的文件。

context manifest 只负责列出应读取的材料，不代表验证通过。完成结论必须由本次运行的命令、人工测试记录或验证报告支撑。

## 验证门禁

在说“完成 / 修复 / 通过 / 没问题 / 可以提交”之前：

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

手动测试脚本至少包含：

```markdown
# 手动行为验证

## 场景
- ...

## 步骤与预期
| 步骤 | 操作 | 预期 | 实测 |
|------|------|------|------|

## 未覆盖项
- ...
```

只有填写了“实测”结果的手动测试脚本才算行为验证证据；空模板、预期结果或“未执行”不算通过证据。

文档/技能改动至少执行适配层列出的文档检查，并人工确认：

- 路径模板没有绕过 `<FEATURE_ROOT>`、`<REVIEW_ROOT>`、`<RUNTIME_ROOT>`、`<SDD_PROGRESS>`。
- 没有新增和当前项目能力不符的测试、E2E 或文档生成前提。
- 没有把某个项目的代理、目录结构或验证命令写进可复用流程层。

## 验证失败处理

验证失败时不要声称完成：

1. 判断是代码问题、环境问题，还是验证命令不适用。
2. 验证命令不适用时，调整为能证明结论的正确验证方式并重新运行。
3. 代码问题时修复后重新运行完整相关验证，不只跑失败的那一条。
4. 同一问题连续 3 轮仍失败时，停止并汇报失败证据、已尝试修复和建议下一步。
5. 环境问题无法自行排除时，说明阻塞原因、已检查内容和剩余风险。

## 输出

小功能可以只在对话中汇报。L 级必须保存到：

```text
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md
```

报告内容：

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

保存验证报告后，同步更新 `<FEATURE_ROOT>/<feature-id>/status.md` 的 `Current gate`、`Completed gates`、`Next action`、`Assets`、`Last updated`、`Base SHA`、`Head SHA`、`Working tree dirty`、`Diff stat hash`、`Last validation at` 和 `Last validation commands`，并同步更新 frontmatter 中的 `dev_flow_status.validation`。`Last validation commands` 至少包含一条实际执行的命令或一条填写了实测结果的人工检查；用户跳过完整验证时，报告结论必须为“部分验证”，不得把 `verification-before-completion` 追加到 `Completed gates`。

如果存在 context manifest，把验证报告和手动测试脚本追加到 `context/verify.jsonl`。

如果 status 中已有 `Last validation at`，在声称完成前先比较当前 `Head SHA`、`Working tree dirty` 和 `Diff stat hash`。任一项与上次验证记录不一致，已有验证证据视为过期，必须重新运行相关验证。`Diff stat hash` 应只覆盖业务改动，排除 `<FEATURE_ROOT>`、`<REVIEW_ROOT>` 和 `.claude/runtime` 生成的流程资产，避免生成验证报告本身让业务验证失效；业务指纹必须同时覆盖未暂存和已暂存改动。

验证报告保存后，M/L 任务必须运行：

```text
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

检查失败时只能输出部分验证或阻塞结论，不得进入“验证通过”的分支收尾。

验证通过后输出交接块，但不要自动提交、合并、推送或创建 PR：

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: verification-before-completion
Generated assets:
- <FEATURE_ROOT>/<feature-id>/status.md
- <REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md
- <REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md（需要手动行为验证时）
Next skill: finishing-a-development-branch
Next inputs:
- <FEATURE_ROOT>/<feature-id>/status.md
- <REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md
- <FEATURE_ROOT>/<feature-id>/context/verify.jsonl
Auto-continue: no
Stop reason: verification passed; choose branch finishing action
[/HANDOFF]
```

验证失败时输出 `Auto-continue: no`，`Stop reason` 写失败命令和推荐下一步。
