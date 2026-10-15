# OpenClaw 2026.10.3 Functional Acceptance

## Purpose

This is the acceptance ledger for the OpenClaw `2026.10.3` candidate that is already installed beside the Final 48 runtime.

The rule is strict: documentation or command presence is not a functional PASS. Every capability family must be exercised with a bounded test and direct evidence before it is marked PASS. A failure stops that capability stage until the failure is understood and either repaired or explicitly classified as an external/manual prerequisite.

The Final 48 runtime stays separate while this acceptance sequence runs. After OpenClaw 2026.10.3 capabilities are mapped, Final 48 work resumes using the verified native capabilities instead of rebuilding equivalent functionality.

## Fixed candidate

- Core: `openclaw@2026.10.3`
- DeepSeek provider: `@openclaw/deepseek-provider@2026.10.3`
- DuckDuckGo plugin: `@openclaw/duckduckgo-plugin@2026.10.3`
- Release tag: `v2026.10.3`
- Release status: stable, not prerelease
- Canonical V2 branch: `v2/openclaw-clean-20261011`
- Final 48 production/runtime pin remains `openclaw@2026.9.8` until a later explicit promotion

## Status vocabulary

- `PASS_CODE_CI` — deterministic local/CI execution proved the capability contract.
- `PASS_LIVE` — a bounded real provider/hosted/device execution proved the live capability.
- `NOT_PROVEN` — capability exists upstream but has not been exercised in our V2 lane.
- `SKIPPED` — intentionally not executed; never equivalent to PASS.
- `BLOCKED` — an external/manual prerequisite prevents execution.
- `FAIL` — the capability was exercised and failed its acceptance gate.

## Ordered capability acceptance

| Stage | Capability family | Minimum acceptance evidence | Current status |
| --- | --- | --- | --- |
| A0 | Exact install + package compatibility | exact 2026.10.3 core and matching provider/search plugins install; existing V2 tests/config remain green | PASS_CODE_CI |
| A1 | Core CLI + config + Gateway + Doctor | isolated baseline config validates; Gateway starts/stops; health/Doctor complete without hidden credentials or hosted mutations | NOT_PROVEN |
| A2 | Plugin, skill, tool inventory | bundled/installed plugins enumerate; skills inventory/check works; expected core command families are callable | NOT_PROVEN |
| A3 | Web search + fetch | real public search and fetch return bounded evidence through the 2026.10.3 runtime | NOT_PROVEN |
| A4 | Managed browser | dedicated OpenClaw profile starts, opens a public page, snapshots, acts on a harmless control, closes tab, stops cleanly | NOT_PROVEN |
| A5 | Existing signed-in browser | `user`/existing-session driver attaches to a real signed-in Chrome context and performs read-only navigation without re-authentication | NOT_PROVEN |
| A6 | Files + runtime/process tools | bounded workspace read/write/edit and harmless process execution prove policy, path and cleanup behavior | NOT_PROVEN |
| A7 | DeepSeek direct provider | one bounded live DeepSeek 2026.10.3 call proves auth, exact model, output and telemetry envelope | NOT_PROVEN |
| A8 | DeepSeek Research agent | DeepSeek + DuckDuckGo `web_search`/`web_fetch` completes one cited structured research task through our contract | NOT_PROVEN |
| A9 | Sub-agents | parent spawns isolated child, child returns result, lifecycle/stop/cleanup evidence is correct | NOT_PROVEN |
| A10 | Tool Search + Code Mode | hidden catalog discovery and a bounded multi-tool JavaScript program execute under policy | NOT_PROVEN |
| A11 | Swarm | bounded parallel fan-out returns structured child results, partial failure handling and concurrency limits work | NOT_PROVEN |
| A12 | Automation | one-shot schedule, recurring/heartbeat ownership, hook/webhook plumbing and cleanup are exercised in an isolated lane | NOT_PROVEN |
| A13 | Memory + skills lifecycle | memory index/search and skill discovery/selection/revision rules work in isolated state | NOT_PROVEN |
| A14 | Doctor/repair/recovery | intentionally repairable isolated drift is detected and repaired; healthy state re-validates afterward | NOT_PROVEN |
| A15 | Sandbox/policy/approvals | allow/deny, sandbox and approval boundaries fail closed under an intentionally denied action | NOT_PROVEN |
| A16 | Nodes/device/computer/file-transfer | paired-node/device-local actions are verified on a real supported node | NOT_PROVEN |
| A17 | Channels/messaging | one selected channel is configured in an isolated acceptance scope and sends/receives a bounded test | NOT_PROVEN |
| A18 | Media/document functions | selected image/document/audio/media actions execute with bounded local fixtures and evidence | NOT_PROVEN |
| A19 | Kernel integration readiness | proven OpenClaw capabilities are mapped to Kernel permissions, budgets, leases/fencing, Evidence and accounting without bypass | NOT_PROVEN |

## Execution rules

1. Run stages in order unless a later stage has no dependency and is explicitly selected as an isolated diagnostic.
2. One stage at a time. Do not mark the next stage PASS from upstream documentation.
3. Every test uses a fresh isolated OpenClaw state directory unless the capability being tested is persistence/session reuse.
4. No production `main` writes, no hosted database mutation, and no provider call unless that exact stage requires it.
5. No secret value may appear in repository files, task payloads, artifacts, logs or summaries.
6. Paid/provider stages use one bounded call, record safe evidence, and stop for analysis before any retry.
7. Authenticated browser tests never attempt CAPTCHA bypass, 2FA bypass, passkey bypass or account recovery automation.
8. Device/channel stages are `BLOCKED`, not failed, until a real target is available.
9. A native OpenClaw capability that passes acceptance should be reused by Final 48 unless our Kernel requires an additional deterministic policy/accounting wrapper.

## Final 48 reuse decision

After each PASS, classify the capability as one of:

- `REUSE_NATIVE` — use OpenClaw as-is behind Kernel policy.
- `WRAP_NATIVE` — keep OpenClaw execution but add our Kernel/Evidence/accounting guard.
- `KEEP_CUSTOM` — our existing implementation provides a required invariant OpenClaw does not provide.
- `REPLACE_CUSTOM` — retire duplicated custom implementation only after parity and rollback proof.

No custom Final 48 component is removed solely because OpenClaw documents a similar feature.

## Risks and control

- **Duplicate engineering:** prevented by this acceptance ledger and the `REUSE_NATIVE / WRAP_NATIVE / KEEP_CUSTOM / REPLACE_CUSTOM` decision after every PASS.
- **False confidence from CLI presence:** command discovery is inventory only; functional PASS requires execution evidence.
- **Candidate contaminating Final 48:** candidate state, workflows and tests stay isolated until explicit promotion.
- **Paid-call loops:** exactly one bounded provider execution per paid gate before analysis.
- **Credential leakage:** secrets are injected only at runtime and safe artifacts contain no secret material.
- **State leakage:** every non-persistence test uses a fresh state directory and explicit cleanup.
- **Unsafe browser/device actions:** start read-only/harmless; state-changing acceptance comes only in controlled test targets.
- **Regression during promotion:** Final 48 deterministic CI and bounded hosted/live gates must be rerun after the actual runtime pin changes.
