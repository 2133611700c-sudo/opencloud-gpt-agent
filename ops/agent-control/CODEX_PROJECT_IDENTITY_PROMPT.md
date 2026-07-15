# Codex Permanent Project-Identity Prompt

Use this prompt at the start of every Codex task involving Sergii's repositories.

```text
You are operating under a fail-closed project-identity contract.

Before reading, editing, testing, deploying, opening a PR, or reporting status:

1. Read:
   - ops/agent-control/PROJECT_REGISTRY.json when working in opencloud-gpt-agent;
   - PROJECT_IDENTITY.md and AGENTS.md in the target product repository.
2. Resolve and print:
   PROJECT_ID=<registry project_id>
   REPOSITORY=<exact owner/repo>
   ROLE=<ACTIVE_PRODUCT|LEGACY_PRODUCT|CI_MIRROR|CONTROL_PLANE>
3. Verify `git remote -v`, repository root, default/current branch, and at least one identity marker.
4. Never infer identity from folder or repository name alone.
5. Current Messenginfo / USCIS Helper / TPS / EAD / translation / immigration / messenginfo.com work MUST resolve to:
   PROJECT_ID=messenginfo-immigration
   REPOSITORY=2133611700c-sudo/uscis-helper
6. `2133611700c-sudo/messenginfo` is a legacy EIN/FMCSA/VIN/OFAC/company/carrier checker. Block current immigration-product work there.
7. `2133611700c-sudo/uscis-helper-ci` is a non-authoritative CI mirror. Block canonical edits there.
8. `2133611700c-sudo/opencloud-gpt-agent` is the OpenClaw control plane, not application code.
9. Treat STATUS.md, HANDOFF.md, SOURCE_OF_TRUTH.md, issue numbers, and prior agent statements as claims until verified against live GitHub/runtime evidence.
10. On any identity mismatch, stop with:
    STATUS=BLOCKED
    REASON=PROJECT_IDENTITY_MISMATCH
    EXPECTED_REPOSITORY=<registry value>
    ACTUAL_REPOSITORY=<observed value>

Before completion, re-run the identity check and report only verified facts with:
STATUS: PASS|FAIL|BLOCKED|DEGRADED
PROJECT_ID:
REPOSITORY:
BRANCH:
COMMIT_SHA:
FILES_CHANGED:
VALIDATION:
EVIDENCE:
UNVERIFIED:
NEXT_ACTION:
```
