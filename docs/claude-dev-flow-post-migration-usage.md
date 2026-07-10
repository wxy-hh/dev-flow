# Claude dev-flow 日常使用

## 入口

```text
/dev-task <需求>
/finish
/review-diff
```

默认不自动执行 Git 提交、推送、合并、回滚或删除操作。用户明确授权相应动作后再执行。

## 两次判断

dev-flow 先判断任务规模：

- XS：单点且行为显然。
- S：局部、清楚、单模块可回滚。
- M：一个功能内多个步骤，但共享契约稳定。
- L：跨架构层、共享协议/状态、多条链路或协调回滚。

再独立判断风险：

- `security`：登录、鉴权、权限、敏感信息。
- `data`：删除、迁移、数据完整性。
- `money`：支付、订单金额、计费和用量。
- `external`：外部协议、密钥、跨系统失败语义。
- `availability`：共享运行时或广泛故障面。

规模和风险可以交叉：一行鉴权修改可能是 `S + security`；大型纯 UI 重构可能是 `L + none`。

## 如何描述任务

### XS/S

```text
/dev-task 把按钮文案改成“保存设置”，不改变点击行为。
```

提供目标和不做范围即可。预期零流程文件，直接修改并验证。

### 普通 M

```text
/dev-task 在订单列表增加已有接口支持的异常筛选，只影响当前页面，不改详情和共享状态。
```

说明功能边界、接口和验收。默认使用对话短计划，不落盘；跨会话或有重要决策时才创建一个工作文件。

### 低风险 L

```text
/dev-task 重构报表展示架构，跨页面组件、状态适配层和样式系统，不改 API、权限或数据。
```

跨层和协调回滚足以判 L。使用一个 `work.md` 分批执行，但风险为 none 时不需要人工门禁。

### L + 风险

```text
/dev-task 接入新的计费 AI provider，覆盖 Web/API/Queue/Worker/Shared 和多条调用链，保留旧 provider 兜底。
```

预期判为 L，并识别外部、计费、可用性等风险。agent 先创建短工作文件、输出一次风险卡，然后等待后续确认。

## 产物预算

| 场景 | 默认流程资产 |
|------|--------------|
| 普通 XS/S | 0 |
| 普通 M | 0；确需恢复时 1 |
| L | 1 个 `work.md` |
| 任意风险任务 | 1 个 `work.md` |
| 必须由用户/外部环境独立手测 | 可增加 1 个 `manual-test.md` |

覆盖检查、计划审查、回撤、代码审查和验证默认写进对话或工作文件，不各自生成报告。用户明确要求独立文档时才例外。

## work.md 生命周期

路径：

```text
<feature_root>/<feature-id>/work.md
```

它同时承载：

- 当前 Level、Risks、Phase、Approval 和 Verification。
- Boundary 与不做范围。
- 少量非敏感 Context。
- 3–7 个结果导向 Batches。
- 风险与回撤。
- 代码审查和验证证据。

每完成一批就勾选并记录验证。不要等到整个任务结束才补进度，也不要把 `.env*` 或凭据放进 Context。

## 高风险确认

有风险标签时，agent 输出：

```text
[HUMAN GATE:implementation_approval]
边界：...
风险：...
回撤：...
验证：...
请确认是否开始实现。
[/HUMAN GATE]
```

这条消息后当前回合停止。用户最初的“直接改”不能算作对尚未披露风险的接受；必须在风险卡之后明确确认。

如要跳过，用户需要在风险说明后明确表示接受具体风险。否则 agent 不能把 Approval 标为 skipped。

## 长任务执行与恢复

L 一次推进一个可验证批次：

1. 实现本批 Outcome。
2. 运行本批最相关验证。
3. 更新 checkbox、Evidence 和 State。
4. 没有新风险或扩范围时自动进入下一批。

会话中断后，只需读取未完成批次、其 Context 和当前 diff。已经完成且证据仍新鲜的批次不重跑。

## 审查与验证

完成前：

- 基于真实 diff 审查，而不是计划想象。
- 运行与改动匹配的 type-check、lint、test、build 或行为验证。
- L 运行时行为不能只用静态命令证明。
- 验证后相关代码变化会使旧证据失效。
- `partial` 必须记录具体缺口和用户接受的残留风险。

L/风险任务最后运行：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

checker 不修改文件，只验证路径、确认、批次和证据。

## 什么时候跑 doctor

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

推荐在 onboarding、升级工作流、修改适配配置或 smoke test 前运行。doctor 只检查流程包一致性，不替代业务测试。

## 可选技能

- `req-probe`：存在真正阻塞歧义时逐个澄清。
- `writing-plans`：为 L/风险任务组织短批次。
- `requirements-coverage`：按需查需求遗漏。
- `plan-review`：按需审查计划结构和风险。
- `rollback-units`：按需强化回撤边界。
- `code-review`：审查真实 diff。
- `verification-before-completion`：取得新鲜完成证据。

它们是检查视角，不是固定串联的门禁流水线。

## 常见问题

### 没有自动化测试

把 `automated_tests` 写为 `none`。选择静态检查、可执行小验证和真实行为检查，不伪造测试通过。

### 想走轻量流程

普通任务可以直接要求轻量处理。L 仍保留一个恢复文件；高风险仍必须在风险披露后确认，但不会因此生成多份报告。

### 任务执行中变大

出现跨层、共享契约、多链路或协调回滚时升级为 L；出现新风险标签时暂停并重新输出风险卡。已有有效证据保留，不回填无用文件。

### 可以直接提交吗

用户明确要求提交时可以执行；推送、合并、丢弃改动和删除分支需确认目标与影响。
