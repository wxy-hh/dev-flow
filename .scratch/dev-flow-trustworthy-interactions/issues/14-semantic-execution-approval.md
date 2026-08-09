# 14 — 按执行授权依据复用执行批准

**What to build:** 让 execution approval 只绑定用户真正授权的执行范围、任务、恢复语义和风险；相同执行语义即使阶段重进也只确认一次，真正改变授权对象时才重新询问。

**Blocked by:** 03 — 统一执行批准与现场取舍交互；11 — 按引用关系失效验证命令证据；13 — 让专项风险角色随相关语义重新审查

**Status:** implemented; ready-for-review

- [x] Core 生成稳定的执行授权依据，覆盖 scope、执行相关分类、当前 REQ/AC/TASK/RU 图、文件范围、恢复语义和当前阻断风险。
- [x] review batch ID、生成投影、阶段位置、TEST-only 关系和无关配置哈希不进入执行授权依据。
- [x] confirmed approval 保存授权依据哈希及可审计摘要，状态能够解释后续复用或撤销原因。
- [x] 计划重新登记、additive verification config、review batch 重建或 implementation 阶段重进时，依据相同则保留批准。
- [x] scope、执行相关分类、TASK/RU、file scope、恢复命令语义或当前风险变化时撤销批准并重新打开 obligation。
- [x] 工件变化不再无条件清空全部 human gates；只失效依据真正变化的批准。
- [x] 旧 5.0 confirmed approval 在既有依据未变化时可确定性升级并继续，无法证明相同时保持保守重问。
- [x] 重放“三次相同执行批准”场景时只出现一次确认；加入真实任务或风险变化后必须出现新的确认。
