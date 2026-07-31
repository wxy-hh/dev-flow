# Dev Flow 外审问题修复实施计划

> **实施状态：** 已完成（2026-07-31）；目标测试、全量测试、路线/交接测试、bundle 检查和原生宿主 E2E 均已通过。

**目标：** 修复 Trace rollback unit 的 `fileScope` 登记校验缺口，并将当前发布文档中的 Trace 首发版本统一为 `1.7.0+`。

**架构：** `policy/rollback.ts` 保持 file-scope 语义的唯一事实源；Trace 写入使用同一安全模式谓词。普通 ledger 读取严格 fail-closed，唯一的兼容分支仅允许同源 artifact 以完整、合法的 Trace delta 替换旧版本留下的非法 `fileScope`。新 snapshot 仍通过既有内容寻址写入和 state CAS 提交。

**技术栈：** TypeScript ESM、Node.js 内置测试运行器、现有 MCP server、内容寻址 Trace store、esbuild。

## 全局约束

- 只处理 `fileScope` 校验和版本标签；不修改外部 audit harness、路线、能力位、MCP 工具名或历史计划。
- 保留既有相对路径、`*` / `?` / `**` glob 与单独 `"."` 的 matcher 语义。
- 不将 file scope 限制为 `protectedRoots`：这是超出本轮范围的合同变化；现有 Hook / checkpoint 继续在 protected-root 写路径上执行授权。
- 新的非法 delta 必须在创建 snapshot、更新 pointer 或递增 feature revision 前失败，错误码沿用 `TRACE_GRAPH_INVALID`。
- 已有非法 snapshot 在普通读取、gate、checkpoint、rollback 和 Hook 路径保持 fail-closed；不得因修复而被静默信任。
- 只能由产生该 rollback node 的 `implementation-plan` 或 `rollback-units` 完整 source replacement 修复旧 snapshot；任何其他图错误都不能走此兼容分支。
- `dist/` 仅在源代码和测试通过后由 `npm run build` 生成；不手改 bundle。
- 不 stage、commit、push 或创建 PR。

## 任务 1：固化规范 file-scope 模式合同

**文件：**

- 修改：`plugins/dev-flow/src/policy/rollback.ts`
- 修改：`tests/unit/rollback-policy.test.mjs`

**接口：**

- 新增并导出 `isSafeFileScopePattern(value: unknown): value is string`（名称可随仓库现有风格微调，但必须成为唯一公开谓词）。
- `pathWithinFileScope` / `scopePatternMatches` 使用该谓词，避免登记期与运行期规则漂移。

- [ ] **步骤 1：先补 policy 红灯测试。** 覆盖有效的 `src`、`src/**`、`src/*.ts`、`"."`；覆盖无效的空白、前后空白、`/etc/passwd`、`C:/temp/x`、`src\\x`、`../x`、`src/../x`、`src//x` 与 `src/./x`。同时断言无效 pattern 在 `pathWithinFileScope` 中永不匹配。

- [ ] **步骤 2：实现规范谓词。** 要求 pattern 为 trim 后的非空 POSIX 相对字符串；拒绝反斜杠、Unix 根路径、Windows drive 前缀、空 segment 和非单独出现的 `.` / `..` segment。保留现有 glob 算法，不引入新的 glob 语法或路径规范化。

- [ ] **步骤 3：让运行期 matcher 调用该谓词。** 保留 target 的既有安全检查；只把 pattern 检查替换为共享谓词，确保已合法的 scope 匹配结果不变。

- [ ] **步骤 4：验证 policy。**

运行：`node --test tests/unit/rollback-policy.test.mjs`

预期：新增的非法模式全部 fail-closed，现有 rollback policy 测试继续通过。

## 任务 2：对新 Trace delta 实施严格准入

**文件：**

- 修改：`plugins/dev-flow/src/core/traceability.ts`
- 修改：`tests/unit/traceability-graph.test.mjs`
- 修改：`tests/unit/mcp-server.test.mjs`

**接口：**

- `validateTraceDelta` 继续抛 `DevFlowError("TRACE_GRAPH_INVALID", ...)`，并在 rollback node 的 `fileScope` 已通过数组/重复项校验后逐项调用共享谓词。
- `applyTraceDelta` 生成的新 ledger 必须走严格图校验。

- [ ] **步骤 1：添加 core 层红灯测试。** 在 `validateTraceDelta` 和 `applyTraceDelta` 路径各覆盖 `../x`、`/abs`、`C:/abs`、反斜杠、`src/../../x`，以及包含 `src` 与一个非法 pattern 的混合 array。断言 `src/**` 和 `"."` 可登记。

- [ ] **步骤 2：实现 caller-input 校验。** 在 `validateNodeInput` 的 rollback 分支对 `fileScope` 的每个条目调用共享谓词；错误 details 至少包含 node ID、字段名和被拒绝的 pattern，方便 MCP 客户端修复。

- [ ] **步骤 3：在 MCP 边界加入回归。** 构造一次有效的 `dev_flow_record_artifact_with_trace` 注册前状态，并针对非法 delta 调用公开 tool。断言响应为 `TRACE_GRAPH_INVALID`，feature revision、artifact hash 和 Trace pointer 都保持调用前的值，且 snapshot 目录没有新增被引用文件。

- [ ] **步骤 4：运行聚焦测试。**

运行：`node --test tests/unit/traceability-graph.test.mjs tests/unit/mcp-server.test.mjs`

预期：非法 file scope 不能跨 MCP 或 Core 边界落盘；既有 Trace schema、CAS 和 closed-input 测试不回归。

## 任务 3：为旧非法 snapshot 提供受限同源修复

**文件：**

