# 规则 (Rules)

## 目录结构

```
rules/
├── README.md              # 本文件
├── git-workflow.md        # Git 工作流（始终加载）
├── project-workflow.md    # 当前项目的 Claude 工作流适配层
├── project-workflow.template.md # 迁移到新项目时使用的适配模板
├── security.md            # 安全指南（常见源码和配置文件）
├── specs/                 # 可选局部规范，M/L 命中 scope 时读取
└── vue3.md                # Vue 3 规范（src/**/*.vue）
```

- **无 paths 限定的 Rule**：全局生效（如 git-workflow.md）。
- **有 paths 限定的 Rule**：只在该路径文件被访问时才加载，节省上下文。
- **命令入口**：日常任务优先使用 `.claude/commands/README.md` 中的 `/dev-task`、`/finish`、`/review-diff` 等命令。
- **项目迁移**：复制 Claude dev-flow 到新项目后，先用 `/onboard-dev-flow` 根据模板生成新的 `project-workflow.md`。
- **局部规范**：`.claude/rules/specs/<scope>/index.md` 是可选增强，只在 M/L 任务明确命中对应 scope 时读取；XS/S 不因此创建额外产物。

## 规则优先级

当特定语言规则与通用规则冲突时，**特定语言规则优先**（具体覆盖一般）。
