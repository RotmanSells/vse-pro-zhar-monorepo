# Архитектура

```text
Customer Web/iOS/Android ──┐
                            ├──► Backend API ───► PostgreSQL
Admin Web ──────────────────┘          │
                                       └── shared Zod contracts
```

## Foundation boundaries

- Customer — universal Expo application: Expo, React Native, React Native Web, Expo Router. Web — основная ежедневная среда; iOS и Android targets сохраняются в app config. Production strategy не строится на WebView.
- Admin — отдельное web-only приложение на React + Vite.
- Backend — Node.js + TypeScript + Fastify modular monolith.
- `packages/contracts` — shared Zod runtime schemas and types.
- `packages/api-client` — shared `/health`, `/catalog`, `/cart/quote`, authenticated checkout and orders plus customer/session transport/domain boundaries and request lifecycle controllers without env or UI dependencies.
- `packages/database` — server-side PostgreSQL pool, Drizzle connection and versioned migration runner.
- `apps/api/src/media` — server-side multipart boundary, image validation/processing and local media storage adapter.

```text
apps/customer ──HTTP──► apps/api ──catalog repository──► packages/database ──► PostgreSQL
apps/admin    ──HTTP──► apps/api
apps/api / frontends ──► packages/contracts
apps/customer / apps/admin ──► packages/api-client ──► apps/api
```

Frontend applications не подключаются к PostgreSQL, iiko, payment provider или другим integrations напрямую. Они знают только Backend API.

## API and runtime validation

`GET /health` остаётся liveness endpoint самого API и не проверяет database readiness. Customer и Admin используют маленький health API client boundary:

```text
fetch /health
    ↓
unknown response
    ↓
HealthResponseSchema.safeParse()
    ↓
loading / Connected / controlled error + retry
```

Response внешнего API не считается доверенным без runtime validation. Safe API errors скрывают internal error details; request IDs генерируются Backend и не принимаются из произвольного client header как authoritative ID.

`packages/api-client` не читает environment и не использует DOM, React или React Native API. Customer и Admin отдельно передают ему `EXPO_PUBLIC_API_URL` и `VITE_API_URL`; общий boundary выполняет URL normalization, `/health` request, timeout, abort, HTTP/network handling и `HealthResponseSchema` validation. Health-specific request controller обеспечивает cancellation, unmount safety и latest-request-wins, а Web/native presentation остаётся в соответствующих приложениях.

Admin staff auth и Customer auth — разные trust boundaries:

```text
Admin Web ── /admin/auth/* ── HttpOnly admin cookie ──┐
                                                       ├── Backend guard → staff_users/sessions
Customer apps ── /auth/* ── Customer cookie/bearer ───┘
```

Staff credentials хранятся только как `scrypt` hash, raw session token — только в HttpOnly cookie. Любой вошедший администратор имеет полный доступ к catalog/media mutations, Orders и разрешённому fulfillment recovery. Bootstrap не seed-ит пользователя и требует явного набора `STAFF_BOOTSTRAP_LOGIN`, `STAFF_BOOTSTRAP_PASSWORD` и `STAFF_BOOTSTRAP_DISPLAY_NAME` variables.

Catalog client выполняет тот же runtime-validated transport boundary для `GET /catalog`, Admin mutations и image upload и отправляет credentialed requests, чтобы HttpOnly staff cookie работала и через same-origin proxy, и при разрешённом cross-origin API. Backend повторно валидирует входные данные, вычисляет и возвращает цены в `priceMinor`, а UI использует клиентское состояние только как представление подтверждённого ответа.

Cart quote использует отдельный side-effect-free boundary:

```text
Customer cart references + quantities
    ↓
POST /cart/quote
    ↓
Backend validates request → PostgreSQL public catalog price/visibility
    ↓
integer line totals + totalMinor, or atomic unavailable error
```

Customer не передаёт цену или total и не создаёт заказ на этом этапе. Shared cart logic не зависит от DOM; Web `localStorage` и native persistent storage подключаются отдельными adapters.

Pickup checkout остаётся read-only boundary:

```text
identified Customer
    ↓
GET /checkout/options → Backend pickup configuration
    ↓ selected location + slot
POST /checkout/quote
    ↓
session + cart references + current public catalog
    ↓
Backend iiko availability adapter (explicit mapping + fresh iiko state)
    ↓
server-confirmed names, integer prices, total and selected pickup
```

