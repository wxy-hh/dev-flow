# 首次路线锁定只有一次 apply

intake 变成 routed 时，`mode/route/steps` 和追溯/审查 pointer 曾写在直锁、文本确认、表单确认（以及 MCP 内联 fallback）里，清空字段和快照事务还不一致。手写 `routeStages` 又把 plan-review / execution-approval 谎成可 record 步骤。

**决定：** 首次锁定只走 `applyLock`。它不自己开 CAS，只返回已有 `mutatePrepared` 的 prepare 身体：

```ts
applyLock({ root, facts, basisHash }): (current, nextRevision) => Promise<PreparedFeatureMutation>
```

输入是已审计的分类事实和 basisHash，不是编好的 Classification。写入时再 select、再对 hash、检查路线能否执行、写快照、按同一套字段改 draft。无门禁直锁和路线确认的 kind.apply 都把它交给各自那一笔 `mutatePrepared`。不公开 compile / inspect / preview。不要 `settle`：凭证事务仍由 `answer` 拥有（ADR-0019）。重分类的步骤保留与审查作废不是这次 apply。删除手写 `routeStages`，已 routed 只信 `state.steps` / `currentStage`。

**为什么：** 两套 apply 会让直锁和确认再次分叉。把重分类并进来会把「保留已完成步骤」塞进首次锁定。留下 `routeStages` 会继续误导空 steps 的回落。公开 inspect 会让 caller 再编排阶段。`applyLock` 自己开 CAS 会和 `answer` 抢事务。

**后果：** Policy 的 select / 编译仍是纯函数。路线确认仍不绑整份项目配置（ADR-0015）。可见步骤预览继续走只读 classify。测试以 `applyLock` 为主，lockClassification 与 `answer` 各留一条调用路径。
