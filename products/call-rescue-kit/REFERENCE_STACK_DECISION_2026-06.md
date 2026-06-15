# Call Rescue Kit — Reference Stack Decision

Date: 2026-06-15
Status: Patter selected for isolated feasibility testing; no production integration authorized yet

## Decision

Use an existing licensed voice-agent foundation rather than building telephony and realtime audio handling from scratch.

Primary candidate: **Patter** (`PatterAI/Patter`), consumed as a version-pinned dependency rather than copied wholesale.

Secondary candidate: **Dograh** (`dograh-hq/dograh`) for studying visual workflows, provider abstraction, self-hosting, and operational UX.

Reference-only sources:

- `openai/openai-realtime-twilio-demo` for the official Twilio ↔ OpenAI Realtime transport pattern.
- `room4-2/OpenConverse` for a small Go-based Twilio ↔ Gemini Live implementation.
- `kirklandsig/AIReceptionist` for receptionist-specific call-transfer, business-hours, FAQ, SIP, and multi-business patterns.

## Candidate assessment

### 1. Patter — selected for smoke test

Repository: `https://github.com/PatterAI/Patter`
License: MIT
Observed maturity at review time:

- 133 commits;
- 613 stars;
- 66 forks;
- 16 releases;
- latest visible release: v0.6.8 dated 2026-06-13;
- Python and TypeScript SDKs;
- Twilio, Telnyx, and Plivo support;
- OpenAI Realtime, Gemini Live, Ultravox, and ElevenLabs ConvAI support;
- provider-neutral STT/LLM/TTS pipeline support;
- call transfer, guardrails, provider fallback, OpenTelemetry tracing, local simulation, and cost/latency dashboard support.

Why it leads:

- permissive license compatible with a proprietary commercial layer;
- avoids dependence on one carrier or one voice model;
- small integration surface compared with forking a full platform;
- recent releases and active development;
- local call simulation may reduce paid telephony testing;
- built-in traces and provider switching support the evidence-first operating model.

Risks:

- still early-stage software;
- public README claims require independent smoke tests;
- telemetry must be disabled or explicitly reviewed;
- API stability and production load behavior are unverified;
- package dependency creates upstream maintenance risk;
- security, data retention, call recording, and failure behavior remain our responsibility.

Decision: proceed to an isolated dependency/import test. Do not connect a phone number or production credentials yet.

### 2. Dograh — architecture and UX reference

Repository: `https://github.com/dograh-hq/dograh`
License: BSD 2-Clause
Observed maturity at review time:

- 547 commits;
- 4.4k stars;
- 928 forks;
- 43 releases;
- latest visible release: v1.35.0 dated 2026-06-12;
- Python and TypeScript codebase;
- self-hosting with Docker;
- visual workflow builder;
- telephony and multiple speech/model providers;
- security policy and deployment documentation.

Strengths:

- largest and most mature candidate reviewed;
- permissive license;
- complete platform and visual workflow model;
- strong provider flexibility and self-hosting story.

Risks:

- much larger operational footprint than the current product requires;
- forking a platform would create a large maintenance burden;
- anonymous telemetry is enabled unless disabled;
- complex infrastructure may conflict with the $100 validation budget;
- adopting its entire UI/backend would delay market validation.

Decision: do not fork now. Use only as a reference for workflow design, provider abstraction, deployment controls, and operational UI.

### 3. OpenAI Realtime Twilio Demo — transport reference only

Repository: `https://github.com/openai/openai-realtime-twilio-demo`
License: MIT
Observed maturity at review time:

- 5 commits;
- 527 stars;
- 180 forks;
- no releases;
- Next.js web application plus Express WebSocket server;
- bidirectional Twilio Media Stream ↔ OpenAI Realtime bridge.

Strengths:

- official reference for the core media transport;
- permissive license;
- small and easy to audit.

Risks:

- README explicitly states it is unpolished and its security practices require audit;
- function calls are mocked;
- no production data model, tenant controls, compliance layer, reporting, or operational fallback.

