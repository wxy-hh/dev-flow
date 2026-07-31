# Dev Flow 外审问题修复设计

## 背景

外部验收发现 Trace rollback unit 的 `fileScope` 在登记时只被验证为非空字符串数组。绝对路径、路径遍历与其他运行时永不匹配的模式可被写入内容寻址 snapshot；运行期虽然 fail-closed，却会留下不可执行的事实记录。另有面向用户的 Trace 版本标签仍写为 `1.8.0+`，与当前发布版本 `1.7.0` 不一致。

## 目标与非目标

目标：

- 新的 Trace 登记不接受不安全或不可规范匹配的 `fileScope`。
- 运行期 scope 判断与登记期判断共用一套规则。
- 已由旧版本写入的非法 snapshot 在普通读/执行路径继续 fail-closed，但只能通过原始 Trace artifact 的完整重新登记恢复。
- 所有当前用户文档把 Trace 能力的首发版本统一为 `1.7.0+`。

非目标：

- 不改变 glob 语义、`"."` 的全项目 scope 语义或 protected-root 的既有责任边界。
- 不修改历史设计/实施计划、外部 audit harness、feature capability 合同或 MCP 工具名。
- 不迁移、删除或重写既有 snapshot；修复通过新的内容寻址 snapshot 和 state pointer CAS 完成。

## 已采纳方案

采用“严格准入 + 受限修复”。相比只校验新输入，它不会继续产生污染；相比升级后直接拒绝旧 snapshot 且无修复入口，它不会把已受影响 feature 永久卡死。

`plugins/dev-flow/src/policy/rollback.ts` 导出唯一的 file-scope 模式谓词。模式必须是已 trim 的相对 POSIX 表示，可使用既有 `*`、`?`、`**` glob，并允许单独的 `"."`。它拒绝绝对路径、Windows drive 路径、反斜杠、空段及 `.` / `..` 段。

Trace 的 caller-input 验证和新 ledger 的持久化验证都调用该谓词。普通 `readTraceability` 对历史非法 scope 返回既有完整性错误，所有 gate、checkpoint、rollback 与宿主 Hook 因此仍 fail-closed。

为保持可恢复性，`recordArtifactWithTrace` 增加一个仅供 source replacement 使用的受限读取分支：它仅在现有 snapshot 的唯一违规项是非法 `fileScope`，且该 rollback node 的 `sourceArtifact` 与正在重新登记的 artifact 相同时，才提供 ledger 作为 replacement 基线。候选 delta 仍先经过严格输入校验，`applyTraceDelta` 生成的最终 ledger 必须通过严格图验证，再写入新 snapshot 并 CAS 更新 pointer。任何其他图错误、其他 source 的非法 scope，或再次提交非法 scope 均不得绕过。

## 文档范围

以下发布文档统一把 Trace 标签改为 `1.7.0+`：仓库根 `README.md`、`plugins/dev-flow/README.md`、`docs/routes.md`、`docs/architecture.md`。历史计划保留其当时上下文，不作追溯性改写。

## 验收

- MCP 登记对 `../x`、`/abs`、`C:/abs`、`src\\x`、`src//x`、`src/./x` 与混合合法/非法 array 返回 `TRACE_GRAPH_INVALID`，且 revision/pointer 不变。
- `src/**` 与 `"."` 的现有 scope 行为不回归。
- 人为构造的旧非法 snapshot 在普通读取时 fail-closed；只有对其对应的 source artifact 提交完整且合法的 replacement delta 才能恢复并产生新的 pointer。
- 所有四处当前文档标签为 `1.7.0+`，不存在面向当前发布物的 `Trace source（1.8.0+）` 或 Trace `1.8.0+` 标签。
