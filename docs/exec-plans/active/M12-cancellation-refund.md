# M12 — Безопасная отмена заказа и возврат денег

Status: blocked
Milestone: M12
Depends on: M7 Orders, M8 Card Payment, M9–M10 iiko Fulfillment, M11 Admin Orders

> **КРИТИЧЕСКОЕ ПРЕДУПРЕЖДЕНИЕ**
>
> Здесь реальные деньги и заказы. Нельзя считать возврат успешным по нажатию кнопки, ответу браузера или одному HTTP-коду. Деньги считаются возвращёнными только после подтверждённого статуса платёжного провайдера.
>
> До реализации нельзя делать реальные возвраты и нельзя подключать production credentials. Сначала нужно подтвердить правила отмены, проверить test-магазин YooKassa и пройти все проверки на тестовом платеже. При любом неизвестном результате операция останавливается в безопасном состоянии и попадает на сверку, но новый возврат автоматически не создаётся.

## Purpose

Добавить безопасную отмену заказа и полный возврат оплаченной суммы:

- Customer может отменить свой заказ только в разрешённом состоянии;
- один Admin имеет полный доступ к отмене, возврату и сверке;
- возврат выполняется только для подтверждённой оплаты;
- сумма берётся только из сохранённого платежа, а не из запроса клиента;
- повторный запрос не создаёт второй возврат;
- неизвестный результат не маскируется под успех;
- Customer и Admin видят правдивый текущий статус.

## Current State

Проверенное состояние перед задачей:

- Order statuses: `pending_payment`, `payment_confirmed`, `kitchen_accepted`, `preparing`, `ready_for_pickup`, `completed`, `fulfillment_problem`.
- Payment statuses: `pending`, `succeeded`, `canceled`.
- Payment amount и currency уже сохраняются в PostgreSQL в целых minor units.
- YooKassa adapter умеет создать платёж и запросить его состояние; refund adapter пока отсутствует.
- Payment webhook уже является источником подтверждения успешной оплаты.
- iiko execution status нельзя менять вручную из Admin.
- Admin имеет один уровень доступа; разделения на роли нет.
- Используется только canonical PostgreSQL database `vse_pro_zhar_dev`.

## Mandatory decision gate

До написания provider write-кода owner должен подтвердить в этом plan:

1. В каких состояниях разрешена отмена Customer.
2. В каких состояниях Admin может отменить заказ.
3. Можно ли отменять оплаченный заказ после `payment_confirmed`, но до принятия кухней.
4. Что делать, если заказ уже получил `providerOrderId` в iiko.
5. Что делать при `fulfillment_problem`: автоматически возвращать деньги или только после ручного решения Admin.
6. Разрешён ли только полный возврат. Для первого безопасного среза — да; частичные возвраты не входят.
7. Какой текст и срок показывать Customer, пока возврат имеет статус `pending`.
8. Как обрабатывать налоговый чек возврата и требования бухгалтерии для конкретного магазина.

Если решение не подтверждено или provider contract неясен, соответствующий сценарий запрещается и возвращает безопасное «операция недоступна». Нельзя выбирать правило по удобству реализации.

### Owner decision recorded for M12 implementation

- Customer cancellation is allowed only for the customer's own order in `pending_payment` or `payment_confirmed`.
- Admin has the same cancellation boundary in M12; one Admin access level remains in use.
- An order in `payment_confirmed` may be canceled only while iiko has not returned a `providerOrderId`.
- If iiko has already returned `providerOrderId`, cancellation/refund is unavailable; M12 does not invent an iiko cancellation contract.
- `fulfillment_problem`, `kitchen_accepted`, `preparing`, `ready_for_pickup`, and `completed` require a separate manual policy and do not receive automatic refund in M12.
- M12 supports full refunds only. The amount and currency come from the persisted succeeded payment.
- Customer sees `refund pending` as “Возврат обрабатывается. Деньги будут возвращены после подтверждения платёжного провайдера.” No fixed deadline is promised; a reconciliation state instructs the customer to contact support.
- M12 sends the documented full-refund request without `receipt`; when the shop uses YooKassa receipts, provider-side receipt registration may be created from the original payment. The shop must confirm its 54-ФЗ configuration and accounting procedure before production refunds; receipt registration is not used as evidence of money returned.

