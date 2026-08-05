---
name: code-review
description: 实现后的 diff 审查。触发：代码审查、code-review、df-code-review、dev-flow-code-review。当 dev_flow_status 显示代码审查时使用。
---

仅使用 Dev Flow MCP 推进状态。先调用 `dev_flow_status`，仅当中文阶段为代码审查且能力合同允许时行动。

## 流程门禁（原职责，不可跳过）

从 action/progress 的 `requiredEvidence` 读取本步义务，只提交其中要求的非空字段：基础为 `reviewType: "code"`，可能另含 `reviewDepth: "full"` 或 `checks`。不得在 Skill 内复制 risk → evidence 映射，也不得把 `full-code-review` 写入 checks。code-review 与 plan-review 相互独立，不能互相顶替。

路线要求 code-review artifact 时，严格执行 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑 → `dev_flow_record_artifact` → `dev_flow_record_step(code_review)`。默认路线不强制该 artifact，不得擅自 scaffold 未要求的 kind。禁止手改 `.dev-flow` 状态文件。

**禁止**未完成实质审查就 `record_step`。仅在无 🔴 blocking 后，才按 `requiredEvidence` 调用 `dev_flow_record_step(code_review, evidence)`。

## 实质审查（合并通用代码审查方法）

用宿主只读能力（Read / Grep / Glob / git 等）自行查看本 feature 相关实现变更与上下文，**不要向用户索要 diff 或改动列表**。需要时可用 `dev_flow_inspect` 的 `implementation` / `delivery` / `artifacts`（有则 `trace`）补充范围；有实施计划或需求时对照目标与范围。

### 1. 理解变更

- 本步要达成什么？变更类型（功能 / 修复 / 重构）？
- 改了哪些路径？是否包含测试？

### 2. 高层设计

- 方案是否合理、是否与仓库既有模式一致？
- 有无更简单做法？代码是否落在正确位置？
- 职责是否清晰，有无明显过度设计？

### 3. 细节质量

- 命名是否达意；函数是否单一职责、副作用可控
- 错误是否处理、有无静默失败或魔法数
- 明显重复、死代码、注释掉的废代码
- 明显逻辑错误、边界与空值路径

### 4. 安全

- 输入校验；无硬编码密钥；敏感数据未明文落盘
- 注入 / XSS / 权限绕过等常见问题（`checks` 含 security 等时加深）

### 5. 性能（点到为止）

- 明显多余循环、N+1、无界缓存或资源未释放

### 6. 测试

- 关键变更是否有测试；边界与错误路径是否覆盖
- 测试是否可读、确定、无脆弱耦合

### 7. `reviewDepth: "full"` 时加深

- 更完整的正确性与调用影响、不可逆后果、回滚相关实现是否自洽

### 8. 反馈方式

- 建设性、具体到位置；说明**为什么**有问题并给可落地改法
- 分级：🔴 blocking（安全、数据损坏、明显功能错误）／🟡 important／🟢 nit
- 少纠缠 diff 外无关风格；可简短肯定做得好的点

## 先修再过关

- 🔴 blocking：在**代码审查**阶段内修复业务代码（允许 repair-current-unit 语义），再对同一变更范围复审，直到无 blocking
- 连续无进展或需产品取舍时，走既有用户决策通道；**不得**空审硬记 `record_step`
- 🟡 / 🟢：写入可见摘要即可，不阻塞 `record_step`

## 收尾

向用户给出**短中文摘要**：审查范围、blocking/important/nit 数量、已修项、遗留 warning。然后按 `requiredEvidence` 完成 `dev_flow_record_step(code_review)`，进入验证；不要把本步扩成第二条用户路线。
