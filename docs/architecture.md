# Architecture

Dev Flow ships as one prebuilt plugin package. Claude Code and Codex CLI load the same Skills, policy contract and local MCP server. Host adapters only normalize hook events and enforce Git/protected-root guardrails; they never advance workflow state.

Consumer state lives in `.dev-flow/`: `project.json` provides strict enforcement, allowed verification commands and protected roots; each feature owns an atomic `state.json` and append-only `events.jsonl`. The state store uses a process lock, revision CAS, fsync and rename. One feature can be `active`; other features must be explicitly paused.

All state transitions go through MCP. Required Markdown assets are feature-local and SHA-256 registered; `status.md` is a read-only generated projection updated in the same state transaction. Gate basis changes revoke the relevant HUMAN GATE. Verification hashes only configured protected roots; a changed hash invalidates verification, feature-check and logic-complete. Core mutations reject out-of-order steps and future artifacts even if a caller bypasses Skills and invokes MCP directly.

Host adapters fast-return for non-writing tools. For relevant PreToolUse events they deny Git writes before `logic-complete` and deny `Write`, `Edit`, `MultiEdit` and `apply_patch` changes under protected roots until `implementation_approval` is confirmed. Unparseable patch input and Bash `apply_patch` are denied conservatively while the gate is pending. `dev_flow_doctor` is read-only and reports project configuration, active-state validity, manifests, bundles, hook/MCP JSON wiring and server availability.
