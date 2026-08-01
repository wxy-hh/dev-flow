# 第二轮真机实战(#6851)问题修复计划

> 状态:已确认,作为 1.10.0 稳定性前置里程碑
> 来源:dev-flow-notes.md(10 个问题 + 5 条建议)与实战实录 `2026-08-01-181134-local-command-caveatcaveat-the-messages-below.txt`
> 关联:[[2026-08-01-first-round-ux-feedback]](第一轮 UX 反馈,修复已 staged)
> 后续:[Dev Flow 2.0 重构实施计划](./2026-08-01-dev-flow-2.0-implementation-plan.md)

## 与 2.0 的关系

本计划先作为 **1.10.0 独立稳定性版本**实施和真机验证,不在本阶段修改 route、Feature State schema 或风险模型。F1-F5 修复的原子性、恢复提示和命令解析能力会成为 2.0 底座;完成 1.10.0 后,再按 2.0 设计重构 intake、基础路线、风险覆盖层、阶段能力和自动 checkpoint。

2.0 将删除 `risk-minimal` 并调整 standard M/L 顶层步骤,但这不构成跳过本计划的理由。两个版本必须保持可独立验证,以便准确定位回归来源。

## Context

用户用 dev-flow 1.9.0 跑真实 M 级需求(vuejs/core #6851,standard-m 全路线 12 步),完整记录 10 个问题。核心判断:**交互层摩擦最严重——写操作频繁被拦、流程反复停止**;另有 3 个插件 bug 与 2 个流程设计缺陷。

现状:第一轮 UX 修复(elicitation 表单开关、自然语言批准词、中文 recoveryHint、批准作废提示)已 **staged 未提交**(src + dist + 测试,4305 行)。本轮在其上叠加,修复 #6851 实战暴露的剩余问题。

## 问题清单(全部已代码定位)

| # | 问题 | 根因 |
| --- | --- | --- |
| 2 | switch_active malformed result | `switchActive` 返回 `Promise<void>` → `toolResult` 对 undefined 序列化出无 text 的内容块(state-store.ts:460-475) |
| 4 | confirm_gate 双事件必失败 | `assertTokenEvidence`/`confirmGate` 只查一个 marker 事件却做两次互斥类型校验(human-gates.ts:161-190、335-354) |
| 9/10 | implementation files 格式无校验,只能手改 state.json | `implementationFiles` 只校验 string[],存在性检查推迟到 finalize(delivery-snapshot.ts:72-85) |
| 5 | heredoc 复合写命令拒绝 | `/tmp` 目标无法 projectRelative → UNRESOLVED;heredoc 正文按 `\n` 分段被误扫(adapter-policy.ts:170-183) |
| 7 | `/dev/null` 误拦 | 重定向正则捕获 `/dev/null` 后无特判 → 仓库外目标 → UNRESOLVED |
| 6/3 | packages/ 写入无 scratch 引导 | APPROVAL_REQUIRED / OUT_OF_SCOPE 提示语不含 scratch 方案 |
| 8 | checkpoint 测试先行死锁 | `CHECKPOINT_VERIFICATION_FAILED`(checkpoints.ts:406)无 recoveryHint,无合并单元指引 |

**不做(本轮)**:evidence 修正工具(前置校验已消除主路径,历史误录靠新 recoveryHint 兜底)、旧 feature 残留优化(#1,skill 已能处理)、`/tmp` 日志放行(语义不同,提示已引导 vitest.log)。

## 改动清单

### F1 — switch_active 返回结构化结果(修 #2)

- `plugins/dev-flow/src/core/state-store.ts:460-475`:`switchActive` 签名 `Promise<void>` → `Promise<FeatureState>`,writeAtomic 后 `return target`(返回风格与 recordStep/finalize/abandon 一致)。5 个既有调用点均不消费返回值,签名变更安全。
- 测试:
  - `tests/unit/state-store.test.mjs:19` 补断言 `featureId === "b"`、`lifecycle === "active"`、`revision === 1`。
  - `tests/unit/mcp-server.test.mjs` 新增端到端用例:initProject → start a(active)→ start b(paused)→ `dev_flow_switch_active`;断言 `content[0].text` 为 string(回归 bug 根症状)、`structuredContent.featureId === "b"`。

### F2 — confirm_gate 双事件 ID 分流校验(修 #4)

- `plugins/dev-flow/src/core/human-gates.ts`(唯一改动文件):
  - 抽私有辅助函数替代两处重复内联(161-190 与 335-354):`assertGateEvidenceTiming`(事件存在 + 晚于门禁呈现)、`assertPromptEvidence`(user-prompt + 归一化文本匹配)、`assertTurnBoundaryEvidence`(turn-boundary)。两个 id **各查各的事件、各校验各的类型与时间**,错误码/文案沿用现状。
  - 防重放补强:`eventIdFromConfirmation` → `confirmationEventIds`(返回两个 id),consumed 集合与 `HUMAN_GATE_EVENT_CONSUMED` 检查收集全部 id(双 id 场景下 turnBoundaryEventId 不再漏检)。
  - 单 id 路径行为逐字节等价;`server.ts:834` 已透传两个 id,无需改。
- 测试(`tests/unit/human-gates.test.mjs` 新增):双 id 全有效成功;turn-boundary 指向 user-prompt 事件 → PROVENANCE_UNAVAILABLE;turn-boundary 早于呈现 → SAME_TURN;prompt 文本不匹配 → REPLY_MISMATCH;跨门禁重放同一 t1 → EVENT_CONSUMED;`resolveGateToken` 双 id 路径。

### F3 — implementation files 记录时存在性校验(修 #9/#10)

- `plugins/dev-flow/src/core/delivery-snapshot.ts` 新增导出 `assertImplementationFilesExist(root, files)`:逐个 lstat;存在即过(**零 git 依赖常见路径**);missing 才调 `git status --porcelain=v1 -z`,状态 `D` 或 `R`/`C` 源路径放行(覆盖 worktree-deleted 与 git rm);仍缺 → 抛 `INVALID_IMPLEMENTATION_FILE`(复用 52 行错误码)带中文 recoveryHint(files 只接受纯路径,如 `"src/foo.js"` 而非 `"src/foo.js (新增)"`);git 失败(非仓库)→ 保守拒绝。
- `plugins/dev-flow/src/core/feature-check.ts:42-50` recordStep:在 mutate **之前**调用该校验 → 抛错时步骤未关闭,可直接重录(消除死局)。
- `delivery-snapshot.ts:177-180` `DELIVERY_FILE_UNREGISTERED` 的 recoveryHint 中文化并说明纯路径规则(历史误录兜底)。
- 测试:
  - `tests/unit/feature-check.test.mjs` 新增:`files: ["src/app.js (新增)"]` → INVALID_IMPLEMENTATION_FILE + hint 含"纯路径";不存在文件同理;空 files 仍成功。
  - `tests/unit/delivery-snapshot.test.mjs` 新增:存在文件成功;`rm` 后(保持 git 跟踪)recordStep 成功。
  - **必须改既有测试**:`tests/unit/implementation-units.test.mjs` 的 `implementationReadyFeature`(39-80)补建 `src/one.ts` fixture,否则 216/221/229/237 四个用例会因新校验而改变期望错误。

### F4 — 写目标解析器:`/dev/null` 放行 + heredoc 正文屏蔽(修 #7/#5)

- `plugins/dev-flow/src/hosts/adapter-policy.ts` `analyzeBashWriteTargets`(162-226):
  - `/dev/null` 过滤(仿 patchTargets:90 先例):push 前 `token === "/dev/null"` 跳过 + 收尾 `filter`;所有目标都是 `/dev/null` → `{ kind: "read-only" }`(丢弃输出,preToolBlock 两个分支均放行);混合命令(sed -i ... /dev/null)仍有真实目标,不误放行。重定向正则改 `(?:^|[^0-9&])>{1,2}` 顺带修 `2>&1` 误捕 `1` 的怪癖。
  - 新增 `maskHeredocBodies`(~35 行):分段前按行屏蔽 heredoc 正文。引号感知扫描器(只识别引号外的 `<<`,防 `printf 'x <<y'` 误开);定界符纯数字不算 heredoc(防 `$((1 << 4))`);`<<-` 支持;未闭合 → 屏蔽到末尾(只少检、不多拦,不构成回归);首行的 `> target` 重定向保持捕获。
- 测试(`tests/unit/adapter-policy.test.mjs`):
  - `echo hi > /dev/null` → read-only;`npm test > /dev/null 2>&1` → read-only;`echo hi > /dev/null > log.txt` → resolved `["log.txt"]`。
  - heredoc:正文含 `>`/`&&` 不误扫(`cat > scratch/a.ts <<'EOF'\nconst x = a > b;\nEOF` → resolved `["scratch/a.ts"]`);未闭合;`<<-` tab 终止;引号内 `<<` 不误开。
  - preToolBlock 集成:`echo hi > /dev/null` 放行(undefined);既有 48-74 heredoc 放行、404-416 /tmp 用例、278-282 expansion 用例不受影响(已确认)。

### F5 — 拦截消息引导 + checkpoint recoveryHint(修 #6/#8)

- `adapter-policy.ts`:
  - 提取 `scratchHint` 常量;APPROVAL_REQUIRED(341-347)末尾追加;`augmentApprovalBlock`(395-407)作废文案末尾**同样追加**(该函数整体替换 hint,两侧都加才不丢);OUT_OF_SCOPE(358-364)追加"临时验证文件请放 scratch/"。
  - 既有测试断言(/作废/、/vitest\.log/)不受追加影响(已确认)。
- `plugins/dev-flow/src/core/checkpoints.ts:406` `CHECKPOINT_VERIFICATION_FAILED` 补中文 recoveryHint:①测试先行死锁 → 测试+修复须合并为同一回撤单元(原子单元);②checkpoint 前清理 scratch/ 残留红测试。
- `plugins/dev-flow/skills/plan/SKILL.md`(10-13 行 RU 要点处)新增 bullet:「前向验证独立可过」原则——若单元前向验证在依赖单元未落地时必然失败,测试与修复必须同单元;checkpoint 前清理 scratch。skills.test.mjs:44 断言不受影响。
- 测试:`tests/unit/checkpoints.test.mjs:159-174` 既有 FAILED 用例补断言 recoveryHint 匹配 `/原子单元|scratch/`;adapter-policy.test.mjs 377-391 / OUT_OF_SCOPE 用例补 `assert.match(reason, /scratch/)`。

## 验证

```bash
npm run typecheck                          # 严格 TS
npm run test:unit                          # 全量单测(含新增/修改用例)
node --test tests/unit/adapter-policy.test.mjs tests/unit/human-gates.test.mjs tests/unit/feature-check.test.mjs tests/unit/delivery-snapshot.test.mjs tests/unit/checkpoints.test.mjs tests/unit/implementation-units.test.mjs tests/unit/mcp-server.test.mjs tests/unit/state-store.test.mjs
npm run test:routes                        # 路线 E2E(受 recordStep/门禁改动影响)
npm run test:interop                       # 跨宿主交接
```

行为验证(可选):真实走一遍 standard-m 门禁确认流程(confirm_gate 双 id、switch_active 返回、`cmd > /dev/null` 放行)。

## 提交前收尾(由用户执行)

- `npm run version:sync` + 版本号提升(行为变更,如 1.9.0 → 1.10.0)+ `npm run build` + `npm run build:check`,源码与 `plugins/dev-flow/dist/` 一并提交
- 更新 `dev-flow-notes.md` UX 清单状态(#2/#4/#7/#9/#6/#8 已修)
- 注意:第一轮 staged 修复(未提交)与本轮改动在同一工作区,提交时一并整理

## 关键文件

- `plugins/dev-flow/src/core/state-store.ts`(F1)
- `plugins/dev-flow/src/core/human-gates.ts`(F2)
- `plugins/dev-flow/src/core/delivery-snapshot.ts`、`plugins/dev-flow/src/core/feature-check.ts`(F3)
- `plugins/dev-flow/src/hosts/adapter-policy.ts`(F4/F5)
- `plugins/dev-flow/src/core/checkpoints.ts`、`plugins/dev-flow/skills/plan/SKILL.md`(F5)
- 测试:`tests/unit/{state-store,mcp-server,human-gates,feature-check,delivery-snapshot,implementation-units,adapter-policy,checkpoints}.test.mjs`
