# dev-flow 双宿主插件实施计划

## 使用方式

本文件是可直接交给实现工程师或编码代理执行的任务清单。严格按顺序实施；每个阶段先写失败测试，再写最小实现，阶段验收通过后再进入下一阶段。

设计权威：`docs/plans/2026-07-22-dev-flow-dual-host-plugin-design.md`。

## 完成定义

只有同时满足以下条件才算实施完成：

- 仓库只保留 marketplace + `plugins/dev-flow` 插件发行形态。
- Claude Code 和 Codex CLI 从同一 GitHub repository 原生安装成功。
- MCP 是全部 Skills 的唯一工作流接口。
- XS、S、risk-minimal、light M、standard M、light L、standard L 的 E2E 全部通过。
- 两个 HUMAN GATE 不能在同一回合确认，且确认记录包含用户原文。
- 一个工作区最多一个 active feature；switch 原子暂停当前 feature 并激活目标 feature。
- logic-complete 前 Git 写操作被 hooks 阻止。
- Claude 创建的 feature 可由 Codex 完成；反向亦然。
- `dist/` 随插件发布，安装过程不执行依赖安装。
- 根 `package.json#version`、两份 manifest 和三个 bundle 版本一致；两个 marketplace 不保存冗余版本。

## 开发约束

- Node.js 最低版本：20。
- TypeScript 严格模式。
- 单元和本地 E2E 使用 Node 内置 test runner。
- MCP SDK、schema validator 和构建工具只作为开发依赖；esbuild 将运行时代码打入三个 bundle。
- 所有项目状态写入都必须经过 state-store transaction。
- 所有外部命令使用 `execFile`/argv，不拼 shell 字符串。
- 不提交 `node_modules/`、测试临时目录、宿主缓存或消费项目生成的 `.dev-flow/`。
- 不在实施过程中创建任何宿主提示注入文件或项目宿主 settings。
- 首次发布以 Claude Code `2.1.215`、Codex CLI `0.144.4` 为初始资格测试基线；README 最低支持版本只能取 release smoke 实际通过的最低版本。

## 阶段 0：建立干净基线

### 目标

当前真实基线是：旧实现仍位于 `.claude/**`；`plugins/`、`tests/` 只有空的试验骨架；根 `package.json`、`package-lock.json` 尚不存在。阶段 0 必须删除旧实现和试验树后从空骨架重建，禁止在旧 thin core、旧 Skill 或旧 hook 上增量修改。

### 文件操作

删除：

- 当前 `.claude/` 整个目录。
- 当前 `plugins/` 和 `tests/` 整树；它们是试验骨架，不作为新实现起点。
- 当前 `templates/` 整个目录。
- 当前旧版 README、旧指南、旧设计和旧测试文档；只保留本设计与本实施计划。

保留：

- `.git/`
- `.gitignore`
- 本设计文档
- 本实施计划

新增根目录：

```text
.agents/plugins/
.claude-plugin/
.github/workflows/
plugins/dev-flow/
tests/{unit,e2e,fixtures,helpers}/
```

### 验收

```bash
git status --short
find . -maxdepth 3 -type f | sort
```

确认没有任何旧运行脚本、宿主项目配置或复制式安装资产留在发行树中。

额外执行 `rg` 确认新实现没有 import、调用或复制 `.claude/**`；也不得从历史提交或其他试验分支搬入旧 thin-core 代码。测试 fixture 不得把旧实现当权威。

## 阶段 1：建立构建系统和插件骨架

### 测试先行

新增 `tests/e2e/forbidden-legacy.test.mjs`，断言：

- 发行树只有根 marketplace 和 `plugins/dev-flow` 插件组件。
- 插件目录不存在项目注入文件、安装复制脚本和包内升级器。
- `dist/` 三个入口存在。

此时测试应失败。

同时为版本同步和插件路径新增失败测试：

- 根 `package.json#version` 是唯一输入；两份 manifest 和 bundle banner 漂移时 `version:check` 失败。
- 两个 marketplace 不包含 version 字段。
- Claude hook command 精确为 `node "${CLAUDE_PLUGIN_ROOT}/dist/claude-hook.mjs"`，并能在包含空格的模拟 plugin root 下执行。

测试文件固定为 `tests/unit/version-sync.test.mjs` 和 `tests/unit/host-paths.test.mjs`；前者在临时副本中制造版本漂移，后者解析 manifest/hooks 并执行带空格路径 fixture。

### 实现文件

新增：

