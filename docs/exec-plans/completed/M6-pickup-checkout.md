# M6 — Оформление заказа самовывозом

Status: completed
Milestone: M6
Depends on: M3 iiko mapping + availability, M4 Cart и M5 Customer profile/session

## Purpose

Сделать Customer-сценарий оформления заказа самовывозом: клиент с сохранённым профилем открывает checkout из корзины, видит подтверждённый Backend итог, выбирает доступные параметры самовывоза и получает понятный результат подготовки заказа.

Этот plan заканчивается на безопасном checkout boundary и не подключает оплату, отправку заказа в iiko или кухонные статусы. Создание и жизненный цикл исторического Order должны быть отдельным M7 vertical slice; checkout не должен создавать неподтверждённый или оплаченный заказ только из-за client-side действия.

## Current State

Проверено перед созданием задачи:

- Customer Web/iOS/Android используют общий cart state и platform-specific storage adapters.
- Guest cart хранит только `{ productId, quantity }`; цены и total приходят из `POST /cart/quote`.
- Customer profile сохраняется в PostgreSQL по normalized phone, а session восстанавливается через `/auth/me`. OTP, SMS и подтверждение владения номером отсутствуют и не будут добавляться.
- Backend + PostgreSQL являются источником истины для Product, current price, visibility, Customer profile и session validity.
- В repository нет checkout contracts, checkout route, pickup location/time model или order creation flow.
- Payment, SBP, iiko order submission, kitchen statuses, refund и Admin Orders ещё не реализованы.
- `docs/ROADMAP.md` определяет последовательность M3 availability → M6 Pickup checkout → M7 Orders → M8 SBP payment → M9 iiko order submission.

## Scope

### Checkout contract and Customer flow

- Добавить строгие runtime-validated contracts для checkout request/response.
- Принимать cart references только из текущего Customer cart; не принимать от клиента цену, line total, total, payment status или availability result.
- Показывать checkout только для identified Customer с действующей server-backed session.
- Отобразить перед отправкой:
  - позиции и quantities из cart;
  - актуальные названия и цены из Backend quote;
  - integer total в minor units, отформатированный только для UI;
  - Customer phone/name из server-confirmed profile;
  - доступные параметры самовывоза согласно Backend configuration.
- Добавить loading, unavailable, stale quote, validation, retry и success/error states.
- При изменении корзины, цены, visibility или availability повторно получать Backend quote и не показывать старый total как актуальный.
- Передать Customer в checkout только после session check; не добавлять OTP, SMS, password, registration или phone verification.

### Pickup rules

- Определить и валидировать pickup location/slot через Backend boundary, а не через захардкоженные значения Customer UI.
- Не разрешать выбрать скрытую, несуществующую или operationally unavailable точку/слот.
- Явно разделить public Product visibility и iiko operational availability.
- Если доступность неизвестна, stale или provider недоступен — fail closed с безопасным сообщением и Retry.
- Не добавлять доставку, адрес доставки, tips, promo, loyalty, modifiers или delivery fee без отдельного требования.

### Backend boundary

- Добавить checkout read/validation endpoint, например `POST /checkout/quote` или эквивалентный узкий route, через существующий modular monolith и dependency injection.
- Backend на каждом запросе повторно проверяет Customer session, cart references, quantities, current prices, public visibility и M3 availability.
- Backend не доверяет client-provided total или pickup state; response проходит runtime validation в shared client.
- Checkout validation не должна иметь order/payment/iiko side effects.
- Если выбранный pickup параметр стал недоступен между запросами, вернуть контролируемую ошибку без partial success.

### Customer UI and boundaries

- Добавить доступную кнопку перехода в checkout из непустой корзины.
- Добавить отдельный checkout screen/component, совместимый с Web/iOS/Android и не зависящий от DOM API.
- Не очищать cart до подтверждённого результата разрешённой операции.
- Не помещать в локальное cart storage Customer PII, цены, checkout totals, payment data или order status.
- Не показывать Customer ложный статус «заказ принят кухней» или «оплачен».

### Documentation

- Обновить README/ARCHITECTURE только после реализации так, чтобы были явно описаны checkout source of truth, pickup boundary и отсутствие payment/iiko side effects.
- Если для pickup locations/slots потребуется новая business entity, сначала зафиксировать её owner-approved contract и versioned migration.

## Out of Scope

- Полный Order lifecycle, order history, order items и Admin Orders — M7.
- Payment provider, SBP, payment initiation/webhook, idempotent payment events и refund — M8/M12.
- Отправка подтверждённого заказа в iiko, retry/recovery и kitchen acceptance — M9/M10.
- OTP, SMS, пароль, регистрация и любое подтверждение номера телефона.
- Delivery, адрес доставки, promo, loyalty, XP, rewards, tips, modifiers, combos и динамические fees.
- Redis, message broker, отдельный checkout/order service, вторую базу или server-side guest cart.
- Client-side authoritative prices, totals, availability или payment state.

## Architecture / Constraints

