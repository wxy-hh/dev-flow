# partial 验证与 outcome

## 结果定义

- `verified`：所有必需行为步骤均为 `passed`，验证证据新鲜，`accepted_risks` 为空，无未关闭 partial-acceptance。
- `partial`：无 `failed` 或 pending 步骤；每个 `skipped` 关联唯一 `AR-xxx`；用户明确接受每个风险；手测表、`status.accepted_risks`、`<REVIEW_ROOT>/<feature-id>-partial-acceptance.md` 三方一致。

pending、`delegated`、空实测、`待执行`、缺风险关联或 `failed` → feature-check 失败。delegated 只表示已交给人/环境，未形成结果。

## 手测机器可读源

优先 frontmatter / 侧车：

```yaml
manual_test_steps:
  - id: MT-001
    result: pending|delegated|passed|failed|skipped
    risk_id: null   # skipped 时必填 AR-xxx
    observed: "..."
    evidence: "..."
```

人读固定七列：`ID | 操作 | 预期 | 结果 | 实测 | 证据 | 风险 ID`。`pending|delegated` 都是未完成，`passed|failed|skipped` 是终态。仅有表格时 validator 尝试解析；frontmatter 与表格并存时 ID、result、risk_id 必须一致。

frontmatter 可选 `method`（`browser|device|api|cli|automated`）：

- 所有 `passed` 须有非空 `observed` 与 `evidence`。
- `behavior_verification: full` 时每个 `passed` 须有 method；light 缺 method 仅 WARN。
- `static-review` / 纯 lint / type-check **不能**作为 passed method（禁止冒充运行时证据）。
- `automated` 须有已注册 verification 资产，并在 evidence 中显式写出 `command: <实际命令>; test: <测试标识>`；只有笼统的「自动化已通过」或资产路径不算执行证据。

## accept-risk

```text
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs propose-risk <feature-id> --id AR-xxx --step MT-00N --reason <reason>
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs accept-risk <feature-id> --id AR-xxx \
  --proposal-token <one-time-token> --evidence <exact-user-reply>
```

proposal 使用 `[HANDOFF]` 停等；token 绑定 feature/AR/step/reason/fingerprint，丢失、过期、消费或漂移后重新 propose。accept 只接受明确“接受具名残余风险并继续/收尾”的回复。成功后追加 partial-acceptance；无 skipped 时不得保留有效 AR，`repair` 不得创建 AR。

## check-ok stamp

`dev-flow-feature-check --finish` 成功时写入 `.claude/runtime/dev-flow/<feature-id>.check-ok`（唯一 stamp 写入者；`complete-verification` 不 stamp）：

```text
workflow_version: <contract version>
fingerprint: <40-char-git-hash>
outcome: verified|partial
checked_at: <ISO-8601>
```

`workflow_version` 为无引号 contract 版本。finish-guard：指纹新鲜、final-assets 有效且版本匹配则允许 add/commit/push/merge（partial 与 verified 相同）；不得把 partial 叙述成「验证通过」。业务 diff 变化或版本不匹配导致过期：一律失效需重跑 check。

## 收尾文案

partial 可正常提交、推送、合并或创建 PR；completion、stamp、收尾输出必须为 `outcome: partial`，展示未验证步骤和风险摘要。