### Conservative baseline до отдельного owner decision

- `completed` никогда не отменяется автоматически.
- `kitchen_accepted`, `preparing`, `ready_for_pickup` и `completed` не получают автоматический refund в M12 без подтверждённой политики.
- Неизвестный iiko результат не трактуется как «заказ не приготовлен».
- Полный refund разрешён только на payment со статусом `succeeded`.
- Частичный refund, ручное изменение суммы и возврат на другую карту не реализуются.
- Если есть сомнение в состоянии заказа, денег или внешнего provider — отказ/сверка, а не рискованная попытка.

## Scope

### Customer

- Кнопка отмены только для собственного заказа и только в одобренном состоянии.
- Повторный запрос возвращает уже известный результат и не запускает вторую операцию.
- После отмены оплаченного заказа Customer видит `refund pending`, `refunded`, `refund failed` или `reconciliation required`.
- Customer не передаёт сумму, payment ID, refund ID, статус или причину, влияющие на решение Backend.
- Customer не видит provider payload, credentials и внутренние error details.

### Admin

- В Order detail показать:
  - причину и инициатора отмены;
  - сохранённую сумму возврата;
  - статус refund;
  - безопасный provider refund ID;
  - время попытки и последнего подтверждения;
  - безопасный код ошибки;
  - историю отмены и возврата.
- Дать одному Admin явное действие отмены/возврата только после безопасной серверной проверки.
- Добавить отдельное действие «проверить возврат» для неизвестного результата.
- Не давать кнопку, которая создаёт новый refund поверх `unknown` или `reconciliation_required`.
- Не давать Admin возможность вручную поставить `refunded` или изменить payment status.

### Backend and PostgreSQL

- Добавить отдельный cancellation/refund boundary внутри текущего modular monolith.
- Добавить versioned migration; production schema вручную не менять.
- Сохранять каждую значимую смену order status в `order_status_history`.
- Сохранять audit без password, session token, card data или raw provider payload.
- Обеспечить transaction/row-lock на order, payment, cancellation и refund перед созданием intent.
- Внешний YooKassa HTTP не выполнять внутри DB transaction.
- После перезапуска Backend незавершённый refund должен находиться и продолжаться безопасно через обычный application process, без Redis, Kafka, RabbitMQ, отдельного сервиса или второй базы.

## Out of Scope

- Частичные возвраты и возвраты отдельных позиций.
- Возвраты на другой платёжный инструмент.
- Ручное изменение payment/order/kitchen status из UI.
- Automatic refund после `kitchen_accepted`, `preparing`, `ready_for_pickup` или `completed`, пока owner не подтвердил отдельную policy.
- Автоматическая отмена iiko-заказа, если для неё нет подтверждённого provider contract и безопасной идемпотентности.
- Chargeback/dispute, payout, loyalty compensation, bonus reversal и SMS.
- Production credentials, production refunds и юридическая автоматизация без подтверждённых требований.
- Новая инфраструктура или отдельный worker service.

## Architecture / Constraints

### Источники истины

- Backend + PostgreSQL — источник истины для order cancellation intent и локального refund state.
- YooKassa — источник истины для факта provider refund.
- Payment `succeeded` не переписывается в `refunded`: успешная оплата и возврат — разные факты.
- Customer/Admin UI показывает только последнее подтверждённое состояние.

### Минимальные lego-блоки

Каждый блок должен иметь одну ответственность и собственные тесты:

1. contracts: статусы, запросы и безопасные ответы;
2. database migration и repositories: данные, ограничения и транзакции;
3. YooKassa provider adapter: только HTTP, idempotency и runtime validation;
4. cancellation service: только правила допуска и создание cancellation intent;
5. refund service/processor: только refund state machine и безопасное продолжение;
6. routes: auth, parse, вызов service, safe error mapping;
7. api-client/controllers: transport и lifecycle;
8. Customer/Admin UI: отображение и подтверждение действия.