```text
package.json
package-lock.json
tsconfig.json
LICENSE
.agents/plugins/marketplace.json
.claude-plugin/marketplace.json
plugins/dev-flow/LICENSE
plugins/dev-flow/README.md
plugins/dev-flow/.claude-plugin/plugin.json
plugins/dev-flow/.codex-plugin/plugin.json
plugins/dev-flow/.mcp.json
plugins/dev-flow/hosts/claude/hooks.json
plugins/dev-flow/hosts/codex/hooks.json
plugins/dev-flow/src/mcp/server.ts
plugins/dev-flow/src/hosts/claude-adapter.ts
plugins/dev-flow/src/hosts/codex-adapter.ts
plugins/dev-flow/dist/mcp-server.mjs
plugins/dev-flow/dist/claude-hook.mjs
plugins/dev-flow/dist/codex-hook.mjs
scripts/build.mjs
scripts/sync-version.mjs
tests/fixtures/hooks/claude-plugin-root-with-spaces.json
tests/unit/host-paths.test.mjs
tests/unit/version-sync.test.mjs
```

阶段 1 即创建最小但 schema 合法的双 manifest、双 marketplace、`.mcp.json` 和 hooks stub，使所有 source/path 可以尽早校验。阶段 11 只补齐最终 metadata、能力声明和原生安装测试，不再首次创建这些文件。

`package.json` 固定脚本：

```json
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:check": "npm run version:check && npm run build && npm run version:check && git diff --exit-code -- plugins/dev-flow/dist",
    "version:sync": "node scripts/sync-version.mjs --write",
    "version:check": "node scripts/sync-version.mjs --check",
    "typecheck": "tsc --noEmit",
    "test:unit": "node --test tests/unit/*.test.mjs",
    "test:routes": "node --test tests/e2e/routes/*.test.mjs",
    "test:interop": "node --test tests/e2e/cross-host/*.test.mjs",
    "test:e2e": "node --test tests/e2e/*.test.mjs tests/e2e/routes/*.test.mjs tests/e2e/cross-host/*.test.mjs",
    "test": "npm run typecheck && npm run test:unit && npm run test:e2e && npm run build:check"
  }
}
```

新增 `scripts/build.mjs`，用 esbuild 生成三个单文件 ESM bundle。设置：

- `platform: "node"`
- `target: "node20"`
- `bundle: true`
- `packages: "bundle"`
- sourcemap 关闭
- banner 加入构建来源和插件版本，但不加入时间戳，确保可重复构建

`scripts/sync-version.mjs` 以根 `package.json#version` 为唯一权威：`--write` 更新两份 manifest；`--check` 校验根版本、两份 manifest 和三个 bundle 内的版本常量/banner。marketplace 不参与版本同步，因为它们不声明 version。

### 验收命令

```bash
npm ci
npm run typecheck
npm run version:sync
npm run build
npm run version:check
node --test tests/unit/version-sync.test.mjs tests/unit/host-paths.test.mjs
node --test tests/e2e/forbidden-legacy.test.mjs
claude plugin validate .
claude plugin validate ./plugins/dev-flow --strict
npm run build:check
```

## 阶段 2：定义 contract、schema 和 route policy

### 测试先行

新增：

```text
tests/unit/classify.test.mjs
tests/unit/derive-next.test.mjs
```

分类测试穷举：

- 4 levels × 4 topologies。
- XS/S 不允许显式 execution。
- M/L 必须声明 execution。
- standard M/L 必须声明 requirements state。
- 风险 XS/S/light M → risk-minimal。
- 无风险 light M → light-m。
- light L / standard L 保持 L route。
- topology 最低级别不满足时失败并返回建议 level。
- 风险标签不修改 level。
- 每个风险标签精确产生 contract 指定的步骤和证据强度：security → 安全检查+行为验证，data/money → 回撤检查+行为验证，external/availability → 集成行为验证，critical correctness → full code-review+full verification，irreversible consequence → full rollback+full code-review+full verification。
- 多风险标签取 obligation 并集且证据强度取更严格值。
- 风险增强不得给 risk-minimal 增加 plan-review。
- reclassify strictness 关系只允许 level/topology/risk/execution 单调升严，不存在降级边；topology 严格序固定为 `local < shared-contract < multi-chain < coordinated-rollback`。

此时测试应因模块不存在而失败。

### 实现文件

新增：

```text
plugins/dev-flow/policy/contract.json
plugins/dev-flow/policy/project.schema.json
plugins/dev-flow/policy/state.schema.json
plugins/dev-flow/policy/event.schema.json
plugins/dev-flow/policy/artifact.schema.json
plugins/dev-flow/src/policy/types.ts
plugins/dev-flow/src/policy/contract.ts
plugins/dev-flow/src/policy/validation.ts
plugins/dev-flow/src/policy/route.ts
plugins/dev-flow/src/policy/derive-next.ts
```

`contract.json` 必须是 route、步骤、资产、HUMAN GATE、风险增强和 feature-check 要求的单一机器权威。代码不得在多个 switch 中重复路线常量。

contract 还必须声明风险标签 → obligation/evidence strength 映射和 reclassify 的单调规则。route selector 只接受新 classification，不能接受调用方直接指定目标 route。

Route ID 固定为：

