# 评审派发物是 Core 生成的完整提示

`start_review_execution` 曾只返回 job 标识，调度者自行拼提示，子智能体既写不出内部文件，也给不出宿主能回收的标记和完成 JSON。

**决定：** 每个 job 返回一份可原样转发的 `dispatchPrompt`，内含回收标记、角色、该角色的冻结切片、completion schema 和「不得写文件」。`capability` 只给宿主内部回收，不进提示。父智能体不得改写提示，也不得再拼完整 package。

**为什么不选另外两套：** 结构化 payload 仍让调用方猜协议。不透明 handle 在 Claude 宿主里没有可转发的文本。放开 `.dev-flow` 写入会绕过宿主回收。