Route не содержит расчёт денег. Provider не знает о PostgreSQL. UI не принимает решений о праве на refund. Customer и Admin используют общий Backend service, а не две копии бизнес-логики.

### Деньги

- Все суммы — integer minor units.
- Refund amount всегда равен сохранённой сумме подтверждённого payment для полного возврата.
- Currency должна совпадать с payment и order.
- Нельзя принимать amount, currency, payment ID или refund ID из client payload как authoritative.
- Нельзя использовать floating-point для расчётов.
- Нельзя округлять сумму во время retry.
- Перед provider request повторно проверить order/payment/refund invariants.

### Идемпотентность и неизвестный результат

- Для локальной операции сохраняется один стабильный server-generated idempotency key.
- Retry той же операции использует тот же key и те же данные.
- Concurrent cancellation/refund должен дать одну cancellation запись и максимум один provider refund.
- Timeout, connection drop и HTTP 5xx означают «результат неизвестен», а не «refund не был создан».
- В неизвестном состоянии сначала выполняется reconciliation по сохранённому provider refund ID или разрешённому provider lookup.
- Если provider ID ещё неизвестен, не создавать новый refund автоматически после истечения безопасного периода idempotency; переводить операцию в `reconciliation_required`.
- `reconciliation_required` не превращается в `refunded` без подтверждения provider.
- Provider response считается пригодным только после runtime validation и проверки payment ID, amount, currency и статуса.

### JavaScript/TypeScript: lego-подход без «паразитов»

Под «паразитами» в этой задаче понимаются костыли, дубли, лишние зависимости и скрытые побочные эффекты. Запрещено:

- добавлять новую npm-библиотеку без доказанной необходимости;
- использовать `any`, `@ts-ignore`, `@ts-expect-error`, безусловные type casts и отключение ESLint;
- сохранять `unknown` или raw provider JSON в PostgreSQL;
- делать direct `fetch` из React/UI или direct DB access из route;
- копировать одну и ту же state machine в Customer, Admin, route и provider;
- добавлять глобальное mutable state, monkey patching, magic money constants или скрытые side effects;
- использовать `Math.random()`, `Date.now()` или данные клиента для refund idempotency;
- оставлять dead code, unused exports, временные debug logs и закомментированные «потом исправим» блоки;
- раздувать один файл универсальным «god service»;
- добавлять Redis, очередь, микросервис или фоновую инфраструктуру «на будущее».

Нужно использовать существующие Zod, Drizzle, Fastify, Node `crypto` и текущие provider/application boundaries. Новые helpers должны быть маленькими, именованными по смыслу и переиспользоваться, если правило действительно общее.

## Implementation Requirements

### 1. Contracts

Добавить только после подтверждения decision gate:

- order status `canceled`;
- cancellation request/response;
- refund status: как минимум `pending`, `succeeded`, `canceled`, `reconciliation_required`;
- безопасные refund summary/detail schemas;
- отдельные error codes для: not allowed, already canceled, refund pending, reconciliation required;
- strict schemas без provider payload и без secrets.

### 2. Database model

Предпочтительный минимальный набор:

`order_cancellations`:

- one row per order;
- order/customer/staff actor references;
- actor type `customer|admin`;
- safe reason code;
- idempotency key;
- created/updated timestamps.

`refunds`:

- one full refund per payment/order;
- payment/order/provider references;
- provider refund ID nullable, later unique;
- exact amount_minor and currency snapshot;
- stable idempotency key;
- local refund status;
- attempt count, next attempt, lease/claim time;
- last safe error code and timestamps.

`refund_events`:

- provider refund ID;
- event type/status;
- event fingerprint unique for deduplication;
- received timestamp;
- no raw payload.

Database constraints must prevent two active full refunds for one payment. Foreign keys, unique keys, non-negative money checks and valid status checks are mandatory.

