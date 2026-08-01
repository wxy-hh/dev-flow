# 第一轮真机验证：用户交互反馈总档

> 状态：已确认（真机首轮，vuejs-core #12088 standard-m）
> 定位：**交互摩擦是当前最严重的问题**，比任何单点 bug 影响都大
> 用户原话："整个过程我认为用户交互层面交互摩擦很大……完全没有交互可言"

## 反馈一：弹框死循环（elicitation 表单渲染失败）

每次决策（grill / HUMAN GATE）都弹出选项缺失的表单（"操作: not set"），Esc 后手动输 token 才能继续。
详见 [[2026-08-01-mcp-elicitation-form-render-bug]]。

## 反馈二：回复引导不具体，空格敏感（已定位根因）

**根因 A：text-token 通道严格相等匹配，无任何归一化**

`requirements-grill.ts` 的 `resolveGrillTextPrompt`：`event.text === userReply` 严格相等。
`human-gates.ts` 的 gate 通道：`trim() + toLocaleLowerCase` 后整句相等（只去首尾空白，**不折叠内部连续空格**）。

→ 用户复制 token 行时多带/少带空格、首尾空格 → 匹配失败。无 recoveryHint 说明"请勿携带多余空格"。

**根因 B：提示与通道错位（更严重的设计问题）**

- HUMAN GATE 通道**本来就支持中文自然语言**：`gateApprovalPhrases` = `["确认需求","需求已确认","同意需求","approved","LGTM"]` / `["确认执行","批准实现","同意实现","开始实现","approved","LGTM"]`
- 但 skill 引导向用户展示的是**一次性 token 行**（`DF-XXXXXXXX confirm`），用户按自然语言输入"确认需求"反而不确定能否触发
- 用户视角：提示里"确认需求"四个字 + 一串无含义标识混排，复制出来的是一串"不知道的标识"，且空格敏感
- 两套通道（自然语言短语 vs token 行）规则各异，agent 与用户都无法直观区分当前门该用哪种

## 反馈三：交互语言不是人话

一次性 token（`DF-Z2T7MTDRN025`）无任何语义，用户无法理解、记忆、核对，只能机械复制；复制失败时也无法自行判断错在哪。

## 修复方向（优先级：高）

1. **skill 层统一引导**：对 HUMAN GATE 直接引导自然语言批准词（"输入：确认需求"），不再展示 token 行；仅 grill 决策保留 token 通道
2. **匹配归一化**：text-token 与 gate 通道统一 `trim + 折叠内部空白 + 小写` 后再比较（防复制空格问题）
3. **提示可读性**：token 行用代码块包裹、明确"原样复制整行、勿加空格"；或提供自然语言别名
4. **弹框修复**：见 elicitation 档案；若表单可用，选择卡片直接点击，自然语言/token 复制场景大幅减少

## 附：门禁机制本身的工作情况（正面）

- git guard 拦截 logic-complete 前 git 写 ✅（git mv → 改用 mv）
- fileScope 校验拦截 scope 外路径 ✅（含源文件补充、测试副产物清理）
- 计划变更 → 批准作废连锁 ✅（防改计划绕过批准，但多次重审造成绕圈感，见发现 #7）
- 写目标校验拦截 /tmp 重定向 ✅
- 状态机全程零损坏，所有决策/门禁/步骤均正确落账
