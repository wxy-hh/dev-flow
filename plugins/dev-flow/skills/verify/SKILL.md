---
name: verify
description: 按 Dev Flow guarantee 集选择最小去重验证命令并记录证据。
---

只运行 project config 登记的命令。读取 `classification.controls.verification` 的 targeted/behavior/integration/full guarantee 集，由 Core 选择覆盖全部保证的最小命令集合并去重；不得把单个命令的名字当作保证，也不得擅自降级。

`preflightCommands` 只做环境准备，失败时记录失败并停止，绝不算验证成功。RU checkpoint 仅运行计划声明的 targeted forward verification；final verification 才覆盖完整 guarantee 集。项目没有命令提供所需 guarantee 时，报告稳定错误、缺失 guarantee 与配置恢复动作。

验证 freshness 以 governed-root 字节指纹为准：仅 HEAD 变化或 reconcile 时间变化但字节不变时不重跑；真实 drift 只撤销受影响证据并回到最早阶段。
