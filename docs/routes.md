# Dev Flow 5.0 动态路线合同

`dev_flow_start` 创建 intake；`dev_flow_classify` 纯预览；`dev_flow_lock_classification` 校验 boundaryAudit，并在需要时创建 route-confirmation。Core 确认后返回 level、控制集、逐项理由和完整 `orderedRoute`。

## Level 下限

| 维度 | XS | S | M | L |
| --- | --- | --- | --- | --- |
| changeSurface | single-site | single-component | multi-component | system-wide |
| behaviorChange | mechanical | bounded-rule | new-capability | systemic-change |
| topology | local | — | shared-contract | multi-chain / coordinated-rollback |

最终 level 取三者最高值。操作者可有证据向上加强，不得低于 Core 下限。风险只增加控制。

用户可通过 `controlEnhancements` 追加 requirements、正式计划、Trace、审查角色、执行确认、unit-chain、恢复层级、代码审查深度或 verification guarantee。合并是单调的；不接受任何关闭或削弱已派生控制的输入，executable rollback 仍受真实可逆事实约束。

## 控制编译

| 控制 | 派生规则摘要 |
| --- | --- |
| requirements | L、新能力/系统性变化、shared-contract 必需；优先冻结已有确认材料 |
| plan | XS locate；S brief；M/L formal；plan-review、unit-chain、operational recovery 强制 formal |
| trace | L 必有；M 在 shared-contract、多 RU、正式恢复或 plan-review 时开启 |
| plan-review | L 默认；M 在共享契约、多 RU、恢复或专项风险时开启；角色按事实派生 |
| execution-approval | L 必有；M 按共享契约、review、多 RU、恢复或高后果风险开启；XS/S 只由高后果风险追加 |
| checkpoints | 所有任务 baseline；L、多 RU、可执行回撤或不可逆风险声明 unit-chain |
| recovery | 所有任务 delivery reverse；必要时 operational strategy；真实可逆且有 unit-chain 才 executable rollback |
| code-review | XS none、S focused、M/L independent；专项风险可提升 full |
| verification | 始终 targeted，按新能力、共享契约、多组件、风险和系统性变化增加 behavior/integration/full |

计划审查的基础角色为 requirements-coverage、architecture-testability 与 rollback-operability；security、data-irreversibility、money-safety、contract-failure、recovery-observability、critical-correctness 等专项角色只在对应事实存在时加入。

同一 level 可以编译出不同路线。例如：

```text
M 本地单单元：planning → implementation → code_review → verification → finalize
M 共享契约：requirements_alignment → planning → plan_review → execution_approval → implementation → code_review → verification → finalize
```

完整显示路线包含 Core-owned gate；实际 recordable steps 由 Core 编译，模型不得复制一套阶段表。

## Boundary audit 与确认

boundaryAudit 必须显式扫描 assumption、free-space、tbd、fallback、scope、acceptance。每个发现以 repository fact/evidence 或 resolved decision 处置。M/L 或任一风险先展示事实、level、完整路线及启用/未启用控制原因，由 route-confirmation 确认；无风险 XS/S 展示后直接锁定。

需求文档登记后同样需要用户确认：`requirements` 技能展示范围、目标、非目标、验收条件摘要与决策记录，用户确认或提出修改（修改需重新登记）后才进入 planning。

首次 governed write 前可以基于纠正事实重算；实质路线变化会使旧确认失效。实现开始后控制只能增加。

## 机器权威

机器合同位于 `plugins/dev-flow/policy/contract.json`，schema 版本为 4。用户交互只使用当前中文选项和 `dev_flow_answer`；不存在公共 resolve 或 feature-check 工具。
