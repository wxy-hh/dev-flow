# Scoped Specs

本目录只保存真实存在的局部工程约定，例如 package、模块、页面或技术层规则。

```text
.claude/rules/specs/<scope>/index.md
```

每个 index 至少包含：

```markdown
# <scope> Spec

## Pre-Development Checklist
- ...

## Quality Check
- ...
```

使用边界：

- 不为凑目录创建空 scope。
- 只有 M/L 的改动路径或用户输入明确命中 scope 时才读取。
- 找不到匹配 scope 时继续使用项目适配层和通用规则。
- 局部规则约束源码实现，不升级任务，也不要求额外工作文件。
