# Patter SDK Smoke-Test Result

Date: 2026-06-15
Workflow run: 27576584547
Status: PARTIAL PASS

## Verified

- `getpatter@0.6.8` installed successfully on Node.js 22.
- Package metadata reports MIT license.
- Core exports `Patter`, `Twilio`, and `OpenAIRealtime` were present.
- No credentials, phone number, call, message, customer action, or spending were involved.

## Dependency footprint

Captured dependency tree:

- 176 nested dependency nodes;
- 108 unique name/version combinations;
- 107 unique package names;
- one direct dependency: `getpatter@0.6.8`.

This is heavier than a minimal Twilio to Realtime bridge and creates supply-chain, update, startup, and vulnerability-management risk.

## Not yet verified

- telemetry disabled at runtime;
- local call simulation;
- carrier webhook operation;
- model connection;
- interruption and transfer behavior;
- recording and retention controls;
- production latency and concurrency;
- vulnerability and transitive-license audit.

## Decision

Patter remains the leading candidate but is not approved as the final production foundation. The next test must capture dependency audit output, verify telemetry-off operation, and compare the operational burden with a minimal official transport implementation.
