# M11 — Admin Orders и операции исполнения

Status: completed
Milestone: M11
Depends on: completed M9–M10 iiko fulfillment, owner decision по staff authentication boundary

## Purpose

Дать сотруднику ресторана безопасную Admin-поверхность для просмотра заказов, оплаты и фактического состояния исполнения через iiko, а также для ограниченного восстановления интеграционных сбоев.

Итоговый сценарий: staff проходит отдельную аутентификацию, видит только доступные ему Admin Orders, открывает детали заказа с snapshots, payment/fulfillment status и history, находит `fulfillment_problem` и может безопасно повторно запустить разрешённую recovery-операцию без создания второго заказа, изменения цены, ручной подмены kitchen status или automatic refund.

## Current State

M0–M10 реализованы как modular monolith с одной PostgreSQL database `vse_pro_zhar_dev`. Customer auth использует лёгкую идентификацию по phone/name и не является staff authorization.

Admin сейчас содержит только catalog/media UI. В sidebar раздел `Заказы` disabled; `/admin/catalog`, catalog mutations и media routes защищены только CORS/origin check, но не staff session. Это подтверждённый security blocker из технического аудита.

Backend уже хранит:

- `orders`, `order_items` с историческими snapshots и `order_status_history`;
- `payments` и дедуплицированные YooKassa events;
- `order_iiko_items` mapping snapshots;
- `iiko_order_dispatches` с correlation/provider/command IDs, attempts, retry time и safe error code;
- подтверждённые business statuses до `completed` и `fulfillment_problem`.

Customer API намеренно возвращает только customer-scoped orders. iiko token, provider payload и credentials не должны переходить в Admin или browser. Admin может получить только минимальные данные, необходимые для операционной работы.

## Scope

### Staff authentication and authorization

- Ввести отдельный staff identity/session boundary, не переиспользуя Customer session и Customer cookie.
- Добавить login, current-session и logout для Admin Web.
- Закрыть staff guard-ом все `/admin/*` routes, включая существующий catalog/media access и новые Orders routes.
- Использовать один уровень доступа: вошедший администратор видит Orders и может выполнять разрешённые fulfillment recovery и catalog/media mutations.
- Обеспечить inactive/revoked/expired staff session rejection и login rate limit.
- Не создавать default credentials и не seed-ить пароль.

### Admin Orders backend

- Добавить authenticated list endpoint с bounded pagination, newest-first sorting и фильтрами по business status, fulfillment status, payment status, date range и order ID/phone search.
- Добавить authenticated detail endpoint с:
  - order/customer snapshots, pickup и integer money;
  - payment status/provider status без secrets и необязательных provider payloads;
  - dispatch status, safe error code, attempt timestamps/count, correlation/provider/command IDs;
  - ordered `order_status_history`.
- Добавить ограниченную recovery-операцию для failed dispatch:
  - lock order и dispatch в одной transaction;
  - сохранять исходный `correlation_id`;
  - при наличии `provider_order_id` только возвращать dispatch в reconciliation/polling path, не делать новый create;
  - без `provider_order_id` возвращать dispatch в create path с тем же correlation ID;
  - не разрешать retry для `completed`, неподтверждённого payment, недопустимого snapshot или явно terminal provider rejection без отдельного решения;
  - повторный concurrent retry должен быть idempotent и возвращать актуальное состояние;
  - сохранять staff action audit.
- Не добавлять endpoint для ручной установки `kitchen_accepted`, `preparing`, `ready_for_pickup` или `completed`: kitchen execution status принадлежит iiko.
- Не реализовывать refund/cancel в M11.

### Admin Web and shared clients

- Заменить disabled `Заказы` на рабочий раздел с login/session bootstrap.
- Реализовать Orders list: loading, empty, error/retry, filters, pagination и заметное представление `fulfillment_problem`.
- Реализовать Order detail: items snapshots, payment, fulfillment, timeline history, safe error message и retry/reconcile action с подтверждением операции.
- Добавить manual refresh; не вводить WebSocket/SSE или бесконечный browser polling.
- Добавить shared contracts, Admin auth/orders clients и request lifecycle controllers с timeout, abort, unmount cancellation и latest-request-wins.
- Не хранить staff password/token в обычном frontend storage; использовать HttpOnly cookie для Admin Web.

