---
name: status
description: 查看并接力 Dev Flow 4.0 的精简状态与恢复动作。
---

调用 `dev_flow_status`，只转述其中的 compact 中文用户视图。需要分类、工件、追溯、审查、实现、验证、交付、历史或诊断细节时，一次只调用一个 `dev_flow_inspect` topic。禁止直接编辑 `.dev-flow`。

需要用户决定时只展示一道中文问题和 2-3 个选项，随后使用 `dev_flow_answer`；不展示内部 ID、哈希、revision、token 或英文 stage。技术错误只转述一个推荐恢复动作。

review、checkpoint、repair 等内部动作不会产生第二条路线或重复确认；相同 basis 的用户决策只呈现一次，出现新事实才重新询问。
