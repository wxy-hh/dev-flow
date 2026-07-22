# Dev Flow

Dev Flow is a prebuilt dual-host plugin for Claude Code and Codex CLI. It routes development work by size, topology, execution, requirements and risk, then enforces only the evidence required for that route.

Install from this GitHub marketplace:

```bash
claude plugin marketplace add wxy-hh/dev-flow
claude plugin install dev-flow@dev-flow-marketplace
codex plugin marketplace add wxy-hh/dev-flow
codex plugin add dev-flow@dev-flow-marketplace
```

Upgrade through each host's native marketplace/plugin update command. The plugin has no copy installer, upgrade helper, migration path, CLAUDE.md injection, or OpenSpec integration.

Before starting a feature, create `.dev-flow/project.json` through `dev_flow_init_project`. It declares strict enforcement, protected business roots and the allowlisted verification commands. Shared feature state lets Claude begin a feature and Codex finish it, or the reverse.

## Host baseline

Dev Flow v1 is release-smoke qualified with Claude Code **2.1.215** and Codex CLI **0.144.4** (Node.js 20 or newer). These are the minimum validated host versions; each release runs the native marketplace, MCP, hook, upgrade and bidirectional handoff suite again before the baseline is advanced.

For local host validation, use installed host binaries and opt in explicitly:

```bash
HOST_E2E=1 npm run test:host-e2e
```

The ordinary `npm test` suite skips this host-dependent layer while still running the complete route, asset, gate, fixture and adapter tests.

Read [architecture](docs/architecture.md), [route contract](docs/routes.md), [publishing](docs/publishing.md), and the approved [implementation plan](docs/plans/2026-07-22-dev-flow-dual-host-plugin-implementation-plan.md).
