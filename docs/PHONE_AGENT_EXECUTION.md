# PHONE AGENT — ACTIVE PLAN + JOURNAL

Updated: 2026-09-03
Historical journal: `docs/PHONE_AGENT_STATE.md` (J-001..J-019).
This file is the active source of truth from J-020 onward.

## 0. MASTER RULES

1. `READ JOURNAL -> VERIFY -> ONE SMALL ACTION -> VERIFY RESULT -> JOURNAL -> NEXT`.
2. “Не получилось” не является конечным статусом. Ошибка классифицируется как `CODE`, `PROVIDER` или `BLOCKED_PRIVILEGE`; затем используется следующий независимый путь. Остановка допустима только при доказанном внешнем hard limit или действии пользователя, которое невозможно выполнить имеющимися инструментами.
3. По Call2Me сначала использовать официальные docs/OpenAPI/API responses и официальные SDK source repos. Не заменять первоисточник предположением.
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
- Runner имеет explicit approval, validation, lock/idempotency, provider dedupe по task id, no auto-redial, polling, max duration, voicemail handling, sanitized public persistence.
- Permanent private evidence pipeline реализован и CI-проверен: transcript endpoint + private artifact + sanitized public metadata.
- CI после изменений: OpenClaw PR Validation SUCCESS, Workflow Self Validation SUCCESS, CodeQL SUCCESS.
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
4. Private result pipeline реализован, но ещё не проверен на новом реальном завершённом звонке, поэтому transcript/extraction runtime acceptance остаётся open.
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
Официально документирован Dashboard `Demo -> Agent`. В официальном API reference отдельный endpoint для изменения workspace demo-agent binding не найден.
Дополнительно проверены официальные Call2Me Python SDK и Node SDK source repositories: отдельный Demo resource / demo-agent binding method в SDK также не найден.

**Вывод:** permanent supported path для этой настройки сейчас — authenticated Dashboard. Undocumented/internal API не использовать как постоянный production contract без доказательства.

## 5. КРУПНЫЙ ПЛАН

### T-1 — Governance + inventory — DONE

### T-2 — Official provider contract audit — DONE

### T-3 — FREE LIVE CONVERSATION — ACTIVE / PRIORITY 1
- T-3.1 Привязать существующий `agent_f2949915a3f2` как Dashboard `Demo -> Agent`. — `BLOCKED_PRIVILEGE`: authenticated Dashboard write; текущие инструменты не имеют Call2Me dashboard/browser connector, официальный setter API/SDK method не найден.
- T-3.2 Проверить binding фактическим free call.
- T-3.3 Один free call на eligible и явно разрешённый destination.
- T-3.4 За 60 sec доказать: AI disclosure -> on behalf of Sergii -> purpose -> first question -> arbitrary answer -> relevant follow-up -> second answer -> correct end.
- T-3.5 Никаких conversational данных в public Git.
Acceptance: Sergii подтверждает, что агент услышал, понял и логично продолжил разговор.

### T-4 — PERMANENT RESULT PIPELINE — CODE DONE / LIVE ACCEPTANCE OPEN
Использован существующий `scripts/openclaw-phone-call.mjs`, не новый runner.
- official transcript endpoint fetch;
- transcript/analysis/extraction -> private runner artifact;
- public Git -> sanitized metadata only;
- sanitized result -> `call_id`, status, answered, duration, evidence availability;
- existing phone workflow -> separate private artifact (3 days) + sanitized artifact;
- PR CI explicitly syntax-checks phone runner.
Acceptance runtime: следующий реальный завершённый call должен доказать получение private transcript/extraction.

### T-5 — SERGII REQUEST -> PHONE TASK — SIMPLE EXISTING PATH
Не тащить `phone_call` в generic OpenClaw task-runner до E2E: это не требуется и создаёт лишний слой.
Постоянный путь:
`ChatGPT -> ops/agent-control/phone-calls/<unique-id>.json -> existing openclaw-phone-call workflow -> existing phone runner`.
Новая задача меняет только task data.

### T-6 — FULL FREE VERTICAL SLICE
Максимально доказать бесплатно:
`SERGII REQUEST -> PHONE TASK -> UNIVERSAL AGENT -> FREE REAL CALL -> DYNAMIC DIALOG -> VERIFIED RESULT -> SERGII`.
Если public demo не переносит arbitrary runtime PHONE TASK data, зафиксировать этот точный provider limit, но сначала исчерпать весь free proof.

