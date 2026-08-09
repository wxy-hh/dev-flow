# 08 — 永久隔离工作流控制目录与业务指纹

**What to build:** 让 Dev Flow 的状态、事件、快照和 Git 元数据永远不属于业务治理范围，使插件自身写入不会改变业务指纹、review basis、checkpoint 或 delivery snapshot。

**Blocked by:** None — can start immediately.

**Status:** implemented; ready-for-review

- [x] `.git` 与 `.dev-flow` 在 Git 和非 Git 枚举模式下都是不可覆盖的内建排除项。
- [x] governed root 为仓库根目录时，未跟踪且未写入 `.gitignore` 的工作流控制文件仍不会被枚举。
- [x] 连续状态 mutation、review job、Trace snapshot 和 verification log 写入不会改变业务指纹。
- [x] 仅工作流控制目录变化时不会产生 REVIEW_BASIS_STALE、workspace drift 或 delivery 内容变化。
- [x] 现有 governed root exclude、tracked ignored file 与 symlink 安全合同保持不变。
- [x] Dev Flow 不自动创建或修改业务仓 `.gitignore`。
- [x] 测试覆盖 governed root 为根、控制目录未忽略、大量状态写入和 review basis 稳定性。
