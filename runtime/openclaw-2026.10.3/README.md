# OpenClaw 2026.10.3 Sidecar

## Purpose

This directory defines the isolated OpenClaw `2026.10.3` candidate lane that runs beside the existing Final 48 runtime.

The Final 48 path remains unchanged and pinned to OpenClaw `2026.9.8` until its own closure route is complete. This sidecar is intentionally additive: it proves that the current OpenClaw V2 Research contract can coexist with and validate against the newer stable OpenClaw runtime without replacing the already-proven Final 48 execution path.

## Exact candidate pins

- Core: `openclaw@2026.10.3`
- DeepSeek provider: `@openclaw/deepseek-provider@2026.10.3`
- DuckDuckGo plugin: `@openclaw/duckduckgo-plugin@2026.10.3`
- Official release tag: `v2026.10.3`
- Official GitHub release ID: `411695418`
- Release status: stable (`prerelease=false`)

## Compatibility gate

The dedicated workflow `.github/workflows/v2-openclaw-2026-10-3-sidecar.yml` verifies, without any paid model call or hosted database mutation:

1. the existing Final 48 foundation validator still passes;
2. the existing Node test suite still passes;
3. the existing health check still passes;
4. exact OpenClaw `2026.10.3` installs successfully;
5. exact matching DeepSeek and DuckDuckGo plugins install successfully;
6. the candidate state directory is isolated and contains no stored DeepSeek auth profile;
7. the current Research `agent exec` CLI flags remain available;
8. the current generated Research config validates under OpenClaw `2026.10.3`;
9. core operational CLI surfaces remain present.

A successful run is `PASS_CODE_CI` evidence for compatibility only. It is not `PASS_LIVE`, does not replace the historic `2026.9.8` runtime proof, and does not authorize production cutover.

## Integration rule

The sidecar must stay isolated from Final 48 until Final 48 is closed. After that closure, promotion of `2026.10.3` requires a separate route that changes the actual runtime pins, reruns deterministic CI, then performs one bounded hosted/live compatibility gate before the new runtime can become canonical.

## Risks and control

- **Runtime contract drift:** detect by validating the existing generated Research config and exact `agent exec` flags against `2026.10.3`.
- **Plugin version mismatch:** core and both official plugins are pinned to the same exact release.
- **Credential contamination:** the candidate uses a fresh isolated state directory and verifies no stored DeepSeek profile.
- **Accidental paid call:** the sidecar workflow receives no provider secret and invokes no model.
- **Final 48 regression:** the existing Final 48 files and `2026.9.8` pins are not modified by this sidecar lane.
- **Premature cutover:** no canonical branch, hosted runtime, production environment, or `main` ref is changed by this work.
