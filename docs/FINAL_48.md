# Финал 48

## Статус и назначение

Этот документ фиксирует финальный маршрут закрытия OpenClaw V2 48-hour Walking Skeleton без перестройки уже доказанного ядра.

Работа выполняется строго поэтапно. После каждого этапа выполняется предусмотренная проверка. Переход к следующему этапу разрешён только после положительного результата предыдущего этапа. Любой RED/FAIL/BLOCKED останавливает маршрут до диагностики и исправления.

Перед каждым writer-этапом обязательно повторно сверять:

1. current canonical V2 HEAD;
2. exact latest CI и job/step conclusions;
3. `PROJECT_STATE.json`;
4. latest `docs/RESULTS_JOURNAL.md` checkpoint;
5. hosted Neon cleanliness, если следующий этап затрагивает hosted/live state;
6. branch/ruleset state, если следующий этап касается governance.

Фактические Git HEAD + exact CI + direct hosted/live evidence имеют приоритет над устаревшим metadata.

## Неподвижные инварианты

- Canonical V2 branch: `v2/openclaw-clean-20261011`.
- `main` не менять до отдельной явной cutover authorization.
- Не менять доказанный Kernel/Research/Data/Evidence/Phone runtime без воспроизведённого дефекта на текущем маршруте.
- Не ослаблять strict Data contract.
- Не запускать второй paid DeepSeek вызов до анализа результата предыдущего.
- `SKIPPED` не является PASS.
- Evidence остаётся canonical; phone/deep-log являются только представлениями.
- Не сохранять секреты в Git, journal, PROJECT_STATE, Evidence, task payload или логи.
- Один writer на одну code-zone.
- Перед перемещением canonical ref использовать свежий HEAD/expected-SHA semantics.

## Исходное состояние перед маршрутом

48H functional vertical уже доказан как `PASS_LIVE` исторической acceptance evidence. Оставшиеся post-48h закрытия:

- G1: постоянное secret plumbing и повторяемые live CI gates без ложного `SKIPPED`;
- G2: защита canonical V2 branch обязательным CI gate;
- финальная синхронизация `PROJECT_STATE.json` и append-only journal после фактического закрытия G1/G2.

Текущий CI до Stage 1 имеет отдельный full live Kernel Research step и отдельный live DeepSeek smoke step. При простом добавлении обоих secrets один CI способен выполнить больше одного paid provider call. Поэтому первым executable изменением является изоляция live gates, а не добавление secrets.

---

## Stage 0 — Baseline

### Цель

Зафиксировать factual baseline до любого writer change.

### Проверки

- canonical V2 HEAD известен;
- exact CI SUCCESS;
- `main` не изменён;
- hosted Neon: `RUNNING=0`, unresolved `RESERVED=0`;
- 48H functional evidence остаётся `PASS_LIVE`;
- canonical V2 branch protection проверен отдельно.

### Gate

Только после PASS всех read-only checks разрешён Stage 1.

---

## Stage 1 — Безопасно разделить обычный CI и live gates

### Поверхность изменений

Только control-plane/governance:

- `.github/workflows/v2-ci.yml`;
- `.github/workflows/v2-live-prerequisites.yml`;
- `scripts/validate-foundation.mjs`.

Не менять `src/` runtime, migrations, Research/Data/Evidence contracts.

### Требуемая модель запуска

`v2-ci.yml` должен поддерживать явный manual input `live_gate`:

- `none`;
- `hosted`;
- `kernel`;
- `smoke`.

Обычные `push`/`pull_request` выполняют только deterministic foundation/code/PG/integration проверки и не получают live secrets и не делают paid provider calls.

`workflow_dispatch + live_gate=hosted` выполняет только hosted Neon verification.

`workflow_dispatch + live_gate=kernel` выполняет ровно один full Research/DeepSeek live vertical.

`workflow_dispatch + live_gate=smoke` выполняет ровно один minimal DeepSeek smoke.

`kernel` и `smoke` не должны выполняться в одном run.

