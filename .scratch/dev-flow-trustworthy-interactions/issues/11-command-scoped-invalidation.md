# 11 — 按引用关系失效验证命令证据

**What to build:** 当验证命令的实际执行内容变化或被删除时，只使引用它的 Trace/RU、恢复和验证证据失效；独立切片继续有效，高影响治理配置则进入明确的重分类或恢复流程。

**Blocked by:** 10 — 安全补充项目验证配置

**Status:** implemented; ready-for-review

- [x] 项目配置依据可区分治理范围、验证目录和每个验证命令的稳定身份。
- [x] Trace/RU 只绑定自身引用命令的身份，不再绑定整份项目配置哈希。
- [x] 修改命令正文、参数或工作目录时，仅引用该命令的当前 Trace/RU 切片变为 stale。
- [x] 删除已引用命令时准确列出受影响切片并阻塞其后续 checkpoint、恢复或 verification。
- [x] 未引用命令变化不使任何 Trace/RU、review 或 implementation evidence 失效。
- [x] governed roots、exclude 或 enforcement 变化被分类为高影响变化，并返回显式重分类或恢复动作，而非普通增量更新。
- [x] 旧 5.0 Trace 只有整体配置哈希时采用保守且确定性的兼容判断，不要求人工编辑 snapshot。
- [x] 双 RU 场景证明一个命令变化不会使另一个独立 RU 的证据失效。
