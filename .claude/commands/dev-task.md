# /dev-task — 开发任务入口

```text
/dev-task <需求描述>
```

1. 读取 `.claude/rules/project-workflow.md`、`CLAUDE.md` 和直接相关源码。
2. 按改动拓扑判断 XS/S/M/L：
   - XS：单点且行为显然。
   - S：局部、清楚、单模块可回滚。
   - M：一个功能内多个步骤，但共享契约稳定。
   - L：跨三个以上架构层、共享协议/状态、多条调用链或协调回滚；任一强信号即可判 L。
3. 独立识别 `security`、`data`、`money`、`external`、`availability` 风险。
4. 选择最小路径：XS/S 直接做；M 用对话短计划；L 或任意风险任务只创建一个 `work.md`。
5. 有风险标签时，先写风险卡并输出 `[HUMAN GATE:implementation_approval]`；用户在风险卡后的明确确认前不得写业务代码。用户最初的“直接改”不算风险接受。
6. L 按 `work.md` 中的结果批次执行，每批验证并更新恢复点；批次间默认自动继续。
7. 完成后基于真实 diff 审查并运行新鲜验证。L/风险任务运行：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

默认产物预算：XS/S 为 0；M 为 0、确需恢复时最多 1；L 或风险任务为 1；只有独立手测需要时最多增加 1 个附件。
