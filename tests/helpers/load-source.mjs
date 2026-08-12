import { build } from "esbuild";
import { execFile } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
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

async function ensureFixtureHookHealth(projectRoot, host = "codex") {
  await mkdir(path.join(projectRoot, ".dev-flow"), { recursive: true });
  const hosts = new Set([host, "claude", "codex"]);
  const now = Date.now();
  const at = new Date(now).toISOString();
  const signals = [...hosts].map((signalHost) => JSON.stringify({
    host: signalHost,
    kind: "session-start",
    eventId: `fixture-${signalHost}-${now}`,
    at,
  })).join("\n");
  await appendFile(path.join(projectRoot, ".dev-flow", "host-health.jsonl"), `${signals}\n`);
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
        await ensureFixtureHookHealth(root, input?.host ?? "codex");
        const riskLabels = input?.riskLabels ?? [];
        const legacyBasis = input?.classificationBasis ?? {};
        const needsFixtureFact = input?.level !== undefined && input?.topology !== undefined && !legacyBasis.scopeFactRefs;
        // v5 classification references registered repository facts instead of
        // caller-authored prose. Write a sentinel file inside the first
        // governed root and commit it BEFORE startFeature so it is neither
        // dirty workspace drift nor an unowned path, then register one
        // fixture fact against it and reuse its record id for every legacy
        // prose field.
        let factPath;
        if (needsFixtureFact) {
          const config = await module.readProjectConfig(root);
          const governedRoot = config.governedRoots[0] ?? ".";
          factPath = governedRoot === "." ? "dev-flow-legacy-fact.txt" : `${governedRoot}/dev-flow-legacy-fact.txt`;
          await mkdir(path.dirname(path.join(root, factPath)), { recursive: true });
          await writeFile(path.join(root, factPath), "legacy test fixture repository fact\n");
          const pending = await run("git", ["status", "--porcelain", "--", factPath], { cwd: root });
          if (pending.stdout.trim()) {
            await run("git", ["add", "--", factPath], { cwd: root });
            await run("git", ["-c", "user.name=Dev Flow Tests", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "legacy fixture fact", "--", factPath], { cwd: root });
          }
        }
        const state = await startFeature(root, input, options);
        if (input?.level === undefined || input?.topology === undefined) return state;
        const signals = legacyBasis.signals ?? {
          changeSurface: input.level === "XS" ? "single-site" : input.level === "S" ? "single-component" : input.level === "M" ? "multi-component" : "system-wide",
          behaviorChange: input.level === "XS" ? "mechanical" : input.level === "S" ? "bounded-rule" : input.level === "M" ? "new-capability" : "systemic-change",
          topology: input.topology,
          unitCount: ["multi-chain", "coordinated-rollback"].includes(input.topology) ? 2 : 1,
          requirements: input.requirements ?? "provided-confirmed",
          operationalRecovery: input.topology !== "local",
          executableRollback: input.topology === "coordinated-rollback",
        };
        let lockedState = state;
        let facts;
        if (legacyBasis.scopeFactRefs) {
          facts = { ...legacyBasis, signals };
        } else {
          lockedState = await module.registerRepositoryFact(root, state.featureId, state.revision, {
            assertion: "legacy test fixture repository fact",
            location: { kind: "positive", path: factPath },
          }, input.host ?? "codex");
          const factRef = lockedState.governance.repositoryFacts[lockedState.governance.repositoryFacts.length - 1].recordId;
          const refLabels = riskLabels.length ? riskLabels : Object.keys(legacyBasis.riskFacts ?? {});
          facts = {
            scopeFactRefs: [factRef],
            topologyFactRefs: [factRef],
            uncertaintyFactRefs: legacyBasis.signals
              ? (legacyBasis.uncertaintyFacts?.length ? [factRef] : [])
              : (input.requirements === "provided-confirmed" ? [] : [factRef]),
            riskFactRefs: Object.fromEntries(refLabels.map((label) => [label, [factRef]])),
            decisionRefs: legacyBasis.decisionRefs ?? [],
            signals,
            ...(legacyBasis.controlEnhancements ? { controlEnhancements: legacyBasis.controlEnhancements } : {}),
          };
        }
        let routed = await lockClassification(root, state.featureId, lockedState.revision, {
          ...facts,
          level: input.level,
          topology: input.topology,
          ...(input.requirements ? { requirements: input.requirements } : {}),
          ...(riskLabels.length ? { riskLabels } : {}),
        }, { scanned: ["assumption", "free-space", "tbd", "fallback", "scope", "acceptance"], items: [] });
        const routeInteraction = Object.values(routed.interactions ?? {}).find((value) => value.kind === "route-confirmation" && value.status === "pending");
        if (routeInteraction) {
          await module.recordHostEvent(root, { eventId: `route-confirm-${routed.revision}`, type: "user-prompt", host: input.host ?? "claude", text: "确认这条路线" });
          routed = await module.confirmRouteClassification(root, routed.featureId, routed.revision, "确认这条路线", input.host ?? "claude");
        }
        return routed;
      },
    };
  }
  return module;
}
