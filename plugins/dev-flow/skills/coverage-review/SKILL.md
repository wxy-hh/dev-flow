---
name: coverage-review
description: 计划登记前自查 Dev Flow 冻结 Trace 的需求、验收、任务、测试与 RU 覆盖。
---

读取 `dev_flow_inspect` 的 artifacts、trace 与 review。确认每个 REQ/AC 均落到 TASK 与 TEST，每个 TASK 属于合法 RU，每个 RU 的 scope、depends_on、targeted forward verification 和恢复命令完整。覆盖缺口在计划登记阶段修复。

本技能是**计划登记前的自我核对**：只产生检查结论，不产生审查记录。计划登记后的独立审查由 plan-review 技能的 requirements-coverage 角色执行——两者使用同一套覆盖核对标准（REQ/AC→TASK/TEST、TASK→RU、RU 完整性），但登记前的缺口由模型直接修改计划修复，登记后的缺口以 review batch 的 blocking finding 为准。

finding target 只能是 governed project path，或当前 frozen Trace 中存在的 REQ/AC/TASK/TEST/RU ID；evidence 只能再引用当前 job 包里的冻结需求/计划工件。禁止自由字符串、手改 snapshot 或创建独立 coverage 路线步骤。
