# PHONE AGENT — ACTIVE PLAN + JOURNAL

Updated: 2026-09-03
Historical journal: `docs/PHONE_AGENT_STATE.md` (J-001..J-019).
This file is the active source of truth from J-020 onward.

## 0. MASTER RULES

1. `READ JOURNAL -> VERIFY -> ONE SMALL ACTION -> VERIFY RESULT -> JOURNAL -> NEXT`.
2. “Не получилось” не является конечным статусом. Ошибка классифицируется как `CODE`, `PROVIDER` или `BLOCKED_PRIVILEGE`; затем используется следующий независимый путь. Остановка допустима только при доказанном внешнем hard limit или действии пользователя, которое невозможно выполнить имеющимися инструментами.
3. По Call2Me сначала использовать официальные docs/OpenAPI/API responses. Не заменять первоисточник предположением.
4. Делать постоянный продукт: расширять существующие runner/workflow/agent/config. Не строить дублирующие workflow, агентов, сервисы и временные архитектурные слои без доказанной необходимости.
5. **FREE FIRST. Траты = $0.00, пока Sergii не даст НОВОЕ явное разрешение.** Предыдущая авторизация на пополнение/номер отменена более поздней инструкцией пользователя. Запрещены без нового разрешения: расход wallet, номер, paid call/plan/add-on, auto-recharge, recording, SIP/BYOC/Twilio, porting, другой платный provider.
6. Продукт считается работающим только по факту поведения:
   `SERGII REQUEST -> PHONE TASK -> UNIVERSAL AGENT -> REAL CALL -> HUMAN DIALOG -> VERIFIED FACTS -> SERGII`.

## 1. БОЛЬШАЯ ЗАДАЧА

Один универсальный исходящий AI-агент. Sergii пишет обычным языком, кому позвонить и что выяснить. Система формирует PHONE TASK, звонит, представляется как AI от имени Sergii, объясняет конкретную цель, слушает реальные ответы, задаёт логичные уточнения, завершает разговор после достижения цели и возвращает только фактически подтверждённые данные.

## 2. ЧТО УЖЕ ДОКАЗАНО

### DONE
- Provider: Call2Me; не менять без доказанного provider blocker.
- Universal Agent: `agent_f2949915a3f2` / `Sergii Universal Phone Agent`.
- Финальный live config уже проверен: dynamic opening, AI disclosure, `on behalf of Sergii`, runtime purpose-first, запрет `Can I help you?`, one-question-at-a-time, recording off, voicemail hangup.
- Реальный demo-звонок Call2Me уже дошёл на телефон Sergii; Sergii подтвердил звонок и речь AI.
- E.164 leading `+` исправлен.
- Постоянный runner: `scripts/openclaw-phone-call.mjs`.
- Постоянный workflow: `.github/workflows/openclaw-phone-call.yml`.
- PHONE TASK template: `ops/agent-control/templates/phone-call.example.json`.
- Runner уже имеет explicit approval, validation, lock/idempotency, provider dedupe по task id, no auto-redial, polling, max duration, voicemail handling, sanitized public persistence.
- Предыдущая security/idempotency проверка была завершена; повторять только после изменения runner.
- Auth/reset/email/signup-credit/agent creation/greeting/API-key historical investigations закрыты, если нет новых данных.

### LAST VERIFIED PROVIDER STATE — ИСТОРИЧЕСКИЙ, НЕ СЧИТАТЬ ТЕКУЩИМ БЕЗ READBACK
- wallet: `$0.00`, `can_proceed=false`;
- production call path доходил до HTTP 402 `Insufficient balance`;
- owned production numbers: empty;
- signup `$5` был заявлен/сконфигурирован, но в фактическом wallet ledger отсутствовал на момент проверки.

## 3. ЧТО ЕЩЁ НЕ ДОКАЗАНО

1. Финальный Universal Agent ещё не прошёл полный live conversation acceptance после purpose-first настройки.
2. Не доказано в живом звонке: arbitrary human answer -> логичное follow-up именно по этому ответу.
3. Free demo ещё не привязан доказанно к `agent_f2949915a3f2` после финальной настройки.
4. Не завершён путь: provider transcript/extraction -> private evidence -> ChatGPT -> Sergii.
5. Не сделан practical factual external call после self-test.
6. Production telephony/number/wallet не рассматриваются до исчерпания бесплатного тестирования.

