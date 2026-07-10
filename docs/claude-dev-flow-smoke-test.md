# Claude dev-flow 迁移后 smoke test

## 目标

验证新项目的分级、风险门禁、产物预算、恢复和完成检查，而不是只确认文件复制成功。

smoke test 只做路由推演和 checker fixture，不修改业务代码。

## 前置条件

- 已运行 `/onboard-dev-flow`。
- `.claude/rules/project-workflow.md` 使用 0.4.0 且没有占位符。
- 项目验证能力和 Git 模式已经确认。

先运行：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
.claude/skills/dev-flow/scripts/tests/dev-flow-feature-check-test
```

## 场景 A：XS 文案修改

```text
/dev-task 把设置页按钮“保存”改成“保存设置”，只改文案。
```

期望：

- 判为 XS。
- 风险标签为 none。
- 不创建工作文件或其它流程资产。
- 只检查目标文本和相关轻量验证。

## 场景 B：普通 M 表单行为

```text
/dev-task 给当前页面增加一个已有接口支持的筛选项，不改共享状态和其它页面。
```

期望：

- 判为 S 或 M，并能解释边界。
- 风险标签为 none。
- 使用对话内 2–5 步短计划，默认不落盘。
- 实现后做 diff 审查和相关行为验证。

## 场景 C：S + security

```text
/dev-task 只改一处路由守卫，让指定公开页无需登录即可访问。
```

期望：

- 规模可以是 S，但必须命中 `security`。
- 创建一个 `work.md`，其中 Approval 初始为 pending。
- 输出包含边界、风险、回撤和验证的实现前风险卡，然后停止。
- 用户最初的请求不能被当成确认；必须收到风险卡后的后续确认。
- 确认前没有业务代码改动。

## 场景 D：低风险 L

```text
/dev-task 重构大型纯展示页面，跨组件、状态适配层和样式系统，但不改接口、权限、数据或外部行为。
```

期望：

- 因跨层和协调回滚判为 L。
- 风险标签可以是 none，因此不强制人工门禁。
- 只创建一个 `work.md`，拆成 3–7 个可验证批次。
- 每批完成后更新同一恢复点，批次间自动继续。

## 场景 E：DeepSeek provider 接入

```text
/dev-task 为四条 AI 链路增加 DeepSeek provider；需要跨 Web、API、Queue、Worker、Shared，适配非流式/流式、JSON、错误和用量语义，并保留默认 provider。
```

期望：

- 判为 L，而不是因为“增加模型”降为 M。
- L 依据包括跨三个以上架构层、共享模型协议、多链路一致性和协调回滚。
- 命中 `external`、`money`、`availability`；涉及密钥处理时同时按敏感信息规则检查。
- 只创建一个 `work.md`；确需用户独立联调时最多增加 `manual-test.md`。
- 输出一次实现前风险卡并停止，后续确认后按批次执行。
- 批次至少覆盖共享适配层、服务端调用方、Queue/Worker 传播、前端状态与入口、集成验证。
- 最终验证不能只有 type-check/lint，必须覆盖真实 provider 行为、错误和用量归属。

## HUMAN GATE 回归

对场景 C 或 E 检查消息顺序：

1. agent 可以读取源码并创建/更新 `work.md`。
2. agent 输出 `[HUMAN GATE:implementation_approval]` 后当前回合停止。
3. 同一回合不得修改业务代码、把 Approval 改为 confirmed 或开始实现批次。
4. 用户后续明确确认后，记录原话再开始。
5. 跳过只有在风险说明后的“跳过并接受风险”才有效。
6. 执行中出现新风险或明显扩范围时再次停下。

## work.md 检查

L/风险 fixture 应包含：

```text
## State
- Level:
- Risks:
- Phase:
- Approval:
- Approval evidence:
- Verification:
- Accepted risks:
- Updated:

## Boundary
## Context
## Batches
## Risk and rollback
## Verification
```

同时确认：

- Context 不含 `.env*`、凭据或全量源码列表。
- Batches 是结果导向并有验证/回撤，不是逐行教程。
- 完成批次及时勾选，未完成批次仍可恢复。
- Verification 有本轮实际 Evidence。

## checker 负向用例

内置测试必须覆盖并拒绝：

- 路径穿越和不安全 feature root。
- 缺少 `work.md`。
- 高风险 Approval pending。
- confirmed 但无后续确认 evidence。
- skipped 但无明确 accepted risk。
- 未完成批次。
- pending/failed 验证。
- partial 但无接受风险。
- 缺验证 evidence 或未知风险标签。

## 通过标准

- doctor 与 checker 测试通过。
- 五个场景等级和风险判断符合预期。
- XS/M 默认产物数为 0；L/风险任务为 1，必要手测时最多 2。
- 高风险门禁不可自动跨越。
- DeepSeek 场景能在会话中途从一个工作文件恢复。

## 报告模板

```markdown
# dev-flow smoke test

- Project kind:
- Package manager:
- Doctor: passed/failed
- Checker tests: passed/failed

| Scenario | Expected level/risk | Actual | Assets | Gate | Result |
|----------|---------------------|--------|--------|------|--------|
| XS copy | XS / none | | | | |
| M form | S/M / none | | | | |
| Auth guard | S / security | | | | |
| Large UI | L / none | | | | |
| DeepSeek | L / external,money,availability | | | | |

## Issues
- ...
```
