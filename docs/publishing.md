# 发布

## 发布前检查

```bash
npm ci
npm test
claude plugin validate .
claude plugin validate ./plugins/dev-flow --strict
HOST_E2E=1 npm run test:host-e2e
```

- **版本权威**：根目录 `package.json#version`。  
- 改版本后执行 `npm run version:sync`，再 `npm run build`，把预构建的 `plugins/dev-flow/dist/` **与源码一并提交**。  
- 消费方**从不**对插件包执行 `npm install`。

## 用户安装（仅原生宿主）

```bash
claude plugin marketplace add wxy-hh/dev-flow
claude plugin install dev-flow@dev-flow-marketplace

codex plugin marketplace add wxy-hh/dev-flow
codex plugin add dev-flow@dev-flow-marketplace
```

升级只用各宿主 marketplace / plugin 更新命令。无迁移包、复制安装器、兼容模式或 CLAUDE.md 注入。

## 真机与 smoke

- 本地可选：`HOST_E2E=1 npm run test:host-e2e`（需本机 Claude Code 与 Codex CLI）。  
- 日常 `npm test` **跳过**该层，仍跑完整路线与适配器测试。  
- CI 工作流 `release-smoke.yml`（手动触发）：隔离 HOME、从临时 Git marketplace 用两宿主原生命令安装、升级，并完成 Claude→Codex / Codex→Claude 接力。  
- 当前 release-smoke 钉住的最低验证版本见根 [README.md](../README.md)（Claude **2.1.215**、Codex **0.144.4**、Node **≥ 20**）。

## 建议顺序

1. `version:sync` + `build` + `npm test` + validate +（发布前）host-e2e  
2. 提交源码与 `dist/`  
3. push `main`，打 tag（如 `v1.0.0`）  
4. 需要时跑 `release-smoke`  
