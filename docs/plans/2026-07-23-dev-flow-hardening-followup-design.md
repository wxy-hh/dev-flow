# Dev Flow 1.3.0 遗漏修复设计

## 目标

修复 1.3.0 实施审查发现的严格模式绕过、恢复中断、只读接口副作用、降级判定与发布校验缺口，同时不把无 active workflow 的正常 Bash 对话变成强制流程。

## 安全边界

- 仅当 `.dev-flow/active.json` 确实不存在时，hook 将 Dev Flow workflow 视为不存在并放行。
- active pointer、project config 或 active state 存在但不可读、JSON/schema 非法时，严格模式 fail closed：阻止 `.dev-flow` 控制文件和 protected roots 写入；project config 无法确定 protected roots 时阻止全部写入。读操作与确定为非 protected 的写操作保持可用。
- Bash 只对可识别的直接写语法枚举所有实际写目标。`touch`、`rm`、`mkdir`、`tee`、重定向、`mv`、`cp`、`sed -i`、`perl -pi` 的多目标不得漏检；变量展开、wrapper、命令替换、glob 或无法准确判定的直接写语法拒绝。未匹配直接写语法的常规构建/安装命令维持既有放行。

## 恢复设计

recovery journal 记录并 fsync 下列可续办阶段：`prepared`、`directory-moved`、`active-cleared`、`completed`。

- 同一 recovery 调用在持有全局 workflow lock 时，根据 journal 与文件系统现状幂等推进下一阶段。
- 未完成 journal 阻止 start；doctor 严格解析 journal，并只返回 MCP 可执行的 resume 动作。
- active pointer 自身损坏时，doctor 提供 pointer digest 与候选 feature；用户显式指定 feature 和证据后，recovery 备份 pointer 与目标 feature，不猜测或手改状态。
- 无法证明唯一安全动作的 journal/文件系统组合 fail closed，不允许通过新的 active feature 绕过。

## 状态与 grill

- `dev_flow_status` 和 `dev_flow_next` 是纯读取接口：用当前 fingerprint 推导 verification 是否过期，但不得写 revision 或失效事件。
- `verify` 使用当前 fingerprint 产生新验证结果；feature-check、finalize 等显式 mutation 在操作前再次校验，并拒绝旧验证。
- requirements grill front matter 非法，或 `in_progress` 缺少 Q-id/response hint 时，status 返回 `GRILL_STATUS_INVALID`，不伪装为 `wait: none`。

## Reclassify

- 在同一个 workflow lock 内依次读取 state、严格 project config、protected-root fingerprint，并作降级判定。
- 降级除当前 state 条件外，还须读取并严格解析 event history；任何 implementation approval 的 `gate-presented`/`gate-confirmed` 记录，或 event history 解析失败，均拒绝降级。

## 发布校验

- `build:check` 在临时副本中执行构建并与当前 `dist` 比较，避免把未暂存的正常实现改动误报为生成漂移。
- 修正尾随空格；自动测试覆盖新的 fail-closed、恢复续办、纯读取、grill 和降级场景。
- 真实 Claude/Codex 回放继续是人工发布门槛，不由自动化伪造通过。

## 验收

1. 多目标 Bash 不能借已登记 artifact 绕过 protected-root/control-file guard；无 active workflow 的普通 Bash 不受阻断。
2. 无效 JSON/schema 与 unreadable active/project/state 不会 fail open；除 project 不可读外，不相关写入仍可继续。
3. recovery 在任一阶段中断后可由 MCP 续办，且未完成 journal 不能 start 新 feature。
4. status/next 不改 revision；过期验证不能通过 feature-check/finalize。
5. grill 非法元数据有明确错误；历史 approval 或不可解析 event history 禁止 standard-to-light 降级。
6. `npm test`、临时构建比对、双宿主人工回放均满足发布要求。
