# Messenginfo open PR classification — 2026-09-16

Status: PASS (read-only classification completed)

## Purpose
Reduce GitHub notification noise and prevent unsafe bulk merges by identifying which open PRs should remain, which have been replaced, and which require a focused technical decision.

## Repository basis
- repository: `2133611700c-sudo/messenginfo`
- main_sha: `fb7c7d5d54dda18c95990782443a5d60540e3d17`
- open_prs_reviewed: 16
- mutations_to_messenginfo: none
- Actions state: intentionally OFF for cost control and pending credential rotation

## Classification

| PR | Classification | Evidence-based reason |
| --- | --- | --- |
| #138 | SUPERSEDED | Stale grouped update of 26 production dependencies; conflicts with current lockfile and mixes unrelated runtime/major-version risks. |
| #139 | SUPERSEDED | Stale grouped dev update; includes Lighthouse, which was removed from main by #173, and conflicts with the current lockfile. |
| #149 | NEEDS_REVIEW | Useful supervisor/security contract, but it predates the central control-plane journal and explicitly requires owner approval; adapt instead of merging verbatim. |
| #152 | SUPERSEDED | Older OpenTelemetry/protobuf cohort; replaced by newer OpenTelemetry cohort #153. |
| #153 | NEEDS_REVIEW | Current OpenTelemetry cohort, but it contains major/breaking version jumps and cannot be accepted without compatibility tests. |
| #154 | KEEP | Focused security patch: next-auth 4.24.13 -> 4.24.15; current main still uses 4.24.13; mergeable. |
| #155 | SUPERSEDED | Updates only CodeQL init in security.yml; conflicts with #156 and should be replaced by one coherent CodeQL pin update. |
| #156 | SUPERSEDED | Updates only CodeQL analyze in security.yml; conflicts with #155 and should be replaced by one coherent CodeQL pin update. |
| #157 | NEEDS_REVIEW | Changes actions/checkout SHA across 42 workflow files and includes a documented breaking behavior change. |
| #160 | SUPERSEDED | Old lockfile-only ip-address update is no longer mergeable against the current lockfile; regenerate from current main if still required. |
| #161 | SUPERSEDED | Mixes Next 16, Sentry major, and PostCSS; Next migration is already isolated in controlled PR #172. |
| #162 | KEEP | Focused brace-expansion security backport; lockfile-only and currently mergeable. |
| #164 | KEEP | Focused nanoid patch update; lockfile-only and currently mergeable. |
| #165 | KEEP | Focused postcss-selector-parser security fix; lockfile-only and currently mergeable. |
| #166 | KEEP | Focused browserslist update based on current main and currently mergeable. |
| #172 | NEEDS_REVIEW | Controlled Next 16.3.5 migration is preferable to raw #169, but it has no CI proof while Actions are off; diff also shows `await params` in `BundleReportPage` without the function being declared `async`, a probable compile blocker. |

## Totals
- KEEP: 5 — #154, #162, #164, #165, #166
- SUPERSEDED: 7 — #138, #139, #152, #155, #156, #160, #161
- NEEDS_REVIEW: 4 — #149, #153, #157, #172

## Verification limits
- Classification is based on live PR metadata/diffs and current main files.
- No install, build, test, workflow, merge, close, label, or branch deletion was performed.
- Because Actions are intentionally OFF, no PR is considered verified for merge solely from this classification.

## One next action
Inspect PR #172 only, correct the static Next 16 migration blocker on its existing branch, and verify the changed source surface without enabling repository Actions.
