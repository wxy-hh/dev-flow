# 13 — 让专项风险角色随相关语义重新审查

**What to build:** 让 security、critical-correctness 等 specialty-risk 角色真正随它们应审查的计划和 Trace 语义变化，而不是只因风险标签仍存在就永久复用旧结果。

**Blocked by:** 12 — 按审查角色依据继承 finding 结论

**Status:** implemented; ready-for-review

- [x] 每个 specialty-risk 角色的依据包含对应风险标签及其相关计划与 Trace 语义切片。
- [x] 风险标签不变但相关 TASK、TEST、RU、文件范围或恢复语义变化时，该角色不能复用旧 job。
- [x] 与角色无关的变化仍可复用旧 job，避免把专项审查退化为每批全量重跑。
- [x] 已 resolved 的专项 finding 在相关依据变化后进入 needs-revalidation，并由同一角色复核。
- [x] 未解决或 still-blocking 的专项 finding 在新 job 中完整结转，不因 job 复用或 batch 变化丢失。
- [x] 无法归因到任何角色切片的未知 diff 保持保守全量重审。
- [x] critical-correctness 的真实审计场景证明计划修复不会因后续无关 batch 变化被错误要求风险接受。
