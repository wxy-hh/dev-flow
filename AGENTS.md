# AGENTS.md — Dev Flow

给 AI 编码代理的仓库指南。阅读顺序建议：本节（现状）→「架构总览」→「硬约束」→「开发与验证」。

## 项目现状（2026-08-20）

- **Dev Flow** 是 Claude Code 插件：**宿主事件驱动的工作流治理**（设计名"隐形治理"）。流程状态在事件流上自动推进，门禁在事件边界自动拦截——模型不需要"记得走流程"，用户也几乎感觉不到流程存在。
- 版本 `0.0.1`，处于契约冷冻点之前（0.x 契约自由演进）。当前分支 `next`，**所有代码未提交**（用户手动提交制，agent 不做任何 git mutation）。
- T0~T9 已全部完成并验收闭环：单测 218/218 全绿，`npm run verify` + verify-t3~t8 串行回归全绿，Bash 门禁 P95=17.9ms ≤30ms。**唯一剩余任务 T10 第一批总验收**（判据见 `docs/2026-08-19-MVP-实施计划.md` §7）。
- 第一批 MVP 四件核心机制：① 首写入门禁（第一次写文件前要求输出意图块：做什么/动哪些文件/风险标签/verify 命令）；② 完成宣称咽喉（done：验收未过必驳回且说清缺什么）；③ 证据链（会话/意图/写入/验收/完成宣称全部自动记入事件流）；④ 敏感路径硬门禁（四类内置 + 项目追加，含 Bash 写入启发式检出）。

## 技术栈与构建

- **TypeScript 源码 + esbuild bundle + 零运行时依赖**。`package.json` `"type": "module"`，但 **hook 产物必须是 `.cjs`**（spike 实证：type:module 仓库下 `.js` 的 require 会崩）。无 tsconfig，esbuild 直接编译；源码 import 用 `.js` 后缀（ESM 风格，esbuild 解析）。
- 前置条件：node >= 20（实测 v22）、Claude Code CLI 2.1.234（`claude --version` 查看）。
- 构建：`npm run build` → `node scripts/build.mjs`，esbuild 把 `src/hooks/*.ts`（6 个入口）打包到 `plugins/dev-flow/dist/*.cjs`。版本号经 `--define DEV_FLOW_VERSION` 注入，**版本单一来源是 `package.json`，`plugin.json` 永不写 version**。
- **先 build 后验证是铁律**（"绝不把旧构建当真"）：所有验证脚本开头都会先 `npm run build`。

## 目录结构

```
src/hooks/            6 个宿主 hook 入口壳（薄：stdin 解析 + 调用 lib + 输出）
src/lib/              16 个纯函数业务模块（判定/事件/状态，无宿主依赖）
test/                 node:test 单测（test/*.test.ts → build/test/*.test.cjs）
scripts/              build.mjs / verify*.sh / sandbox-reset.sh / auth-env.sh /
                      make-test-settings.sh / perf-fastpath.mjs
plugins/dev-flow/     插件载体：.claude-plugin/plugin.json、.mcp.json、
                      hooks/hooks.json、dist/（构建产物，已 gitignore）
docs/                 设计文档（规格与结论都在这，见「文档地图」）
sandbox/              seed（最小种子仓）+ work（固定验证仓，一键重建）+ mcp-probe（spike 遗留）
spike/                T0 spike throwaway（不入库，只留结论文档）
build/                单测产物 + 性能留痕（bash-fastpath-p95.txt）
.agents/skills/       项目技能（来自 mattpocock/skills，skills-lock.json 锁定版本）
```

## 运行时架构（六个注册点）

插件通过 `plugins/dev-flow/hooks/hooks.json` + `.mcp.json` 挂在宿主事件上，全部产物在 `dist/`：

| 注册点 | 产物 | 职责 |
| --- | --- | --- |
| `SessionStart`（matcher: startup/resume/clear/compact/fork） | `session-start.cjs` | 记 `session.start`；意图块规则常驻注入；恢复播报（"你昨天在做X，做到Y，还差Z"）；done 兜底四条件检测 |
| `UserPromptSubmit` | `user-prompt-submit.cjs` | 四通道识别：逃生门 / 主线切换 / 完成确认两跳 / 终裁解锁（窄模式表，精确短语匹配才写事件） |
| `PreToolUse`（Write/Edit/MultiEdit） | `pre-tool-use-write.cjs` | 首写入门禁（一拦二放）+ 敏感路径硬门禁 + 用户一句话放行消费端 |
| `PreToolUse`（Bash） | `pre-tool-use-bash.cjs` | 不可逆操作拦截（push/DROP/publish/rm -rf 高危）+ 启发式写入目标检出（`>`/`>>`/`tee`/`sed -i`/`cp`/`mv`）+ 快路径正则 |
| `PostToolUse` / `PostToolUseFailure`（Bash/Write/Edit/MultiEdit） | `post-tool-use.cjs` | 验收事件记账（verify.passed/failed，退出原因区分 timeout/killed/nonzero/unknown）+ `file.changed` 记账 |
| MCP server（.mcp.json，server 名 `df`） | `mcp-server.cjs` | 两个工具：`done`（完成宣称咽喉，唯一状态翻转点）、`status`（只读状态摘要 ≤500 字符） |

