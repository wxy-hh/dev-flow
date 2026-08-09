# 10 — 安全补充项目验证配置

**What to build:** 让项目维护者通过 Core 管理的更新入口安全补充验证命令或 guarantee，并让纯增量配置变化只更新验证能力，不推倒无关业务证据。

**Blocked by:** 09 — 在路线锁定前校验 verification guarantee

**Status:** implemented; ready-for-review

- [x] 提供 `dev_flow_update_project`，接收完整候选配置和调用者观察到的旧配置哈希。
- [x] 配置哈希不匹配时拒绝覆盖，并返回当前哈希和刷新后重试的恢复动作。
- [x] 已初始化项目再次调用 init 只允许内容完全相同的幂等操作；真实变化必须走更新入口。
- [x] 新增未引用验证命令被分类为增量验证能力变化，不使需求、计划、review 或 confirmed approval 失效。
- [x] 仅扩充既有命令的 `provides` 时更新 guarantee 覆盖，不改变命令执行身份或业务执行语义。
- [x] 工具结果明确返回新配置哈希、变化分类、受影响证据和下一步。
- [x] 进行中的 5.0 feature 可以在不手改 project state 的情况下补齐缺失 guarantee 并继续。
- [x] 公开 MCP 测试覆盖幂等初始化、CAS 冲突、增量命令和 provides 扩充。