- Backend + PostgreSQL — authoritative source для Customer session, catalog price/visibility, pickup configuration и operational availability.
- Customer UI — только presentation последнего подтверждённого state; client input не является доказательством права на цену, скидку, availability или заказ.
- Все денежные значения хранятся и считаются в integer minor units; floating point и client total запрещены.
- Frontend не подключается напрямую к PostgreSQL, iiko или payment provider.
- Все external/provider responses проходят runtime validation и fail-closed обработку.
- Checkout должен быть совместим с cookie transport на Web и bearer/secure-storage adapter на native.
- Schema changes выполняются только через versioned Drizzle migration. Не создавать order tables в рамках M6 без явного решения о границе M7.
- Любая будущая операция, создающая Order, должна иметь отдельный server-side idempotency design и не может считать redirect/callback доказательством оплаты.

## Implementation Requirements

- Вынести checkout schemas и error codes в `packages/contracts`.
- Добавить framework-independent checkout client/controller в `packages/api-client` с timeout, abort, runtime response validation и latest-request-wins semantics.
- Добавить Backend repository/service boundary для получения доступных pickup options и проверки cart/availability.
- Подключить Customer checkout через dependency injection и test doubles; не читать env или DOM в общей бизнес-логике.
- Добавить safe error mapping для validation, unavailable, authentication и service failure без PII в logs/errors.
- Уточнить до реализации owner-facing pickup contract: одна или несколько точек, выбор времени/слота, рабочие часы, timezone и текст подтверждения.
- Сохранить existing cart references и не изменять M4 persistence payload.

## Tests

- Contracts:
  - valid checkout request/response;
  - unknown fields, empty cart, invalid quantities, invalid pickup option и malformed totals;
  - integer minor-unit validation и safe error envelopes.
- Backend/service:
  - session обязателен;
  - current PostgreSQL price/visibility/availability повторно проверяются на каждом checkout request;
  - stale/unavailable item или pickup option не создаёт partial success;
  - client-provided price/total/payment state игнорируются или отклоняются;
  - unavailable database/provider возвращает safe controlled response.
- API client/controller:
  - HTTP/network/timeout/abort/invalid response handling;
  - stale response не заменяет последнюю корзину/quote;
  - dispose/unmount и retry безопасны.
- Customer UI:
  - переход из непустой корзины;
  - identified/anonymous/session-expired states;
  - актуальный total, pickup validation, loading/error/retry и empty-cart state;
  - Web/native-safe rendering без DOM dependency;
  - checkout не отправляет payment/iiko/order side effects.
- Real verification:
  - Customer с реальной PostgreSQL session открывает checkout;
  - Admin/catalog price or visibility change приводит к новой серверной проверке;
  - operationally unavailable pickup/product закрывает checkout fail-closed;
  - после reload cart references сохраняются, а checkout повторно получает authoritative quote.

## Acceptance Criteria

- [x] Identified Customer может открыть checkout только из непустой корзины.
- [x] Checkout показывает только актуальные Backend-confirmed позиции, цены и total.
- [x] Backend повторно проверяет session, cart, price, visibility и availability; client total не используется.
- [x] Pickup options/slots приходят из Backend и недоступные значения fail closed.
- [x] Customer получает понятные loading, validation, stale, unavailable, service error и retry states.
- [x] После reload/retry устаревшие данные не становятся authoritative.
- [x] Checkout не запускает оплату, iiko submission, kitchen status или неподтверждённый Order side effect.
- [x] Web/iOS/Android shared logic остаётся DOM-independent, а storage продолжает хранить только cart references.
- [x] Contracts, Backend, API client/controller, Customer UI и реальный PostgreSQL web flow покрыты automated tests.
- [x] README/ARCHITECTURE и этот plan отражают фактическую реализацию; plan переносится в `docs/exec-plans/completed/`.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Проверка с основной PostgreSQL database:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
  pnpm --filter @vse-pro-zhar/database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
  pnpm exec playwright test
```

Другие локальные databases, включая `vse_pro_zhar_test`, для этой задачи не создаются и не используются. Migration запускается только при изменении schema и только через versioned migration.

Также проверить Customer Web через `http://localhost:8082`, отсутствие direct frontend DB/provider access, отсутствие OTP/SMS/payment/iiko calls и неизменность `output.pptx`.

Для локального simulator happy path Backend запускается с полными `IIKO_*` переменными и `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev`; simulator должен оставаться отдельным development substitute. В этой проверке подтверждены `available`/stop-list состояния через simulator и отсутствие прямых provider calls из Customer. Настроенный общий Playwright runner не использовался, если его порты заняты чужими процессами; targeted headless Chromium для уже запущенных `API/Customer` прошёл.

## Progress

- [x] Зафиксировать owner-approved pickup contract и dependency на M3 availability.
- [x] Проверить текущие Cart, Customer session и catalog/availability boundaries.
- [x] Реализовать contracts, Backend validation boundary и shared API client/controller.
- [x] Реализовать Customer checkout UI для Web/iOS/Android.
- [x] Добавить unit, integration и real PostgreSQL web E2E tests.
- [x] Выполнить доступные verification и обновить Discoveries/Decision Log/Outcome.
- [x] Подключить read-only iiko-compatible availability adapter, выполнить simulator happy path с `vse_pro_zhar_dev` и перенести plan в `completed/`.

