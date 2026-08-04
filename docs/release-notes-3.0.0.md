# Dev Flow 3.0.0 草稿

## 破坏性变化

- MCP mutation 默认返回 `FeatureMutationSummary`，不再返回完整 `FeatureState`；需要完整状态时调用 `dev_flow_status`。
- `dev_flow_next` 的实现阶段显式要求 `files: "protected-root-paths"`；checkpoint/verification 命令支持 preflight 与行内命令。
- MCP 入参统一按 `tools/list` schema fail-fast 校验，未知字段和缺少 required 字段返回 `INVALID_TOOL_INPUT`。
- 需要用户证据的调用必须显式传 `host`；事件 host 不匹配时 fail-closed。
- standard M 的默认计划审查增加 `rollback-operability` 角色。

## 迁移提示

- 将 mutation 响应中的完整状态读取迁移为 `dev_flow_status`；summary 仅用于 revision、stage、生命周期、义务计数和进度计数。
- 将分类优先迁移到 `classificationBasis.signals` 推荐模式；推荐结果由操作者核实后再 lock。
- verification attempt 的完整输出改读 `.dev-flow/features/<featureId>/verification/<attemptId>.log`，state 只保留 `outputTail` 与 `outputPath`。

其他 MCP 客户端仍未受支持；直连只用于诊断，不具备宿主写入守卫与可信用户证据。