数据流：hook 入口壳 → `gate-runner.runGate`（IO 编排：读 config/state/events → 调决策纯函数 → 事件 append → 增量折叠 state → 原子写回）→ 任何异常 `audit.warning` + 放行（fail-open）。MCP 的 done 是**唯一允许 fail-closed** 的点（咽喉故障宁可驳回不可假通过）。

### 宿主硬约束（spike 实证，违反=静默失效）

- **输出必须 `hookSpecificOutput` 格式** + `fs.writeSync(1, …)` 同步写（`src/lib/output.ts`）。顶层 `permissionDecision`/`additionalContext` 在 2.1.234 被静默忽略（deny 会 fail-open）；`process.stdout.write` + `process.exit()` 会丢输出。
- 拦截型 hook 必须**同步且快**（`async: true` 的决策字段全部失效）；hook 输出 ≤10,000 字符；改动无自动 watch（新会话或 `/reload-plugins` 生效）。
- Bash 门禁性能生死线 **P95 ≤ 30ms**（含 node 冷启动）：快路径 = 两个正则（`IRREVERSIBLE_HINT_RE`/`WRITE_HINT_RE`）无命中立即 exit 0、不读任何文件。加代码时不许破坏快路径（无命中路径零 IO）。
- 定位：`CLAUDE_PROJECT_DIR`（项目根，状态根 = `<项目根>/.dev-flow`）、`CLAUDE_PLUGIN_ROOT`（插件根，敏感匹配 meta.plugin 用）。都在 hook 进程环境里。

## 状态与数据模型

运行时状态写在**目标项目根目录**的 `.dev-flow/`（不在本仓库）：

| 文件 | 内容 | 说明 |
| --- | --- | --- |
| `events.jsonl` | 证据链原始记录（append-only） | **事实源**；state 可从它重建 |
| `state.json` | 活跃/挂起主线、需求、连败计数、最近验收等 | 缓存；tmp+rename 原子替换，只由同步 hook 写 |
| `config.json` | 项目配置（可选） | `sensitivePaths`（只追加不覆盖）、`autoCommit` |
| `.gitignore` | 内容 `*` | 首次运行自创建，自包含隔离，**不碰业务仓的 .gitignore** |

- 13 个业务事件类型（`EVENT_TYPES`，12+1 预算封顶，新增必答三问）+ `audit.warning`（系统内部事件，不占预算）。
- **记事实不记内容（红线）**：事件载荷只记路径/工具名/退出码/时间戳/主线 id/规则名/用户原话（截断 500 字符）；永不记文件内容；命令输出只留尾部 ≤20 行、行内防御截断；单行 ≤1KiB（超长逐级降级）。红线执行点在 `sanitizeEvent` 单点。
- 时序事实（最后写入/最近验收/宣称痕迹）一律以 events 反向扫为准（`scanMainlineFacts`，早退），**不读 state 缓存字段**。
- 状态演进 **additive-only**：字段只增、带默认值；未知顶层字段进 `extra` 保留（写回不丢）；旧状态缺字段给默认。
- 单主线语义（软单主线）：同一时间一条活跃（`activeMainlineId`），切换即挂起旧的（`mainline.switch`），同名重激活。

## 开发与验证

```bash
npm install          # 一次性
npm run build        # TS → plugins/dev-flow/dist/*.cjs（毫秒级，先 build 后验证）
npm test             # 单测：node --test build/test/*.test.cjs（当前 218 个，~1s）
npm run verify       # T1 真机冒烟（node/claude 检查 → build → 重置 sandbox → claude -p 端到端 → 断言）
bash scripts/verify-t3.sh   # T3~T8 各是真机验证脚本，按任务逐个跑
bash scripts/verify-t8.sh
npm run sandbox:reset        # 一键重建 sandbox/work（seed 复制 + 独立 git init）
node scripts/perf-fastpath.mjs   # Bash 快路径 P95 抽测（判据：≤30ms）
```

- **串行纪律**：所有 verify 脚本共用 `sandbox/work/` 验证仓，每个脚本开头都会重置它（`rm -rf` 重建）。**并行运行会互相清掉现场，必须串行**。
- 真机验证用 `claude -p` 非交互会话跑场景脚本：`--plugin-dir plugins/dev-flow` + `--allowedTools`（MCP 工具位通配 `'mcp__plugin_dev-flow_df__*'`）+ `--settings`（`empty-settings.toml`，可用 `DEV_FLOW_TEST_SETTINGS` 覆盖做直连兜底，见 `scripts/make-test-settings.sh`）。需要本机 `claude` 可用且有 provider（`scripts/auth-env.sh` 负责注入认证 env）。
- 验证场景按"关键证据缺失自动重置重试 ≤3 次"吸收模型行为方差（Kimi 偶发只描述不真调工具）；断言面：`events.jsonl`/`state.json`（落账）+ `.dev-flow-debug/*.log`（hook 判定证据）+ `--debug-file`（核对无 `Hook JSON output had unrecognized`）+ transcript（模型可见性）。
- 单测约定：node:test + node:assert/strict，零新增依赖；临时目录/临时 git 仓每用例独立（`mkdtempSync` + `t.after` 清理）；IO 相关单测覆盖 fail-open 路径（损坏/缺失/坏行）。

