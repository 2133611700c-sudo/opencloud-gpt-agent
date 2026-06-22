# ChatGPT -> GitHub -> OpenClaw Architecture

Status: ACTIVE

## Purpose

This repository supports one control loop:

`ChatGPT -> GitHub -> OpenClaw`

Everything in this repo should reinforce that path, not create parallel agent architectures.

## Control plane

1. ChatGPT prepares a safe task definition.
2. GitHub stores the task and optional dispatch request in this repository.
3. GitHub Actions validates and executes the exact task.
4. OpenClaw performs the browser or runner work.
5. Evidence is written back to the repository.
6. ChatGPT reads the evidence and decides the next step.

## Repository entrypoints

- Task files: `ops/agent-control/tasks/*.json`
- Dispatch files: `ops/agent-control/dispatch/*.json`
- Dispatch workflow: `.github/workflows/openclaw-chatgpt-dispatch.yml`
- Runner workflow: `.github/workflows/openclaw-task-runner.yml`
- Latest machine-readable state: `ops/agent-control/reports/openclaw-latest.json`
- Human-readable status ledger: `ops/agent-control/STATUS.md`
- Contract: `ops/agent-control/OPENCLAW_CLOUD_AGENT_CONTRACT.md`

## Approved execution paths

### Path A: ChatGPT dispatch file

1. ChatGPT creates a task JSON under `ops/agent-control/tasks/`.
2. ChatGPT creates a dispatch JSON under `ops/agent-control/dispatch/`.
3. A push triggers `openclaw-chatgpt-dispatch.yml`.
4. The dispatch workflow calls `openclaw-task-runner.yml` with the exact `task_file`.
5. The runner uploads artifacts and commits evidence.

This is the primary architecture for ChatGPT-driven execution.

### Path B: Direct task push

1. ChatGPT creates a task JSON with `"status": "pending"`.
2. A push triggers `openclaw-task-runner.yml`.
3. The runner executes only that exact task file.

This path exists as a fallback, but it is secondary to explicit dispatch.

### Path C: Workflow dispatch

1. ChatGPT or the control UI calls `workflow_dispatch`.
2. The workflow runs the exact `task_file`.

This path is allowed for controlled operator use and the production control UI.

## Non-goals

The following are out of scope for this repository architecture:

- direct ChatGPT -> OpenClaw execution without GitHub audit trail
- direct writes to `main` outside the defined task/dispatch/evidence flow
- customer actions
- paid ads changes
- public posting
- destructive actions
- unrelated multi-agent orchestration patterns

## Safety rules

- The exact task file must be explicit.
- No workflow may choose tasks by last-modified time.
- Duplicate dispatch and task-push execution for the same task must be suppressed.
- Evidence must be committed back to GitHub.
- Final status must be one of `PASS`, `FAIL`, `BLOCKED`, or `DEGRADED`.
- ChatGPT should treat `openclaw-latest.json` and the managed OpenClaw block in `STATUS.md` as the current truth.

## Audit trail

Every valid run should leave these handles:

- task file path
- optional dispatch file path
- GitHub Actions run URL
- artifact name
- report file path
- latest summary in `openclaw-latest.json`
- managed current-status block in `STATUS.md`
- evidence commit SHA

## Current proof points

- Dispatch workflow present: `.github/workflows/openclaw-chatgpt-dispatch.yml`
- Runner workflow present: `.github/workflows/openclaw-task-runner.yml`
- Current latest status file: `ops/agent-control/reports/openclaw-latest.json`
- Current latest task in status ledger: `OC-EXAMPLE-COM-AUDIT-20260621-01`
- Current latest successful run URL:
  `https://github.com/2133611700c-sudo/opencloud-gpt-agent/actions/runs/27934530183`

## Completion rule

This architecture is working only when ChatGPT can:

1. create or trigger an exact task,
2. observe the GitHub run,
3. read evidence from the repository,
4. report the outcome without guessing.
