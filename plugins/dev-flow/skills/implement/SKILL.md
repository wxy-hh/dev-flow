---
name: implement
description: 在 implementation 阶段按 Core 能力自由实现并自动恢复技术错误。
---

只在 `dev_flow_status` 显示开发实现且控制允许写入时写入业务代码。Core/Hook 按真实目标和阶段判断语义，不因 Write、Edit、apply_patch、heredoc 等价命令不同而拦截；控制文件仍只能由 MCP 变更。

常规写入失败时优先读取 status、修正目标或使用等价操作继续。验证失败保持当前实现单元 active，记录 failure signature 和 progress evidence；有进展就自动修复，连续同签名无进展或达到上限才 `waiting-user`。不要自动丢弃用户改动，也不要手改 checkpoint/repair 状态。

XS/S/light M 使用内部自动 checkpoint；standard M/L 还可按计划行为切片产生多个 checkpoint。pause 不要求提交、验证或 finalize；WIP/manual commit 后先自动 reconcile，再按内容变化精确标记 stale。
