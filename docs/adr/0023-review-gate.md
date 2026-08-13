# 审查就绪只问一个 gate

「实现能不能开始 / 计划审查过了没有」由 `assertReviewComplete` 抛错、`next.ts` 再映射错误码、`recordStep` 与 `begin` 再各调一次。隔离证明缺失会在调度层直接炸，不一定变成下一步。

**决定：** 一个 `reviewGate`，不返回 NextAction，不公开 deficit 集合：

```ts
reviewGate(root, state, query?: { phase?: "plan" | "code" }): Promise<
  | { status: "ready"; stamp?: ReviewStamp }
  | { status: "need-batch"; cause: "missing" | "stale" | "phase" }
  | { status: "jobs-open"; batchId; jobs }
  | { status: "blocking"; batchId; findingIds }
  | { status: "isolation"; batchId; jobIds }
>
```

默认相位跟当前 open step；`recordStep` / `begin` 可显式问 plan 或 code。无审查义务时 `{ status: "ready" }`，不读 ledger。`jobs-open` 带 jobs，避免 `nextAction` 再读账本。`need-batch.cause` 保住 STALE 与 REQUIRED 的恢复文案。隔离是一种 status，`nextAction` 译成「先做审查」，不再 throw-through。公开 `assertReviewComplete` 删除。job 机保持 deep。投影 rebuild 沉为内部。风险接受仍走交互（ADR-0019 下一刀）。

**为什么：** 抛错再翻译会让 next 与 recordStep 对同一码走出两套动作。gate 若返回 NextAction，调度和门禁抢 seam（ADR-0021）。体检表式结果会把 doctor/inspect 绑上审查 I/O。不带 jobs 会逼 next 成为第二个读者。

**后果：** 测试打 `reviewGate` 的 status / cause / ids。计划审查与代码审查的相位差是 query，不是两个 gate。代码质量审查与需求忠实度、独立审查隔离证明（ADR-0012 / 0017）不改语义，只改问法。
