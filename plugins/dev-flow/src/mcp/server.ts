import readline from "node:readline";
import { DevFlowError, failureFrom } from "../core/errors.js";
import { buildFeatureMutationSummary } from "../core/execution-brief.js";
import type { FeatureState } from "../core/state-store.js";
import type { PublicInteraction } from "../core/user-interactions.js";
import { lifecycleLabel, routeLabel, stageLabel } from "../policy/presentation.js";
import { emitAttention } from "./attention.js";
import { dispatch, McpConnection, publicTools, toolSchemas, type DispatchPorts, type ToolSchemaEntry } from "./dispatch.js";

// 本文件是 stdio 入口 adapter：stdin 行协议 → dispatchRequest → dispatch（dispatch.ts
// 是可导入深模块，接口即测试面）；stdout 协议写出全部集中于此。构建入口见 build.mjs。
const root = process.cwd();

/** Protocol-level JSON-RPC result (initialize, tools/list, …). */
function protocolResult(id: unknown, value: unknown) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: value })}\n`);
}

/** tools/call result: MCP CallToolResult shape. */
function toolResult(id: unknown, value: unknown) {
  const view = value && typeof value === "object" && !Array.isArray(value)
    ? value as { contentView?: unknown; structuredContentView?: unknown }
    : {};
  const contentValue = view.contentView === undefined ? value : view.contentView;
  const structuredValue = view.structuredContentView === undefined ? value : view.structuredContentView;
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(contentValue) }],
      structuredContent: structuredValue,
    },
  })}\n`);
}

const readOnlyResponseTools = new Set([
  "dev_flow_init_project",
  "dev_flow_classify",
  "dev_flow_status",
  "dev_flow_inspect",
  "dev_flow_get_traceability",
  "dev_flow_get_review_job",
  "dev_flow_preview_rollback",
  "dev_flow_enable_windows_notifications",
  "dev_flow_doctor",
]);

function isFeatureState(value: unknown): value is FeatureState {
  const schemaVersion = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (schemaVersion === 4 || schemaVersion === 5)
    && typeof (value as { featureId?: unknown }).featureId === "string"
    && typeof (value as { revision?: unknown }).revision === "number"
    && typeof (value as { mode?: unknown }).mode === "string");
}

/** Apply the compact contract only to mutation responses; read-only views stay full. */
function compactMutationResult(toolName: string, value: unknown): unknown {
  if (readOnlyResponseTools.has(toolName)) return value;
  const mutationContent = (summary: ReturnType<typeof buildFeatureMutationSummary>, interaction?: PublicInteraction) => ({
    状态: lifecycleLabel(summary.lifecycle),
    ...(summary.route ? { 路线: routeLabel(summary.route) } : {}),
    当前阶段: stageLabel(summary.stage),
    下一步: summary.logicComplete ? "当前任务已完成。" : "按当前状态继续下一步。",
    需要用户决定: summary.counters.openInteractions > 0,
    健康状态: summary.counters.blockingFindings > 0 ? "需要处理" : "正常",
    ...(interaction?.status === "pending" ? {
      需要用户决定: true,
      当前问题: interaction.question ?? "请回答当前问题。",
      交互提示: interaction.presentation ?? interaction.question ?? "请回答当前问题。",
      选项: interaction.options.map((option) => `${option.answerCode ? `${option.answerCode}. ` : ""}${option.label}${option.recommended ? "（推荐）" : ""}`),
    } : {}),
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  // 变更结果只有两种形状：裸 FeatureState 或管道 envelope（{ state, interaction?, … }）。
  // 先归一为 envelope 再走单一格式化路径——两种形状共享同一份 summary/content/control，
  // 不再靠两套分支分别猜测；键序与形状保持不变。
  const record = isFeatureState(value)
    ? { state: value }
    : value as Record<string, unknown>;
  const state = record.state;
  if (!isFeatureState(state)) return value;
  const summary = buildFeatureMutationSummary(state);
  const content = mutationContent(summary, record.interaction as PublicInteraction | undefined);
  const highlighted = record.ratifiedFrom
    ? { 决策ID: record.decisionId, 登记方式: "已依据你最近的回答自动登记", 问题: record.question, 原话: record.evidence, 结论: record.conclusion, ...content }
    : record.recordIds
      ? { 事实ID: record.recordIds, 新建: record.created, 已存在: record.existing, ...content }
      : record.recordId
        ? { 事实ID: record.recordId, ...content }
        : record.decisionId
          ? { 决策ID: record.decisionId, ...content }
          : content;
  const control = { featureId: summary.featureId, expectedRevision: summary.revision, stage: summary.stage, lifecycle: summary.lifecycle };
  const structuredContentView = isFeatureState(value)
    ? { ...summary, state: summary, control }
    : { ...record, ...summary, state: summary, control };
  return { contentView: highlighted, structuredContentView };
}

function failure(id: unknown, error: unknown) {
  const value = failureFrom(error);
  const content = JSON.stringify({
    状态: "未完成",
    错误码: value.code,
    原因: value.cause,
    提示: value.userMessage,
    影响: value.impact,
    恢复动作: value.recovery.instruction,
    ...(value.technical && Object.keys(value.technical).length ? { 安全细节: value.technical } : {}),
  });
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      isError: true,
      content: [{ type: "text", text: content }],
      structuredContent: value,
    },
  })}\n`);
}

function protocolFailure(id: unknown, error: unknown): void {
  const value = failureFrom(error);
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: value.userMessage, data: value } })}\n`);
}

