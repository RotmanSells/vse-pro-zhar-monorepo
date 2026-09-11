# M8 — SBP payment через YooKassa

Status: completed
Milestone: M8
Depends on: M7 — внутренние `pending_payment` заказы

## Purpose

После создания собственного заказа Customer может инициировать тестовый SBP-платёж через YooKassa. Backend сохраняет payment state, возвращает только безопасный confirmation payload, обрабатывает серверное подтверждение через YooKassa webhook/API и не считает redirect доказательством оплаты.

## Current State

- M7 завершён: identified Customer создаёт принадлежащий ему `pending_payment` order через PostgreSQL, с integer minor-unit total, item snapshots и idempotency.
- Backend — Fastify modular monolith; Customer Web/iOS/Android используют shared contracts и api-client, не обращаясь к provider напрямую.
- Canonical local database: `vse_pro_zhar_dev` через настроенный `DATABASE_URL`; отдельная test database запрещена.
- В YooKassa REST API для интернет-платежа SBP используются `payment_method_data.type = sbp`, `confirmation.type = redirect`, `return_url`, `capture = true` и заголовок `Idempotence-Key`; webhook `payment.succeeded` содержит актуальный на момент события payment object.

## Scope

- Shared strict runtime-validated contracts для payment provider/statuses, create/detail responses, webhook payload, safe errors и idempotency/provider conflicts.
- Versioned Drizzle migration/schema для `payments`, `payment_events` и payment-confirmed order state.
- Payment repository/service с ownership, persisted order amount/currency validation, provider idempotency, duplicate/out-of-order event handling и transactional status changes.
- YooKassa REST adapter с server-only credentials, SBP creation, normalized response validation и безопасной классификацией provider failures.
- Protected `POST /orders/:id/payments`, `GET /orders/:id/payment` и `POST /webhooks/yookassa`.
- Shared Customer payment client/controller и UI: initiate, loading, confirmation URL via platform adapter, pending after return, backend refresh, success only after backend confirmation, retry/error.
- Contracts, adapter, repository/service, API, ownership/idempotency/webhook and Customer controller/UI tests.

## Out of Scope

- Production payment mode, real provider payment/manual browser payment without separate action-time confirmation.
- iiko order submission, kitchen statuses, refund, cancellation, loyalty, Admin Orders и M9+ scope.
- Redis, queues, отдельный payment service, вторая database или client-authoritative payment/order state.

## Architecture / Constraints

- Credentials `YOOKASSA_SHOP_ID`/`YOOKASSA_SECRET_KEY` читаются только Backend-ом; значения не выводятся и не попадают в frontend, `.env.example`, snapshots или API response.
- При отсутствующих, замаскированных или невалидных credentials реальные provider-запросы не выполняются. Provider adapter тестируется test doubles.
- Backend повторно читает order из PostgreSQL; amount берётся из persisted `orders.total_minor`, currency — из persisted order. Client не передаёт amount, total, currency, provider payment id или status.
- Клиентский redirect, QR или локальное состояние не являются доказательством оплаты. `order.status = payment_confirmed` появляется только после принятого server-side YooKassa подтверждения.
- Webhook payload проходит strict runtime validation; provider payment object дополнительно проверяется по id, amount, currency, metadata/order binding и допустимому transition. Повторное событие дедуплицируется PostgreSQL unique constraint.
- Все API errors — safe contracts; unknown provider details не раскрываются Customer.
- Native-compatible payment transport не зависит от DOM; открытие confirmation URL изолировано platform adapter-ом.

## Implementation Requirements

- Persist payment provider/status separately from order status; store confirmation metadata without secrets.
- Enforce one active payment per order in the selected model, unique provider payment id and idempotency key scope.
- Preserve transactional order/payment/event state transitions and safe retry behavior.
- Do not send order to iiko from any M8 path.

## Tests

- Contracts: strict valid/invalid payment and webhook payloads, safe errors, provider status transitions.
- YooKassa adapter: request shape, Basic auth without leakage, SBP payload, idempotency, timeout/4xx/5xx/malformed response and test-mode guard.
- Repository/service/API: authenticated ownership, pending-payment status, persisted amount/currency, idempotency replay/conflict, concurrency, duplicate/out-of-order webhook, mismatch and provider unavailable.
- Database integration only through canonical `vse_pro_zhar_dev`.
- Customer controller/UI: loading, confirmation adapter, pending refresh, backend-confirmed success, retry/error and no secret/authoritative local state.