### Audit and documentation

- Добавить persistent audit log для успешного staff login/logout и order recovery actions без паролей, provider payloads и лишних PII.
- Обновить README, ARCHITECTURE и ROADMAP с фактическими Admin auth/order boundaries.

## Out of Scope

- Customer OTP/SMS, verified phone ownership и account recovery.
- Automatic refund, customer/admin cancellation и изменение оплаченного заказа — M12.
- Manual kitchen status override и прямые iiko calls из браузера.
- Loyalty, rewards, push/SMS, analytics и полноценный customer management.
- Bulk order editing/export, delivery/courier workflow и multi-restaurant operations.
- WebSocket/SSE, Redis, Kafka, RabbitMQ, отдельный worker/service, Kubernetes или вторая database.
- Production iiko account conformance; simulator остаётся development substitute.

## Architecture / Constraints

- Backend остаётся modular monolith в одном application process.
- Используется только PostgreSQL `vse_pro_zhar_dev`; migrations versioned, production schema вручную не меняется.
- Backend + PostgreSQL — source of truth для staff, orders, payments, dispatch и audit state; Admin UI — только представление подтверждённых данных.
- CORS и `Origin` check не считаются authentication или authorization.
- Staff auth полностью отделён от Customer auth: отдельные tables/session cookie, staff session проверяется на Backend.
- Raw password хранится только как password hash; raw staff/session tokens не сохраняются. Предпочтительно использовать Node built-in `crypto.scrypt`/constant-time comparison вместо добавления auth infrastructure.
- Production cookie — `HttpOnly`, `Secure`, `SameSite=Lax`, explicit path/origin policy. Login errors не раскрывают, существует ли конкретный login.
- Все critical Admin inputs и DB/provider responses проходят runtime validation. Ошибки наружу — только safe error envelope с request ID.
- PII минимизируется: list показывает только необходимое; полный phone доступен только authorized staff в order detail и не попадает в logs/audit metadata.
- iiko является source of truth kitchen execution status. Admin retry/reconcile не превращает payment confirmation в kitchen acceptance и не может вручную подтвердить заказ.
- Recovery после `fulfillment_problem` требует явной state-machine семантики: retry не должен молча регрессировать order status или делать history duplicate. Если текущая модель не может выразить recovery, сначала добавить отдельное внутреннее recovery state/event или owner decision, а не обходить invariant прямым SQL update.

## Proposed Data Model

Точные имена и поля подтверждаются перед migration, но минимальная модель должна покрыть:

```text
staff_users(
  id, login unique, display_name, password_hash, is_active,
  created_at, updated_at
)

staff_sessions(
  id, staff_user_id, token_hash unique, expires_at, revoked_at,
  last_used_at, created_at, updated_at
)

staff_audit_log(
  id, staff_user_id nullable, action, order_id nullable,
  request_id nullable, created_at
)
```

`action` ограничивается database/application allowlist. Foreign keys, indexes на login/session expiry/order/time и safe retention policy обязательны. Не добавлять arbitrary request body или provider response в audit log.

Для recovery выбрать один проверяемый вариант до implementation:

1. расширить `iiko_order_dispatches` lifecycle полем/статусом recovery и добавить controlled recovery method;
2. или сделать transaction method, который атомарно requeues dispatch, сохраняет audit event и явно разрешает iiko-confirmed status выйти из `fulfillment_problem` без повторной записи уже существующих history events.

Выбор должен сохранить stable correlation ID, не допустить второй external order и быть покрыт concurrency test.

## API Contract Proposal

Названия являются proposal для implementation и должны быть зафиксированы в contracts до кода:

```text
POST /admin/auth/login
GET  /admin/auth/me
POST /admin/auth/logout

GET  /admin/orders?status=&fulfillmentStatus=&paymentStatus=&from=&to=&search=&limit=&offset=
GET  /admin/orders/:id
POST /admin/orders/:id/fulfillment/retry
```