## 代码风格与纪律

- **全中文注释与文档**，简洁直白、反口号、真实场景导向。每个 lib 模块文件头有块注释：职责 + 设计依据（引用 `docs/2026-08-19-MVP-实施计划.md` 的章节，如"计划 §3.2"）+ 关键约束。
- **纯函数纪律**：业务逻辑必须下沉 `src/lib/` 的纯函数（同输入同输出、无 IO、任意输入不崩溃），hook 入口壳只做 stdin 解析 + IO + 输出。判定模块与 IO 壳分层（如 `write-gate.ts` 纯函数 + `gate-runner.ts` 编排壳）。
- **fail-open 纪律**：一切门禁/注入故障 → `audit.warning` + 放行，绝不阻塞开发（"门卫晕倒不该把楼锁了"）。判定语义：宁漏勿误拦（门禁）、宁漏勿误收（自动提交）、fail-visible（拦截必附理由模板，模型据模板改正）。
- 新增机制先对照两份设计文档（方向合同 + 实施计划），**没有设计依据不加**；事件类型/工具/字段都有预算或红线，先看现有契约再动。
- 性能意识：SessionStart 只读 state 一次 + events 尾扫；UserPromptSubmit 30s 预算内不读 events；PostToolUse 快路径（无活跃主线/无声明/verify:none/不匹配 → 立即 exit 0）。

## 安全与边界（如实说明）

- 敏感路径内置四类：密钥凭据（`.env` 族豁免 `.env.example/.env.sample/.env.template`、`*.pem`、`*.key`、`secrets/`、`.ssh/`、`.aws/`、`.npmrc`）、CI 与发布（`.github/workflows/`、`Dockerfile`、`deploy/`、`k8s/`、`*.tf`）、数据（`migrations/`、`schema.prisma`）、元敏感（`.dev-flow/`、`.claude/`、插件根）。匹配前 **NFC 归一化 + symlink 目标解析**（坑 N-5：macOS 常存 NFD 路径）。
- 不可逆操作人工门禁：`git push`、`DROP TABLE/DATABASE`、publish（`--dry-run` 除外）、高危 `rm -rf` → 需用户亲自执行或一句话授权（"我授权"→ `escape.used`/`unlock` 记账放行，信任但记账）。
- 自动提交（done 时）只 `git add -A -- <主线触碰清单>`，绝不卷用户未提交改动；merge 冲突/detached HEAD/空提交/非仓内 → 跳过（fail-open）；剥离 `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` 防操作到别的仓。
- **已知盲区/边界**：解释器任意写入（`python -c "open(...)"` 等）从命令文本判不出，按设计承认防不住；模型行为只在 Kimi（kimi-for-coding）实证，Anthropic 官方模型未验证；交互模式长期会话 hook 热加载未实证；状态损坏没有自动修复工具（doctor 尚未实现，需要时手工以 events 重建 state——`rebuildFromFile` 是数据基础）。
- 第一批不做：连败锁定、finalize 审计渲染、评审（均第二批）。

## 文档地图（规格与结论都在这里，改代码前先读）

| 文档 | 内容 |
| --- | --- |
| `docs/2026-08-19-下一代工作流设计方向.md` | 方向合同：为什么重写、设计宪法、五场景、能力砍留 |
| `docs/2026-08-19-MVP-实施计划.md` | 实施计划：§0 spike 硬约束（宿主事实基线）、§2~§3 机制规格、§6 任务分解、§7 验收判据 |
| `docs/2026-08-19-spike-结论.md` | T0 spike 实测：hookSpecificOutput 格式、.cjs、fs.writeSync、P95 基线、坑 |
| `docs/2026-08-19-坑清单核对表.md` | 旧版 95+5 条坑的闭环核对（每条：覆盖/机制已砍失效/未吸收） |
| `docs/2026-08-20-重构交接.md` | 交接记录：当前状态与下一步（T10 总验收）、工作规则、环境事实 |
| `docs/2026-08-15-仪式减法优化路线图.md` | 旧版路线图（历史背景） |

## 工作规则（用户定的）

- **用户手动提交一切代码**，agent 不做任何 git mutation（含 commit/push/rebase）。
- 验收必须真跑测试与场景，不接受"应该可以"。
- 执行派子代理时，主会话只做审查/监督/验收；提交前用 `code-review` 技能按双轴（守仓库规范/忠实实现计划）审查未提交 diff。