Pickup location and slots are generated on the Backend from one configured point, 30-minute slots, 10:00–22:00 and `Europe/Moscow`. When all server-only `IIKO_*` variables are explicitly configured, the adapter obtains an iiko token and reads `terminal_groups/is_alive` plus `stop_lists` for the configured organization and terminal. It never reads iiko names/prices as our catalog source and never performs order writes in M6. Missing `Product → iiko product` mapping, unknown/stale availability, malformed responses or provider failure cannot become `available` through catalog visibility; without a complete adapter configuration the default remains fail-closed. The local simulator at `/Users/rotman/Desktop/vse-pro-zhar-iiko-simulator` is only a development substitute and is not a production dependency. The response text explicitly says that the Order has not been created, and the boundary has no payment, iiko submission or kitchen side effects.

Internal orders extend the checkout boundary only after a confirmed quote:

```text
identified Customer
    ↓ cart references + pickup selection + Idempotency-Key
POST /orders
    ↓
session + current catalog + prices + fresh iiko availability + pickup slot
    ↓
one PostgreSQL transaction
    ├── orders (pending_payment, totalMinor, pickup snapshot, fingerprint)
    ├── order_items (historical product snapshots)
    └── order_status_history (initial pending_payment event)
    ↓
created order response
```

`OrderService` checks the Customer session before using an idempotency key. A replay for the same Customer/key and fingerprint returns the existing aggregate without a second order; a different fingerprint returns `IDEMPOTENCY_CONFLICT`. `GET /orders` and `GET /orders/:id` scope every query by the authenticated `customer_id`, so a Customer cannot read another Customer’s order. The Customer clears local cart references only after the confirmed create response. `pending_payment` is not a payment fact, kitchen acceptance or iiko submission; M7 has no payment provider/webhook and no iiko order-write call.

Test card payment extends the internal order boundary through a Backend-owned YooKassa adapter:

```text
identified Customer
    ↓ Idempotency-Key, no amount/status/provider id
POST /orders/:id/payments
    ↓
session + Customer ownership + pending_payment order
    ↓ persisted order total/currency
YooKassa test-mode bank-card redirect payment
    ↓
payments (pending) + safe confirmation URL
    ↓ provider webhook → Backend GET /v3/payments/:id
payment_events deduplication + amount/currency/order binding
    ↓ only verified succeeded + paid
payment = succeeded; order = payment_confirmed
```

The Customer never calls YooKassa directly and never treats redirect, QR, local state or a create response as payment proof. `POST /webhooks/yookassa` accepts only runtime-validated notification payloads, ignores unknown provider payments without side effects, deduplicates event fingerprints in PostgreSQL and uses the current provider object before applying a transition. `payment_confirmed` means only that Backend confirmed payment; missing or invalid server-only YooKassa configuration fails closed without making a real provider request.

Paid fulfillment remains a separate server-only boundary:

```text
verified YooKassa success
    ↓ one PostgreSQL transaction
payment succeeded + order payment_confirmed + iiko_order_dispatches pending
    ↓ commit; no iiko HTTP in webhook
single Backend process: lease → iiko create → command status → order polling
    ↓ runtime validation + monotonic mapping
order kitchen_accepted → preparing → ready_for_pickup → completed
```

`apps/api/src/iiko/fulfillment.ts` is the write/status adapter and `processor.ts` is the resumable in-process loop. The adapter sends order and payment snapshots in integer-minor-unit-derived amounts, reuses the same correlation UUID on retries, and recovers a duplicate only after matching provider order ID, organization and total. `creating` leases allow restart recovery after an unknown timeout without issuing a new external ID. Pending, unknown or stale iiko states do not imply kitchen acceptance; retry exhaustion and provider cancellation become `fulfillment_problem`, with no automatic refund. Customer responses contain only the internal order/fulfillment status and timestamp.

Admin Orders остаётся server-backed operational surface:

```text
staff session → bounded Orders list/detail → recovery confirmation
                                      ↓
                         order lock + dispatch lock + audit
                                      ↓
       failed dispatch → pending/submitted with the same correlation ID
```

Recovery никогда не устанавливает kitchen status, не делает refund и не вызывает iiko из браузера. `fulfillment_problem` выходит только через runtime-валидированный iiko status существующего processor; provider payloads, credentials, password hashes и session tokens не входят в Admin response или audit metadata.

Cancellation and refund extend the same modular-monolith boundary:

```text
Customer/Admin intent + Idempotency-Key
    ↓ order lock → payment/dispatch lock
order_cancellations + order.status = canceled + history
    ↓ only persisted payment.succeeded
one refunds intent (exact payment amount/currency)
    ↓ outside the database transaction
YooKassa POST /v3/refunds → persisted pending/succeeded/canceled/reconciliation_required
```

