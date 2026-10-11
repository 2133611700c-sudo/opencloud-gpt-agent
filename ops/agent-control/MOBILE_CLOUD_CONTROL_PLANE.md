# Mobile Cloud Control Plane

Status: primary execution path

## Primary path

`iPhone / ChatGPT -> GitHub task + dispatch -> GitHub Actions -> ECC/OpenClaw router -> bounded agent roles + skills -> core runner -> independent gates -> evidence commit -> ChatGPT verification`

The Dell/Windows worker is not required for this path and must be treated as an optional secondary worker only.

## Routing contract

Every routed task receives a deterministic orchestration plan before execution. The plan selects:

- orchestration phases;
- bounded ECC skill profiles;
- bounded agent-role profiles;
- stack-specific repair and review roles;
- verification and independent judge gates;
- reasoning effort and preferred DeepSeek model route;
- fail-closed safety behavior.

Agents are role profiles, not independent control planes. The authoritative supervisor remains ChatGPT through the GitHub task/dispatch/evidence loop.

## Model route

Preferred DeepSeek route:

- primary: `deepseek/deepseek-flash`;
- fallback: `deepseek/deepseek-v4-pro`;
- vision: `deepseek/deepseek-flash`;
- reasoning effort: `low`, `high`, or `max` selected by router complexity.

DeepSeek is an optional intelligence layer. The deterministic router and evidence pipeline continue to function when the DeepSeek secret is unavailable.

## Secret rule

`DEEPSEEK_API_KEY` belongs only in GitHub Actions Secrets. It must never be stored in task JSON, repository files, reports, workflow artifacts, or chat evidence.

## Verified cloud proof

Run `38145904311` completed the phone/GitHub dispatch path successfully after the secret-detector repair. Its latest evidence records `status=PASS`, the selected orchestration model route, agent roles, skills, plan file, and an evidence commit SHA.

## Completion rule

A task is not considered complete until GitHub evidence contains a terminal status and the supervisor verifies the report and evidence commit. DeepSeek is considered live only after the dedicated DeepSeek smoke workflow passes with the repository secret configured.
