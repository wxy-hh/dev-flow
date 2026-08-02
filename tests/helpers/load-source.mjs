import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function loadSource(relativePath) {
  const result = await build({
    entryPoints: [path.join(root, relativePath)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    define: { __DEV_FLOW_VERSION__: JSON.stringify("test") },
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  const module = await import(`data:text/javascript;base64,${encoded}`);
  // Existing low-level tests historically called startFeature with the
  // classification fields inline. Runtime v2 intentionally starts in intake;
  // normalize those fixtures here so the old stateful tests exercise the v2
  // lock boundary without adding a compatibility path to production code.
  if (relativePath.endsWith("plugins/dev-flow/src/core/state-store.ts")) {
    const startFeature = module.startFeature;
    const lockClassification = module.lockClassification;
    return {
      ...module,
      startFeature: async (root, input, options) => {
        const state = await startFeature(root, input, options);
        if (input?.level === undefined || input?.topology === undefined) return state;
        const riskLabels = input.riskLabels ?? [];
        const basis = input.classificationBasis ?? {
          scopeFacts: ["legacy test fixture scope"],
          topologyFacts: ["legacy test fixture topology"],
          uncertaintyFacts: input.requirements === "provided-confirmed" ? [] : [input.requirements ?? "legacy test fixture uncertainty"],
          riskFacts: Object.fromEntries(riskLabels.map((label) => [label, [`legacy test fixture evidence: ${label}`]])),
          decisionRefs: [],
        };
        return lockClassification(root, state.featureId, state.revision, {
          ...basis,
          level: input.level,
          topology: input.topology,
          ...(input.execution ? { execution: input.execution } : {}),
          ...(input.requirements ? { requirements: input.requirements } : {}),
          ...(riskLabels.length ? { riskLabels } : {}),
        });
      },
    };
  }
  return module;
}
