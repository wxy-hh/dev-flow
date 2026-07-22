# status CLI 与写入授权

`dev-flow-status` 是 `status.md` 和 write authorization 的唯一写入入口。命令实现位于 `.claude/skills/dev-flow/scripts/dev-flow-status.mjs`；写后立即跑 validator，失败恢复原状态。`repair` 只重排字段，不发明事实。

下面的相对路径命令都**在仓库根目录执行**。运行时 `next_command` 会给出可从任意子目录执行的绝对脚本路径；不要为此添加 PATH shim、自动 `chdir` 或 `cd … && …`。

## 高层入口

```text
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs start <feature-id>
  --level <XS|S|M|L>
  --topology <local|shared-contract|multi-chain|coordinated-rollback>
  [--risk-labels <csv>]
  [--execution <light|standard>]
  [--requirements <missing-or-unclear|openspec|documented-unconfirmed|confirmed>]
  [--evidence-result <verified|partial|not-applicable>]
  [--existing-diff <unrelated|in-scope> --reason <text>]
  [--dry-run]

node .claude/skills/dev-flow/scripts/dev-flow-status.mjs next [feature-id]

node .claude/skills/dev-flow/scripts/dev-flow-status.mjs scaffold <feature-id>
  --asset <rollback-units|security-review|code-review|verification|manual-test|partial-acceptance|completion>
  [--refresh]
```

`start` 是默认入口：XS/S 自动 light 且拒绝 `--execution`；M/L 必须明确 `light|standard`；standard 必须给 `--requirements`。dry-run 与真实执行共用 policy；真实执行原子完成 classify 或 init+activate，失败不留半状态。`next` 只输出 route、process、authorization、当前 gate、blocker 和唯一下一条命令。`scaffold --refresh` 仅允许 completion；生成名为 `<feature-id>-<kind>.md`，读取端继续兼容历史单双日期名称。

拓扑约束：`local` 允许 XS/S/M；`shared-contract` 最低 M，破坏共享契约时必须按 L 分类；`multi-chain`、`coordinated-rollback` 只允许 L。同一 feature 内匿名、真实账号、OAuth 等行为分支是验证矩阵，不是 multi-chain。

## 低层兼容命令

```text
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs authorize --level <XS|S|M> [--note <text>]
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs init <feature-id> --level <XS|S|M|L> --profile <profile>
  --topology <topology> --evidence-result <result>
  [--entry-gate <req-probe|openspec|grillme|writing-plans>]
  [--note <text>] [--risk-labels a,b] [--lightweight-l]
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs activate <feature-id>
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs add-asset <feature-id> --path <repo-path> --kind <kind>
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs complete-gate <feature-id> <gate>
  [--evidence-inline <summary>]
  [--evidence-file <repo-path> --heading <markdown-heading>]
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs promote-gate <feature-id> <risk-gate> --to <light|full> --reason <text>
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs record-risk-evidence <feature-id> <label>
  [--mode <inline|report>] [--conclusion <text>] [--verification <text>] [--report <path>]
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs confirm-human <feature-id> <gate>
  --status confirmed --evidence <exact-user-reply>
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs record-validation <feature-id> --command <command>
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs complete-verification <feature-id> --command <command>
  [--report <path>] [--manual-test <path>]
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs mark-retrospective <feature-id> --reason <text>
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs propose-risk <feature-id> --id <AR-id> --step <manual-step> --reason <text>
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs accept-risk <feature-id> --id <AR-id>
  --proposal-token <token> --evidence <exact-user-reply>
node .claude/skills/dev-flow/scripts/dev-flow-status.mjs repair <feature-id>
```

M + 风险标签必须经 `start`，不得用 `authorize --level M` 绕过 status。已有 active status-backed authorization 时，重复 `start` 或低层 `authorize` 零修改拒绝，不能降级成 classified。保留低层命令是为了恢复和兼容，不鼓励调用方重新实现 policy。

## process 与批准基线

`start/init` 记录单一业务 diff hash `B0`。dirty workspace 必须声明 `unrelated|in-scope` 和原因；输出只列 path/status，不读出文件内容。`clean|unrelated` 默认 normal，`in-scope` 直接 retrospective。仅当现有 diff **全部**是 untracked 的 `docs/**` 或 `*.md` 时，CLI 会额外给出提示；仍需人工判断并显式声明，例如 `--existing-diff unrelated --reason "用户预先编写的需求输入，已纳入 B0 基线"`，等价英文示例为 `--existing-diff unrelated --reason "User-authored requirement input, included in the B0 baseline"`。混入源码、非文档或已跟踪修改时不会给该提示。

