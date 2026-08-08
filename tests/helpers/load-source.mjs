import { build } from "esbuild";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const run = promisify(execFile);

async function ensureLegacyFixtureGit(projectRoot) {
  try {
    await run("git", ["rev-parse", "HEAD"], { cwd: projectRoot });
  } catch {
    await run("git", ["init", "--quiet"], { cwd: projectRoot });
    await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "fixture baseline"], { cwd: projectRoot });
  }
}

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
        await ensureLegacyFixtureGit(root);
        const state = await startFeature(root, input, options);
        if (input?.level === undefined || input?.topology === undefined) return state;
        const riskLabels = input.riskLabels ?? [];
        const signals = {
          changeSurface: input.level === "XS" ? "single-site" : input.level === "S" ? "single-component" : input.level === "M" ? "multi-component" : "system-wide",
          behaviorChange: input.level === "XS" ? "mechanical" : input.level === "S" ? "bounded-rule" : input.level === "M" ? "new-capability" : "systemic-change",
          topology: input.topology,
          unitCount: ["multi-chain", "coordinated-rollback"].includes(input.topology) ? 2 : 1,
          requirements: input.requirements ?? "provided-confirmed",
          operationalRecovery: input.topology !== "local",
          executableRollback: input.topology === "coordinated-rollback",
        };
        const basis = input.classificationBasis?.signals ? input.classificationBasis : {
          scopeFacts: ["legacy test fixture scope"],
          topologyFacts: ["legacy test fixture topology"],
          uncertaintyFacts: input.requirements === "provided-confirmed" ? [] : [input.requirements ?? "legacy test fixture uncertainty"],
          riskFacts: Object.fromEntries(riskLabels.map((label) => [label, [`legacy test fixture evidence: ${label}`]])),
          decisionRefs: [],
          signals,
        };
        let routed = await lockClassification(root, state.featureId, state.revision, {
          ...basis,
          level: input.level,
          topology: input.topology,
          ...(input.requirements ? { requirements: input.requirements } : {}),
          ...(riskLabels.length ? { riskLabels } : {}),
        }, { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] });
        if (routed.pendingDecision?.kind === "route-confirmation") {
          await module.recordHostEvent(root, { eventId: `route-confirm-${routed.revision}`, type: "user-prompt", host: input.host ?? "claude", text: "确认这条路线" });
          routed = await module.confirmRouteClassification(root, routed.featureId, routed.revision, "确认这条路线", input.host ?? "claude");
        }
        return routed;
      },
    };
  }
  return module;
}