Decision: use to verify low-level transport assumptions only. Do not treat as a product foundation.

### 4. AIReceptionist — product-pattern reference, not proprietary base

Repository: `https://github.com/kirklandsig/AIReceptionist`
License: AGPL-3.0
Observed maturity at review time:

- 158 commits;
- 45 stars;
- 18 forks;
- no releases;
- active development warning;
- OpenAI Realtime + LiveKit + SIP architecture;
- inbound calls, FAQ answering, transfers, message taking, multi-business support, business-hours configuration.

Strengths:

- closest functional match to the target product;
- useful receptionist-specific configuration and telephony documentation;
- explicit support for multiple businesses and after-hours behavior.

Risks:

- AGPL requires source disclosure of network-served modifications;
- no formal releases;
- active development and breaking changes;
- depends on LiveKit and SIP infrastructure;
- an OpenAI Realtime authentication change on 2026-06-03 reportedly broke the previous OAuth path.

Decision: study patterns only. Do not copy code into a closed commercial service unless the project is intentionally operated under AGPL and source obligations are accepted.

### 5. OpenConverse — narrow technical reference

Repository: `https://github.com/room4-2/OpenConverse`
License: MIT
Observed maturity at review time:

- 44 commits;
- 6 stars;
- no visible product dashboard;
- Go server;
- Twilio phone mode and browser WebSocket mode;
- Gemini Live integration;
- optional Redis session persistence.

Strengths:

- small codebase suitable for audit;
- permissive license;
- useful Gemini Live and audio conversion reference;
- lower infrastructure complexity.

Risks:

- very early adoption;
- narrow server layer rather than full receptionist product;
- no visible lead management, booking, attribution, client dashboard, or compliance layer.

Decision: retain as an alternative transport reference if Patter is unstable or too heavy.

## Clean-room implementation rules

1. Keep original license and attribution notices for reused code.
2. Record exact upstream repository, commit/tag, file, and license before copying any code.
3. Prefer installing a released package over copying source files.
4. Never copy brand names, logos, proprietary text, customer data, prompts, or closed-source interface assets.
5. Do not combine AGPL code into a proprietary hosted service without an explicit licensing decision.
6. Independently test all security, privacy, call-routing, recording, retention, and failure behavior.
7. Pin dependency versions and maintain an upstream-change register.

## Proposed product architecture

Use Patter for the voice transport/provider layer only.

Build our own narrow commercial layer:

- tenant and business configuration;
- plumbing/HVAC approved intake schema;
- emergency/non-emergency routing policy;
- business-hours and fallback logic;
- consent/recording disclosure configuration;
- structured lead and call-event storage;
- human handoff and transfer failure recovery;
- evidence report and recovered-opportunity attribution;
- client-facing audit dashboard;
- operational error, latency, and cost controls;
- state-specific compliance settings;
- official-license/entity verification for prospect qualification.

## Feasibility gates

### Gate A — dependency smoke test

- install a pinned Patter version in a clean environment;
- import TypeScript SDK successfully;
- instantiate configuration without production credentials;
- verify telemetry can be disabled;
- verify local simulation or test mode is available;
- record transitive dependency count and install warnings.

### Gate B — controlled voice test

Only after Gate A passes:

- connect test credentials;
- run a synthetic inbound-call scenario;
- measure first-response latency;
- test interruption handling, silence, repeated questions, transfer failure, and unsupported requests;
- confirm no invented prices, availability, or emergency instructions.

### Gate C — product-layer prototype

Only after the market-validation sample passes:

- implement one plumbing/HVAC intake flow;
- produce a structured lead record and daily evidence report;
- validate human handoff;
- calculate actual per-minute and per-lead infrastructure cost.

## Current status

- Product-market validation: not complete.
- Production voice stack: not selected finally.
- Preliminary reference-stack leader: Patter.
- Money spent: $0.
- Messages sent: 0.
- Phone numbers purchased: 0.
- Production credentials used: 0.
