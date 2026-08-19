#!/bin/bash
# 一键重建固定验证仓 sandbox/work/（计划 §2.2）
# seed → work：复制最小种子 + 独立 git init + 删上一轮状态目录，可反复重跑。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED="$ROOT/sandbox/seed"
WORK="$ROOT/sandbox/work"

# 全量重建：work 是产物，任何残留都作废
rm -rf "$WORK"
mkdir -p "$WORK"
cp -R "$SEED/." "$WORK/"

# 防御性清理上一轮运行残留（seed 不含这些目录，正常情况无，但防手写残留）
rm -rf "$WORK/.dev-flow" "$WORK/.dev-flow-debug"

# 独立 git 仓：验证仓内 git 操作（T7 自动 commit）的测试现场
cd "$WORK"
git init -q
git config user.name "Dev Flow Sandbox"
git config user.email "dev-flow-sandbox@localhost"
git add -A
git commit -qm "sandbox: seed 初始提交（dev-flow 验证仓）"

echo "[sandbox-reset] 已重建 ${WORK}（seed: ${SEED}）"
echo "[sandbox-reset] 注意：work/.env 是假敏感样本，被根 .gitignore 的 .env 规则忽略、不入本仓——这是刻意的（它就该是不可入库的敏感文件样本）。"