### 3. Provider adapter

Extend the existing YooKassa adapter only with the smallest required operations:

- create full refund;
- get refund by provider refund ID;
- lookup/reconcile refunds by payment only if the current provider API contract supports it and the response is runtime-validated.

The adapter must:

- call provider server-side only;
- send persisted idempotency key;
- use exact persisted amount/currency and payment ID;
- validate provider response strictly;
- distinguish confirmed success, pending, terminal cancellation and unknown/unavailable result;
- expose safe error details only;
- never write to database;
- never decide whether business cancellation is allowed.

Before implementation recheck the current official provider contract. Current official documentation states that refunds are made for successful payments, uses `POST /v3/refunds` with `payment_id` and `amount`, supports an `Idempotence-Key`, and exposes `refund.succeeded` notifications. The exact response fields and lookup behavior must be verified against the current API specification before coding.

### 4. Cancellation and refund state machine

Create one shared service with explicit transitions:

```text
order eligible
  → cancellation intent persisted
  → order canceled
  → no payment: done
  → payment pending: wait for final payment state safely
  → payment succeeded: refund intent persisted
  → refund pending
  → provider succeeded: refunded
  → provider canceled: refund failed
  → unknown and not reconciled: reconciliation required
```

Rules:

- persist cancellation and refund intent before external write;
- lock relevant rows in a deterministic order;
- never create refund before payment is provider-confirmed succeeded;
- if payment succeeds after cancellation, do not create iiko dispatch; create exactly one refund intent;
- never dispatch a canceled order to iiko;
- do not claim refund success from local intent creation;
- do not silently reopen a canceled order;
- do not issue a second refund after timeout;
- preserve order/payment/refund history across retries and process restart.

If a race between payment webhook, iiko processor and cancellation cannot be closed with existing boundaries, stop and add a tested state transition or narrow the allowed cancellation states. Do not fix the race with an unprotected SQL update.

### 5. API routes

Add:

- Customer: `POST /orders/:id/cancel`;
- Customer: existing order detail returns safe cancellation/refund state;
- Admin: `POST /admin/orders/:id/cancel`;
- Admin: `POST /admin/orders/:id/refund/reconcile`;
- Admin: existing order detail includes safe refund information;
- provider webhook route for refund events, if current provider contract requires it.

All routes must use existing Customer/Admin auth boundaries. Admin is one access level; no role checks or role fields may be added.

For every mutating request:

- validate origin where cookie auth is used;
- require and validate idempotency where the operation can have a side effect;
- parse input before service call;
- map only safe errors;
- return current persisted state, not a guessed success message.

### 6. Processor and recovery

Use one small in-process `RefundProcessor` inside the existing API process, modeled on the current durable iiko processor only where the mechanics are genuinely shared.

It must:

- claim one due refund safely;
- use a bounded attempt/retry policy;
- preserve the same idempotency key;
- poll a known provider refund ID when available;
- reconcile unknown results before any new create attempt;
- survive process restart through persisted state;
- stop and alert via safe state after unrecoverable ambiguity;
- stop cleanly during graceful shutdown.

Do not create a general-purpose job framework or a second service.

### 7. UI

Customer:

- show Cancel only when Backend says it is allowed;
- show confirmation with clear warning;
- disable duplicate submission;
- show «отмена принята», «возврат обрабатывается», «деньги возвращены» and safe failure/reconciliation messages;
- never promise an instant refund before provider confirmation.

Admin:

- show exact persisted amount and currency;
- require explicit confirmation before cancellation/refund;
- show disabled state for terminal/unsafe orders;
- show «проверить возврат» for reconciliation;
- do not expose raw provider response or credentials.

## Tests

### Contract and unit tests

- strict request/response validation;
- no client amount/payment/refund override;
- every allowed and denied state transition;
- full refund amount uses persisted payment snapshot;
- integer money and currency mismatch rejection;
- no role field or role-based behavior in Admin auth response.

### Database and concurrency tests

