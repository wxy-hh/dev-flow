# 验证发现：MCP elicitation 表单在 Claude Code 渲染异常导致交互卡死

> 状态：已确认（真机复现，阻塞 HUMAN GATE / grill 的 elicitation 通道）
> 发现日期：2026-08-01（第一轮真机验证，vuejs-core #12088 XS 案例）
> 待办：需要修复或规避

## 现象

grill 决策呈现（`grill-decision-presented`，Q-001）后，Claude Code 弹出表单：

```
❯ ⚠ 操作: ▸ not set
        选择确认、提出修改意见，或当前问题的一个选项
        This field is required
      修改意见 / 补充说明: not set
        选择"提出修改意见"或"其他"时必填

    Accept    Decline
```

- "操作"下拉框**无任何可选项**（not set），但为必填 → 点 Accept 无效果
- 方向键 / Tab 均无法展开或切换选项
- 弹窗模态化，**无输入框**，无法走 text-token 通道输入文本
- 会话被永久卡在该弹窗，只能 Esc / Ctrl+C / 重启会话脱困

## 环境

- Claude Code **2.1.220**（CLI）
- dev-flow **1.9.0**（project scope 安装，本地 marketplace）
- macOS 26.6，Node v22.22.0

## 触发链路

1. agent 调用 `dev_flow_request_grill_decision`（Q-001，options 数组 3 项）
2. MCP server 创建 interaction（kind=grill，status=pending），事件 `grill-decision-presented` 落账
3. MCP 返回 elicitation（交互确认）→ Claude Code 将其渲染为权限样式表单
4. 表单选项**未渲染**（疑似协议/版本不兼容或 UI bug）→ 卡死

## 影响

- **HUMAN GATE 与 grill 决策共用的 elicitation 通道在真机不可用**——这是主交互路径，非边缘场景
- 双通道中的 text-token 通道不受影响（需先脱困再输入文本）
- 事件账本确认无 resolve 事件落账，状态机未损坏，重启会话可继续

## 2026-08-01 追加（首轮验证实录）

- **系统性高频**：首轮验证连续 3 次决策（Q-001/Q-002/Q-003）弹窗全部卡死，无一例外
- **当前 workaround**：Esc 关闭弹窗 → 回到输入框 → 手动输入提示中的一次性 token 行（如 `DF-XXX repo-only`）→ 决策正常落地（3/3 成功）
- 即：**每轮决策都需用户手动 Esc + 抄录 token**，摩擦成本显著；text-token 通道本身可靠，问题仅在 elicitation 表单渲染
- 修复优先级上调：这是用户每次决策都要面对的高频摩擦，建议 skill 层直接默认引导 text-token 输入，规避表单

## 2026-08-01 追加：门禁消息误导（发现 #5）

实现阶段补充 RU-001 file_scope 并重新登记计划文档后，`implementation_approval` 批准按设计作废（计划 SHA 变更），但 PreToolUse 拦截消息仅提示 `DEV_FLOW_IMPLEMENTATION_APPROVAL_REQUIRED: Target is under a protected root; finish the route and wait for implementation approval`，**未说明"计划文档已在批准后变更、批准作废、需重新确认"**，agent 在"刚批准过"的认知下撞墙困惑。

- 机制本身正确（防批准后改计划的漏洞）
- 建议：hook 拦截消息补充作废原因（如携带 last-gate-basis 与当前计划 SHA 的差异提示）
- 另：RU file_scope 含移动操作时必须同时覆盖源与目标两侧（发现 #4），计划阶段易漏源侧；门禁正确拦截，agent 补充后需重登记 → 连锁触发本发现

## 2026-08-01 追加：写目标校验拦截 /tmp 重定向（发现 #6，轻量）

验证阶段 agent 执行 `pnpm vitest run > /tmp/full-vitest.log` 被 `DEV_FLOW_WRITE_TARGET_UNRESOLVED` 拦截（重定向目标在仓库外）。门禁将 shell 重定向纳入写目标校验，设计合理（写操作可审计），但 agent 写 /tmp 是常见习惯，且拦截消息未提示"改用项目内路径"的 recoveryHint。
- 建议：hook 消息补 recoveryHint（如 `Use a project-relative log path, e.g. vitest.log`），skill 层引导验证命令输出走项目内路径

## 修复方向（待定）

1. **skill 层规避**：requirements/grillme 技能在呈现决策时改用 text-token 通道（提示用户直接输入选项文本），不依赖 elicitation 表单
2. **协议核对**：检查 server 端 elicitation 返回格式与当前 Claude Code 版本（2.1.220）支持的协议是否一致（protocolVersion 2024-11-05 vs 新版本）；升级 CLI 验证是否复现
3. **回归保障**：修复后需要真机交互验证（自动化测试覆盖不了 UI 渲染）

## 复现步骤

1. 任意业务仓（如 vuejs-core）启用 dev-flow 1.9.0
2. 启动交互式 claude 会话，发起一个走到 requirements+grill 步骤的需求
3. 等待 `grill-decision-presented` 后观察表单

## 关联验证发现

- classify 将 #12088（预期 XS）分类为 **standard-m**（需求状态 missing-or-unclear → 强制 requirements+grill）。是否过严待后续案例对照
