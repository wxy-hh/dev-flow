# 风险门禁细则

被 dev-flow `SKILL.md` 引用；风险标签触发的最低门禁、每类门禁的阻塞条件，以及 security 相关调查清单。标签清单和最低门禁映射与 `.claude/skills/dev-flow/contract.json` 同源，改动契约时两处同步更新。

## 风险标签定义

- `security`：登录、鉴权、权限、token/session、敏感信息。
- `data`：删除、迁移、数据完整性、不可逆状态变化。
- `money`：支付、计费、价格、余额、结算。
- `external`：外部协议、回调、第三方 API、跨系统跳转。
- `availability`：可用性、队列、限流、关键降级或恢复。
- `critical_correctness`：即使改动很小，错误结果本身也会造成重大业务/合规/健康/资格判断后果。
- `irreversible_consequence`：后果不可逆但不属于已有 data/money 标签的情形。

后两项是开放式兜底，不是"任何 bug 都算高风险"；命中时必须写清错误结果、受影响范围、为何普通验证不够。

## 最低门禁映射

| 标签 | 最低 gate |
|---|---|
| `security` | `security_review: light`、`behavior_verification: light` |
| `data` | `rollback_units: light`、`behavior_verification: light` |
| `money` | `rollback_units: light`、`behavior_verification: light` |
| `external` | `behavior_verification: light` |
| `availability` | `behavior_verification: light` |
| `critical_correctness` | `behavior_verification: light` |
| `irreversible_consequence` | `rollback_units: light`、`behavior_verification: light` |

多个标签取所需证明的并集；标签对应的最低 gate 不得降为 `none`，项目或任务可以升为 `full`。gate 形态：`none` 不触发；`light` 只把结论写入 `status.md` 的 `risk_evidence`（`mode: "inline"`）；`full` 落盘为项目适配层定义的标准资产并用 `mode: "report"` 指向仓库内报告。

风险 XS/S 用 `profile: "risk-minimal"`；携带风险标签的 M/L 用 `profile: "standard"`。

## promote-gate 与 severity

`promote-gate` 只接受上表 contract risk gates（`requirements_coverage` / `plan_review` / `rollback_units` / `security_review` / `behavior_verification`），只做 `none → light → full` 单调提升与 `--reason` 记录。**severity 识别属于 skill**（requirements-coverage、plan-review、rollback-units、security-reviewer 调用方、verification-before-completion）：light 出现 CRITICAL/HIGH 时 skill 必须先 `promote-gate … --to full --reason <text>`，再落盘 full 证据。CLI / validator **不**扫描 Markdown 中的 HIGH/CRITICAL，也不自动 promote。`code-review` 不是 risk gate，禁止 `promote-gate code-review`；CRITICAL/HIGH 时 skill 创建独立报告并用 `complete-gate code-review --evidence-file …` 登记。

## 各门禁阻塞条件

**需求覆盖**（复用 `requirements-coverage`，实现计划生成后、计划审查前执行）：需求没有对应任务；任务找不到需求来源且不是明确技术支撑任务；需求没有验收或验证方式；需求文档内部冲突；计划触碰明确不做的范围。通过时只作为 `plan-review` 输入，不追加为 verification 类资产。

**计划审查**（复用 `plan-review`，实现前门禁，不能由 `code-review` 替代）：CRITICAL/HIGH 是阻塞项，必须修复、反驳或用户明确接受风险后才能进入实现。审查输入包含需求说明书、实现计划、覆盖结论和相关源码/规范。

**回撤单元**（复用 `rollback-units`）：任务间有依赖但没有说明回撤顺序；任务修改共享接口/状态/权限/数据结构但没有回撤后验证；L 级任务没有记录提交、diff 范围或等价回撤策略。模板：

```markdown
### Task <id> Rollback Unit
- Purpose:
- Requirement IDs:
- Files:
- Produces:
- Consumed by:
- Commit / Diff range:
- Revert order:
- Revert command or patch strategy:
- Post-revert verification:
- Risks:
```

**安全审查**：优先用 `security-reviewer`；无可用智能体时把清单写进 `plan-review`、`status.md` 和最终 `code-review`。检查重点：token/session 安全读写和清理；权限判断只依赖可信来源、无绕过路径；登录回跳/跨系统参数/URL code 等入口校验和兜底；订单/支付/删除等高后果动作有权限和状态保护；无硬编码凭据、敏感日志或过宽错误泄露。`full` 保存到 `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-security-review.md`；`light` 至少写入 `status.md` 或最终代码审查。

**行为验证**：`webapp-testing: enabled` 用其跑关键路径并记录截图/trace；`disabled` 落盘 `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md`（步骤、预期、实测结果）；`automated-tests: present` 同时运行相关自动化测试。L 级运行时行为改动不能只用 type-check/lint 作为完成证据。用户跳过完整 lint/build 时可记录 accepted risk，但 verification 只能标 partial，不能进 `completed_gates`。

## 登录 / 鉴权 / SSO 验证矩阵

命中 `security` 标签且涉及登录、鉴权、SSO、token/session、权限守卫、HTTP 401/403 或跨系统回跳时，验证计划至少覆盖：

| 路径 | 必查点 |
|------|--------|
| SSO 入口 | URL 参数存在、缺失、重复或非法时的处理 |
| token 交换 | 请求参数、成功返回 token 写入、失败兜底跳转 |
| 本地登录 | 原 `/login` 独立登录能力不被破坏 |
| 路由守卫 | 已登录放行、未登录拦截、被动 token 失效后的去向 |
| HTTP 拦截器 | Authorization 注入、401/403 处理、错误信息不泄露敏感数据 |
| 显式登出 | 清理登录态、SSO 来源标记和跳转目标符合需求 |
| 跨系统回跳 | 认证中心地址占位符、回跳循环和来源判断 |
| 现有登录副作用 | license、门户、菜单、报表或项目已有登录后置流程是否保留 |

任一项未决都要留在需求确认门禁，不用占位符推进计划。可按项目语言调整命令，基础扫描示例：

```bash
rg -n "router\.(push|replace)\(['\"]/login['\"]\)|window\.location\.(href|replace)\s*=\s*['\"]/login['\"]|next\(['\"]/login['\"]\)" src
```