Live execution разрешён только для manual `workflow_dispatch` на canonical branch `v2/openclaw-clean-20261011`.

Если оператор запросил live gate, но обязательный secret отсутствует, workflow должен FAIL CLOSED, а не silently SKIP выбранный gate.

`v2-live-prerequisites.yml` должен быть ручным prerequisite check, который подтверждает только PRESENT/MISSING и никогда не печатает secret values.

### Validator

`validate-foundation.mjs` должен fail, если:

- paid gate доступен на ordinary push/PR;
- live gate не ограничен manual dispatch;
- kernel/smoke могут запуститься одновременно;
- selected live gate silently skips из-за missing secret;
- возвращён `permissions: write-all`;
- нарушены требуемые least-privilege permissions/concurrency invariants.

### Тест

После change:

- foundation validator PASS;
- Node suite PASS;
- PostgreSQL/kernel assertions PASS;
- integration tests PASS;
- health PASS;
- canonical workflow syntax/CI PASS;
- DeepSeek calls = 0;
- hosted live mutation = 0.

Любой FAIL = STOP.

---

## Stage 2 — Protected live Environment

### Цель

Отделить ordinary CI от среды, имеющей доступ к hosted DB и paid provider credential.

Создать GitHub Environment:

`openclaw-v2-live`

Разрешённая deployment branch:

`v2/openclaw-clean-20261011`

На этом этапе secrets ещё не добавляются.

### Тест

Read-only verify:

- environment существует;
- branch policy соответствует canonical V2;
- никакие secret values не раскрываются.

PASS -> Stage 3.

---

## Stage 3 — Защита canonical V2 branch

### Цель

Включить active ruleset только для:

`refs/heads/v2/openclaw-clean-20261011`

### Правила

- require pull request;
- required status/check: `foundation`;
- require branch up to date, если совместимо с реальным workflow;
- block deletion;
- block non-fast-forward/force push;
- require linear history;
- не вводить искусственный mandatory external approval для solo-owner режима;
- не давать broad permanent bypass, который обесценивает gate.

`main` не менять.

### Тест

Read-only verify ruleset/branch state:

- canonical V2 protected;
- ruleset active;
- required check = `foundation`;
- deletion blocked;
- non-fast-forward blocked;
- PR rule active.

PASS -> Stage 4.

---

## Stage 4 — Permanent secrets, без paid provider call

### Environment

`openclaw-v2-live`

### Secrets

- `DATABASE_URL` для V2 hosted DB;
- `DEEPSEEK_API_KEY`.

Secret values не должны появляться в output/log/repository/journal/state/evidence.

### Первый тест

Запустить только manual live-prerequisites gate.

Ожидается:

- `DATABASE_URL: PRESENT`;
- `DEEPSEEK_API_KEY: PRESENT`;
- prerequisite gate PASS;
- secret values не напечатаны.

FAIL = STOP, никакого live Research.

---

## Stage 5 — Hosted Neon gate отдельно от DeepSeek

Запустить manual:

`live_gate=hosted`

### Ожидается

- ordinary foundation PASS;
- hosted schema/persistence verification EXECUTED;
- DeepSeek provider calls = 0.

До и после выполнить read-only Neon inventory.

После hosted verification должны отсутствовать dangling RUNNING/RESERVED состояния и неожиданные mutations.

PASS -> Stage 6.

---

## Stage 6 — Ровно один full live Kernel Research vertical

Запустить manual:

`live_gate=kernel`

### Ожидаемая цепочка

PostgreSQL -> Research -> pinned OpenClaw -> DeepSeek -> `web_search` + `web_fetch` -> strict Data -> accounting -> reservation reconciliation -> runtime receipt -> durable Evidence.

### Post-run verification

Обязательно доказать:

- task terminal SUCCESS;
- Research SUCCESS;
- Data SUCCESS;
- accounting row существует;
- reservation reconciled/released;
- unresolved `RESERVED=0`;
- runtime receipt существует;
- durable Evidence существует;
- required tools observed;
- `RUNNING=0`.

Если FAIL:

