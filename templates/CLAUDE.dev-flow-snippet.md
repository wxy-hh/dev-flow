# dev-flow 工作流入口

新开发请求先使用 `.claude/skills/dev-flow/SKILL.md`：按改动拓扑判断 XS/S/M/L，再独立识别 `security`、`data`、`money`、`external`、`availability` 风险。

普通 XS/S/M 默认不生成流程文件。L 或任意风险任务只维护 `<feature_root>/<feature-id>/work.md`；只有独立手测确有必要时才增加 `manual-test.md`。

有风险标签时必须先输出 `[HUMAN GATE:implementation_approval]`，等待风险卡之后的用户明确确认；用户最初的“直接改”不能自动跨过该门禁。L 按可验证批次执行，每批更新同一个 `work.md`。

项目路径和验证命令只从 `.claude/rules/project-workflow.md` 读取。迁移到新项目先运行 `/onboard-dev-flow`，完成 L/风险任务前运行 `.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish`。