```text
xs
s
risk-minimal
light-m
standard-m
light-l
standard-l
```

标准 M ordered steps 固定为：

```text
requirements
requirement_confirmation
implementation_plan
coverage_review
rollback_unit
plan_review
implementation_approval
implementation
code_review
verification
feature_check
finalize
```

标准 L 使用同一骨架，但 rollback、plan/code review 和 verification evidence 为 full 独立资产。

### 验收命令

```bash
npm run build
node --test tests/unit/classify.test.mjs tests/unit/derive-next.test.mjs
```

## 阶段 3：实现项目配置

### 测试先行

新增 `tests/unit/project-config.test.mjs`，覆盖：

- 有效 schema v1。
- 缺失字段。
- 非 strict enforcement。
- 重复 command ID。
- command 使用空字符串。
- cwd 为绝对路径或含 `..`。
- protected root 为绝对路径、含 `..` 或落在 `.dev-flow/`。
- feature 只能引用已登记 command ID。
- 未初始化项目无法 start。

### 实现文件

新增或完成：

```text
plugins/dev-flow/src/mcp/tools/project.ts
plugins/dev-flow/src/core/errors.ts
plugins/dev-flow/policy/project.schema.json
```

实现 `dev_flow_init_project`：

1. 定位 Git root；不是 Git 仓库时返回稳定错误。
2. 校验调用输入。
3. 原子创建 `.dev-flow/project.json`。
4. 已存在时默认拒绝覆盖；只有 expected hash 匹配时允许更新。
5. 返回项目配置 hash、command IDs 和 protected roots。

项目配置中的命令只保存 executable + args + project-relative cwd。验证执行器以后只按 command ID 运行。

### 验收命令

```bash
node --test tests/unit/project-config.test.mjs
```

## 阶段 4：实现事务状态库和单 active feature

### 测试先行

新增：

```text
tests/unit/state-store.test.mjs
tests/unit/reclassify.test.mjs
```

覆盖：

- 新建 feature 时生成 state 和 events。
- active feature 存在时，默认 activation 的 start 不能创建第二个 active；显式 `activation: "paused"` 可以创建不可推进的 paused feature且不改变 active pointer。
- expected revision 不匹配时零修改失败。
- 临时文件写入失败不会损坏旧 state。
- 并发写入只有一个成功。
- lifecycle 只允许 `active | paused | finalized | abandoned`，终态不可逆。
- finalize 清除 active 指针；abandon active 也清除，abandon paused 不影响当前 active。
- terminal 历史 feature 可读但不可修改；paused feature 只能由 switch/abandon 等生命周期工具修改，不能推进 route step。
- 显式 switch 需要原因，只能切到 paused feature，并在单事务中 pause 当前、activate 目标；不允许产生两个 active/in-progress。
- switch 任一写入或 revision 校验失败时，两份 state、两份 ledger 和 active pointer 均保持原样。
- abandon 必须记录原因、用户证据和时间；finalized 不可 abandon，abandoned 不可恢复或切换，恢复工作必须创建新 feature ID。
- schema 非 v1 失败且不转换。
- live owner 持锁超过 5 秒时返回 `STATE_LOCK_TIMEOUT`，不得抢锁。
- 只允许接管 owner PID 已死亡且超过 30 秒的 stale lock；revision conflict 仍返回 `STATE_REVISION_CONFLICT`。

`reclassify.test.mjs` 至少覆盖五组：

1. light M 增加风险进入 risk-minimal，保留仍匹配的边界证据并失效 implementation approval 及后续证据。
2. M 提升到 L/更高 topology，从第一个新 obligation 起失效，并要求 L 资产。
3. light → standard M/L 时重新要求需求基线、`requirement_confirmation` 和 `implementation_approval`。
4. 降 level、删风险、standard → light 或降低 topology 全部返回 `RECLASSIFICATION_NOT_STRICTER` 且 revision 不变。
5. finalized/abandoned feature 禁止 reclassify。

### 实现文件

新增或完成：

```text
plugins/dev-flow/src/core/state-store.ts
plugins/dev-flow/src/mcp/tools/feature.ts
plugins/dev-flow/src/mcp/tools/inspect.ts
```

实现：

- 项目根定位。
- 基于项目根 hash 的跨进程锁。
- 锁等待上限 5 秒，以 50 ms + jitter 重试；stale 候选阈值 30 秒。
- 锁 metadata 包含 PID、hostname、acquiredAt、featureId、operation；同机 live PID 绝不抢占，只接管 dead + stale owner。
- 错误码固定区分 `STATE_LOCK_TIMEOUT` 和 `STATE_REVISION_CONFLICT`。
- revision compare-and-swap。
- 临时文件 + fsync + atomic rename。
- append-only `events.jsonl`。
- `.dev-flow/active.json` 原子维护。
- `start/status/next/switch_active/reclassify/abandon` 的底层事务。

