# M9–M10 — Полный цикл исполнения оплаченного заказа через iiko

Status: completed
Milestone: M9–M10
Depends on: completed repository technical audit, M8 Card Payment

## Purpose

Реализовать безопасный путь от server-confirmed YooKassa payment до исполнения заказа кухней: durable intent, отправка в iiko без дублей, синхронизация статусов и отображение фактического состояния в Customer Web.

Итоговый сценарий: Customer создаёт заказ, оплачивает его тестовой картой, получает подтверждение payment, видит передачу в iiko, принятие кухней, `preparing`, `ready_for_pickup` и `completed` в истории.

## Current State

Реализованы каталог, Customer session, cart, server-owned checkout quote, read-only iiko availability/stop-list, orders со snapshots и YooKassa test-card payment с server-side verification/webhook. M9–M10 добавляют durable `payment_confirmed → iiko → kitchen status` path: PostgreSQL intent, server-only adapter, resumable in-process processor и Customer-visible fulfillment state.

Локальный simulator проверен через `/api/1/deliveries/create`, `/api/1/commands/status`, `/api/1/deliveries/by_id`, duplicate-order, status progression, cancellation и fault-compatible runtime validation.

Технический аудит M0–M8 завершён. Он также зафиксировал отдельные pre-production blockers: staff authorization Admin, verified customer identity и crash-consistent payment initiation. Этот plan обязан устранить последний риск на payment → dispatch boundary, но не подменяет отдельные security decisions.

## Scope

### Backend and PostgreSQL

- Добавить PostgreSQL-backed `iiko_order_dispatches` intent, создаваемый атомарно при первом переходе payment в `succeeded`.
- Обеспечить unique `order_id`/correlation ID и идемпотентность повторных webhook.
- Хранить submission status, attempt count, next retry, provider order ID, command ID и безопасный error code.
- Сохранять meaningful order transitions в `order_status_history`.
- Не выполнять внешний iiko HTTP внутри payment webhook transaction.
- Восстанавливать pending отправки после перезапуска Backend.

### iiko adapter and processor

- Реализовать отдельный write adapter для оплаченных pickup orders.
- Использовать create order, command status и order polling endpoints simulator contract.
- Валидировать каждый provider response runtime schema; HTTP 200 и `pending` не считать kitchen acceptance.
- Повторно использовать стабильный external/correlation ID при retry.
- Обрабатывать duplicate-order только как восстановимый сценарий для того же нашего заказа.
- Реализовать ограниченный deterministic retry внутри текущего Backend process без очереди, Redis или отдельного worker.
- Не создавать новый внешний order после timeout неизвестного результата.
- Разделить retryable (timeout, connection drop, 429, временный 5xx, pending) и terminal ошибки (missing mapping, malformed snapshot, mismatch, provider rejection).
- После исчерпания retry переводить dispatch в `failed`, order — в `fulfillment_problem`; refund не запускать.

### Customer

- Показать состояния: ожидает оплату, передаём заказ, ожидаем кухню, принят, готовится, готов к выдаче, завершён, проблема исполнения.
- Добавить ручное обновление и refresh при возврате приложения в active state без агрессивного постоянного polling.
- Не показывать `kitchen_accepted` до подтверждения iiko.
- Не отдавать iiko token, provider payload, credentials или stack trace.
- Сохранить Web/iOS/Android-совместимость и DOM-independent business logic.

### Verification

- Добавить unit, API, repository integration, concurrency, retry, restart, adapter, Customer и simulator tests.
- Выполнить полный browser E2E оплаченного заказа до `completed`.

## Out of Scope

- Automatic refund, customer cancellation и изменение заказа после оплаты.
- Loyalty, XP, rewards, push/SMS.
- Полноценная Admin Orders panel.
- WebSocket/SSE.
- Redis, Kafka, RabbitMQ, отдельный worker/service, несколько ресторанов.
- Staff authentication и verified customer identity как самостоятельные milestones.
- Production iiko claim без real-account conformance.

## Architecture / Constraints

