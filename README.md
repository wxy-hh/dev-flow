# dev-flow

面向 Claude Code 的轻量开发工作流迁移包。

dev-flow 先判断任务规模，再独立识别风险：小任务直接做，大任务按批次推进，高风险任务不能在风险未披露、未确认时开始实现。

## 核心原则

```text
任务规模决定怎么执行，真实风险决定是否停下来确认。
```

- XS/S/M/L 只表达改动拓扑、计划深度和恢复需求。
- `security`、`data`、`money`、`external`、`availability` 独立触发硬门禁。
- 普通 XS/S/M 默认不生成流程文件。
- L 或任意风险任务只维护一个 `work.md`；独立手测确有必要时才增加一个附件。
- 覆盖、计划审查、回撤、代码审查和验证是按需检查视角，不是固定报告流水线。

例如，接入一个新模型 provider，如果同时跨 Web、API、Queue、Worker、Shared，修改共享协议并影响多条调用链，应判为 L；外部协议、密钥、计费和可用性再分别触发风险控制。

## 目录

```text
.claude/
  agents/                         # 可选规划、审查、安全和测试代理
  commands/                       # /dev-task、/onboard-dev-flow、/finish
  rules/
    project-workflow.template.md  # 新项目适配模板
    git-workflow.md
    security.md
    specs/                        # 可选局部规则
  skills/
    dev-flow/                     # 默认入口与 work checker
    writing-plans/
    code-review/
    verification-before-completion/
    ...                           # 其它按需检查视角
docs/
  claude-dev-flow-migration.md
  claude-dev-flow-smoke-test.md
templates/
  CLAUDE.dev-flow-snippet.md
```

## 快速迁移

复制流程层到目标项目后运行：

```text
/onboard-dev-flow
```

需要同时验证迁移结果：

```text
/onboard-dev-flow --smoke-test
```

onboarding 会根据目标项目生成 `.claude/rules/project-workflow.md`。不要把旧项目的成品配置复制过去。

如果目标项目已有 `CLAUDE.md`，把 `templates/CLAUDE.dev-flow-snippet.md` 合并进去。

## 日常使用

```text
/dev-task <需求>
```

| 等级 | 典型信号 | 默认产物 |
|------|----------|----------|
| XS | 文案、显然配置、无行为变化 | 0 |
| S | 局部行为、边界清楚、单模块可回滚 | 0 |
| M | 一个功能内多个步骤，共享契约稳定 | 0；确需恢复时 1 |
| L | 跨层、共享协议、多链路或协调回滚 | 1 个 `work.md` |

任意风险任务也使用一个 `work.md`，并在实现前输出：

```text
[HUMAN GATE:implementation_approval]
...
[/HUMAN GATE]
```

风险卡输出后必须等待用户后续确认。用户最初的“直接改”不能自动跨过尚未披露的风险。

## 自检

迁移包或项目适配层静态检查：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

checker 回归测试：

```bash
.claude/skills/dev-flow/scripts/tests/dev-flow-feature-check-test
```

L 或风险任务收尾检查：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

checker 只验证一个 `work.md`：路径、风险确认、批次完成、验证结果和证据。它不归档、移动或删除文件。

## 注意

- 项目没有真实测试运行器时，明确写 `automated_tests: none`。
- L 运行时行为改动不能只靠 type-check 或 lint。
- `.env*` 和凭据不能登记为工作上下文。
- 非 Vue 项目可以删除或替换 `.claude/rules/vue3.md`。
- 默认不自动提交、推送、合并、回滚或删除分支。