- сохранить Evidence;
- диагностировать;
- не запускать smoke;
- не выполнять второй paid call;
- исправление -> полный CI -> только потом следующий paid attempt.

PASS -> Stage 7.

---

## Stage 7 — Отдельный DeepSeek smoke

Только после PASS Stage 6.

Запустить manual:

`live_gate=smoke`

Должен быть выполнен один minimal provider request с deterministic expected result.

После PASS считаем доказанными отдельно:

- hosted gate;
- full live kernel gate;
- provider smoke;
- permanent secret plumbing.

Только здесь G1 может быть закрыт.

---

## Stage 8 — Усилить validator для финального closure

### Цель

Не позволить governance metadata объявить финальное закрытие при незакрытых G1/G2.

### Поверхность

`scripts/validate-foundation.mjs`

### Требование

При финальном closure validator должен требовать согласованные признаки:

- G1 permanent plumbing verified;
- hosted live verification executed;
- kernel live executed;
- smoke executed;
- G2 branch protection verified;
- required check = `foundation`;
- least-privilege workflow permissions verified.

Отсутствие любого признака -> foundation FAIL.

Отдельный PR, полный CI, только PASS -> merge.

---

## Stage 9 — Финальная синхронизация PROJECT_STATE + Journal

Только после фактического PASS G1/G2.

### Файлы

- `PROJECT_STATE.json`;
- `docs/RESULTS_JOURNAL.md`.

Journal остаётся append-only.

### PROJECT_STATE

Убрать только реально подтверждённый stale metadata и записать свежие evidence references для:

- verified executable/governance head;
- exact CI;
- G1 runs;
- live task/accounting/Evidence;
- G2 ruleset/required check;
- Neon cleanliness.

Не создавать self-SHA churn. `verified_code_head` означает последний проверенный executable/governance commit, а текущий Git HEAD читается непосредственно из GitHub.

### Journal

Добавить один новый checkpoint `48H FINAL CLOSURE` с:

- baseline branch/SHA/CI;
- G1 evidence;
- G2 evidence;
- live run IDs;
- ruleset ID;
- hosted cleanliness;
- known limitations;
- next route.

Никаких secrets.

---

## Stage 10 — Финальный governance proof

Финальный metadata change проходит только через:

feature branch -> PR -> required `foundation` -> SUCCESS -> merge.

После merge повторно проверить:

- canonical V2 HEAD;
- exact CI;
- active V2 ruleset;
- required `foundation` check;
- Neon cleanliness;
- `PROJECT_STATE` coherence;
- latest journal checkpoint.

Только после этого допускается статус:

`48H FINAL CLOSURE = PASS`

---

## Жёсткий порядок маршрута

Stage 0 Baseline PASS
-> Stage 1 Safe live-CI isolation PASS
-> Stage 2 Protected live Environment PASS
-> Stage 3 V2 branch protection PASS
-> Stage 4 Secrets presence PASS
-> Stage 5 Hosted Neon PASS
-> Stage 6 ONE paid Kernel vertical PASS
-> Stage 7 ONE paid provider smoke PASS
-> Stage 8 Closure validator PASS
-> Stage 9 State + Journal PASS
-> Stage 10 Final governance proof PASS
-> `48H FINAL CLOSURE = PASS`.

Любой RED/FAIL/BLOCKED останавливает маршрут.

## Запрещённые отклонения до завершения Финал 48

Не начинать в рамках этого маршрута:

- Browser Agent;
- Vision/OCR/PDF;
- sandbox;
- Swarm/Repair/Judge;
- full 71 agents/311 skills;
- runtime/model/provider upgrade;
- broad refactor;
- cutover в `main`;
- production deployment/cutover;
- ослабление strict Data admission;
- автоматические paid retry loops;
- подмена GitHub-specific webhook доказательством USER HTTP ingress.

## Следующая фаза после PASS Финал 48

Только отдельным маршрутом:

- canary rollout;
- backup/checkpoint;
- production env mapping;
- rollback mechanism;
- rollback rehearsal;
- health/observability;
- cutover readiness review;
- explicit production move authorization.
