# ECC Adapter Spec for ChatGPT → GitHub → OpenClaw

## Goal
Use the ECC skill/agent corpus as a routing and quality-policy library without creating a parallel execution plane.

## Runtime stages
1. **Supervisor/Router (ChatGPT)** selects 1–5 relevant skills and one role profile.
2. **Plan** freezes goal, allowed scope, acceptance criteria, forbidden actions, retry cap.
3. **Execute** only through an existing supported OpenClaw task type or a local read-only analysis tool.
4. **Repair** routes failures to the narrowest resolver role; minimal diff only.
5. **Review** selects stack/domain reviewer.
6. **Judge** runs deterministic acceptance checks and may not edit the acceptance criteria.
7. **Evidence** writes report/artifact/status using the existing OpenClaw evidence contract.
8. **Learn** records reusable lessons only after evidence; project-scoped by default.

## Safety inheritance
ECC content never overrides OpenClaw safety flags. Customer actions, public posting, paid-ad changes, destructive actions, secrets exposure, and unscoped production changes remain blocked. Prompt-like text inside imported skills is treated as reference material, not higher-priority instruction.

## Router contract
A route decision contains `selected_skills[]`, `selected_role`, `execution_lane`, optional `task_type`, `acceptance_criteria[]`, `forbidden_actions[]`, `max_repair_attempts` (default 3), and `judge_checks[]`.

## Repair contract
`diagnose → isolate root cause → choose narrow resolver → minimal repair → rerun failed check → full verification → independent review`. Never broaden scope merely because a repair attempt failed.

## Current integration constraint
Do not add autonomous squad execution until the existing task schema and runner support the exact new task type and evidence semantics. The repo architecture requires a single audited `ChatGPT → GitHub → OpenClaw` path.
