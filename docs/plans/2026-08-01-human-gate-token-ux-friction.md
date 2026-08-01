# 验证发现：HUMAN GATE 一次性 token 对真实用户不直观，自然语言确认无法触发

> 状态：已确认（真机复现，UX 摩擦）
> 发现日期：2026-08-01（第一轮真机验证，vuejs-core #12088）
> 关联：[[2026-08-01-mcp-elicitation-form-render-bug]]（同轮验证的弹窗卡死问题）

## 现象

需求确认门（HUMAN GATE requirement_confirmation）呈现后提示：

```
继续： 已打开选择卡片；如未看到，请使用一次性回复：
- DF-Z2T7MTDRN025 confirm — 确认需求
- DF-Z2T7MTDRN025 request-changes <修改意见> — 提出修改意见
```

**用户输入"确认需求"（自然语言）无法触发流程**，只有原样复制含 token 的整行（`DF-Z2T7MTDRN025 confirm`）才被接受。

## 摩擦点

1. 提示中"确认需求"中文标签与 token 行并存，用户（包括插件作者本人）第一反应输入自然语言"确认需求"→ 不匹配 → 流程不推进，用户困惑
2. 每轮决策/HUMAN GATE 都要复制一长串 token（`DF-XXXXXXXXXX confirm`），与"批准实现"等常见交互相比认知成本高
3. 在 elicitation 表单卡死（见关联档案）的背景下，唯一路径是 Esc + 复制 token，双重摩擦叠加

## 设计权衡（为何有 token）

- 一次性 token + 整句批准词：防重放、防伪造、绑定具体交互（HUMAN GATE 的 security 设计）
- 放宽匹配（如接受自然语言"确认需求"）会削弱防伪语义，不建议直接放宽

## 修复方向（待定）

1. **skill 层引导优化**：提示中明确"**请原样复制以下整行回复，不要自行输入文字**"，并把 token 行视觉突出（如代码块包裹）
2. **别名支持**（可选）：对 `confirm` 等固定动作支持自然语言别名匹配，但保留 token 防重放校验（仍需用户回复中带 token）
3. 与 elicitation 表单修复联动：若表单通道修好，选择卡片可直接点击选项，token 复制场景大幅减少

## 复现步骤

1. 走 standard-m 路线到需求确认门
2. 输入自然语言"确认需求" → 流程不推进
3. 原样复制 token 行 → 流程推进

## 验证实录

- Q-001/Q-002/Q-003 grill 决策：3/3 靠复制 token 行成功
- requirement_confirmation：自然语言尝试失败，token 行成功