List/detail responses не должны включать password hash, session token, iiko access token, raw provider payload, secret, stack trace или Customer session token. Retry response возвращает только safe order/fulfillment state.

## Implementation Sequence

1. Зафиксировать owner decision по staff credential bootstrap, password policy, session TTL и recovery из `fulfillment_problem`.
2. Добавить contracts и database migration для staff users/sessions/audit, constraints/indexes и repositories.
3. Реализовать Backend staff auth service/routes/guards и применить guard к существующим Admin catalog/media routes.
4. Реализовать Admin order repository/service/routes, safe mapping и transactionally idempotent recovery.
5. Добавить shared Admin auth/orders clients/controllers и их lifecycle tests.
6. Добавить Admin login shell, Orders list/detail, filters, history, safe errors и refresh.
7. Добавить audit events и проверить PII/secret boundaries, direct iiko access и authorization matrix.
8. Выполнить integration/concurrency/restart tests, browser E2E и обновить документацию только после фактических результатов.

## Tests

### Staff auth and authorization

- valid login creates one staff session; wrong password/login has same safe error;
- expired, revoked and inactive sessions are rejected;
- Customer cookie/token cannot access Admin routes;
- anonymous requests receive 401 as specified;
- login rate limit, logout idempotency and session cleanup are covered;
- catalog/media mutations remain protected after the new guard is installed.

### Admin orders and recovery

- list filters, pagination, ordering and ownership/authorization are correct;
- detail returns snapshots, history and safe fulfillment fields only;
- customer PII is not present in list/logs where not required;
- retry is atomic, idempotent and concurrency-safe;
- stable correlation ID is preserved;
- existing provider order is reconciled/polled, never recreated;
- failed create without provider order is requeued with the same correlation ID;
- completed/payment-unconfirmed/terminal invalid cases cannot be retried;
- provider/iiko status remains authoritative and Admin cannot manually set kitchen status;
- every meaningful staff action writes one audit record without credentials/payloads.

### UI and browser

- Admin login, session restore and logout;
- полный доступ администратора ко всем реализованным разделам;
- loading/empty/error/retry states for list/detail;
- status filters and `fulfillment_problem` presentation;
- detail refresh and latest-request-wins/unmount cancellation;
- browser E2E: unauthenticated Admin is blocked, authorized staff sees orders, recovery action is safe, Customer remains isolated and no iiko request originates from browser.

## Acceptance Criteria

