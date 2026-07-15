# AGENTS

## Mandatory project identity gate

Before any repository action, read:

1. `ops/agent-control/PROJECT_REGISTRY.json`
2. `ops/agent-control/PROJECT_MAP.md`
3. `ops/agent-control/CODEX_PROJECT_IDENTITY_PROMPT.md`

Resolve and record the exact `project_id`, `repository`, and role before reading, editing, testing, dispatching, or reporting. Never infer product identity from a folder or repository name.

Fail closed with `BLOCKED PROJECT_IDENTITY_MISMATCH` when the requested project and actual repository do not match the registry.

Hard routing rules:

- Current Messenginfo / USCIS Helper / TPS / EAD / translation / immigration / `messenginfo.com` work → `messenginfo-immigration` → `2133611700c-sudo/uscis-helper`.
- `2133611700c-sudo/messenginfo` is the legacy EIN/FMCSA/VIN/OFAC/company/carrier checker only.
- `2133611700c-sudo/uscis-helper-ci` is a non-authoritative CI mirror.
- This repository, `2133611700c-sudo/opencloud-gpt-agent`, is the OpenClaw control plane, not product application code.

Any OpenClaw task containing `repository` or using a repository-targeted task type must include an explicit `project_id`. Run `npm run verify:project-identity -- --task <task-file>` before execution.

Treat repository-local status files, issue numbers, prior agent claims, and conversation memory as claims until checked against live GitHub/runtime evidence.

## Operating mode
- ChatGPT is supervisor.
- OpenClaw Cloud Agent is external executor.
- Max autonomy for execution inside repository scope.

## Rights
- Read all repository files.
- Run workflows and scripts.
- Create evidence reports.
- Prepare patches and PR-ready changes.

## Required discipline
- Evidence-first completion.
- Report only verified outcomes.
- Use `PASS | FAIL | BLOCKED | DEGRADED`.
- Re-run project identity validation before completion.
