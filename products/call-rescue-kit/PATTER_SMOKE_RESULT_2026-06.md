# Patter SDK Smoke-Test Result

Date: 2026-06-15
Latest evidence run: 27576996077
Status: PARTIAL PASS

## Verified

- `getpatter@0.6.8` installed successfully on Node.js 22.
- Package metadata reports MIT license.
- Core exports `Patter`, `Twilio`, and `OpenAIRealtime` were present.
- npm production audit reported zero known vulnerabilities at test time.
- Audit metadata reported 70 production and 36 optional dependencies.
- Installed code supports disabling telemetry through environment variables and a constructor option.
- No real credentials, call, message, customer action, or spending were involved.

## Dependency footprint

- 176 nested dependency nodes;
- 108 unique name/version combinations;
- 107 unique package names;
- 4,288 installed files;
- approximately 758,312 KB for `node_modules`;
- one direct dependency: `getpatter@0.6.8`.

The package is materially heavier than a minimal Twilio-to-Realtime bridge. This creates supply-chain, update, startup, and deployment-size risk.

## Constructor test

The first construction test stopped at carrier validation because the Twilio adapter requires an account identifier before creating the carrier object. This does not show a telemetry failure. The next test uses non-production placeholder configuration and performs no network call.

## Not yet verified

- successful Patter construction with telemetry disabled;
- local call simulation;
- carrier webhook operation;
- model connection;
- interruption and transfer behavior;
- recording and retention controls;
- production latency and concurrency;
- transitive-license compatibility.

## Decision

Patter remains the leading candidate but is not approved as the final production foundation. It must still pass telemetry-disabled construction and a no-phone local simulation, and its operational burden must be compared with a minimal official transport implementation.
