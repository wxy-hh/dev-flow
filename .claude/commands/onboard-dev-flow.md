# /onboard-dev-flow — 新项目适配

根据当前项目生成或刷新 `.claude/rules/project-workflow.md`。

```text
/onboard-dev-flow [--repo-governed|--local-config] [--smoke-test]
```

## 流程

1. 读取 `.claude/rules/project-workflow.template.md`。
2. 检测 package manager、lock 文件、项目类型和 monorepo 边界。
3. 从真实脚本中识别 install、dev、build、type-check、lint、format 和 test；确认 test 是否为真实测试运行器。
4. 检测浏览器/运行时验证能力、Git 跟踪边界和已有局部规则。
5. 生成 0.4.0 配置，只保留 `feature_root`、可选局部规则路径、验证命令和 Git 模式。
6. 无法确认的能力写 `none` 或 `needs-confirmation`，不猜测、不创建占位资产。
7. 运行 `.claude/skills/dev-flow/scripts/dev-flow-doctor`。
8. 指定 `--smoke-test` 时执行 `docs/claude-dev-flow-smoke-test.md` 的五个分级/风险场景。

## 约束

- 不修改业务代码，不自动提交。
- 不复制旧项目的 `project-workflow.md`。
- frontmatter 是配置事实源，正文不再复制命令矩阵。
- 默认 feature id 为 `YYYY-MM-DD-<short-kebab-name>`。
- 普通 XS/S/M 不需要工作文件；L 或任意风险任务使用 `<feature_root>/<feature-id>/work.md`。
- 高风险实现前只有一次风险确认，但不能由用户最初的“直接改”自动跨过。

## 完成格式

```text
已生成/更新 .claude/rules/project-workflow.md。
检测：project kind、package manager、feature root、验证能力、Git mode。
验证：dev-flow doctor <通过|失败>；smoke test <通过|未运行|失败>。
```