禁止直接导出无 revision 检查的 `saveState`。

### 验收命令

```bash
node --test tests/unit/state-store.test.mjs tests/unit/reclassify.test.mjs
```

## 阶段 5：实现资产模板、登记和 status 投影

### 测试先行

新增 `tests/unit/artifacts.test.mjs`，逐 route 断言强制资产集合：

- XS/S：无 Markdown。
- risk-minimal：status + risk card。
- light M：无强制 Markdown。
- standard M：requirements、plan、status、coverage。
- light L：boundary、rollback/safety、verification。
- standard L：requirements、plan、coverage、rollback units、plan review、code review、verification。

再覆盖：

- 不允许在当前 step 前创建未来资产。
- 路径必须位于当前 feature 目录。
- 文件 hash 变化使登记失效。
- status 是生成投影，不能通过 `record_step` 伪造机器字段。

### 实现文件

新增：

```text
plugins/dev-flow/src/core/artifacts.ts
plugins/dev-flow/src/mcp/tools/artifacts.ts
plugins/dev-flow/templates/boundary-card.md
plugins/dev-flow/templates/code-review.md
plugins/dev-flow/templates/coverage-matrix.md
plugins/dev-flow/templates/implementation-plan.md
plugins/dev-flow/templates/plan-review.md
plugins/dev-flow/templates/requirements.md
plugins/dev-flow/templates/risk-card.md
plugins/dev-flow/templates/rollback-safety.md
plugins/dev-flow/templates/rollback-units.md
plugins/dev-flow/templates/status.md
plugins/dev-flow/templates/verification.md
```

模板必须包含稳定 heading 和 frontmatter：

```yaml
dev_flow:
  schema_version: 1
  feature_id: <id>
  route: <route>
  kind: <kind>
```

`dev_flow_scaffold_artifact` 只创建当前 deriveNext 所要求的资产。`dev_flow_record_step` 登记 path、kind、SHA-256 和 required headings。

### 验收命令

```bash
node --test tests/unit/artifacts.test.mjs
```

## 阶段 6：实现 HUMAN GATE

### 测试先行

新增：

```text
tests/unit/human-gates.test.mjs
tests/e2e/strict-human-gate.test.mjs
```

覆盖：

- gate 未 present 不能 confirm。
- present 后立即 confirm 被同 turn marker 拒绝。
- `userReply` 缺失或为空失败。
- 布尔确认、代理转述字段无效。
- 捕获到 prompt event 时，原文不一致失败。
- prompt event 必须晚于 present。
- 没有 prompt event 但存在可信、晚于 present 的宿主 turn boundary 时可以确认，并记录 `matched-turn-boundary`。
- 只有 `userReply`、但 prompt event 和可信 turn boundary 都不存在时返回 `HUMAN_GATE_PROVENANCE_UNAVAILABLE`；显式原文不能单独完成 gate。
- 同一 prompt 不能确认两个 gate。
- requirement 文件 hash 变化使 requirement confirmation 失效。
- scope、计划、coverage、rollback 或 risk evidence 变化使 implementation approval 失效。
- 失败路径不增加 revision。

### 实现文件

新增或完成：

```text
plugins/dev-flow/src/core/human-gates.ts
plugins/dev-flow/src/mcp/tools/evidence.ts
plugins/dev-flow/src/hosts/claude-adapter.ts
plugins/dev-flow/src/hosts/codex-adapter.ts
```

实现两个 MCP tools：

```text
dev_flow_present_gate
dev_flow_confirm_gate
```

`confirm_gate` 输入固定包含 `featureId`、`gate`、`userReply`，可选 `promptEventId` 或 `turnBoundaryEventId`。保存原文、host、时间、provenance、basis hash 和消费的 event/turn marker。

adapter 的 `UserPromptSubmit` 在宿主提供时只追加 host event；PreToolUse 根据 session/turn marker 阻止同回合确认。若宿主运行没有该事件，只能由可验证的后续 turn boundary 作为 fallback；两种时序来源都缺失时 MCP fail closed。E2E 不得把“Codex 必定提供 UserPromptSubmit”作为严格门禁成立的前提。MCP 是最终状态写入者。

### 验收命令

```bash
node --test tests/unit/human-gates.test.mjs tests/e2e/strict-human-gate.test.mjs
```

## 阶段 7：实现 fingerprint、验证和 feature-check

### 测试先行

新增 `tests/unit/feature-check.test.mjs`，覆盖：

