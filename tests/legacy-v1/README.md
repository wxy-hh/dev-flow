# v1 测试归档

这里保留 Dev Flow 1.x 的历史测试，仅用于查阅旧行为和回溯问题，不属于 2.0 自动化验证面。

2.0 使用 schema v2 硬切换：`startFeature` 先创建 intake，路线通过分类事实显式锁定；risk-minimal、固定 execution gate、rollback unit 日常编排和旧英文资产路径均已删除。因此这些测试如果继续按旧合同运行，会把预期的硬切换误报为回归。

2.0 的活动测试位于 `tests/unit/`、`tests/e2e/routes/` 和 `tests/e2e/cross-host/`，并以 `v2-*`、`v2-lifecycle` 与各基础路线风险覆盖测试作为发布验证入口。
