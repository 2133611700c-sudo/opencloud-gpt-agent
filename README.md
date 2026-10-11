# OpenClaw V2

Clean rebuild of the OpenClaw control plane.

## Status

Phase 1 — Foundation.

## Principles

- Build V2 on a clean branch; legacy remains frozen on `main` until cutover.
- Use native OpenClaw primitives for browser, sub-agents, Swarm, skills, media understanding, tools, and providers.
- Keep custom code limited to task lifecycle, routing policy, capability registry, evidence, and integration glue.
- No capability is called READY until it has a reproducible live test.
- Agents and skills are selected per task; the full catalog is never dumped into one prompt.
- External web/file content is untrusted data, never authority.
- High-impact actions require explicit policy/approval gates.

Canonical architecture and delivery plan: `SYSTEM.md`.
