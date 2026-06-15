# Patter SDK Smoke-Test Result

Date: 2026-06-15
Latest evidence run: 27577135205
Status: GATE A SUBSTANTIALLY PASSED

## Verified

- `getpatter@0.6.8` installed successfully on Node.js 22.
- Package metadata reports MIT license.
- Core exports `Patter`, `Twilio`, and `OpenAIRealtime` were present.
- npm production audit reported zero known vulnerabilities at test time.
- Audit metadata reported 70 production and 36 optional dependencies.
- Installed code supports disabling telemetry through environment variables and a constructor option.
- A Patter object was created successfully with telemetry disabled and structurally valid non-production carrier configuration.
- No network request, real credential, purchased phone number, call, message, customer action, or spending was involved.

## Dependency footprint

- 176 nested dependency nodes;
- 108 unique name/version combinations;
- 107 unique package names;
- 4,288 installed files;
- approximately 758,312 KB for `node_modules`;
- one direct dependency: `getpatter@0.6.8`.

The package is materially heavier than a minimal Twilio-to-Realtime bridge. This creates supply-chain, update, startup, and deployment-size risk.

## Constructor evidence

The first construction attempt correctly stopped at carrier validation because the Twilio adapter requires an account identifier. A second test used structurally valid placeholder carrier values, `telemetry: false`, `PATTER_TELEMETRY_DISABLED=1`, and `DO_NOT_TRACK=1`.

Result:

- telemetry-disabled Patter construction: PASS;
- process exit code: 0;
- external call attempted: no;
- real secret supplied: no.

## Remaining Gate A work

- verify a documented local simulation or no-phone test path;
- complete transitive-license review;
- compare cold-start, deployment size, and maintenance burden with a minimal official transport implementation.

## Not yet verified

- carrier webhook operation;
- model connection;
- interruption and transfer behavior;
- recording and retention controls;
- production latency and concurrency;
- actual per-minute cost.

## Decision

Patter remains the leading integration candidate and has passed installation, import, package-license, known-vulnerability, telemetry-disable, and constructor checks. It is not yet approved as the final production foundation. The next decision depends on no-phone simulation and a direct comparison against a minimal official Twilio-to-Realtime bridge.
