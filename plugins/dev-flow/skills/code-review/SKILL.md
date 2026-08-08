---
name: code-review
description: 按 Core 返回的 none、focused、independent 或 full 深度审查实现。
---

读取 `classification.controls.codeReview`，不要在 Skill 复制风险映射。`none` 不创建独立阶段；`focused` 对实际 diff 做聚焦自审；`independent` 使用与实现分离的审查；`full` 深入调用影响、失败路径、安全、数据/金额/不可逆后果和测试充分性。

审查范围以 Core 派生 implementation/delivery 文件和 Git 基线为准，不向用户索要文件清单。先修 blocking，再复审；修复产生的新可信写入自动加入交付。仅在实质审查完成且无 blocker 后，按 Core 返回的 requiredEvidence 记录 code_review；不要用 code review 替代 plan review。
