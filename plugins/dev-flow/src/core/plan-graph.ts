/**
 * Structural validation of the inter-task graph declared in an
 * implementation plan. Formal plans must declare an implementation_unit on
 * every task and a tasks/depends_on list on every UNIT; Core rejects plans
 * whose declared graph is dangling or cyclic before they can be registered.
 */

const TRACE_ANCHOR = /<!-- dev-flow:id=(REQ|AC|TASK|TEST|UNIT)-([0-9]{3,}) kind=(requirement|acceptance-criterion|task|test|implementation-unit) -->/g;

interface TaskDecl {
  id: string;
  implementationUnit?: string;
}

interface ImplementationUnitDecl {
  id: string;
  tasks: string[];
  dependsOn: string[];
}

interface PlanGraph {
  tasks: Map<string, TaskDecl>;
  implementationUnits: Map<string, ImplementationUnitDecl>;
}

/** Parse a `- key: [a, b]` / `- key: UNIT-001` line into its list or scalar value. */
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
 * declared task/UNIT fields can be validated.
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
  const implementationUnits = new Map<string, ImplementationUnitDecl>();
  for (const [id, block] of blocks) {
    const fields = parseBlock(block.text);
    if (block.kind === "task") {
      tasks.set(id, { id, implementationUnit: fields["implementation_unit"]?.[0] });
    } else if (block.kind === "implementation-unit") {
      implementationUnits.set(id, {
        id,
        tasks: fields["tasks"] ?? [],
        dependsOn: fields["depends_on"] ?? [],
      });
    }
  }
  return { tasks, implementationUnits };
}

/** Validate the declared graph; returns human-readable errors (empty means valid). */
export function validatePlanTaskGraph(markdown: string): string[] {
  const { tasks, implementationUnits } = collectGraph(markdown);
  const errors: string[] = [];
  if (tasks.size === 0) errors.push("计划中没有任何 TASK 锚点；请为每个任务声明 dev-flow:id=TASK-xxx kind=task");
  if (implementationUnits.size === 0) errors.push("计划中没有任何 UNIT 锚点；请为每个实现单元声明 dev-flow:id=UNIT-xxx kind=implementation-unit");

  for (const task of tasks.values()) {
    const unit = task.implementationUnit;
    if (!unit) {
      errors.push(`${task.id} 未声明 implementation_unit`);
      continue;
    }
    if (!implementationUnits.has(unit)) {
      errors.push(`${task.id} 引用了不存在的实现单元 ${unit}`);
      continue;
    }
    const declared = implementationUnits.get(unit)!;
    if (!declared.tasks.includes(task.id)) {
      errors.push(`${unit} 的 tasks 未包含引用它的 ${task.id}（双向不一致）`);
    }
  }

  for (const implementationUnit of implementationUnits.values()) {
    for (const taskId of implementationUnit.tasks) {
      const task = tasks.get(taskId);
      if (!task) {
        errors.push(`${implementationUnit.id} 的 tasks 引用了不存在的任务 ${taskId}`);
      } else if (task.implementationUnit !== implementationUnit.id) {
        errors.push(`${implementationUnit.id} 列出 ${taskId}，但该任务声明的 implementation_unit 是 ${task.implementationUnit ?? "空"}（双向不一致）`);
      }
    }
    for (const dependency of implementationUnit.dependsOn) {
      if (!implementationUnits.has(dependency)) {
        errors.push(`${implementationUnit.id} 的 depends_on 引用了不存在的实现单元 ${dependency}`);
      }
    }
  }

  const cycle = findCycle(implementationUnits);
  if (cycle) errors.push(`实现单元依赖成环：${cycle.join(" → ")}`);

  return errors;
}

/** DFS cycle detection on the UNIT depends_on graph; returns one cycle path if any. */
function findCycle(implementationUnits: Map<string, ImplementationUnitDecl>): string[] | undefined {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  function visit(nodeId: string): string[] | undefined {
    color.set(nodeId, GRAY);
    stack.push(nodeId);
    for (const dependency of implementationUnits.get(nodeId)?.dependsOn ?? []) {
      if (!implementationUnits.has(dependency)) continue;
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

  for (const nodeId of implementationUnits.keys()) {
    if ((color.get(nodeId) ?? WHITE) === WHITE) {
      const cycle = visit(nodeId);
      if (cycle) return cycle;
    }
  }
  return undefined;
}
