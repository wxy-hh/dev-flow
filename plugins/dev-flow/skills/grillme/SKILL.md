---
name: grillme
description: 在 Dev Flow 5.0 中区分现场取舍与既有用户结论，并用可信交互落账。
---

先查仓库，只有会改变范围、验收、拓扑、风险或不可逆取舍的问题才询问用户，每次只问一个互斥决策。

现场取舍只走 `dev_flow_request_grill_decision` → 原生 elicitation / `dev_flow_answer`；不要创建第二份 pending ledger，也不存在 resolve-decision 工具。已有明确用户结论使用 `dev_flow_record_decision` 一次性写入 evidence 与 conclusion，并且必须绑定 feature 启动后、来自当前宿主的可信用户事件。

优先使用 MCP form elicitation 的 `oneOf + const + title` 选项。decline、cancel、协议错误、超时或缺少能力时保留 pending，改为提示用户直接回复完整中文选项；普通 AskUserQuestion/request_user_input 没有可信宿主事件时不能作为接受证据。