- protected roots 的 tracked 和相关 untracked 内容进入 fingerprint。
- `.dev-flow/` 不进入业务 fingerprint。
- Git commit 前后业务内容不变时 fingerprint 稳定。
- 验证后业务文件变化会失效 verification、feature-check 和 logic-complete。
- feature-check 检查 route ordered steps、gate、资产 hash、验证命令和 review 分离。
- 不要求 feature-check 的 route 不会被错误阻止。
- required route 缺 feature-check 不能 finalize。
- plan-review evidence 不能满足 code-review，反向亦然。
- 每次验证无论成功失败都追加不可变 attempt，attempt ID 单调递增。
- exit code 非 0 保持 verification 未满足并阻塞后续步骤，但允许同一 command ID 重跑。
- 后续 fresh pass 可以满足当前 fingerprint 的 verification，历史失败 attempt 仍保留。
- fingerprint 变化清除 satisfied attempt 的新鲜度，不删除历史 attempts。

### 实现文件

新增或完成：

```text
plugins/dev-flow/src/core/fingerprint.ts
plugins/dev-flow/src/core/feature-check.ts
plugins/dev-flow/src/mcp/tools/evidence.ts
plugins/dev-flow/src/mcp/tools/finish.ts
```

验证执行：

1. 从 feature state 读取 command IDs。
2. 从 project.json 解析 executable/args/cwd。
3. 使用 `execFile` 运行，保存 exit code、开始/结束时间和截断摘要。
4. 为每次运行分配单调 attempt ID 并 append 到 `verification.attempts[]`。
5. 只有当前 fingerprint 上所有必需 command 的最新 fresh attempt exit code 为 0 才完成 verification。
6. 失败时 `dev_flow_next` 继续返回 verification retry action，并附失败摘要；不得进入 feature-check/finalize。
7. 保存验证后的业务 fingerprint和满足 verification 的 attempt IDs。

`dev_flow_finalize` 必须在一个 state transaction 中重新检查所有 obligation、重新计算 fingerprint、确认 feature-check 新鲜，然后设置 logic-complete、把 lifecycle 置为 finalized 并清除 active。

### 验收命令

```bash
node --test tests/unit/feature-check.test.mjs
```

## 阶段 8：实现 Git policy 与双宿主 hooks

### 测试先行

新增 `tests/unit/git-policy.test.mjs` 并使用 hook fixtures，覆盖：

- 无条件只读命令只包括 `status/diff/log/show/rev-parse/ls-files/ls-tree/cat-file/name-rev`。
- 条件只读 flag：`branch` 仅无参数、`--list/--show-current/-a/-r/-v/-vv`；`remote` 仅 `-v/show/get-url`；`config` 仅 `--get/--get-all/--list`；`worktree` 仅 `list`；`stash` 仅 `list/show`。
- `git branch` 的创建、删除、移动等写 flag 不得因子命令名称被误放行；未知子命令/flag 在 strict mode 下 fail closed。
- logic-complete 前拒绝 add、commit、push、merge、rebase、tag、cherry-pick、reset。
- `git -C path commit`、环境变量前缀和常见 wrapper 仍能识别。
- 含管道、分号、命令替换且无法安全解析的 Git 写命令 fail closed。
- 非 Git 命令不误拦。
- HUMAN GATE 前 protected-root Write/Edit/apply_patch/Bash 重定向被拒绝。
- 流程资产写入仍允许。
- `tests/unit/host-paths.test.mjs` 断言 Claude hooks.json 的 command 精确为 `node "${CLAUDE_PLUGIN_ROOT}/dist/claude-hook.mjs"`，在带空格 plugin root fixture 中能安全启动。
- Codex hook/MCP path 使用 `${PLUGIN_ROOT}`；两宿主 adapter 的包内资源均通过 `import.meta.url` 自定位。

### 实现文件

新增或完成：

```text
plugins/dev-flow/src/core/git-policy.ts
plugins/dev-flow/src/hosts/claude-adapter.ts
plugins/dev-flow/src/hosts/codex-adapter.ts
plugins/dev-flow/hosts/claude/hooks.json
plugins/dev-flow/hosts/codex/hooks.json
```

两套 hooks 均注册：

```text
SessionStart
UserPromptSubmit
PreToolUse
PostToolUse
Stop
```

Claude command hook 使用 `command: "node \"${CLAUDE_PLUGIN_ROOT}/dist/claude-hook.mjs\""`。Codex 使用 `${PLUGIN_ROOT}/dist/codex-hook.mjs` 启动 bundle。两宿主的当前 hook schema 都以 shell command 字符串启动 handler；adapter 启动后只用 `import.meta.url` 找包内资源，cwd 只用于定位消费项目。

`UserPromptSubmit` 是可选增强事件：宿主提供时登记原文；缺失时只允许可信 turn boundary fallback。严格 gate 的正确性不能依赖某个宿主必定发出该事件。

PostToolUse 不直接改 feature state，只追加规范化 host event。下一次 MCP 调用在事务中消费事件并进行失效处理。

### 验收命令

