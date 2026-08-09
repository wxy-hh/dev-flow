---
name: requirements
description: 复用或生成 Dev Flow 的持久需求证据并完成边界审计。
---

先调查已有 issue、设计、测试和已确认材料。若它们已覆盖目标、范围、非目标与验收，优先冻结为需求证据；只有 Core 的 `controls.requirements=true` 且无可复用材料时才 scaffold/编辑/登记 `需求文档.md`。

持续维护 `boundaryAudit`：扫描默认假设、自由空间、TBD、fallback、范围与验收留白。仓库可判定的内容记录 evidence；必须由用户选择的内容走 grill 决策，绑定 decision reference。grill 必须提供 2–3 个带说明的正式选项和唯一推荐理由，由 Core 分配 A/B/C；不要把 `other` 当正式选项。不得在留白未处置时锁定分类，也不得为不需要需求工件的路线强制生成文档。