## Discoveries

- На момент создания plan в repository есть cart quote и Customer session, но нет checkout route, pickup model или order flow.
- M4 намеренно заканчивается на server-confirmed quote и запрещает checkout/order side effects.
- M3 availability должна быть authoritative boundary до разрешения реального pickup checkout; Customer не может объявлять продукт или слот доступным самостоятельно.
- В текущем repository M3 iiko mapping/availability provider ещё не подключён: M6 должен иметь отдельный DI boundary и безопасный fail-closed default, а не трактовать public catalog visibility как operational availability.
- До подключения iiko configuration default provider возвращал неизвестную availability для всех товаров, поэтому API безопасно отклонял checkout; этот fail-closed путь сохранён и покрыт тестами.
- Основная PostgreSQL database `vse_pro_zhar_dev` доступна; прямой браузерный сценарий с запущенными API/Customer и этой database загрузил меню и checkout boundary с ожидаемым fail-closed результатом. Стандартный Playwright runner не стартовал из-за уже занятого чужим процессом порта `127.0.0.1:5173`; процесс не изменялся.
- Для Web HttpOnly cookie API URL должен использовать `localhost`, если Customer открыт на `localhost:8082`; смешивание `localhost` и `127.0.0.1` приводит к успешному identify с последующим `401` на checkout.
- В `/Users/rotman/Desktop/vse-pro-zhar-iiko-simulator` найден локальный детерминированный iiko-compatible simulator. Его `v2/access_token`, `terminal_groups/is_alive` и `stop_lists` покрывают read-only availability boundary; dataset использует synthetic UUID и `simulationOnly`, поэтому mapping должен быть явным и не переносится в production credentials.
- Backend adapter подключён через DI только при полной server-only `IIKO_*` конфигурации. Без неё сохраняется fail-closed provider; adapter не читает iiko catalog data и не выполняет order/payment writes.
- При первом live запуске freshness проверялась timestamp-ом после provider call: timestamp, снятый до сетевого запроса, ложно отклонял корректный ответ как «будущий» на несколько миллисекунд. Checkout теперь измеряет age после получения provider response и всё ещё отклоняет future/stale timestamps.
- Pinned iiko OpenAPI требует только `productId` и `balance` в stop-list item; `sizeId`, `sku` и `dateAdd` могут отсутствовать, поэтому adapter валидирует их как optional nullable поля.
- Для текущей ручной проверки порт `3000` был занят чужим локальным приложением, поэтому Backend запущен на `3001`, а Customer Web — с `EXPO_PUBLIC_API_URL=http://localhost:3001`; это не меняет canonical default в конфигурации и не затрагивает чужой процесс.

## Decision Log

- M6 отделяется от M7: этот plan описывает checkout validation/review, а Order persistence и lifecycle остаются отдельной задачей, чтобы не смешивать cart, order, payment и iiko boundaries.
- OTP/SMS/phone verification исключены как постоянное product decision и не должны появиться в checkout.
- Для текущего масштаба сохраняется modular monolith и одна PostgreSQL database; новая инфраструктура не требуется.
- Pickup contract для M6: одна Backend-configured точка (`main-grill`), выбор 30-минутного слота на сегодня/завтра, рабочие часы 10:00–22:00, timezone `Europe/Moscow`. Customer получает только runtime-generated доступные слоты; адрес и operational availability не зашиваются в Customer UI. Checkout возвращает подтверждённый quote и текст «Проверка завершена. Заказ ещё не создан.» без order/payment/iiko side effects.
- До полной production iiko configuration wiring использует fail-closed provider через DI. Для локальной проверки допускается только отдельный simulator adapter с явным mapping; нельзя подменять его public catalog visibility или считать наличие pickup options доказательством iiko availability.
- Web runtime использует `http://localhost:3000` и Customer `http://localhost:8082` для auth/checkout cookie continuity; `127.0.0.1` не смешивается с `localhost` в этой boundary.

## Outcome

M6 реализован как read-only checkout boundary без Order, payment и iiko side effects:

- добавлены shared contracts/error codes, Backend routes/service, server-generated pickup slots и fail-closed operational availability boundary;
- добавлены framework-independent API client/controller с timeout, abort, runtime validation и latest-request-wins semantics;
- Customer Web/iOS/Android-compatible checkout UI открывается только для identified Customer с server-backed session и не меняет cart persistence payload;
- добавлены unit/integration tests, документация и real `vse_pro_zhar_dev` + browser verification.

Read-only operational checkout подключён к явному iiko-compatible adapter и проверен через локальный simulator happy path при использовании `vse_pro_zhar_dev`. `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` с canonical database, database probe, adapter tests, live simulator availability, stop-list fail-closed scenario и headless Chromium happy path прошли. Production real-iiko credentials/conformance и M7 order submission остаются за пределами M6; simulator не становится production dependency.