- All `/admin/*` business endpoints require the separate Backend staff authorization boundary.
- No default or hardcoded staff credentials exist; bootstrap is explicit and auditable.
- Authorized staff can list and inspect orders with snapshots, payment, fulfillment and history.
- вошедший администратор может выполнять catalog/media mutations только после authentication.
- Recovery never creates a second internal or external order and never changes correlation ID.
- Admin cannot mark a kitchen status manually or claim iiko acceptance before Backend confirmation.
- Customer sessions cannot read or mutate Admin data; Admin responses do not expose secrets or provider payloads.
- Recovery and audit writes remain correct under concurrent requests and process restart.
- Customer order state remains consistent after Admin recovery and iiko status polling.
- Automated tests, canonical PostgreSQL integration, browser E2E and production build pass.
- Documentation reflects the implemented auth/order boundaries; real iiko conformance and production identity readiness are not overstated.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm test
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm e2e -- --workers=1
git diff --check
pnpm audit --prod
```

Manual verification на `vse_pro_zhar_dev`: explicit staff bootstrap → Admin login → session restore/logout → full Admin access → Orders list/filter/detail → safe retry of a controlled failed dispatch → same correlation/provider state → processor status refresh → Customer sees only its own order. No real refund, no production iiko write and no second database.

## Progress

- [x] Зафиксировать owner decision по staff auth, bootstrap и recovery semantics.
- [x] Добавить contracts, versioned migration и staff repositories.
- [x] Реализовать staff login/session/logout и Backend authorization guards.
- [x] Защитить существующие Admin catalog/media routes.
- [x] Реализовать Admin Orders repository/service/routes.
- [x] Реализовать idempotent fulfillment retry/reconcile и audit log.
- [x] Добавить shared Admin auth/orders clients и lifecycle controllers.
- [x] Реализовать Admin login и Orders UI.
- [x] Добавить unit/API/repository/concurrency/restart tests.
- [x] Пройти canonical PostgreSQL verification и browser E2E.
- [x] Обновить documentation и заполнить Outcome.

## Discoveries

- Текущий Admin использует только CORS/origin protection; это не заменяет staff authorization.
- Customer session нельзя расширять до staff session: разные trust boundary, cookie namespace и PII scope.
- M9–M10 сохраняют `fulfillment_problem` как безопасный отказ; Admin retry требует явной recovery semantics, иначе текущий monotonic state machine правильно блокирует последующий kitchen status.
- На масштабе десятков заказов в день bounded pagination и PostgreSQL indexes достаточны; отдельный search service или очередь не нужны.
- Recovery можно выразить существующим lifecycle: requeue failed dispatch сохраняет correlation ID, а разрешённый iiko status processor может атомарно вывести order из `fulfillment_problem`; отдельное recovery-состояние не требуется.
- Для обратной совместимости audit `order_id` остаётся nullable при retention/deletion заказа; application inserts recovery audit только вместе с order ID.

## Decision Log

- Staff authorization является обязательной частью M11, потому что Admin уже имеет mutating catalog/media endpoints.
- Предпочтительный baseline — server-side staff users + password hash + opaque HttpOnly sessions в PostgreSQL без внешнего identity service; окончательное решение требует owner approval.
- Один уровень доступа проверяется на Backend, а не только скрывается в UI.
- Admin может инициировать только reconciliation/retry; ручная установка kitchen status запрещена.
- Все Admin order operations остаются в текущем modular monolith и одной canonical database.
- Real iiko conformance, verified customer identity и automatic refund не расширяются этим plan.
- В рамках выданного задания owner decision принят как baseline: staff session TTL — 8 часов, password policy — 12–128 символов, bootstrap — обязательные `STAFF_BOOTSTRAP_*` env без seed/default credentials; login limiter — 10 попыток/IP за 15 минут.

## Outcome

M11 реализован как vertical slice в текущем modular monolith и одной canonical PostgreSQL database. Добавлены отдельные `staff_users`, `staff_sessions`, `staff_audit_log` и `order_customer_snapshots`, `scrypt` password hashing, opaque Admin HttpOnly session cookie, explicit staff bootstrap command, login rate limit и единый Backend staff guard. Все `/admin/*` business routes защищены; вошедший администратор может менять catalog/media, работать с Orders и запускать разрешённый fulfillment recovery.

Добавлены Admin Orders contracts, repository/service/routes и shared clients/controllers. Orders list поддерживает bounded newest-first pagination, filters по business/fulfillment/payment status, датам и ID/phone; detail отдаёт customer/item/pickup snapshots, integer money, payment/dispatch safe fields и history. Recovery атомарно блокирует order+dispatch, reset-ит current attempt cycle, сохраняет correlation ID, выбирает create/reconcile path, пишет audit и не устанавливает kitchen status. Existing provider order не создаётся повторно; `fulfillment_problem` может выйти только после iiko-confirmed status.

Admin Web получил session bootstrap/login/logout, полный catalog, Orders list/detail, loading/empty/error/retry, filters, manual refresh, history, problem banner и confirmation для recovery. Dev/E2E Admin использует same-origin Vite proxy; production cookie policy остаётся HttpOnly/Secure/SameSite=Lax. Документация README/ARCHITECTURE/ROADMAP обновлена.

Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm test` (67 API tests и workspace suites), `pnpm build`, `pnpm audit --prod`, canonical `migrate`/`probe`, canonical PostgreSQL integration 14/14 и Playwright E2E 7/7 на свободных локальных портах. Реальная iiko account conformance, production identity provisioning и refunds остаются вне M11.
