# 审查门禁把豁免做成单独状态

ADR-0023 的 `reviewGate` 只在批次 `complete` 之后才看质量例外，所以「接受风险并继续」挡不住 `jobs-open`。`ready` 又带着 stamp，看起来像审查通过。

**决定：** 接受审查风险与当前未完成批次写入 `waived` 是同一笔事务。`reviewGate` 增加 `{ status: "waived"; batchId }`，放行后续步骤，不带 passed stamp，展示「风险已接受」。`ready` 仍只表示审查已完成。`failed` 只属于单个审查工作；批次终态只有完成、豁免、被接替。风险接受同时绑定 `batchId`、`basisHash` 和交付内容，任一变化旧例外失效。

**为什么不选另外两套：** 继续返回 `ready` 会把豁免说成通过。批次保持 open、只靠例外绕过 gate，账本和门禁会再分叉。超时或空结果自动结束批次，等于自动通过。
