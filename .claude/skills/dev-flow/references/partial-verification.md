# partial 验证与 outcome

## 结果定义

- `verified`：所有必需行为步骤均为 `passed`，验证证据新鲜，`accepted_risks` 为空，无未关闭 partial-acceptance。
- `partial`：无 `failed` 或 pending 步骤；每个 `skipped` 关联唯一 `AR-xxx`；用户明确接受每个风险；手测表、`status.accepted_risks`、`<REVIEW_ROOT>/<feature-id>-partial-acceptance.md` 三方一致。

pending、空实测、`待执行`、缺风险关联或 `failed` → feature-check 失败。

## 手测机器可读源

优先 frontmatter / 侧车：

```yaml
manual_test_steps:
  - id: MT-001
    result: passed|failed|skipped
    risk_id: null   # skipped 时必填 AR-xxx
    observed: "..."
    evidence: "..."
```

人读固定七列：`ID | 操作 | 预期 | 结果 | 实测 | 证据 | 风险 ID`。`结果` 仅 `passed|failed|skipped`。仅有表格时 validator 尝试解析，失败则 FAIL；frontmatter 与表格同时存在时，两边的 ID 集合及每项 `result`、`risk_id` 必须一致。

frontmatter 可选 `method`（`browser|device|api|cli|automated`）：

- 所有 `passed` 须有非空 `observed` 与 `evidence`。
- `behavior_verification: full` 时每个 `passed` 须有 method；light 缺 method 仅 WARN。
- `static-review` / 纯 lint / type-check **不能**作为 passed method（禁止冒充运行时证据）。
- `automated` 须有已注册 verification 资产，并在 evidence 中显式写出 `command: <实际命令>; test: <测试标识>`；只有笼统的「自动化已通过」或资产路径不算执行证据。

## accept-risk

```text
dev-flow-status accept-risk <feature-id> --id AR-xxx \
  --step MT-00N --reason <reason> --evidence <user-evidence>
```

每次成功追加/更新 partial-acceptance 中对应 `AR-xxx`（步骤、原因、用户原话、确认时间）。无任何 skipped 时不得生成或保留有效 partial-acceptance；`repair` 不得凭空创建 AR。

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
