---
name: coverage-review
description: 核对 Dev Flow 5.0 冻结 Trace 的需求、验收、任务、测试与 RU 覆盖。
---

读取 `dev_flow_inspect` 的 artifacts、trace 与 review。确认每个 REQ/AC 均落到 TASK 与 TEST，每个 TASK 属于合法 RU，每个 RU 的 scope、depends_on、targeted forward verification 和恢复命令完整。覆盖缺口在计划登记阶段修复。

finding target 只能是 governed project path，或当前 frozen Trace 中存在的 REQ/AC/TASK/TEST/RU ID；evidence 只能再引用当前 job 包里的冻结需求/计划工件。禁止自由字符串、手改 snapshot 或创建独立 coverage 路线步骤。
