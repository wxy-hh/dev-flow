# dev-flow 工作流入口

新开发、业务改动、bug 修复或重构请求默认以 `.claude/skills/dev-flow/SKILL.md` 为入口，先判断 XS / S / M / L，再选择最小足够流程。用户明确要求轻量处理、只用某个技能或直接修改时，优先遵守。

涉及登录、鉴权、订单、支付、数据删除、跨系统跳转等高风险链路时，先提示风险并建议走 `dev-flow` 完整流程；用户确认后再按其指令执行。详细分级、风险维度门禁、半自动 `[HANDOFF]`、安全审查、行为验证和回撤证据规则以 `dev-flow` 技能为准。

dev-flow 的项目适配值集中在 `.claude/rules/project-workflow.md`，包括资产目录、运行时台账、feature-id 规约、验证矩阵、scoped specs、context manifest 和当前项目启用的测试/文档能力。迁移到其他项目时先运行 `/onboard-dev-flow` 生成适配层，不要把旧项目路径和命令散写进各个技能。

XS/S 和默认轻量 M 不为三件套额外生成产物；轻量 L 与标准 M/L 才维护 `status.md` 的 `dev_flow_status`、`context/{implement,review,verify}.jsonl` 和必要的局部规范引用。