- Backend остаётся модульным монолитом с одним application process.
- Используется только PostgreSQL `vse_pro_zhar_dev`; отдельная test database запрещена.
- PostgreSQL — source of truth внутреннего order и durable dispatch state; iiko — source of truth kitchen execution status.
- Customer никогда не вызывает iiko напрямую.
- Отправляется только server-confirmed оплаченный order с историческими snapshots и integer minor-unit money.
- Payment redirect/callback не запускает submission.
- Секреты и iiko token не сохраняются во frontend, логах или public responses.
- Внешние payloads и persisted integration data проходят runtime validation.

## Domain State Model

Business statuses:

```text
pending_payment → payment_confirmed → kitchen_accepted → preparing
→ ready_for_pickup → completed
                         ↘ fulfillment_problem
```

Integration statuses хранятся отдельно: `pending`, `creating`, `command_pending`, `submitted`, `failed`.

`payment_confirmed` означает только успешную оплату. `kitchen_accepted` появляется только после подтверждения iiko. Final statuses не регрессируют, а unknown/stale provider status не переписывает более новый status.

Минимальное mapping:

```text
Unconfirmed → payment_confirmed
WaitCooking/ReadyForCooking → kitchen_accepted
CookingStarted → preparing
CookingCompleted/Waiting → ready_for_pickup
Closed → completed
Cancelled → fulfillment_problem
```

## Database Changes

Добавить versioned migration и таблицу наподобие:

```text
iiko_order_dispatches(
  id, order_id unique, correlation_id unique,
  provider_order_id nullable unique, command_id nullable,
  status, attempt_count, next_attempt_at, last_attempt_at,
  last_error_code nullable, created_at, updated_at
)
```

`order_id` ссылается на `orders`; correlation ID не меняется при retry. Для новых позиций сохранить snapshot iiko product mapping. Заказ без mapping snapshot fail-closes в controlled problem state и не отправляется автоматически.

## Payment → Dispatch Boundary

В одной PostgreSQL transaction при первом server-confirmed success:

```text
payment → succeeded
order → payment_confirmed
order_status_history += payment_confirmed
iiko_order_dispatches += pending
```

Использовать unique constraint/`ON CONFLICT DO NOTHING`. Webhook завершается после durable commit и не ждёт iiko network request:

```text
оплата подтверждена → intent сохранён → Backend перезапущен → intent найден → отправка продолжается
```

## Required Tests

### Payment and persistence

- succeeded payment создаёт ровно один dispatch;
- повторный webhook не создаёт второй dispatch;
- pending/canceled payment не создаёт dispatch;
- rollback не оставляет order без intent;
- ошибка intent откатывает переход.

### Concurrency and adapter

- два processor invocation не создают два iiko orders;
- restart продолжает незавершённую отправку;
- retry использует тот же correlation ID;
- duplicate, timeout, connection drop, 429/5xx, malformed JSON, schema drift и ID/amount mismatch обрабатываются безопасно;
- повторный provider status не создаёт history duplicate;
- stale/final status не регрессирует.

### Customer and simulator

- paid не отображается как accepted;
- accepted/preparing/ready/completed/problem copy корректен;
- refresh/AppState lifecycle, unmount cancellation и latest-request-wins проверены;
- проходят happy, duplicate-order, command pending/success/failure, progression, cancellation, terminal-offline и fault scenarios.

## Acceptance Criteria

