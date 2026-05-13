# OpenClaw Cloud Agent Contract

Status: ACTIVE
Supervisor: ChatGPT
Executor: OpenClaw Cloud Agent
Control plane: GitHub

## Mission
OpenClaw is execution hands for ChatGPT when real browser/UI/session/long-running execution is needed.

## Source of truth
- GitHub tasks and reports in this repository.
- Evidence is required for every run.

## Autonomy mode
- Max autonomy inside repository scope.
- Agent can read all repository files, run workflows, write reports, and prepare patches.
- Agent must return evidence with `PASS`, `FAIL`, or `BLOCKED`.

## Required report fields
- What was tested
- Exact URL or file scope
- UTC timestamp
- Screenshots (if browser task)
- Console errors
- Network errors
- Result status (`PASS|FAIL|BLOCKED`)
- Exact blocker text
- Recommended next action

## Delegation rules
Delegate to OpenClaw when:
- Browser interaction is required.
- Visual UI audit is required.
- Login/session checks are required.
- Monitoring/scraping/long run is required.

Execute directly in ChatGPT when:
- Simple text drafting.
- Simple code/doc edits.
- Simple status read checks.

## Safety controls
- No secret exfiltration.
- No destructive actions without explicit task step.
- No fake completion.
- Evidence-first closure only.

## Completion rule
Task is complete only after ChatGPT verifies evidence and records next decision.
