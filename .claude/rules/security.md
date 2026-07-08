---
paths:
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/*.astro"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
  - "**/*.kt"
  - "**/*.cs"
  - "**/*.php"
  - "**/*.rb"
  - "**/*.rs"
  - "**/*.sql"
  - "**/*.yml"
  - "**/*.yaml"
  - "**/*.json"
  - "**/*.env*"
---

# 安全指南

## 强制安全检查

在任何提交之前：
- [ ] 无硬编码凭据（API 密钥、密码、令牌）
- [ ] 所有用户输入均已验证
- [ ] 预防 XSS（对 HTML 进行净化处理）
- [ ] 错误消息不泄露敏感数据

## 凭据管理

```typescript
// 严禁：硬编码凭据
const apiKey = "sk-proj-xxxxx"

// 推荐：环境变量
const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  throw new Error('API key not configured')
}
```

## 安全响应协议

发现安全问题：
1. 立即使用 **security-reviewer** 智能体
2. 修复严重（CRITICAL）级别问题
3. 轮换已暴露的凭据
4. 审查整个代码库类似问题
