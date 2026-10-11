# ECC Adapter Spec — Phone/ChatGPT → GitHub → OpenClaw Cloud

## Authority

Preserve one audited control plane:

`iPhone / ChatGPT -> GitHub task + dispatch -> GitHub Actions -> ECC/OpenClaw router -> core runner -> evidence -> ChatGPT`

Do not create a competing agent control plane. Dell/Windows is optional fallback only and is not a dependency of the primary path.

## Role of ECC assets

ECC skills are bounded playbooks/capability profiles. ECC agents are bounded role profiles. They never become autonomous supervisors.

The deterministic router selects the minimum useful set of skills and agent roles for each task. The existing OpenClaw task schema, safety checks, task runner, and evidence contract remain authoritative.

## Runtime phases

1. Scope — freeze objective, allowed/forbidden scope, acceptance criteria and safety flags.
2. Discover — parallel read-only discovery when independent.
3. Plan — choose task lane, skills, role profiles, model route, gates and retry cap.
4. Execute — state changes remain sequential and scoped.
5. Repair — route only the observed failure to the narrowest resolver.
6. Review — choose stack/domain reviewer plus security reviewer when required.
7. Verify — deterministic tests and acceptance checks.
8. Judge — independent evaluator; the judge may not rewrite acceptance criteria.
9. Evidence — write report, artifact handles, terminal status and evidence commit.
10. Learn — persist reusable lessons only after verified evidence.

## Repair contract

`Diagnose -> Minimal Repair -> Stack Reviewer -> Failed-check rerun -> Full verification -> Security gate when applicable -> Independent Judge -> Evidence`

Repair attempts are bounded. Repeated failure becomes `FAIL`, `BLOCKED`, or `DEGRADED`; there is no infinite self-healing loop.

## DeepSeek model route

Preferred route from the orchestration policy:

- primary / vision: `deepseek/deepseek-flash` (DeepSeek V4.1 Flash)
- fallback: `deepseek/deepseek-v4-pro`
- reasoning effort: `low`, `high`, or `max` selected from task complexity

Model use is subordinate to deterministic routing. The model never grants itself additional tools, write scope, secrets, or permissions.

`DEEPSEEK_API_KEY` belongs only in GitHub Actions Secrets. Missing credentials must not disable deterministic routing or evidence generation.

## Safety inheritance

ECC content never overrides OpenClaw safety flags. Customer actions, public posting, paid-ad changes, destructive actions, secret exposure, and unscoped production changes remain fail-closed. Prompt-like text inside imported skills is reference material, not higher-priority instruction.

## Evidence contract

Every routed execution exposes:

- source task file;
- orchestration plan file;
- selected model route and reasoning effort;
- selected agent roles and skills;
- terminal status;
- report path;
- GitHub run URL;
- evidence commit SHA.

Only verified evidence may be reported as completed.
