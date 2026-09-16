# Messenginfo PR #172 static correction — 2026-09-16

Status: DEGRADED

## Purpose
Remove the confirmed static compile blocker from the controlled Next.js 16.3.5 migration while keeping repository Actions disabled and avoiding production changes.

## Repository basis
- repository: `2133611700c-sudo/messenginfo`
- PR: #172
- branch: `security/fix/next-16.3.5-verify`
- head_before: `aa3c7d0cead91199611a26f5b710c1a127081605`
- head_after: `af8b6b04a0be148c81033e9bca144fe48c561f67`
- correction_commit: `af8b6b04a0be148c81033e9bca144fe48c561f67`

## Confirmed defect and correction
- File: `app/(public)/bundle/[reportId]/page.tsx`
- Before: synchronous `BundleReportPage` used `await params`.
- After: function declaration is `export default async function BundleReportPage(...)`.
- Scope: one source-line change; no dependency, lockfile, workflow, secret, deployment, or production change.

## Static verification
- Reviewed all 13 changed source/config files in PR #172.
- All other changed page and route handlers that await `params` are declared `async`.
- Declared/resolved Next version: `16.3.5`.
- Next engine requirement from lockfile: Node `>=20.9.0`.
- Repository runtime declarations: `.nvmrc=20`, `engines.node=20.x`.
- React and React DOM resolve to `18.2.0`; Next 16.3.5 lockfile peer range explicitly accepts `^18.2.0`.
- Scripts use `next dev --webpack`, `next build --webpack`, `eslint .`, and `tsc --noEmit`.
- PR remains draft, open, and mergeable after the correction.

## Verification limit
- Full install/typecheck/test/build: `UNVERIFIED`.
- Local shell has no authenticated private-repository checkout path (`git ls-remote` failed without credentials).
- Repository Actions remain intentionally OFF for cost control and pending credential rotation.
- Therefore PR #172 must not be merged yet.

## One next action
Close only the first two clearly superseded grouped dependency PRs (#138 and #139) with an evidence-based superseded note; do not touch KEEP or NEEDS_REVIEW PRs.