## 4. ОФИЦИАЛЬНО ПОДТВЕРЖДЁННЫЙ CALL2ME CONTRACT

### FREE DEMO
Call2Me official Demo docs:
- `POST /v1/demo/call` публичный;
- signup/card не нужны;
- shared temporary number резервируется на 15 min;
- one demo call per destination/day;
- max 60 sec;
- default demo agent;
- workspace admin может выбрать свой agent через Dashboard `Demo -> Agent`;
- documented request содержит `phone_number` + `name`; arbitrary runtime `objective/questions/dynamic_variables` для demo endpoint официально не документированы.

### RESULT / TRANSCRIPT
Official Calls/API/Post-Call/Webhook docs:
- `GET /v1/calls/{id}`;
- `GET /v1/calls/{id}/transcript`;
- full transcript существует после call;
- agent post-call extraction может извлекать structured fields из transcript и сохранять их на call;
- `call.ended` webhook может нести transcript reference;
- vCon optional, MVP не требует.

### DEMO AGENT BINDING
Официально документирован Dashboard `Demo -> Agent`. В официальном API reference отдельный endpoint для изменения workspace demo-agent binding не найден. Не опираться на undocumented endpoint как на постоянный contract без прямого доказательства.

## 5. КРУПНЫЙ ПЛАН

### T-1 — Governance + inventory — DONE
Этот документ содержит правила, фактическое состояние, gaps и последовательность.

### T-2 — Official provider contract audit — DONE
Free demo, transcript/result, post-call extraction, demo binding surface и free/paid boundary проверены по первоисточникам.

### T-3 — FREE LIVE CONVERSATION — ACTIVE / PRIORITY 1
- T-3.1 Привязать существующий `agent_f2949915a3f2` как Dashboard `Demo -> Agent` постоянной настройкой provider.
- T-3.2 Проверить binding readback или фактическим поведением.
- T-3.3 Один free call на eligible и явно разрешённый destination.
- T-3.4 За 60 sec доказать: AI disclosure -> on behalf of Sergii -> purpose -> first question -> arbitrary answer -> relevant follow-up -> second answer -> correct end.
- T-3.5 Никаких conversational данных в public Git.
Acceptance: Sergii подтверждает, что агент услышал, понял и логично продолжил разговор.

### T-4 — PERMANENT RESULT PIPELINE — ACTIVE / CODE IMPLEMENTED, CI VERIFYING
Использовать существующий `scripts/openclaw-phone-call.mjs`, не новый runner.
- fetch official transcript endpoint;
- keep transcript/analysis/extraction only in private workflow artifact;
- public Git gets only sanitized evidence;
- sanitized result includes `call_id`, status, answered, duration and evidence-availability flags;
- workflow uploads private evidence separately with short retention.
Acceptance: после реального call можно достать transcript/extraction privately и вернуть evidence-only факты Sergii.

### T-5 — SERGII REQUEST -> PHONE TASK — SIMPLE EXISTING PATH
Не тащить `phone_call` в generic OpenClaw task-runner до E2E: это не требуется для звонка и добавляет лишний слой.
Постоянный путь уже есть:
`ChatGPT -> ops/agent-control/phone-calls/<unique-id>.json -> existing openclaw-phone-call workflow -> existing phone runner`.
- PHONE TASK contract держать в одном template;
- ChatGPT создаёт один task JSON под конкретное поручение;
- push task file запускает существующий phone workflow.
Acceptance: нет ручного переписывания runner/prompts; новая задача меняет только task data.

### T-6 — FULL FREE VERTICAL SLICE
Максимально доказать бесплатно:
`SERGII REQUEST -> PHONE TASK -> UNIVERSAL AGENT -> FREE REAL CALL -> DYNAMIC DIALOG -> VERIFIED RESULT -> SERGII`.
Если public demo технически не переносит runtime PHONE TASK data, это фиксируется как точный provider limit; всё остальное бесплатное тестирование должно быть исчерпано до обсуждения production spend.

### T-7 — PAID PRODUCTION — LOCKED
Только после T-3..T-6. Любое предложение денег обязано содержать: почему без этого нельзя; какие free paths исчерпаны; exact expected cost; hard maximum. Выполнение — только после нового разрешения Sergii.

