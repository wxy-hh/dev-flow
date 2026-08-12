import { access } from "node:fs/promises";
import path from "node:path";

/**
 * Hook 事件携带的 cwd 跟随 agent 的 shell 变化：在 Bash 中 cd 进子目录后，
 * 所有 hook 事件都从子目录触发。宿主事件与健康信号必须写入项目根
 * .dev-flow 账本，因此向上查找最近的含 project.json/active.json 的根目录。
 *
 * 只认 project.json/active.json 标记，不认裸 .dev-flow 目录——健康记录器
 * 可能在没有完整初始化的位置留下 .dev-flow 目录（本次修复前就发生过）。
 */
async function hasDevFlowMarker(directory: string): Promise<boolean> {
  for (const marker of ["project.json", "active.json"]) {
    try {
      await access(path.join(directory, ".dev-flow", marker));
      return true;
    } catch {
      // keep looking upward
    }
  }
  return false;
}

/**
 * Resolve the dev-flow project root from a host event cwd.
 * Walks up from `cwd` to the nearest ancestor carrying a `.dev-flow` marker;
 * falls back to `cwd` itself when no marker exists above it.
 */
export async function resolveDevFlowRoot(cwd: string): Promise<string> {
  const original = path.resolve(cwd);
  let current = original;
  for (;;) {
    if (await hasDevFlowMarker(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return original;
    current = parent;
  }
}