```bash
node --test tests/unit/git-policy.test.mjs
node plugins/dev-flow/dist/claude-hook.mjs < tests/fixtures/hooks/claude-pretool-git.json
node plugins/dev-flow/dist/claude-hook.mjs < tests/fixtures/hooks/claude-plugin-root-with-spaces.json
node plugins/dev-flow/dist/codex-hook.mjs < tests/fixtures/hooks/codex-pretool-git.json
```

实施本阶段时补齐上述 hook fixture JSON 文件。

## 阶段 9：实现 MCP server 和全部 tools

### 测试先行

为 MCP initialize、tools/list、每个 tool 的 schema 和错误映射增加协议测试。测试至少验证：

- server instructions 首 512 字符说明先分类、一次只推进一个 action、HUMAN GATE 必须停止。
- read-only tools 带 readOnlyHint。
- mutation tools 带 destructive/write 注解。
- 所有错误映射为稳定 code + message + structuredContent。
- server 关闭 stdin 后正常退出。
- JSON-RPC 并发请求不会绕过 state lock。
- 并发 mutation 中一个请求持有 live lock 超过 5 秒时，另一个稳定返回 `STATE_LOCK_TIMEOUT`；CAS 冲突仍单独映射为 `STATE_REVISION_CONFLICT`。
- `dev_flow_reclassify` 不能接受 target route，只接受更严格 classification + reason，并遵循阶段 4 的失效规则。
- `dev_flow_switch_active` 和 `dev_flow_abandon` 暴露 lifecycle 约束，不允许绕过 core transaction。

### 实现文件

完成：

```text
plugins/dev-flow/src/mcp/server.ts
plugins/dev-flow/src/mcp/tools/project.ts
plugins/dev-flow/src/mcp/tools/classify.ts
plugins/dev-flow/src/mcp/tools/feature.ts
plugins/dev-flow/src/mcp/tools/inspect.ts
plugins/dev-flow/src/mcp/tools/artifacts.ts
plugins/dev-flow/src/mcp/tools/evidence.ts
plugins/dev-flow/src/mcp/tools/finish.ts
```

注册工具：

```text
dev_flow_init_project
dev_flow_classify
dev_flow_start
dev_flow_status
dev_flow_next
dev_flow_switch_active
dev_flow_scaffold_artifact
dev_flow_record_step
dev_flow_present_gate
dev_flow_confirm_gate
dev_flow_reclassify
dev_flow_feature_check
dev_flow_finalize
dev_flow_abandon
dev_flow_doctor
```

不得提供可直接修改 current step、human gate status、lifecycle、logicComplete 或 revision 的通用 patch tool。

tool schema 还必须写死：start 的 activation 默认 active且只有显式值才能创建 paused；switch 的 target 必须为 paused；abandon 必须带 reason 和 user evidence；reclassify 必须带 expected revision、new classification 和 reason。所有失败路径 structuredContent 都返回未变化的 current revision。

### 验收命令

```bash
npm run typecheck
npm run build
node --test tests/unit/mcp-server.test.mjs
```

实施本阶段时将 `tests/unit/mcp-server.test.mjs` 加入最终树。

## 阶段 10：编写共享 Skills

### 文件

为以下每个目录创建 `SKILL.md` 和 `agents/openai.yaml`：

```text
dev-flow-task
dev-flow-status
dev-flow-requirements
dev-flow-risk-review
dev-flow-plan
dev-flow-coverage-review
dev-flow-rollback-safety
dev-flow-plan-review
dev-flow-implement
dev-flow-code-review
dev-flow-verify
dev-flow-feature-check
dev-flow-finish
dev-flow-doctor
```

### Skill 统一规则

每个 Skill 必须：

- 通过描述准确控制触发范围。
- 只使用 dev-flow MCP tools 读写工作流状态。
- 开始时调用 `dev_flow_next` 并只处理返回的一个 action。
- HUMAN GATE 输出后立即结束当前回复。
- 不把 plan-review 与 code-review 合并。
- 不自行执行未登记的验证命令。
- 不在 logic-complete 前建议 Git 写操作。
- 使用宿主无关的 server/tool 语义，不硬编码 Claude/Codex 展开的 MCP namespace。

`dev-flow-task` 明确声明 v1 不做 OpenSpec integration；收到已有相关文件时只把它们当需求输入。

### 测试

新增 Skill 静态测试，检查：

- 每个目录具备合法 frontmatter。
- 每个 Skill 都包含 MCP-only 状态规则。
- plan/code review 的描述与调用边界不同。
- finish 包含 logic-complete → Git 顺序。
- task 不声明 v1 未实现的集成。

### 验收命令

```bash
node --test tests/unit/skills.test.mjs
```

实施本阶段时将 `tests/unit/skills.test.mjs` 加入最终树。

## 阶段 11：完成 manifests、双 marketplace 与版本一致性

### 文件

完成阶段 1 已创建的最小合法文件：

```text
.claude-plugin/marketplace.json
.agents/plugins/marketplace.json
plugins/dev-flow/.claude-plugin/plugin.json
plugins/dev-flow/.codex-plugin/plugin.json
plugins/dev-flow/.mcp.json
```