- migration creates all constraints on canonical schema;
- one cancellation row per order;
- one refund intent per payment;
- two concurrent cancellation requests produce one result;
- two concurrent refund attempts produce one provider call;
- payment webhook racing cancellation produces either:
  - normal payment/dispatch before cancellation, if cancellation lost the race; or
  - canceled order plus one refund intent, with no iiko dispatch, if cancellation won;
- process restart resumes pending refund;
- timeout/5xx does not create a second refund;
- provider mismatch is rejected and never marked refunded;
- audit/history writes are complete and contain no secrets or raw payload.

### Provider adapter tests

Use test doubles for every provider result:

- succeeded payment → full refund request;
- pending refund → later provider GET;
- succeeded refund → local `refunded`;
- canceled refund → local failure, no success message;
- timeout, connection error and 5xx → unknown/reconciliation path;
- repeated same idempotency key → same logical operation;
- malformed JSON/status/amount/currency/payment ID → safe error;
- credentials never appear in logs or returned contracts.

### API and browser tests

- anonymous Customer/Admin gets 401;
- Customer cannot cancel another customer's order;
- one Admin can cancel/refund any eligible order;
- completed/unsafe orders are blocked;
- duplicate click and page reload do not duplicate cancellation/refund;
- Customer sees only its own refund state;
- Admin order detail displays safe refund state;
- browser never calls YooKassa directly;
- no false «деньги возвращены» before provider-confirmed success.

### Manual test

Only with a dedicated YooKassa test payment and test credentials:

1. create a small test order;
2. confirm payment server-side;
3. request cancellation once;
4. verify one refund intent and one provider refund;
5. repeat request and reload;
6. verify no second provider refund;
7. verify provider-confirmed result in Admin and Customer;
8. separately simulate timeout/unknown result and verify reconciliation state.

Never use a real production payment or production credentials for this check.

## Acceptance Criteria

- No cancellation or refund operation can be authorized from client-provided amount/status.
- Unpaid order can be canceled without creating a refund.
- Only provider-confirmed `succeeded` payment can create a full refund intent.
- Full refund amount exactly matches persisted payment amount and currency.
- One order/payment can never produce two successful refunds.
- Retry, duplicate click, webhook replay, timeout and process restart do not create a duplicate refund.
- Unknown provider result is visibly unknown/reconciliation-required; it is never shown as refunded.
- Provider `canceled` refund is not shown as returned money.
- A canceled order cannot be sent to iiko by a later payment webhook or processor run.
- Payment `succeeded` remains a payment fact; refund status is stored separately.
- One Admin has full access; no `admin/operator` roles or role permissions exist.
- Secrets, raw provider payloads and payment instrument data never reach UI, logs or audit.
- Canonical PostgreSQL migration, automated tests, build and browser checks pass.
- Documentation describes the actual safety rules and does not claim production refund readiness without a real approved provider check.

## Verification

Commands must use only the canonical database:

```bash
pnpm lint
pnpm typecheck
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm test
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm e2e -- --workers=1
pnpm build
pnpm audit --prod
git diff --check
```

Before any external test refund, verify:

- provider account is explicitly test mode;
- payment ID belongs to the dedicated test order;
- amount and currency are shown in the persisted order/payment;
- no production environment variables are loaded;
- cleanup cannot delete or mutate unrelated orders.

## Progress

- [x] Зафиксировать conservative owner decision по cancellation matrix, iiko boundary и refund/receipt policy.
- [x] Проверить актуальный YooKassa refund contract по официальной документации и read-only API semantics; real test refund не выполнялся.
- [x] Добавить contracts и versioned PostgreSQL migration.
- [x] Реализовать repositories и transaction-safe state transitions.
- [x] Реализовать provider refund adapter с runtime validation.
- [x] Реализовать cancellation/refund service и durable in-process processor.
- [x] Добавить Customer/Admin API clients, controllers и UI.
- [x] Добавить contract, provider, concurrency и canonical PostgreSQL integration tests; restart path покрыт durable claim/lease processor’ом.
- [ ] Выполнить только test-mode manual refund verification — test-mode flags присутствуют, но dedicated provider write/refund lifecycle в этой задаче не запускался; production credentials/orders не использовались.
- [x] Обновить документацию и Outcome после фактических проверок.
- [ ] Перенести plan в `docs/exec-plans/completed/` только после полного acceptance; текущий внешний provider/manual gate блокирует closure.

