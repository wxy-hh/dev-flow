# Scoped Specs

本目录用于可选的局部工程规范。它只在 M/L 任务明确命中对应 scope 时读取，不影响 XS/S 快速路径。

## 目录约定

```text
.claude/rules/specs/
  <scope>/
    index.md
```

`<scope>` 可以是 package、模块、页面、技术层或团队约定的稳定名称。不要为了凑目录而创建空 scope。

## index.md 必需结构

每个 scope 的 `index.md` 必须包含：

```markdown
# <scope> Spec

## Pre-Development Checklist
- ...

## Quality Check
- ...
```

- `Pre-Development Checklist`：实现前必须知道的局部约定。
- `Quality Check`：审查和验证时要检查的局部约定。

## 使用边界

- XS/S 不读取本目录，不创建 context manifest。
- 轻量 M 只有已经产生落盘资产时才使用相关 scope。
- 轻量 L 和标准 M/L 在计划、改动路径或用户输入命中 scope 时读取。
- 找不到匹配 scope 时，继续使用 `.claude/rules/project-workflow.md` 和通用 rules。
