---
paths:
  - ".claude/**"
  - "CLAUDE.md"
  - "<feature-root>/**"
dev_flow:
  version: "0.4.0"
  project_kind: "<detect>"
  package_manager: "<detect>"
  paths:
    feature_root: "<detect-feature-root>"
    scoped_spec_root: ".claude/rules/specs"
  verification:
    install: "<detect-or-none>"
    dev: "<detect-or-none>"
    build: "<detect-or-none>"
    build_only: "<detect-or-none>"
    type_check: "<detect-or-none>"
    lint: "<detect-or-none>"
    lint_changed: "<detect-or-none>"
    format: "<detect-or-none>"
    test: "<detect-or-none>"
    automated_tests: "<none|present>"
    runtime_verification: "<optional|required|custom>"
    webapp_testing: "<disabled|enabled>"
  git:
    mode: "<local-config|repo-governed>"
---

# Claude 项目工作流适配

本文件只保存当前项目事实。迁移 dev-flow 后根据真实项目重新生成，不复制旧项目的命令、路径或能力判断。

## 配置规则

- `dev_flow` frontmatter 是唯一机器配置，不在正文复制成第二张表。
- 所有 `<detect...>` 和枚举占位符必须替换；无法确认时写 `none` 或 `needs-confirmation`。
- `feature_root` 必须是仓库内相对路径，例如 `docs/dev-flow/features`。
- `scoped_spec_root` 是可选局部规则目录；没有真实规则时保持空目录或删除目录，不生成占位规范。
- `test` 只有在真实测试运行器存在时才填写测试命令，不能把 dev/watch 命令当测试。

## 任务资产

新 feature id 默认使用：

```text
YYYY-MM-DD-<short-kebab-name>
```

L 或任意风险任务的唯一工作文件：

```text
<feature_root>/<feature-id>/work.md
```

普通 XS/S 不生成流程文件；普通 M 默认也不生成。只有确需用户独立执行手测时，才在同一 feature 目录增加 `manual-test.md`。

`work.md` 的固定 State 字段、风险门禁和批次格式以 `.claude/skills/dev-flow/SKILL.md` 为准，不在本文件维护副本。

## 验证策略

按改动类型选择能证明结果的最小命令集合：

- 文档/规则：文本一致性和相关脚本自检。
- 源码/类型：相关 type-check、lint 和测试。
- 构建/路由/接口：增加 build 或集成验证。
- UI/运行时行为：使用浏览器验证或明确记录的人工检查。
- 高风险链路：覆盖成功、失败、缺失输入、权限/状态保护、清理和回撤后行为。

`automated_tests: none` 时不要假装存在单元测试；选择静态检查、可执行的小型验证或人工行为证据。验证后代码变化时，旧结果失效。

## Git 边界

- `local-config`：`.claude/` 与 `CLAUDE.md` 可以只保留在本机。
- `repo-governed`：只提交团队需要共享的规则，忽略本地设置和一次性运行文件。
- dev-flow 默认不提交、推送、合并、回滚或删除分支；按用户明确授权执行。

## 可选局部规则

只有 M/L 改动路径明确命中 `.claude/rules/specs/<scope>/index.md` 时才读取。局部规则用于源码约束，不改变等级，也不产生额外流程资产。每个 index 至少包含：

- `Pre-Development Checklist`
- `Quality Check`

## Onboarding 检测清单

生成本文件时检查：

1. package manager 与 lock 文件。
2. install、dev、build、type-check、lint、format、test 命令。
3. test 是否为真实测试运行器。
4. 浏览器或运行时验证能力。
5. 项目类型、monorepo 边界和关键共享层。
6. Git 跟踪/忽略边界。
7. 已存在的局部规则；没有则不创建。

生成后运行：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
```