内容严格采用设计文档中的最终 JSON，补齐最终 metadata、capabilities 和 source policy。Codex `.mcp.json` 使用：

```json
{
  "mcpServers": {
    "dev-flow": {
      "command": "node",
      "args": ["${PLUGIN_ROOT}/dist/mcp-server.mjs"]
    }
  }
}
```

### 测试

扩展 `tests/e2e/native-install-upgrade.test.mjs`：

- 根 `package.json#version`、两个 manifest version 和三个 bundle 版本一致。
- 任一 manifest/bundle 被手工改成不同版本时 `npm run version:check` 失败；两个 marketplace 均不声明 version。
- 所有相对组件路径存在并位于插件根内。
- marketplace source 指向 `./plugins/dev-flow`。
- Codex marketplace 包含 installation/authentication/category。
- manifest 不声明不存在的 app、asset 或 connector。
- MCP command 不依赖 cwd。
- Claude MCP 使用 `${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.mjs`，hook command 精确为 `node "${CLAUDE_PLUGIN_ROOT}/dist/claude-hook.mjs"`。
- 三个 dist 入口存在。

### 验收命令

```bash
claude plugin validate .
claude plugin validate ./plugins/dev-flow --strict
npm run version:check
node --test tests/e2e/native-install-upgrade.test.mjs
```

Codex 以当前最低支持版本在隔离 HOME 中执行实际 marketplace add 和 plugin add；如果 `PLUGIN_ROOT` 不展开，停止发布并调整最低版本或使用该版本正式支持的插件根变量，不能改回 cwd 相对启动。

## 阶段 12：逐 route E2E

### Fixture

创建：

```text
tests/fixtures/tiny-app/package.json
tests/fixtures/tiny-app/src/counter.js
tests/fixtures/tiny-app/test/counter.test.js
tests/helpers/fixture-repo.mjs
tests/helpers/host-runner.mjs
```

fixture helper 每次使用独立临时 Git 仓库，写入 project.json，运行测试后自动清理。

### Route tests

实现：

```text
tests/e2e/routes/xs.test.mjs
tests/e2e/routes/s.test.mjs
tests/e2e/routes/risk-minimal-xs.test.mjs
tests/e2e/routes/risk-minimal-s.test.mjs
tests/e2e/routes/risk-minimal-m.test.mjs
tests/e2e/routes/light-m.test.mjs
tests/e2e/routes/standard-m.test.mjs
tests/e2e/routes/light-l.test.mjs
tests/e2e/routes/standard-l.test.mjs
```

每个测试必须从 init project、classify、start 开始，逐次调用 next，并验证：

- 完整 ordered step 序列。
- HUMAN GATE 停止位置。
- 强制资产精确集合和不应出现的资产。
- feature-check 是否必须。
- finalize 后 logicComplete 为 true、lifecycle 为 finalized，且 active pointer 清除。
- Git guard 在前后状态的差异。

标准 M 额外断言 rollback、plan-review、code-review、verification 都完成，但独立 Markdown 仍只有四类。

轻量 M 额外断言 code-review step 完成，但不存在强制 `code-review.md`。

### 验收命令

```bash
npm run test:routes
```

## 阶段 13：双向跨宿主 E2E

### 自动化测试

实现：

```text
tests/e2e/cross-host/claude-to-codex.test.mjs
tests/e2e/cross-host/codex-to-claude.test.mjs
```

Claude → Codex：

1. Claude adapter 创建 standard M。
2. Claude 完成 requirement confirmation、计划、coverage、rollback、plan-review。
3. Claude present implementation approval 后停止。
4. Codex adapter 读取同一 active/state revision。
5. 用户在 Codex 侧明确批准，confirm 保存该原文。
6. Codex 完成实现、code review、verification、feature-check、finalize。
7. 断言没有重复 requirement gate，lastUpdatedBy host 切换正确。

Codex → Claude：

1. Codex adapter 创建 light L。
2. Codex 生成 boundary、rollback/safety 并 present implementation approval。
3. Claude adapter 读取同一 pending gate。
4. 用户在 Claude 侧批准，Claude 完成后续流程。
5. 断言资产 hash、events revision 连续且 active 被清除。

本地 E2E 直接驱动两个 adapters；release smoke 还要使用真实宿主 CLI。

两条方向都分别覆盖：有 `UserPromptSubmit` 的 matched-host-event 路径、没有该事件但有可信后续 turn boundary 的 fallback 路径。另加负向场景：只有 `confirm_gate.userReply` 且两种时序证据都没有时必须返回 `HUMAN_GATE_PROVENANCE_UNAVAILABLE`，不得推进 revision。测试不能把 Codex 必定产生某个 hook event 当作成功前提。

### 验收命令

```bash
npm run test:interop
```

