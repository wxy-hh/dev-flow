import { recordHostHealth, type HostHealthSignal } from "./host-health.js";
import { readActive, readState, reconcileWorkspace } from "./state-store.js";

/**
 * Core entry point for host wiring signals. Adapters report facts here; Core
 * owns the only stateful recovery action that follows a proven stale gap.
 */
export async function observeHostRecovery(
  root: string,
  signal: Omit<HostHealthSignal, "at"> & { at?: string },
): Promise<void> {
  const health = await recordHostHealth(root, signal);
  if (!health.recovered) return;

  const active = await readActive(root);
  if (!active) return;
  const state = await readState(root, active.featureId);
  if (state.lifecycle !== "active" && state.lifecycle !== "finalized") return;
  await reconcileWorkspace(root, active.featureId, state.revision, signal.host);
}
