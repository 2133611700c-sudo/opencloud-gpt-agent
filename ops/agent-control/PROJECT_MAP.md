# Canonical Project Identity Map

This file prevents repository-name confusion. It is subordinate only to `PROJECT_REGISTRY.json`, which is the machine-readable authority.

## Final routing table

| Project ID | Repository | Role | Rule |
|---|---|---|---|
| `messenginfo-immigration` | `2133611700c-sudo/uscis-helper` | Active current product | All current Messenginfo, USCIS Helper, TPS, EAD, translations, immigration self-help, and `messenginfo.com` work goes here. |
| `messenginfo-legacy-company-checker` | `2133611700c-sudo/messenginfo` | Legacy separate product | Use only for the old EIN/FMCSA/VIN/OFAC/company/carrier checker. Never use for current Messenginfo immigration work. |
| `uscis-helper-ci-mirror` | `2133611700c-sudo/uscis-helper-ci` | Non-authoritative CI mirror | Never make canonical product edits or decisions here. |
| `openclaw-control-plane` | `2133611700c-sudo/opencloud-gpt-agent` | Control plane | Holds ChatGPT/OpenClaw task dispatch, evidence, validation, and operational control. It is not the product codebase. |

## Non-negotiable resolution rule

A folder/repository name is not proof of product identity. Before action, the agent must:

1. Resolve `project_id` from `PROJECT_REGISTRY.json`.
2. Verify the exact `owner/repository`.
3. Verify at least one identity marker from the registry.
4. State the resolved project ID and repository in the task/evidence.
5. Fail closed on mismatch.

For any request containing current **Messenginfo**, **USCIS Helper**, **TPS**, **EAD**, **translation**, **immigration**, or **messenginfo.com**, the only valid canonical repository is:

`2133611700c-sudo/uscis-helper`

## Truth hierarchy

1. Live repository/runtime evidence.
2. `PROJECT_REGISTRY.json` for cross-repository identity.
3. Repository-local `PROJECT_IDENTITY.md`.
4. `AGENTS.md`, `STATUS.md`, `HANDOFF.md`, `SOURCE_OF_TRUTH.md`, ADRs.
5. Conversation memory and repository/folder names.

Issue numbers and status documents are not self-validating. A missing or contradictory live issue makes the reference `UNVERIFIED` or stale, never canonical.
