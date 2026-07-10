# Rules

```text
rules/
├── project-workflow.template.md  # 新项目适配模板
├── project-workflow.md           # 当前项目真实配置（onboarding 生成）
├── git-workflow.md               # Git 边界
├── security.md                   # 通用安全约束
├── specs/                        # 可选局部工程规则
└── vue3.md                       # Vue 项目可选规则
```

- 迁移后先运行 `/onboard-dev-flow`，不要复制旧项目的成品配置。
- 项目路径和验证命令只写在 `project-workflow.md` 的 `dev_flow` 配置中。
- `.claude/rules/specs/<scope>/index.md` 只在 M/L 改动明确命中 scope 时读取，不改变等级，也不产生额外流程资产。
- 特定语言/模块规则与通用规则冲突时，具体规则优先。
