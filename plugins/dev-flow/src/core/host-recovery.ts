import { recordHostHealth, type HostHealthSignal } from "./host-health.js";
import { lock, readActive, readState, reconcileWorkspace } from "./state-store.js";
import { runBoundedEvidenceMaintenance } from "./evidence-maintenance.js";

/**
 * Core entry point for host wiring signals. Adapters report facts here; Core
 * owns the only stateful recovery action that follows a proven stale gap.
 */
export async function observeHostRecovery(
  root: string,
  signal: Omit<HostHealthSignal, "at"> & { at?: string },
): Promise<void> {
  const health = await recordHostHealth(root, signal);

  // Phase 8: SessionStart runs one bounded maintenance round under the feature
  // lock without advancing feature revision.
  if (signal.kind === "session-start") {
    const active = await readActive(root);
    if (active) {
      let release: (() => Promise<void>) | undefined;
      try {
        release = await lock(root, active.featureId, "session-evidence-maintenance");
        const state = await readState(root, active.featureId);
        await runBoundedEvidenceMaintenance(root, active.featureId, state);
      } catch {
        // Doctor surfaces evidence store damage; host health stays non-blocking.
      } finally {
        await release?.();
      }
    }
  }

  if (!health.recovered) return;

  const active = await readActive(root);
  if (!active) return;
  const state = await readState(root, active.featureId);
  if (state.lifecycle !== "active" && state.lifecycle !== "finalized") return;
  await reconcileWorkspace(root, active.featureId, state.revision, signal.host);
}
