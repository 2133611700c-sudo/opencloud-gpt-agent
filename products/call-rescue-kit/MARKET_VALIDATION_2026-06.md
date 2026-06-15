# Call Rescue Kit — Evidence-First Market Validation

Date: 2026-06-15
Status: NOT VALIDATED / NO SALES AUTHORIZED
Owner: ChatGPT operating lead

## Executive verdict

The underlying problem is real: home-service companies receive high-intent phone leads, missed calls can hurt responsiveness, and major field-service platforms now ship AI reception and call-recovery features.

The original generic offer — "AI answers missed calls" for a $1,500 setup fee — is not sufficiently differentiated. The category is rapidly commoditizing through Goodcall, Jobber, Housecall Pro, ServiceTitan, CallRail, Retell, Vapi, Twilio, and similar vendors.

The project must not be sold as software access. It may only proceed as a narrow, measurable revenue-recovery implementation for a defined segment that lacks an existing solution.

## Current evidence

### Problem evidence

1. Google Local Services Ads says responsiveness affects ranking and missed calls may negatively affect responsiveness.
2. Invoca's 2025 home-services benchmark is based on analysis of more than 60 million calls, confirming that call handling and conversion are material operating metrics.
3. ServiceTitan provides call auditing, unbooked/abandoned-call reporting, and an AI Voice Agent, confirming that contractors pay to measure and recover call opportunities.

### Competition evidence

1. Goodcall publishes low-cost self-service AI phone-agent plans.
2. Jobber offers AI Receptionist as an add-on or included feature on higher plans.
3. Housecall Pro markets CSR AI for 24/7 answering and booking.
4. ServiceTitan offers a native AI Voice Agent for eligible home-service customers.
5. Retell, Vapi, and Twilio make custom voice deployments inexpensive enough that software access alone cannot justify a large setup fee.

## Revised product hypothesis

Sell a managed 14-day lost-lead recovery pilot, not an AI receptionist.

The pilot must:

- establish a baseline from the client's real call logs;
- identify missed, abandoned, and after-hours calls;
- implement fallback handling only where the current process fails;
- qualify callers using a narrow approved script;
- route emergency and non-emergency requests correctly;
- produce a daily evidence report;
- calculate recovered opportunities without claiming revenue that cannot be attributed;
- include a human fallback and failure log.

## Initial target profile

The first target segment remains a hypothesis until the 100-company audit is complete.

Required characteristics:

- U.S. residential plumbing or HVAC company;
- approximately 2–15 field workers;
- owner-led or small office team;
- evidence of paid lead generation or high inbound-call dependence;
- no visible 24/7 live answering solution;
- no visible AI receptionist or integrated booking workflow;
- no ServiceTitan/Jobber/Housecall Pro voice feature already solving the problem;
- average job economics capable of covering a $750–$1,250 pilot from one or a few recovered jobs.

Automatic exclusions:

- enterprise or multi-state operator;
- visible 24/7 call center;
- existing AI receptionist;
- strong online booking plus live chat plus same-day dispatch;
- no reliable public contact path;
- unverifiable company identity;
- evidence based only on malformed page text or scraper artifacts.

## Pricing hypotheses to test

No price is final before interviews.

- Option A: $750 fixed 14-day pilot.
- Option B: $1,000 fixed pilot with setup and reporting.
- Option C: $1,250 implementation with 30 days of monitoring.
- Ongoing support hypothesis: $199–$299/month, with telephony and AI usage paid directly by the client or passed through at cost.

The former $1,500 founding package is suspended until proof exists that the implementation creates measurable value beyond a commodity subscription.

## Validation stages

### Stage 0 — market map

Deliverables:

- competitor matrix with product, price, target segment, integration depth, and implementation burden;
- 100-company audited sample across at least five metros;
- percentage with existing 24/7 answering, AI receptionist, online booking, live chat, and weak fallback handling;
- shortlist of at least 20 companies with manually verified pain signals.

Pass gate:

- at least 20% of the audited sample matches the strict target profile.

Kill/pivot gate:

- fewer than 10% match the strict profile, or most prospects already receive equivalent functionality from their field-service platform.

### Stage 1 — problem interviews

Deliverables:

- at least 10 owner/manager conversations;
- documented current call process, missed-call volume, after-hours policy, average job value range, existing software, and buying objections;
- no fabricated revenue-loss estimate.

Pass gate:

- at least three qualified owners confirm the problem is active and costly, or one owner agrees to a paid pilot.

Kill/pivot gate:

- fewer than three qualified confirmations after 20 completed owner conversations.

### Stage 2 — demonstration

Deliverables:

- live demo number;
- approved emergency/non-emergency script;
- human handoff;
- structured lead record;
- daily report;
- failure and hallucination logging;
- test set covering accents, silence, interruptions, repeated questions, transfer failure, spam, and unsupported requests.

Pass gate:

- at least 95% correct routing on the controlled test set;
- zero fabricated prices, availability, licenses, guarantees, or emergency advice.

### Stage 3 — paid pilot

Deliverables:

- signed scope;
- client-owned or client-approved communication account;
- baseline call data;
- implementation;
- final evidence report.

Pass gate:

- one paid pilot and at least one attributable recovered qualified opportunity.

Scale gate:

- two paid pilots with acceptable delivery cost and no material safety or routing failure.

## First-month revenue probability

Current state: domain not deployed, no live demo, no case study, no verified sending identity, no owner interviews.

Estimated probability of $2,500 revenue in the first 30 days from the current state: 10–20%.

Estimated probability after completing Stage 0, a production-grade demo, and 100 manually qualified prospects: 25–35%.

These are planning estimates, not promises.

## Cost controls

- No paid advertising during validation.
- No new GitHub repository unless code isolation or client confidentiality requires it.
- No paid telephony scale before the controlled demo passes.
- No customer-specific vendor cost before payment or written approval.
- No public launch before domain, privacy disclosures, terms, and communication compliance are reviewed.
- Initial validation cash cap remains $100.

## Communication controls

- The setup mailbox `2133611700uscis@gmail.com` is for service registration and recovery only.
- Do not use an address containing `uscis` for commercial outreach.
- No automated outreach, form submission, SMS, calls, or public posting.
- Every recipient and message must be individually verified before any send authorization.

## Immediate work order

1. Build the competitor matrix from current official pricing and product documentation.
2. Replace the current weak website classifier with a strict evidence schema.
3. Audit 100 companies across five metros.
4. Manually review the top 20.
5. Build the controlled demo only if Stage 0 passes.
6. Prepare interview outreach only after the evidence package is complete.

## Required evidence format

Every claimed milestone must include:

- commit SHA;
- source URLs or captured public evidence;
- workflow/run ID when automation is used;
- counts before and after manual review;
- explicit list of unverified assumptions;
- money spent;
- messages sent;
- current gate status.