## Acceptance Criteria

- [x] Identified Customer can create exactly one YooKassa SBP payment for own `pending_payment` order and receive safe confirmation data.
- [x] Anonymous/expired/revoked Customer receives 401; another Customer cannot create/read payment for the order.
- [x] Client amount/currency/provider payment id/status are ignored or rejected; persisted order values are authoritative.
- [x] Repeated same idempotency request returns same payment result; conflicting payload returns 409.
- [x] Webhook is strict, server-confirmed, deduplicated, transactionally persisted and safe for malformed/duplicate/out-of-order input.
- [x] Only server-confirmed successful YooKassa payment changes order to `payment_confirmed`; no iiko/kitchen claim is exposed.
- [x] Required verification commands pass without revealing credentials or claiming an unconfirmed payment.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar-database probe
git diff --check
```

Manual browser flow is limited to UI/API state checks without clicking the external YooKassa payment action unless the user separately confirms at action time.

## Progress

- [x] Прочитать обязательные архитектурные документы и M7 plan.
- [x] Зафиксировать M8 scope в active execution plan.
- [x] Реализовать contracts, database schema/migration и repositories.
- [x] Реализовать YooKassa adapter, payment service, API routes и webhook.
- [x] Реализовать shared Customer client/controller и UI.
- [x] Добавить и выполнить automated/database verification.
- [x] Обновить Discoveries, Decision Log и Outcome фактическими результатами.
- [x] Перенести plan в `docs/exec-plans/completed/` после успешной проверки.

## Discoveries

- Официальный интернет-SBP flow YooKassa использует `payment_method_data.type = sbp`, redirect confirmation и автоматический capture; webhook notification object нужно дополнительно сверять с текущим provider payment state.
- Локальный корневой `.env` содержит test-store credentials; Backend загружает корневой env-файл даже при запуске из `apps/api`, а test secret может содержать literal `*`.
- Для конкурентных payment-create запросов PostgreSQL row lock удерживается до завершения provider call; это сохраняет один active payment на order без Redis/очереди.
- Canonical migration `0003_nosy_boomerang.sql` применена к `vse_pro_zhar_dev`; database integration с payment/event tables проходит после исправления только test fixtures.
- Customer controller переводит `canceled` payment в retryable error и создаёт новый idempotency key для повторного запуска; pending/waiting остаются pending до Backend confirmation.
- Реальный YooKassa payment action после настройки credentials не выполнялся; provider contract по-прежнему проверяется test doubles с `test: true`, а локальная iiko availability проверена read-only через simulator.

## Decision Log

- Для M8 используется REST adapter на встроенном `fetch`, без нового SDK или отдельного сервиса: текущий масштаб не требует дополнительной инфраструктуры, а provider boundary остаётся заменяемым.
- Create-response всегда сохраняется с внутренним `pending`, даже если provider response содержит `succeeded`; order переводится в `payment_confirmed` только обработчиком server-side webhook после provider GET и сверки суммы/currency/order binding.
- `payment_events` дедуплицируются по `(provider, eventFingerprint)`, потому что webhook contract не предоставляет отдельный обязательный event id в принятом payload.
- YooKassa credentials загружаются только в Backend startup из корневого `.env`/process environment; Customer получает только `PaymentSummary` и redirect URL, без provider payment id или credentials.

## Outcome

M8 реализован и проверен. Добавлены strict contracts, migration `0003_nosy_boomerang.sql`, `payments`/`payment_events`, транзакционный payment repository, YooKassa SBP adapter, authenticated payment routes, webhook с provider GET и Customer pending/refresh/retry UI. После настройки test-store credentials Backend успешно стартует с корневым `.env`, health endpoint отвечает, а local iiko simulator возвращает `available`; реальный YooKassa payment action всё ещё не выполнялся. Подтверждённая оплата, `payment_confirmed` в production и отправка в iiko не заявляются. M9 не начинался.