## 阶段 14：真实宿主安装、升级与接力

### CI workflow

新增：

```text
.github/workflows/ci.yml
.github/workflows/release-smoke.yml
```

`ci.yml` 在每个 PR 运行：

```bash
npm ci
npm run typecheck
npm run version:check
npm run build:check
npm run test:unit
npm run test:routes
npm run test:interop
claude plugin validate .
claude plugin validate ./plugins/dev-flow --strict
```

`release-smoke.yml` 在 tag 或手动触发时：

1. 创建隔离的 Claude/Codex 配置目录和临时 fixture repo。
2. 从当前 checkout 添加本地 marketplace。
3. 使用两个宿主原生命令安装插件。
4. 确认 Skills 可见、MCP initialize 成功、hooks 已加载/可信。
5. 执行两条真实跨宿主接力场景。
6. 用临时 1.0.1 marketplace snapshot 验证宿主原生升级。
7. 确认升级过程中没有依赖安装命令。
8. 输出 Claude/Codex 的实际版本并把本次通过结果保存为 artifact；首次基线目标为 Claude Code `2.1.215`、Codex CLI `0.144.4`。

只有完整通过原生 marketplace add/install、MCP initialize、hooks、双向接力和原生升级的宿主版本，才能写入 README 最低支持线。要声明更低版本时，必须给 release smoke 增加对应版本 job 并通过；不得根据命令存在或 manifest 可解析推断兼容。

真实模型调用容易受输出波动影响，因此 release smoke 的断言只针对 MCP 状态、资产和事件，不匹配自然语言全文。

### 验收命令

```bash
npm test
HOST_E2E=1 node --test tests/e2e/native-install-upgrade.test.mjs
```

## 阶段 15：用户文档与最终审计

### 文件

新增或重写：

```text
README.md
docs/architecture.md
docs/routes.md
docs/publishing.md
plugins/dev-flow/README.md
scripts/generate-routes-doc.mjs
tests/unit/routes-doc.test.mjs
```

README 只提供：

- GitHub marketplace add。
- Claude/Codex 原生 plugin install。
- 原生升级命令。
- 最低宿主和 Node 版本。
- 第一次运行 `dev_flow_init_project` 的说明。
- route 速查和 HUMAN GATE 停止语义。

`scripts/generate-routes-doc.mjs` 从 `plugins/dev-flow/policy/contract.json` 读取 route ordered steps、gate、强制资产、风险增强和 feature-check，写入 `docs/routes.md` 的固定 generated markers。脚本提供 `--write` 与 `--check`；check 模式在内存中重生成并逐字比较，不直接修改文件。

根 scripts 增加：

```json
{
  "docs:routes": "node scripts/generate-routes-doc.mjs --write",
  "docs:routes:check": "node scripts/generate-routes-doc.mjs --check"
}
```

`tests/unit/routes-doc.test.mjs` 篡改 generated 区域后断言 check 失败，并逐 route 验证文档中步骤、gate、资产和 feature-check 与 contract 一致。`docs/publishing.md` 记录 `version:sync`、routes doc 重建、dist 重建、validate、跨宿主 smoke 和 tag 顺序。

### 最终审计

```bash
npm test
npm run docs:routes:check
npm run version:check
claude plugin validate .
claude plugin validate ./plugins/dev-flow --strict
git diff --check
git status --short
```

人工检查：

- 没有项目提示注入或宿主项目 settings。
- 没有包内升级器、复制安装步骤和旧 schema reader。
- 没有 OpenSpec MCP/tool/命令依赖。
- light M 文档和测试均为“强制审查步骤、无强制审查文件”。
- project.json、显式用户原文、PLUGIN_ROOT、单 active feature、预构建 dist 五项全部有实现和测试。
- Claude hook 使用带双引号的 `CLAUDE_PLUGIN_ROOT` command 字符串，并通过带空格路径 fixture。
- switch/abandon/reclassify lifecycle、verification retry、锁超时和 strict gate provenance 都有正反测试。
- `docs/routes.md` generated 区域、两份 manifest 和三个 bundle 分别通过 contract/version 自动核对。
- logic-complete 是任何 Git 写操作前的硬门禁。

## 建议提交拆分

实现时每个提交都必须保持当前已完成阶段的测试通过：

1. `chore: replace repository with dual-host plugin skeleton`
2. `feat: add route contract and project configuration`
3. `feat: add transactional feature state and active pointer`
4. `feat: add route assets and human gates`
5. `feat: add verification feature-check and git policy`
6. `feat: expose dev-flow MCP server and shared skills`
7. `feat: add Claude and Codex plugin packaging`
8. `test: cover routes and cross-host continuation`
9. `ci: add native install upgrade and release smoke`
10. `docs: publish dual-host installation and route guide`

不要在测试失败、dist 未同步或 manifest 版本不一致时创建发布 tag。
