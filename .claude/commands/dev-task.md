# /dev-task — 开发任务入口

把一个新需求交给 `dev-flow` 技能先分级，再选择最小足够流程。

## 使用

```text
/dev-task <需求描述>
```

## 流程

1. 阅读 `.claude/rules/project-workflow.md`、`CLAUDE.md`、相关源码、已有产物和现有约定。
2. 调用 `dev-flow` 技能判断 XS/S/M/L 与风险标签，并按其路由执行；分级依据、路径选择、HUMAN GATE 和验证门禁规则均以 `.claude/skills/dev-flow/SKILL.md` 及其 `references/` 为准，本命令不重复定义。
3. 完成前必须提供新鲜验证证据。

进入标准 L 前的 doctor 前置检查、实现收尾顺序等标准 L 专属规则见 `dev-flow/references/standard-ml.md`。
