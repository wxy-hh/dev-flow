---
name: verify
description: 按 Dev Flow guarantee 集选择最小去重验证命令并记录证据。
---

只运行 project config 登记的命令。读取 `classification.controls.verification` 的 targeted/behavior/integration/full guarantee 集，由 Core 选择覆盖全部保证的最小命令集合并去重；不得把单个命令的名字当作保证，也不得擅自降级。

`preflightCommands` 只做环境准备，失败时记录失败并停止，绝不算验证成功。UNIT checkpoint 仅运行计划声明的 targeted forward verification；final verification 才覆盖完整 guarantee 集。项目没有命令提供所需 guarantee 时，报告稳定错误、缺失 guarantee 与配置恢复动作。

验证 freshness 以 governed-root 字节指纹为准：仅 HEAD 变化或 reconcile 时间变化但字节不变时不重跑；真实 drift 只撤销受影响证据并回到最早阶段。

验证失败按结束原因分别处理：`non-zero-exit` 是代码缺陷（修复后回到审查/实现闭环重跑），`timeout`/`output-limit`/`spawn-failure` 是环境或进程问题（不针对不存在的缺陷反复修复）。最终交付内容在审查后发生变化时，Core 会重开受影响实现单元、代码审查与验证，修复代码后先重新审查再验证，不能直接跳到 verification 或 finalize。

风险接受只绑定接受时的交付内容（issue 22）：验证失败被用户接受后，内容一旦变化旧接受自动失效，需要重新验证；问题消失时不会再次询问。接受风险不会把失败检查改写为通过，报告显示"风险已接受"。