- 修改：`plugins/dev-flow/src/core/traceability.ts`
- 修改：`plugins/dev-flow/src/core/traceability-store.ts`
- 修改：`plugins/dev-flow/src/core/artifacts.ts`
- 修改：`tests/unit/traceability-store.test.mjs`
- 修改：`tests/unit/traceability-artifacts.test.mjs`

**接口：**

- 普通 `readTraceability(root, state)` 保持严格验证；遇到旧 unsafe `fileScope` 时以 `TRACEABILITY_INTEGRITY_FAILED` fail-closed。
- 增加仅供 `recordArtifactWithTrace` 使用的内部 source-repair read API。它接收 `artifactKind`，只容忍该 source artifact 的 rollback node 上的 file-scope 违规；其余 ledger 合同、pointer digest、revision、summary、edges 和 source metadata 必须仍严格有效。
- source replacement 后对候选 ledger 重新执行严格验证；成功时写入新内容寻址 snapshot 并原子替换 pointer。

- [ ] **步骤 1：添加旧 snapshot fixture。** 从合法已登记 ledger 出发，构造含 `fileScope: ["../x"]` 的 snapshot，并同步其 SHA-256 pointer，使测试针对 schema/语义而非 digest 损坏。

- [ ] **步骤 2：证明普通路径 fail-closed。** `readTraceability`、`dev_flow_get_traceability` / 下一步 gate（选现有最接近的测试入口）必须报告 Trace 完整性问题，且不得返回可用 ledger 或允许写受保护文件。

- [ ] **步骤 3：实现受限 repair loader。** 不以匹配 error-message 字符串来降级。用明确的 validation mode 或结构化结果区分“唯一为可修复 fileScope 的旧 snapshot”与其他不可信 snapshot；确保违规 node 的 `sourceArtifact` 等于本次 `artifactKind`。

- [ ] **步骤 4：接入 artifact replacement。** 仅在 `recordArtifactWithTrace` 中调用 repair loader；要求 source Markdown anchors 与完整 delta 正常匹配，且新 delta 已通过任务 2 的严格校验。完成 replacement 后，普通 `readTraceability` 应能读取新 pointer。

- [ ] **步骤 5：补齐绕过防护。** 测试以下场景均失败且 pointer/revision 不变：以 `requirements` 修复 plan 来源的违规、只修复部分 source、重新提交非法 pattern、snapshot 同时含悬空引用或错误 digest、以及非 Trace tool 的任何调用。

- [ ] **步骤 6：运行 Trace store / artifact 回归。**

运行：`node --test tests/unit/traceability-store.test.mjs tests/unit/traceability-artifacts.test.mjs tests/unit/traceability-gates.test.mjs`

预期：正常完整性检查不弱化；唯一允许的迁移路径是同源、完整、严格合法的替换登记。

## 任务 4：统一当前发布文档的 Trace 版本标签

**文件：**

- 修改：`README.md:13`
- 修改：`plugins/dev-flow/README.md:12`
- 修改：`docs/routes.md:34`
- 修改：`docs/architecture.md:34`
- 修改（如测试中需要自动守卫）：`tests/unit/routes-doc.test.mjs` 或新建窄范围文档版本测试

- [ ] **步骤 1：更新四处当前发布文档。** 将 Traceability / Trace source / Trace 账本的 `1.8.0+` 表述统一为 `1.7.0+`；不改变关于 checkpoint 与 rollback execution 的既有 `1.7.0+` 表述。

- [ ] **步骤 2：增加轻量防漂移测试。** 读取 `package.json#version` 与四个当前发布文档；断言 Trace 版本标签不再高于当前首发版本。历史计划和设计文档排除在扫描范围之外，避免改写历史记录。

- [ ] **步骤 3：验证文档合同。**

运行：`node --test tests/unit/routes-doc.test.mjs`

预期：机器路线文档合同保持一致，版本标签不会再次漂移。

## 任务 5：发布前验证与 bundle 更新

**文件：**

- 自动生成并受版本控制：`plugins/dev-flow/dist/mcp-server.mjs`
- 自动生成并受版本控制（仅在构建有变更时）：`plugins/dev-flow/dist/claude-hook.mjs`、`plugins/dev-flow/dist/codex-hook.mjs`

- [ ] **步骤 1：按顺序运行目标测试。**

```bash
node --test tests/unit/rollback-policy.test.mjs
node --test tests/unit/traceability-graph.test.mjs tests/unit/mcp-server.test.mjs
node --test tests/unit/traceability-store.test.mjs tests/unit/traceability-artifacts.test.mjs tests/unit/traceability-gates.test.mjs
node --test tests/unit/routes-doc.test.mjs
```

- [ ] **步骤 2：运行全量源码验证。**

```bash
npm run typecheck
npm run test:unit
npm run test:routes
npm run test:interop
```

- [ ] **步骤 3：更新和校验受版本控制 bundle。**

```bash
npm run build
npm run build:check
```

预期：bundle 只由构建脚本产生，版本检查与源码一致性通过。

- [ ] **步骤 4：运行发布级验证与工作树检查。**

```bash
npm test
npm run test:host-e2e
git diff --check
git status --short
```

预期：测试、宿主真机 E2E、bundle 一致性和空白检查全部通过；报告变更文件与结果给用户审核，不执行 Git 发布操作。

## 自检

- 任务 1–3 一一覆盖外审的 `fileScope` 登记缺陷及其 legacy 可恢复性。
- 任务 4 覆盖全部四处当前发布文档，而非只修复报告最先列出的两处。
- 错误码、MCP 输入闭包、Trace CAS、内容寻址与 runtime fail-closed 边界均保持不变或更严格。
- 不包含未经用户授权的外审脚本、路线合同或 Git 发布变更。
