export interface RollbackWarningNode {
  kind: "implementation-unit";
  id: string;
  status: string;
  fileScope: string[];
  dependsOn: string[];
}

function isTestScope(pattern: string): boolean {
  const normalized = pattern.normalize("NFC").replaceAll("\\", "/");
  return normalized.includes("__tests__")
    || /(^|\/)(tests?|fixtures?)(\/|$)/u.test(normalized)
    || /\.(test|spec)\./u.test(normalized);
}

/**
 * Warn once when a test-only implementation unit is a dependency of a unit that also
 * owns implementation paths. This is advisory and deliberately ignores task
 * titles and free-form descriptions.
 */
export function detectRollbackSplitWarning(nodes: RollbackWarningNode[]): string[] {
  const current = new Map(nodes.filter((node) => node.kind === "implementation-unit" && node.status === "current").map((node) => [node.id, node]));
  const splits: string[] = [];
  for (const node of current.values()) {
    const implementationScope = node.fileScope.some((pattern) => !isTestScope(pattern));
    if (!implementationScope) continue;
    for (const dependencyId of node.dependsOn) {
      const dependency = current.get(dependencyId);
      if (dependency && dependency.fileScope.length > 0 && dependency.fileScope.every(isTestScope)) {
        splits.push(`${dependency.id}->${node.id}`);
      }
    }
  }
  return splits.length === 0
    ? []
    : [`测试与实现拆为不同实现单元，${[...new Set(splits)].sort().join(",")}：A 的前向验证红测试期必失败死锁；建议合并原子单元`];
}