M12 allows cancellation only for `pending_payment` and `payment_confirmed` orders before iiko external work starts; `providerOrderId`, kitchen states, `fulfillment_problem` and `completed` are fail-closed. A late successful payment for a canceled order is persisted as a payment fact but cannot create an iiko dispatch; it creates the same single refund intent. YooKassa timeout, connection failure, 5xx or a mismatched response never become `refunded`; the processor persists reconciliation-required state and never creates a second refund automatically. `payment.succeeded` remains separate from refund state. The provider adapter performs server-side `POST /v3/refunds` and `GET /v3/refunds/:id` with the persisted idempotency key and exact minor-unit amount; the full-refund request omits `receipt` and leaves any provider-side receipt registration to the shop's YooKassa configuration. Raw provider payloads and secrets do not enter PostgreSQL, audit or UI. Production refund readiness remains pending the shop's approved test-account/accounting check.

Customer identification остаётся лёгкой UX-идентификацией без подтверждения владения номером:

```text
anonymous add
    ↓
CustomerIdentifyModal (phone + name, optional birth date)
    ↓
POST /auth/identify (phone-only, Web/native) → PostgreSQL upsert + opaque session
    ↓
one pending { productId, quantity } action → local guest cart
```

Backend + PostgreSQL — source of truth для normalized phone, profile и session validity. Web session transport — HttpOnly/Secure/SameSite cookie с explicit origin allowlist; локальный Customer Web и API используют host `localhost` для одной cookie site family, нельзя смешивать `localhost` и `127.0.0.1` для auth/checkout. iOS/Android — bearer token через injected secure-storage adapter; phone-only auth не отправляет SMS-коды. Native `expo-notifications` получает permission/token на устройстве, а Backend хранит device registry и preference. Raw session token не хранится в PostgreSQL, localStorage или AsyncStorage. SMS.ru adapter оставлен как server-side boundary для будущих SMS-уведомлений и не вызывается auth flow. M6 добавляет только authenticated read-only checkout validation; M7 добавляет server-backed internal order persistence with `pending_payment`, idempotency and Customer ownership, без payment/iiko flows.

Изображение проходит через Backend до записи URL в Product:

```text
Admin file picker
    ↓ multipart
POST /admin/media/images
    ↓ MIME + decoded image validation
sharp: EXIF rotate → resize ≤ 1600px → WebP quality 82
    ↓
MEDIA_DIR/*.webp ──► public /media/:filename
    ↓
Product.imageUrl в PostgreSQL
```

## Browser CORS

Backend регистрирует официальный Fastify CORS plugin с явным runtime-validated `CORS_ALLOWED_ORIGINS`. Development defaults ограничены локальными Customer (`localhost:8082`) и Admin (`localhost:5173`) origins; production без корректного allowlist не стартует. Wildcard `*` не используется.

## Database

M16.7 добавляет `categories.version` и `category_versions` для append-only create/update/archive snapshots. Category mutations проходят Staff auth, safe Origin, глобальную idempotency key и row lock + optimistic version check; Admin получает server-owned order/visibility/count, Customer не получает hidden category или её Product в catalog/quote/checkout.

Database foundation использует `pg` pool и Drizzle ORM/Kit. `DATABASE_URL` валидируется как PostgreSQL URL и существует только в server/CI environment. Pool можно закрыть явно; migration runner использует `packages/database/drizzle/`.

Проект использует одну основную PostgreSQL database; для текущего локального контура это `vse_pro_zhar_dev`. Backend, migrations и ручная browser-проверка не должны создавать или использовать `vse_pro_zhar_test`, другие `*_test` databases или отдельный локальный PostgreSQL instance. Test doubles допустимы только внутри изолированных automated tests и не являются рабочей database.

Operational availability and kitchen execution are external-provider inputs behind separate Backend adapters. The iiko simulator may be used for local availability, create, command and status checks, but it must not be wired into production as a fake provider; real iiko credentials, reviewed order/payment mappings and reviewed product mappings are required for production configuration. Local manual checks use the single canonical `vse_pro_zhar_dev` database, never a test database.

API/database configuration failures сохраняют fail-fast поведение. Startup и CLI выводят только структурированные safe issue paths и категории; значения environment, credentials и полные connection URLs не логируются.

