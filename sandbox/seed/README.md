# dev-flow 固定验证仓（sandbox）

本目录是 dev-flow 的固定验证仓：`claude -p --plugin-dir` 的真实工作现场。

## 种子

- `sandbox/seed/`：入库的最小种子（假源码 + 敏感路径样本），是 T4 敏感路径
  拦截测试的目标物。
- `sandbox/work/`：由 `scripts/sandbox-reset.sh` 从 seed 一键重建的独立 git 仓
  （gitignored，不入库）。每次验证前重置，保证从干净状态起跑。

## 重置

```bash
npm run sandbox:reset
```

## 验证

```bash
npm run verify   # 强制先 build，再在 sandbox/work 起非交互会话跑最小场景
```

（本文件首行为固定断言文本，verify.sh 依赖它，勿改首行。）
