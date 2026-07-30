# Dev Flow 审查采样设计

## 目标

为 Review 4B 增加由 MCP 服务端发起的采样证据。只有当前 batch 中至少两个不同 job 具有有效、不同且服务端签发的采样 provenance 时，Core 才计算 `independent-sampling`；其他情形继续使用 `multi-perspective`。

## 接口与状态机

新增 `dev_flow_sample_review_job`，入参仅为 `featureId`、`expectedRevision`、`batchId` 和 `jobId`。调用方不能提供 request ID、capability、completion、角色、basis 或 assurance。

job 增加显式 `sampling` 状态：人工路径为 `pending → claimed → submitted`，采样路径为 `pending → sampling → submitted`；两种占用互斥。采样失败、超时或响应无效时回到 `pending`。当前 batch 的 next/status/投影必须显示 `sampling`，但不暴露 sibling 输出。

## 服务端流程

1. Core 先在内容寻址 review snapshot 中写入 sampling attempt：仅存 request SHA-256、batch/job 绑定、签发时间及状态；明文 request ID 只保留在服务端本次调用栈。
2. MCP 服务端确认客户端声明 sampling capability 后，发送 `sampling/createMessage`。请求仅含目标 job 的 immutable package、role/depth 和固定 JSON completion 指令。
3. 响应必须是单段文本 JSON，并复用普通 submit 的 completion、finding、scope 与 resolution 校验。
4. 成功时 Core 原子提交 job 与 provenance；失败、超时（120 秒）或校验失败时原子烧毁 attempt、记录受限失败码并恢复 `pending`。

已消费、伪造、跨 job 或跨 batch 的 request ID 一律拒绝为 `REVIEW_SAMPLING_REQUEST_REPLAY`。服务端异常后，后续 sampling/claim 操作会回收过期占用。

## Assurance 与验证

batch 只要出现 sampling attempt 即标记 `executionMode: "mcp-sampling"`；assurance 仍必须由 Core 从成功 provenance 计算。零或一个有效 sampled job、任何人工提交、以及调用方自填字符串都不能升级 assurance。

测试覆盖 request ID 唯一性与重放、跨 batch 复用、claim/sampling 互斥、超时恢复、响应校验、sibling 隔离、两 job 升级及 2a 人工路径回归。
