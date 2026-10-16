# AGENTS

## Mandatory session start
1. Read `ops/agent-control/CANONICAL_ENGINEERING_MEMORY.md` first. Its rules are the permanent operating contract for ChatGPT/OpenClaw work in this repository.
2. Read `ops/agent-control/ACCESS_REGISTRY.md` next so credential names, native storage locations, consumers, and verification states are known before asking the owner to rediscover anything.
3. For OpenClaw V2 work, use the V2 canonical router/state on the active V2 branch: `START_HERE.md` -> `PROJECT_STATE.json` -> latest `docs/RESULTS_JOURNAL.md` checkpoint -> exact HEAD/CI/runtime evidence.
4. If working in the legacy control-plane scope instead, read `ops/agent-control/STATUS.md` from the first line and treat its `SUPERVISOR BOARD — READ FIRST` section as the current orientation board.
5. Select work only after the relevant project map is reconciled with current repository/runtime evidence.
6. After verification, update all affected canonical memory/state/journal/access artifacts in the same work cycle before starting another material action.

## Operating mode
- ChatGPT is supervisor.
- OpenClaw Cloud Agent is external executor where that control plane is used.
- Max autonomy for execution inside repository scope.
- Use parallel agents/subagents/tools when the task can be decomposed, but retain central supervision and evidence review.

## Rights
- Read all repository files.
- Run workflows and scripts.
- Create evidence reports.
- Prepare patches and PR-ready changes.

## Required discipline
- Evidence-first completion.
- Report only verified outcomes.
- Use `PASS | FAIL | BLOCKED` plus the more precise V2 evidence labels where defined.
- Do not invent missing facts or modify during diagnosis before the system is understood.
- Do not ask the owner to re-find known credentials before checking `ACCESS_REGISTRY.md` and the available native secret/runtime path.
- Keep `CANONICAL_ENGINEERING_MEMORY.md` continuously updated when confirmed rules, lessons, errors, architecture changes, acceptance criteria, or prohibitions change.
- Keep `ACCESS_REGISTRY.md` continuously updated when credential references, storage locations, consumers, or verification states change.