M1 создаёт business schema `categories` и `products` через versioned migration. M5 добавляет `customers` и `customer_sessions`; upsert Customer и session insert выполняются в одной транзакции, normalized phone уникален, expiry/revocation проверяются на Backend. M7 добавляет `orders`, `order_items` и `order_status_history`; M8 — `payments` и `payment_events`; M9 — `order_iiko_items` mapping snapshots и `iiko_order_dispatches`; M11 — `order_customer_snapshots`, `staff_users`, `staff_sessions` и `staff_audit_log`; M12 — `order_cancellations`, `refunds` и `refund_events`; M13 — `loyalty_accounts`, append-only `loyalty_ledger`, `loyalty_rank_history`, reward definitions и redemption intents; M13.5 — fixed-discount reward targets, immutable reward versions и redemption-order snapshots. Order/payment/dispatch/cancellation/refund/loyalty state, item snapshots and provider events записываются с транзакционными инвариантами, а `(customer_id, idempotency_key)`, `(provider, event_fingerprint)`, `(order_id, status)`, one cancellation per order, one refund per payment и `(source_type, source_id, rule_version)` для earn защищены unique constraints. Денежные order/payment/refund payloads используют integer-compatible PostgreSQL `bigint` с Backend safe-integer validation; XP и угольки используют bounded PostgreSQL integer. M13 начисляет `floor(totalMinor / 100)` XP и `floor(totalMinor / 10_000)` угольков только для `completed` + provider-confirmed `succeeded`, а account update, ledger snapshot и rank transition выполняются в одной transaction. Начальная migration добавляет только семь категорий для рабочей таксономии; фиктивные товары и rewards не seed-ятся. `Category`, `Product`, `Customer`, `CustomerSession`, `Order`, `Payment`, `IikoDispatch`, `Cancellation`, `Refund` и Loyalty entities принадлежат Backend + PostgreSQL, а repositories изолируют доступ к Drizzle. M2 хранит обработанные изображения в `MEDIA_DIR`, а их URL — в `Product.imageUrl`; для текущего single-process масштаба отдельный object storage не добавляется. Если `DATABASE_URL` не задан, API остаётся доступным для health, но business endpoints возвращают контролируемый `SERVICE_UNAVAILABLE`, чтобы demo-данные не попадали в runtime.

M14 добавляет server-owned `wheel_settings`, `wheel_prizes`, immutable `wheel_spins`/reward claims и `quest_definitions`/progress/events/claims. M16.5.1 добавляет `communication_template_versions`, `communication_drafts` и append-only `communication_draft_audit`: draft content, template/segment/promo versions and bounded preview metadata принадлежат Backend/PostgreSQL, а raw recipients/provider payloads и delivery states не сохраняются. Spin, quest rewards, native device registration и communication draft mutations проходят через PostgreSQL unique keys/row locks; массовый campaign dispatch остаётся отдельным provider/outbox scope.

## Development experience

Root pnpm workspace не использует Nx, Turborepo, Redis, Kafka, RabbitMQ, Kubernetes, microservices или другую инфраструктуру «на будущее». `pnpm dev` параллельно запускает ровно три приложения:

- Customer Web — `http://localhost:8082`;
- Admin Web — `http://127.0.0.1:5173`;
- API — `http://127.0.0.1:3000`.

Root-команды, которым нужны shared packages, сначала последовательно выполняют сборку `packages/contracts` и `packages/api-client`, а затем запускают package `*:root` scripts. Поэтому параллельный запуск приложений не записывает в один shared `dist`; standalone `dev`/`build` команды приложений сами имеют явную подготовку packages.

`apps/customer/expo-env.d.ts` — generated Expo declaration и игнорируется Git. Управляемая типизация public `EXPO_PUBLIC_API_URL` находится в `apps/customer/src/env.d.ts`.

PostgreSQL не нужен для health-screen development. Для реального catalog runtime, database commands, integration checks и catalog lifecycle E2E нужен CI service или явно настроенный development PostgreSQL.

## Sources of truth

Внутренние business entities принадлежат Backend + PostgreSQL. Customer Web, iOS, Android и Admin никогда не являются источником истины для prices, totals, customer profile, session validity, orders, payments, availability, promo validity или rewards. Локальная guest cart — только reference state `{ productId, quantity }`; authoritative текущая цена и quote принадлежат Backend + PostgreSQL. Phone/name — пользовательское утверждение, не verified identity. Operational availability и kitchen execution принадлежат iiko через отдельные Backend adapters с mapping и runtime validation; при отсутствии полной конфигурации или валидного ответа M6 fail-closes checkout, а M9–M10 не создают ложное fulfillment success. Payment fact принадлежит YooKassa server event + persisted Backend state; dispatch intent и внутренний order history принадлежат Backend + PostgreSQL.
