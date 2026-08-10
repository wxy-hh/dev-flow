# 03 — AskUserQuestion 结构化凭证

**What to build:** 表单选中即信任——Claude 原生 AskUserQuestion 的回答事件携带问题与选项对齐信息，归属时以事件内容（而非智能体转述）解析选项并直接落账。

**Blocked by:** 02。

**Status:** implemented; ready-for-review

- [x] hook 记录 AskUserQuestion 回答事件时携带问题文本（结构化消歧依据；不再只落文本）。
- [x] 归属判定以事件内容（prompt.text）解析选项，userReply 仅用于事件消歧，不参与内容判定。
- [x] 旧事件（无问题字段）自动走文本凭证路径，读时兼容。
- [x] 表单选中一次落账：结构化事件存在时 agent 任意转述均成功（route-confirmation 场景；approval 等门禁的"任意转述"留待后续扩展，其事件查找已语义兼容化）。
- [ ] 后续：hook 记录选项结构（options 列表/所选选项 id 对齐）——本轮由"问题文本 + 选中标签"承担，选项结构字段留待审计增强。
