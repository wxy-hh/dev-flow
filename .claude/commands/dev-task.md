# /dev-task — 开发任务入口

把一个新需求交给 `dev-flow` 技能先分级，再选择最小足够流程。

## 使用

```text
/dev-task <需求描述>
```

## 流程

1. 阅读 `.claude/rules/project-workflow.md`、`CLAUDE.md`、相关源码、已有产物和现有约定。
2. 调用 `dev-flow` 技能判断 XS/S/M/L 与风险标签，并按其路由执行；分级依据、路径选择、HUMAN GATE 和验证门禁规则均以 `.claude/skills/dev-flow/SKILL.md` 及其 `references/` 为准，本命令不重复定义。
3. 分类输入齐备后**同回合**运行 `dev-flow-status start`：XS/S 不传 execution；M/L 传 `--execution light|standard`，standard 再传 `--requirements`。dirty workspace 明确 `--existing-diff unrelated|in-scope --reason`。需要预览时先 `--dry-run`；真实 start 原子写授权/status，不得把写权限推到下一轮。
4. required HUMAN GATE 仅 `confirmed` 才完成并产生相应推进；用户接受残留风险时仍记 `confirmed`，原话写入 evidence。
5. 完成前必须提供新鲜验证证据；status 机器字段只通过 `dev-flow-status` 更新。收尾见 `/finish`：logic-complete 后可 Git；compact/full 可选。

进入标准 L 前的 doctor 前置检查、实现收尾顺序等标准 L 专属规则见 `dev-flow/references/standard-ml.md`。

可选：`/dev-task --trace` 仅在显式启用时写 runtime JSONL（feature ID、gate、duration_ms、check_exit_code、denied_write；不记录 token）。