### T-7 — PAID PRODUCTION — LOCKED
Только после T-3..T-6. Любое предложение денег: почему необходимо; какие free paths исчерпаны; exact expected cost; hard maximum; затем новое разрешение Sergii.

### T-8 — PRACTICAL CALL + HARDENING
После self-test acceptance и отдельного разрешения: factual external call; затем permanent credential hardening и cleanup obsolete experiments/PR.

## 6. ЧТО СЕЙЧАС НЕ ДЕЛАЕМ

Twilio/SIP/BYOC/AT&T; номер; wallet spending; новый voice provider; frontend/CRM/queue/microservices; mass dialing/cold outreach; cosmetic PR cleanup; generic phone orchestration до E2E.

## 7. CURRENT CHECKPOINT

- Branch: `feat/openclaw-vendor-phone-calls`.
- PR #39: open/unmerged.
- T-4 permanent code: verified by CI, live-call acceptance pending.
- Current only external gate for T-3: authenticated Dashboard `Demo -> Agent` selection.
- After that immediately perform free call; no wallet/number purchase.

## JOURNAL

### J-020 — Inventory reconciled — DONE
Historical journal, branch, PR, universal runner/workflow/task template and open gaps verified.

### J-021 — Historical spending authority — SUPERSEDED
Earlier authorization existed; latest instruction supersedes it. Current spend authority: `$0.00`.

### J-022 — Existing-number/BYOC investigation — SUPERSEDED
Not relevant before free acceptance.

### J-023 — Connector housekeeping — NON-BLOCKING
Accidental branch `tmp-do-not-use` exists from tool probing; contains no intentional PHONE AGENT work; never use as source of truth.

### J-024 — FREE-FIRST governance — DONE
No financial action without new approval; exhaust free path; failed method -> next path; primary sources; permanent tools.

### J-025 — Official demo contract — DONE
Free endpoint/60 sec/one destination/day/shared temporary number/custom agent via Dashboard verified.

### J-026 — Result audit start — SUPERSEDED BY J-027

### J-027 — Official result/transcript/extraction contract — DONE
Call detail, transcript endpoint, post-call extraction and webhook evidence mechanisms verified. Existing runner chosen as permanent integration point.

### J-028 — Demo binding + free/paid boundary — DONE
Documented custom demo-agent binding is Dashboard-side; public demo is the explicit free phone-call surface.

### J-029 — Permanent implementation inspection — DONE
Exact result-path gaps in existing phone runner/workflow verified.

### J-030 — Generic integration considered — DONE
Generic OpenClaw schema/runner lacks phone_call, but dedicated permanent phone path already solves ingestion for MVP.

### J-031 — Unnecessary generic expansion reverted — DONE
Experimental generic schema/lib additions reverted before use. No duplicate routing layer remains.

### J-032 — Permanent private evidence pipeline — DONE CODE / LIVE ACCEPTANCE OPEN
- Existing phone runner extended with `/calls/{id}/transcript` retrieval, provider extraction detection and private evidence JSON.
- Public markdown no longer persists destination/conversation/provider bodies; sanitized result includes call_id/status/answered/duration/evidence flags.
- Existing phone workflow uploads private artifact with 3-day retention and sanitized artifact separately.
- PR validation now runs `node --check scripts/openclaw-phone-call.mjs`.
- VERIFIED CI: OpenClaw PR Validation run `33804632776` SUCCESS; phone runner syntax step SUCCESS; Workflow Self Validation run `33804632726` SUCCESS; CodeQL run `33804632582` SUCCESS.
- STATUS: code DONE; runtime acceptance waits for next real call.

### J-033 — Demo binding search continued — DONE
- PRIMARY SOURCE: official docs say Dashboard `Demo -> Agent`.
- PRIMARY SOURCE: official `call2me-app/python-sdk` inspected; no Demo resource or demo-agent binding setter.
- PRIMARY SOURCE: official `call2me-app/node-sdk` searched; no Demo binding API surface found.
- TOOL CHECK: no Call2Me plugin/connector is installable in this chat; no authenticated dashboard browser tool is available here.
- RESULT: supported binding write is a genuine `BLOCKED_PRIVILEGE`, not a code/provider design problem.

### J-034 — MINIMUM USER ACTION / NEXT
Sergii must perform exactly one provider-dashboard write: open Call2Me Dashboard -> `Demo` -> `Agent` -> select `Sergii Universal Phone Agent` (`agent_f2949915a3f2`) -> save. No payment, number or plan change. After confirmation, immediately execute T-3 free live acceptance call and continue journal.
