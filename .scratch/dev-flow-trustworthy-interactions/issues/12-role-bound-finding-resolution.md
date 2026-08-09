# 12 — 按审查角色依据继承 finding 结论

**What to build:** 让 blocking finding 的修复结论随对应审查角色的相关语义继承：无关变化继续保持 resolved，相关变化进入 needs-revalidation 并交回原角色复核，而不是被错误改写为风险接受。

**Blocked by:** 04 — 统一风险决定交互

**Status:** implemented; ready-for-review

- [x] finding origin 保持不可变，resolved 与 still-blocking 结果记录提交角色当时的语义依据。
- [x] finding 状态可明确派生为 unresolved、resolved、needs-revalidation、still-blocking 或 risk-accepted。
- [x] 对应角色依据未变时，跨 review batch 的 resolved finding 继续保持 resolved。
- [x] 对应角色依据变化时，resolved finding 进入 needs-revalidation，并被携带到原角色的新 review job。
- [x] 原角色必须对每个待复核 finding 明确提交“仍已修复”或“重新阻断”，不能遗漏。
- [x] needs-revalidation finding 不能直接进入风险接受；只有当前角色明确提交 still-blocking 后才可呈现风险决定。
- [x] 旧 5.0 finding event 与 batch disposition 能被确定性读取，不丢失既有 blocker 或修复记录。
- [x] 测试覆盖无关变化保留、相关变化复核、仍已修复、重新阻断和禁止错误风险接受。