normal 的 `confirm-human implementation_approval` 首次从 pending 转 confirmed 时，在写 status/auth 前计算 `B1`，仅 `B1 === B0` 才批准；漂移时零修改失败并提示 `mark-retrospective`。批准后的 activate/re-confirm 只重算 basis：authorization 比较既有结构化 `approval_basis` 与 status 中的 mode、disposition、baseline、route、risk、protected roots 和前置资产 hash，不再把当前业务 diff 与 `B0` 比较。最终验证/check-ok/completion 使用 `Bfinal`。

`mark-retrospective` 只切换 mode、记录原因并使 authorization pending；不刷新原始 baseline，也不确认 HUMAN GATE。任何 `in-scope`（含无风险 XS/S/light M）都创建 status；后两者复用 risk-minimal/risk-minimal-m，且仅此模式允许空风险标签。retrospective 表示允许审查、修复、验证现有实现，不是追认过去实现，不追补需求确认、writing-plans、coverage 或 plan-review。

单一全仓 hash 不能证明批准后 unrelated 旧 diff 从未被修改。需要强隔离时使用干净工作区或独立 worktree，不扩张成第二套 path manifest。

## evidence 与风险接受

`complete-gate` 的 inline/report 互斥。light 可 inline 或 report；full 只接受已登记资产中的 report。behavior light 继续复用 `risk_evidence` 和 validation commands。security inline 采用语义校验，接受中英文自然语言或键值写法、任意顺序：鉴权必须有范围、结果，且列出矩阵/分支，或具体说明登录/SSO/token/session/权限等未触及、原因和验证结论；隐私必须有范围、白名单、排除字段、数据构建/序列化/导出 props 等强制边界和结果。只写“已审查/无问题”会失败。最短示例：`scope=auth; anonymous denied, account allowed; result=verified`；`scope=privacy；白名单：id,name；排除字段：token,email；强制边界：序列化导出 props；结果：通过`。

`propose-risk` 输出现有 `[HANDOFF]`（`Auto-continue: no`）和只显示一次的原始 token；runtime 只存 token hash。token 绑定 feature、AR、step、reason、业务 fingerprint，并且单次、限时有效。丢失、过期、消费、fingerprint 漂移或 runtime 清理后必须重新 propose。

`accept-risk` 保存用户后续回复原文。回复必须明确接受刚列出的具名残余风险并继续/收尾；“确认”“继续”“完成吧”“行”等通用 HUMAN GATE 回复不能消费 token。门槛高于 `confirm-human`。

manual-test 的 `delegated` 表示已交给人或运行环境但仍 pending；finish 会阻断。`passed` 需要可审计实测；`skipped` 必须与 accepted risk 和 partial-acceptance 三方一致。

## 授权与路径门禁

一个 worktree 只有 `.claude/runtime/dev-flow/write-authorization.json`。状态为 `classified|approval-pending|approved|closed`；approved 必须是当前 schema/version、有 active status，且 approval basis 匹配。finalizer 后保留 closed 记录；finalized 查询不依赖写授权。

只在命中 `protected_write_roots` 时应用 `off|ask|strict`；`.claude/**`、feature/review roots、`openspec/**` 永远是流程资产。Bash：只读探索（`rg`/`ls`/`git status` 等，见 `dev-flow-command` 的 `is_readonly`）始终放行，不要求先 `/dev-task`；pending、closed 或无授权时只闸变更类 Bash 与单条受管控制命令以外的 mutate。单/双引号或转义中的管道、重定向、连接、后台等普通元字符作为字面量时不算 shell control；未引用的管道、重定向、连接、后台和换行会阻断（且不算只读）。命令替换是例外：反引号与 `$()` 在未引用或双引号内都会执行，因此均阻断；只有位于单引号内或已转义为字面量时才放行。Git close-out 交给 finish guard。

真实 secret 文件写入要求确认，`.env.example` 放行。validator 只扫描受管流程/最终资产中的高置信 secret assignment，错误只报告 path/key，不打印值。该护栏不是系统安全边界。
