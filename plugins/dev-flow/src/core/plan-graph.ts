/**
 * Structural validation of the inter-task graph declared in an
 * implementation plan. Light L plans must declare a rollback_unit on every
 * task and a tasks/depends_on list on every RU; Core rejects plans whose
 * declared graph is dangling or cyclic before they can be registered.
 */

const TRACE_ANCHOR = /<!-- dev-flow:id=(REQ|AC|TASK|TEST|RU)-([0-9]{3,}) kind=(requirement|acceptance-criterion|task|test|rollback) -->/g;

interface TaskDecl {
  id: string;
  rollbackUnit?: string;
}

interface RollbackDecl {
  id: string;
  tasks: string[];
  dependsOn: string[];
}

interface PlanGraph {
  tasks: Map<string, TaskDecl>;
  rollbacks: Map<string, RollbackDecl>;
}

/** Parse a `- key: [a, b]` / `- key: RU-001` line into its list or scalar value. */
function parseField(line: string): { key: string; value: string[] } | undefined {
  const match = /^-\s+([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
  if (!match) return undefined;
  const raw = match[2].trim();
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    return {
      key: match[1],
      value: inner.length
        ? inner.split(",").map((item) => item.trim()).filter((item) => item.length > 0)
        : [],
    };
  }
  return { key: match[1], value: raw.length ? [raw] : [] };
}

function parseBlock(blockText: string): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const line of blockText.split("\n")) {
    const parsed = parseField(line);
    if (parsed) fields[parsed.key] = parsed.value;
  }
  return fields;
}

/**
 * Split markdown into blocks keyed by anchor id. Reuses the same anchor syntax
 * as the trace pipeline but returns block text, not just a content hash, so the
 * declared task/RU fields can be validated.
 */
export function parsePlanBlocks(markdown: string): Map<string, { kind: string; text: string }> {
  TRACE_ANCHOR.lastIndex = 0;
  const anchors: Array<{ id: string; kind: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = TRACE_ANCHOR.exec(markdown)) !== null) {
    const [, prefix, suffix, kind] = match;
    anchors.push({ id: `${prefix}-${suffix}`, kind, index: match.index });
  }
  const blocks = new Map<string, { kind: string; text: string }>();
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const end = anchors[index + 1]?.index ?? markdown.length;
    blocks.set(anchor.id, { kind: anchor.kind, text: markdown.slice(anchor.index, end) });
  }
  return blocks;
}

function collectGraph(markdown: string): PlanGraph {
  const blocks = parsePlanBlocks(markdown);
  const tasks = new Map<string, TaskDecl>();
  const rollbacks = new Map<string, RollbackDecl>();
  for (const [id, block] of blocks) {
    const fields = parseBlock(block.text);
    if (block.kind === "task") {
      tasks.set(id, { id, rollbackUnit: fields["rollback_unit"]?.[0] });
    } else if (block.kind === "rollback") {
      rollbacks.set(id, {
        id,
        tasks: fields["tasks"] ?? [],
        dependsOn: fields["depends_on"] ?? [],
      });
    }
  }
  return { tasks, rollbacks };
}

/** Validate the declared graph; returns human-readable errors (empty means valid). */
export function validatePlanTaskGraph(markdown: string): string[] {
  const { tasks, rollbacks } = collectGraph(markdown);
  const errors: string[] = [];
  if (tasks.size === 0) errors.push("计划中没有任何 TASK 锚点；请为每个任务声明 dev-flow:id=TASK-xxx kind=task");
  if (rollbacks.size === 0) errors.push("计划中没有任何 RU 锚点；请为每个回撤单元声明 dev-flow:id=RU-xxx kind=rollback");

  for (const task of tasks.values()) {
    const unit = task.rollbackUnit;
    if (!unit) {
      errors.push(`${task.id} 未声明 rollback_unit`);
      continue;
    }
    if (!rollbacks.has(unit)) {
      errors.push(`${task.id} 引用了不存在的回撤单元 ${unit}`);
      continue;
    }
    const declared = rollbacks.get(unit)!;
    if (!declared.tasks.includes(task.id)) {
      errors.push(`RU-${unit} 的 tasks 未包含引用它的 ${task.id}（双向不一致）`);
    }
  }

  for (const rollback of rollbacks.values()) {
    for (const taskId of rollback.tasks) {
      const task = tasks.get(taskId);
      if (!task) {
        errors.push(`${rollback.id} 的 tasks 引用了不存在的任务 ${taskId}`);
      } else if (task.rollbackUnit !== rollback.id) {
        errors.push(`${rollback.id} 列出 ${taskId}，但该任务声明的 rollback_unit 是 ${task.rollbackUnit ?? "空"}（双向不一致）`);
      }
    }
    for (const dependency of rollback.dependsOn) {
      if (!rollbacks.has(dependency)) {
        errors.push(`${rollback.id} 的 depends_on 引用了不存在的回撤单元 ${dependency}`);
      }
    }
  }

  const cycle = findCycle(rollbacks);
  if (cycle) errors.push(`回撤单元依赖成环：${cycle.join(" → ")}`);

  return errors;
}

/** DFS cycle detection on the RU depends_on graph; returns one cycle path if any. */
function findCycle(rollbacks: Map<string, RollbackDecl>): string[] | undefined {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  function visit(nodeId: string): string[] | undefined {
    color.set(nodeId, GRAY);
    stack.push(nodeId);
    for (const dependency of rollbacks.get(nodeId)?.dependsOn ?? []) {
      if (!rollbacks.has(dependency)) continue;
      const state = color.get(dependency) ?? WHITE;
      if (state === GRAY) {
        const start = stack.indexOf(dependency);
        return [...stack.slice(start), dependency];
      }
      if (state === WHITE) {
        const cycle = visit(dependency);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    color.set(nodeId, BLACK);
    return undefined;
  }

  for (const nodeId of rollbacks.keys()) {
    if ((color.get(nodeId) ?? WHITE) === WHITE) {
      const cycle = visit(nodeId);
      if (cycle) return cycle;
    }
  }
  return undefined;
}