- Оплата атомарно создаёт durable dispatch intent; падение процесса не теряет order.
- Только оплаченный order может быть отправлен в iiko.
- Retry не создаёт второй внешний order.
- Используются order snapshots и integer money.
- Customer видит только подтверждённые kitchen statuses.
- History сохраняется без дублей и регрессий.
- Ошибка iiko не превращается в ложный success; exhausted retry даёт `fulfillment_problem`.
- Автоматический refund не выполняется.
- Полный simulator/browser flow проходит до `completed`.
- Все проверки проходят на `vse_pro_zhar_dev`; production readiness не заявляется без real-iiko conformance.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm test
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm e2e
git diff --check
pnpm audit --prod
```

Ручная проверка: Customer → test payment → payment webhook → durable dispatch в PostgreSQL → ровно один simulator order → command confirmation → `Готовится` → `Готов к выдаче` → завершённый order.

## Progress

- [x] Завершить repository technical audit.
- [x] Зафиксировать iiko write configuration contract.
- [x] Добавить migration, schema constraints и repositories.
- [x] Добавить payment-to-dispatch atomic boundary.
- [x] Реализовать iiko write/status adapter.
- [x] Реализовать resumable dispatch processor.
- [x] Реализовать status mapping и history.
- [x] Обновить Customer contracts/API/UI.
- [x] Добавить regression, concurrency и restart tests.
- [x] Пройти simulator scenarios и PostgreSQL integration.
- [x] Пройти browser E2E на canonical database; paid status chain дополнительно прошла через реальный Backend processor и simulator.
- [x] Обновить documentation и Outcome.

## Discoveries

- Simulator покрывает create, command status, order polling, duplicate, progression и fault scenarios.
- Simulator не заменяет real iiko account conformance.
- M8 намеренно заканчивается на `payment_confirmed`.
- Технический аудит требует durable intent до внешнего iiko HTTP.
- Для новых заказов iiko mapping сохраняется отдельным immutable snapshot рядом с `order_items`; текущий Product mapping не переписывает историю заказа.
- Simulator write contract требует явных order type и external payment type IDs; без них fulfillment provider остаётся unavailable и не создаёт ложный accepted status.
- `SKIP LOCKED` + lease позволяют двум processor invocations безопасно конкурировать и возобновлять `creating` intent после restart.
- Hosted YooKassa card action не является частью автоматического Playwright run: server-confirmed payment boundary проверен repository/API tests и отдельным local integration flow, без заявления production payment readiness.

## Decision Log

- M9 и M10 объединены в один вертикальный slice: отдельная отправка без видимого кухонного результата не закрывает пользовательский сценарий.
- Durable dispatch реализуется PostgreSQL + текущий Backend process; broker и отдельный worker не добавляются.
- Payment webhook сохраняет intent, но не выполняет iiko network request.
- iiko write adapter и status processor остаются server-only; Customer получает только внутренние status/timestamp, а manual refresh/AppState используется вместо Customer polling loop.
- Retryable provider faults используют тот же correlation UUID; неизвестный результат create не получает новый external ID, а duplicate recovery принимает только matching provider order/organization/amount.
- Refund/cancellation остаются M12, Admin Orders — M11.
- Security blockers из аудита не маскируются этим plan и требуют отдельных owner decisions до production.

## Outcome

M9–M10 реализованы как локальный production-shaped vertical slice для одного Backend process и canonical PostgreSQL `vse_pro_zhar_dev`. Payment repository атомарно создаёт единственный `iiko_order_dispatches` intent при первом server-confirmed success; intent содержит immutable order/item snapshots и переживает process restart. `apps/api/src/iiko/fulfillment.ts` выполняет runtime-validated create/command/status calls, а `apps/api/src/iiko/processor.ts` реализует lease, deterministic retry, duplicate recovery, monotonic order status transitions и `fulfillment_problem` без automatic refund.

Customer contracts и detail UI показывают только Backend-confirmed fulfillment state, добавляют manual refresh и AppState-active refresh, не вызывая iiko напрямую. Проверены unit/API/adapter/processor tests, PostgreSQL migration/probe/integration на `vse_pro_zhar_dev`, 6 browser E2E scenarios на одном worker, production build, lint, typecheck, `git diff --check` и `pnpm audit --prod`.

Локальный сквозной integration run подтвердил цепочку `payment_confirmed → kitchen_accepted → preparing → ready_for_pickup → completed` и единственный simulator order с history без дублей. Real iiko account conformance, hosted YooKassa interactive card action, staff authorization и production readiness остаются явно незакрытыми отдельными решениями; это не подменяется simulator или test doubles.
