# /commit — 提交代码

根据当前工作区 diff 生成 commit message，并在提交前给出必要验证建议。

## 使用

```
/commit
```

## 流程

1. 获取 `git diff`（工作区变更），为空则退出
2. 读取 `.claude/rules/project-workflow.md`，按项目适配层判断改动类型并选择验证：
   - 文档、规则、命令：做适配层定义的文本检查
   - Vue/TS 改动：运行适配层定义的类型检查和代码检查
   - 构建、路由、接口、关键页面：运行适配层定义的构建或集成验证
3. 如验证失败，先报告问题并建议修复；不要生成“可提交”的结论
4. 生成 commit message（格式见下）
5. 展示变更列表、验证结果、commit message 和建议暂存文件

## 提交方式

默认不自动执行 `git add`、`git commit`、`git push`。只有用户明确要求“帮我提交/推送”，才执行对应 Git 操作。

```
<type>: <一句话描述>

<可选说明>
```

类型: feat / fix / refactor / chore / style / docs / test