function emitAttentionNotification(event: Parameters<typeof emitAttention>[0]): void {
  void emitAttention(event, {
    emit: (message) => process.stdout.write(`${JSON.stringify(message)}\n`),
  });
}

const connection = new McpConnection();
const ports: DispatchPorts = {
  elicit: (interaction, question) => connection.elicit(interaction, question),
  sampleReview: (job) => connection.sampleReview(job),
  assertSamplingSupported: () => connection.assertSamplingSupported(),
  notify: emitAttentionNotification,
};
const inFlight = new Set<Promise<void>>();

async function dispatchRequest(message: { id?: unknown; method?: string; params?: any; result?: unknown; error?: unknown }): Promise<void> {
  try {
    // Notifications have no id; ignore after initialize handshake.
    if (!Object.hasOwn(message, "id") || message.id === undefined || message.id === null) return;

    if (message.method === "initialize") {
      connection.configure(message.params?.capabilities, message.params?.clientInfo);
      protocolResult(message.id, {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        serverInfo: { name: "dev-flow", version: __DEV_FLOW_VERSION__ },
        capabilities: { tools: {} },
         instructions: "先完成事实调查和路线分类。日常读取 dev_flow_status；它会显示中文阶段、当前下一步和唯一待决问题。所有用户决定统一使用 dev_flow_answer，系统会自动按问题类型处理。没有真实决策缺口时流程会自动推进。先调用 dev_flow_init_project，再开始 feature。",
      });
      return;
    }
    if (message.method === "tools/list") {
      protocolResult(message.id, {
        tools: publicTools.map((name) => {
          const { expose, ...schema } = toolSchemas[name] as ToolSchemaEntry;
          return { name, ...schema };
        }),
      });
      return;
    }
    if (message.method === "tools/call") {
      const name = message.params?.name;
      const arguments_ = message.params?.arguments ?? {};
      toolResult(message.id, compactMutationResult(name, await dispatch(root, name, arguments_, ports)));
      return;
    }
    if (message.method === "ping") {
      protocolResult(message.id, {});
      return;
    }
    protocolFailure(message.id, new DevFlowError("UNKNOWN_METHOD", String(message.method ?? "missing method")));
  } catch (error) {
    if (message?.id !== undefined && message?.id !== null) failure(message.id, error);
  }
}

let requestTail = Promise.resolve();
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let message: { id?: unknown; method?: string; params?: any; result?: unknown; error?: unknown };
  try {
    message = JSON.parse(line);
  } catch {
    continue;
  }
  if (connection.consumeResponse(message)) continue;
  const task = requestTail.then(() => dispatchRequest(message)).finally(() => inFlight.delete(task));
  requestTail = task;
  inFlight.add(task);
}
connection.close();
await Promise.allSettled(inFlight);
