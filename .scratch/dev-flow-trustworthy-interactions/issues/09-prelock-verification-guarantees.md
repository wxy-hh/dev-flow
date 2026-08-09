# 09 — 在路线锁定前校验 verification guarantee

**What to build:** 让验证能力缺口在项目初始化或路线锁定前被发现，而不是等到最终 verification 才迫使用户重新登记需求、计划、Trace 和批准。

**Blocked by:** None — can start immediately.

**Status:** implemented; ready-for-review

- [x] 新项目配置至少有一个非 preflight 命令提供所有路线都要求的 targeted guarantee。
- [x] 路线预览完成后、正式锁定前，Core 根据派生控制检查该路线需要的完整 guarantee 集。
- [x] guarantee 缺口返回稳定错误码、缺失项、用户影响和唯一配置恢复动作。
- [x] 缺口存在时不创建路线确认、Trace snapshot、review ledger 或 routed state。
- [x] preflight 命令无论声明哪些 provides 都不计入 guarantee evidence。
- [x] 无风险 XS/S、共享契约 M、系统性 L 及风险增强路线分别覆盖准确的前置检查。
- [x] 配置完整时现有分类与路线锁定行为不增加额外用户问题。
