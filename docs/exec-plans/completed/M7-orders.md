# M7 — Внутренние заказы

Status: completed
Milestone: M7
Depends on: M6 Pickup checkout, M5 Customer authentication, M3 iiko availability

## Purpose

После подтверждённого checkout identified Customer может создать внутренний заказ в Backend + PostgreSQL. Заказ сохраняется со статусом `pending_payment`, доступен только владельцу, а Customer получает подтверждённый ответ с ID, total и статусом. Payment, webhook и отправка в iiko в эту задачу не входят.

## Current State

- M6 предоставляет server-confirmed checkout quote с pickup location/slot и повторной проверкой catalog visibility, prices и iiko-compatible availability.
- Customer session хранится и проверяется Backend-ом; anonymous/expired/revoked sessions не имеют доступа к защищённым операциям.
- Cart хранит только `{ productId, quantity }`; authoritative prices, totals и product names приходят из Backend.
- Backend — modular monolith, PostgreSQL — authoritative source; canonical local database: `vse_pro_zhar_dev` через `DATABASE_URL`.
- В repository добавлены order tables, order contracts, repository/service, routes и Customer order flow.

## Scope

- Добавить shared runtime-validated contracts для создания заказа, ответа, статусов, списка/просмотра собственных заказов и safe errors.
- Добавить versioned Drizzle migration и schema для `orders`, `order_items`, `order_status_history` с constraints, snapshots и idempotency key.
- Реализовать repository/service в существующем modular monolith: session ownership, повторная catalog/visibility/price/iiko availability/pickup validation, integer minor-unit arithmetic с overflow checks, атомарная запись заказа/items/initial history и idempotent replay/conflict.
- Добавить защищённые `POST /orders`, `GET /orders`, `GET /orders/:id`.
- Добавить shared API client/controller и Customer UI: create after successful quote, loading/error/success, confirmed ID/total/`Ожидает оплаты`, clear cart only after backend success, own-order list/view.
- Добавить contracts, service/repository, API/idempotency/database integration и Customer UI/controller tests.

## Out of Scope

- Payment provider, SBP, payment webhook, refund, payment redirect.
- iiko order submission, kitchen statuses, retries/recovery и Admin Orders.
- Новая инфраструктура, вторая database, test database, Redis/message broker и отдельный service.
- Client-authoritative price, total, product name, availability или order status.

## Architecture / Constraints

- Использовать только `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev`; не создавать и не использовать `*_test` databases.
- Все деньги — integer minor units; backend заново читает Product и iiko availability, клиентские цены/total игнорируются или отклоняются.
- `product_is_orderable = admin_enabled AND iiko_available`; unknown/stale/unavailable/malformed availability и unavailable pickup slot fail closed.
- Запись order, snapshots и initial status history выполняется одной DB transaction.
- Idempotency scope включает Customer и key; тот же key + тот же canonical payload возвращает существующий заказ, другой payload даёт понятный conflict.
- Customer видит только свои заказы; UI не утверждает payment/kitchen/iiko state.
- M7 не вызывает iiko submission и payment provider.

## Implementation Requirements

- Сохранить исторические `product_name`, `unit_price_minor`, `quantity`, `line_total_minor` в `order_items`.
- Хранить pickup location/slot, `pending_payment`, currency, timestamps, customer_id и безопасный idempotency fingerprint/key в `orders`.
- Ввести versioned migration и не менять схему вручную.
- Shared client/controller не должен зависеть от DOM; transport остаётся совместимым с Web/native session adapters.

## Tests

- Contracts: valid/invalid create/list/detail/status/error payloads, неизвестные поля, empty items, invalid quantities/slot/money.
- Service/repository: 401 boundary, visibility/price/availability/pickup recheck, backend-owned totals/snapshots, overflow, atomic rollback, ownership, idempotent replay/conflict.
- API: POST/GET auth, validation, safe errors, own-order access.
- Database integration только через canonical `vse_pro_zhar_dev`.
- Customer UI/controller: create flow, loading/error/success, retry-safe cart clearing, status copy, own orders, no payment/iiko side effects.

## Acceptance Criteria

- [x] Identified Customer после успешного checkout quote создаёт ровно один внутренний `pending_payment` order.
- [x] Anonymous/expired/revoked Customer получает 401.
- [x] Backend сам вычисляет total и snapshots; client total/price/name/status не authoritative.
- [x] Empty/invalid cart, hidden/unknown product, changed price, unavailable/stale iiko availability и unavailable pickup slot отклоняются без partial order.
- [x] Duplicate Idempotency-Key безопасно возвращает тот же order; другой payload даёт conflict.
- [x] Order/items/initial status history атомарны.
- [x] Customer может получить список и detail только собственных заказов.
- [x] В M7 нет payment provider/webhook и iiko order submission.
- [x] Required verification commands and canonical DB probe pass.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar-database probe
git diff --check
```

Manual browser flow: current Customer/API localhost ports, identified session, successful checkout quote, create order, verify success text and own order readback; confirm no payment/iiko submission requests.

## Progress

- [x] Прочитать обязательные архитектурные документы и M6 plan.
- [x] Создать active plan и зафиксировать M7 scope.
- [x] Реализовать contracts, database schema/migration и repository/service.
- [x] Реализовать API routes и shared Customer client/controller.
- [x] Реализовать Customer order creation/history UI.
- [x] Добавить и выполнить automated/database verification.
- [x] Обновить Discoveries, Decision Log и Outcome.
- [x] Выполнить browser POST `/orders` после action-time confirmation и закрыть plan.
- [x] Перенести plan в `docs/exec-plans/completed/` после успешной проверки.

## Discoveries

- M6 специально заканчивается read-only quote и не создаёт Order; M7 должен принимать те же pickup/catalog/availability boundaries повторно на write boundary.
- Canonical PostgreSQL `vse_pro_zhar_dev` была доступна: migration `0002_watery_toxin.sql`, probe и database integration прошли; новые order money fields используют PostgreSQL `bigint` с safe-integer validation.
- `OrderService` проверяет existing Customer/key до повторного quote, поэтому сетевой retry после успешной записи возвращает тот же order даже если текущий catalog state уже изменился.
- Для локального browser checkpoint порт `3000` занят сторонним приложением; текущий API работает на `3001`, а Customer Web уже настроен на этот API. Browser quote, POST `/orders` и GET `/orders` прошли на identified Customer; созданный заказ имеет статус `pending_payment`.

## Decision Log

- Для idempotency используется unique `(customer_id, idempotency_key)` и server-side canonical payload fingerprint в PostgreSQL; отдельная инфраструктура не нужна.
- Заказ сохраняется только как внутреннее состояние `pending_payment`; M7 не трактует создание заказа как оплату или kitchen acceptance.
- List response содержит summary без item snapshots; detail/create response содержит snapshots. Каждый ownership query фильтруется по authenticated `customer_id`, а чужой detail намеренно возвращает `404`.

## Outcome

M7 завершён как vertical slice: shared contracts, versioned migration/schema, transactional order repository, backend validation/API, idempotency, Customer create success/error flow и own-order list/detail реализованы. Полные `lint`, `typecheck`, `test`, `build`, canonical database probe и `git diff --check` прошли. Ручной browser flow через локальные Customer/API порты подтвердил checkout quote, создание внутреннего заказа и его чтение владельцем; запись содержит `pending_payment`, snapshots и initial status history. Payment provider, webhook и отправка заказа в iiko в M7 отсутствуют. Следующая задача по roadmap — M8 SBP payment.