## Discoveries

- Текущий provider abstraction умеет create/get payment, но не refund; refund boundary нужно добавлять отдельно.
- Текущая payment state machine хранит `succeeded` как факт оплаты; refund нельзя моделировать переприсваиванием payment status.
- YooKassa в официальной документации указывает, что возврат выполняется для успешного платежа; для создания используется `payment_id`, сумма и ключ идемпотентности.
- Официальная документация описывает `refund.succeeded` как событие возврата; точный набор полей и способ сверки нужно подтвердить по актуальной спецификации перед реализацией.
- У текущего iiko adapter нет отдельной команды отмены заказа; автоматическая отмена уже отправленного iiko-заказа не может быть предположена.
- В реализации безопасная matrix зафиксирована: Customer/Admin могут отменить только `pending_payment` и `payment_confirmed` до начала внешней iiko-работы; `providerOrderId` и все kitchen/fulfillment terminal states блокируются.
- Локальный refund intent использует отдельный server-generated UUID idempotency key; timeout/5xx/invalid provider response переводят refund в `reconciliation_required` без повторного POST.
- YooKassa OpenAPI YAML доступен на официальной странице, но web fetch не отдал бинарный YAML; текущий adapter ограничен подтверждённым официальными страницами полем full refund и GET-by-refund-ID contract.
- Browser E2E с альтернативными портами прошёл только два smoke-сценария; один Admin foundation сценарий получил неожиданный failed `/admin/orders` request, а четыре Customer/Admin сценария завершились timeout. Это требует отдельного E2E environment/debug шага; production/manual refund readiness не заявляется.
- Во время M13.4 test-mode flags YooKassa были обнаружены в локальных env-файлах, но provider write не выполнялся: безопасное наличие конфигурации не является evidence успешного платежа или возврата.
- После исправления E2E same-host cookie setup полный suite на canonical database прошёл; provider manual gate остаётся внешним и не заменяется automated test doubles.

## Decision Log

- M12 использует один уровень доступа Admin; role-based access control сюда не добавляется.
- Первый refund slice — только полный возврат; partial refund остаётся отдельной задачей.
- Сумма refund всегда берётся из сохранённого succeeded payment.
- Внешний provider write выполняется только после сохранения локального intent и вне DB transaction.
- Любая неоднозначность provider результата переводит операцию на reconciliation, а не запускает новый refund.
- Новые инфраструктурные компоненты не добавляются; незавершённые операции хранятся в PostgreSQL и обрабатываются существующим application process.
- В JavaScript/TypeScript сохраняется lego-структура: маленькие модули, общие правила в одном service, строгие типы, без лишних зависимостей и костылей.
- M12 сохраняет `payment.status = succeeded` как отдельный факт и хранит refund state в отдельной таблице; cancellation intent создаётся до любого provider refund HTTP.

## Outcome

Локальный M12 vertical slice реализован и проверен на canonical `vse_pro_zhar_dev`: добавлены cancellation/refund contracts, migration `0010_m12_cancellation_refund`, transaction-safe repository, YooKassa full-refund adapter, durable in-process processor, Customer/Admin routes, clients/controllers/UI и refund event deduplication. В полном QA-прогоне 2026-09-06 прошли lint, typecheck, migration/probe, 225 unit/integration tests, 11 browser E2E, build, audit и diff check; controlled anonymous API checks вернули безопасные 401 без provider payloads. Реальный YooKassa payment/refund и production credentials/orders не использовались; dedicated test-payment/manual provider verification и бухгалтерская/54-ФЗ policy check остаются обязательными внешними gates, поэтому plan имеет статус `blocked` и остаётся в `active/`.
