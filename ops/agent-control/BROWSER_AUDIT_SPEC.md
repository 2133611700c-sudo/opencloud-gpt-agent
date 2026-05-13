# Browser Audit Spec

## Scope
- URLs: `/`, `/book`, `/pricing`, `/services`, `/messenger`
- Viewports: desktop and mobile

## Required capture
- Full-page screenshots for each URL and viewport
- Console errors
- Failed network requests
- Phone visibility check
- CTA visibility check
- Forbidden claims check

## Output
- Report under `ops/agent-control/reports/repo-scan/<UTC_TIMESTAMP>.md`
- Status for each URL: `PASS | FAIL | BLOCKED`
- Exact blocker when blocked
