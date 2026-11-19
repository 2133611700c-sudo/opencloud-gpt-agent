# TOYOTA G10 — isolated owner approval review (2026-11-18)

**STATUS: PARTIAL / REVIEW ONLY. NOT DEPLOYED; NOT PRODUCTION READY.**

This Git branch does not replace the canonical TOYOTA source or merge code into `main`. The full G08 parent is preserved in the user's Google Drive; this branch records the exact surgical patch, its helper and its independently executed regression gate.

Original parent ZIP: `TOYOTA_BROWSER_G08_ISOLATION_REVIEW_2026-11-18.zip`.
Parent SHA-256: `6add09c0487df1311a84ad1a3c387d5e2f4daac43c61dc98430cc6cc6108e1c3`.

## Files
- `G10_HUB.patch`: precise unified diff for `toyota/hub/hub.mjs` in the G08 parent.
- `action-approval.mjs`: new module for `toyota/hub/action-approval.mjs`.
- `g10_owner_gate.mjs`: local SQLite regression test; run from G08 unpacked root after applying patch.

## Acceptance in current independent local environment
- G10 owner grant/replay/hash tests: 29/29 pass, exit 0.
- G08 isolation tests: 21/21 pass (local real Chromium, no real remote MCP).
- Concurrent browser crash/download tests: 9/9 pass (local real Chromium).
- Node syntax: 26/26 pass.
- Authentic MCP SDK: BLOCKED — npm ci --offline ENOTCACHED.
- Real HTTPS, Telegram, Drive-agent sync, and Dell WSL2 deployments: NOT VERIFIED.
- An earlier Browser Current full regression is recorded as FAILED/INCOMPLETE; missing `crash_download_child.mjs`. Do not promote old PASS statements.

## Independent evidence and readback
Archive: https://drive.google.com/file/d/1S2ichtU3343a9oCoDDGyCaKvrdnRE6JE/view
Report: https://drive.google.com/file/d/1T2QozZGzvvU74Rby_lUOgQDXd3HsWQcp/view
Archive SHA-256: `aa8366f8985944da2fb4456b079dcade05c9d6b33216268ee0b7284722909b3d`.
Report SHA-256: `46d778703c18dbca25259ef9b1807fa25f72ff6dab9bba59d7b423d9f2c2c874`.
Google Drive read-back matched both byte-for-byte.

## Risk and next step
G10 is only partially mitigated. Passive navigation can have site effects; full authenticated MCP-to-browser testing and a separate owner identity are mandatory before production cutover. Owner consent is needed for production deployment, secret changes, or webhook changes.

No production webhook or Dell processes were modified.
