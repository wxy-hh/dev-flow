# Publishing

Build before release:

```bash
npm ci
npm test
claude plugin validate .
claude plugin validate ./plugins/dev-flow --strict
HOST_E2E=1 npm run test:host-e2e
```

`package.json#version` is authoritative. Run `npm run version:sync`, build, and commit the prebuilt `plugins/dev-flow/dist/` entries with the source. Consumers never run `npm install`.

Install through native hosts only:

```bash
claude plugin marketplace add wxy-hh/dev-flow
claude plugin install dev-flow@dev-flow-marketplace
codex plugin marketplace add wxy-hh/dev-flow
codex plugin add dev-flow@dev-flow-marketplace
```

Use the host-native marketplace/plugin update commands for upgrades. There is no migration package, copy installer, compatibility mode, or CLAUDE.md injection.

`release-smoke.yml` creates isolated HOME directories, installs the plugin from a disposable Git marketplace through both native CLIs, advances that marketplace, runs each native upgrade command, and completes Claude → Codex and Codex → Claude MCP/hook handoffs. The host suite is intentionally opt-in locally because it requires both CLIs; it is mandatory in release smoke.