### T-8 — PRACTICAL CALL + HARDENING
После self-test acceptance и отдельного разрешения: один factual external call; затем permanent credential hardening и cleanup obsolete experiments/PR.

## 6. ЧТО СЕЙЧАС НЕ ДЕЛАЕМ

Twilio/SIP/BYOC/AT&T; номер; wallet spending; новый voice provider; dashboard/frontend/CRM/queue/microservices; mass dialing/cold outreach; cosmetic PR cleanup; generic phone orchestration до E2E.

## 7. CURRENT CHECKPOINT

- Branch: `feat/openclaw-vendor-phone-calls`.
- PR #39: open/unmerged.
- Priority 1: T-3 free live conversation.
- Parallel code work: T-4 private evidence pipeline CI verification.
- T-5 uses the already-existing dedicated phone task path; no generic runner expansion before E2E.

## JOURNAL

### J-020 — Inventory reconciled — DONE
Historical journal, branch, PR, universal runner/workflow/task template and open gaps verified.

### J-021 — Historical spending authority — SUPERSEDED
Earlier authorization existed; latest user instruction supersedes it. Current spend authority: `$0.00`.

### J-022 — Existing-number/BYOC investigation — SUPERSEDED
Not relevant before free acceptance.

### J-023 — Connector housekeeping — NON-BLOCKING
Accidental branch `tmp-do-not-use` exists from tool probing; contains no intentional PHONE AGENT work; never use as source of truth.

### J-024 — FREE-FIRST governance — DONE
Latest explicit user rule locked: no financial action without new approval; exhaust free path; failed method must lead to another path; primary sources; permanent tools.

### J-025 — Official demo contract — DONE
Free endpoint/60 sec/one destination per day/shared temporary number/custom agent via `Demo -> Agent` verified.

### J-026 — Result audit start — SUPERSEDED BY J-027

### J-027 — Official result/transcript/extraction contract — DONE
Call detail, transcript endpoint, post-call extraction and webhook evidence mechanisms verified. Decision: extend existing runner, no separate result service.

### J-028 — Demo binding + free/paid boundary — DONE
Documented custom demo-agent binding is Dashboard-side; no documented API setter found. Public demo is explicit free phone-call surface; production PSTN is wallet/number infrastructure.

### J-029 — Permanent implementation started — DONE
Inspected existing phone runner/workflow and identified exact result-path gaps.

### J-030 — Unnecessary generic-integration path identified — DONE
Initial inspection showed generic OpenClaw task schema/runner does not support `phone_call`. A generic integration was considered, but it is not required for the product because the dedicated permanent phone task/workflow already exists.

### J-031 — Generic integration expansion reverted — DONE
- ACTION: experimental additions of `phone_call` to generic task schema/lib were reverted before use.
- REASON: they would require changing the large generic runner and duplicate routing logic before E2E.
- RESULT: no unnecessary generic orchestration remains. Dedicated phone path stays authoritative.

### J-032 — Permanent private evidence pipeline implemented — VERIFYING
- ACTION: existing `scripts/openclaw-phone-call.mjs` extended; no competing runner created.
- ADDED: official `/calls/{id}/transcript` retrieval with safe fallback to embedded transcript.
- ADDED: provider extraction detection and private evidence JSON containing task context, call status, transcript, provider summary/analysis/extraction.
- PRIVACY: private evidence writes under runner temp, chmod-restricted; transcript/analysis/extraction/destination are not written to public markdown.
- ADDED: sanitized result now includes `call_id`, status, answered, duration, transcript/extraction availability and private evidence filename.
- ACTION: existing `.github/workflows/openclaw-phone-call.yml` now uploads private evidence as a separate 3-day artifact and sanitized evidence separately.
- ACTION: PR validation now performs `node --check scripts/openclaw-phone-call.mjs`.
- STATUS: VERIFYING CI; do not mark DONE until current PR validation succeeds.

### J-033 — Next action
1. Wait only for current CI verification of J-032; fix if it fails.
2. In parallel resolve T-3.1: documented permanent `Demo -> Agent` binding. If no tool can operate the authenticated Dashboard and no stable API setter exists, classify exact `BLOCKED_PRIVILEGE` and reduce to one Dashboard action for Sergii; continue all other free work instead of stopping.
