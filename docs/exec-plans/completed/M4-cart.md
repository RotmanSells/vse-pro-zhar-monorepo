# M4 — Гостевая корзина и Backend quote

Status: completed
Milestone: M4
Depends on: M1 Catalog and the current M2 product-image implementation; M3 iiko availability is intentionally not required for this slice

## Purpose

Сделать рабочий пользовательский сценарий гостевой корзины: добавить блюдо из Customer-каталога, изменить количество, удалить позицию, очистить корзину и восстановить её после перезапуска клиента. Корзина хранит только ссылки на товары и количества, а Backend по актуальным данным PostgreSQL возвращает текущие цены и сумму.

Задача заканчивается на просмотре подтверждённого Backend quote. Она не создаёт заказ и не открывает checkout; будущий checkout отдельно проверит operational availability и отправит подтверждённый заказ в iiko через Backend.

## Current State

Проверено перед созданием задачи:

- `docs/exec-plans/active/` пуст, кроме `.gitkeep`; этот файл является новой active task.
- Customer — universal Expo-приложение с targets `web`, `ios`, `android`. `CustomerHome` сейчас рендерит только `CatalogScreen`; кнопка `+` на карточке товара отключена и явно сообщает, что добавление появится на следующем этапе.
- В Customer нет cart state, cart screen, навигации к корзине, persistence adapter или storage dependency.
- Admin — React + Vite web-приложение. Существующий catalog screen уже изменяет `priceMinor` и `isVisible` через `PATCH /admin/products/:id`; отдельной сущности или страницы гостевых корзин нет.
- `packages/contracts` содержит `CatalogProduct` с ценой в целых minor units. `packages/api-client` содержит общий catalog client/controller, но не cart contract или quote client.
- `packages/database` использует одну PostgreSQL database и Drizzle. В схеме есть только `categories` и `products`; `CatalogRepository` умеет читать каталог и менять Product, но не имеет метода чтения набора товаров для quote.
- Backend регистрирует public `GET /catalog` и Admin catalog mutations. `/cart/quote`, cart contracts, cart migrations и Backend cart route отсутствуют.
- В `/Users/rotman/Desktop/prototypes/index.html` есть визуальный reference для корзины: floating cart, badge, список позиций, `+/-`, удаление и empty state. Demo `localStorage` и client-side total из prototype не являются production-источником истины и не переносятся буквально.
- Текущий checkout уже содержит реализованные M1/M2 изменения каталога, изображений и UI в commit `f4df5df`; существующий `output.pptx` остаётся отдельным пользовательским файлом и не входит в scope.
- Baseline после аудита: `pnpm test` — 60 passed, 3 skipped (PostgreSQL integration без `DATABASE_URL`).

## Scope

### Shared cart model and API contract

- Добавить framework-independent модель cart item с полями `productId` и `quantity`.
- Нормализовать cart state: один item на Product, количество — целое `1..99`, верхний лимит позиций — 100; `+` существующей позиции увеличивает quantity, а не создаёт дубликат.
- Добавить runtime-validated contracts для quote request/response. Минимальный request:

  ```json
  {
    "items": [
      { "productId": 1, "quantity": 2 }
    ]
  }
  ```

- Реализовать public `POST /cart/quote` без авторизации и без side effects. Backend принимает только Product IDs и quantities и возвращает, например:

  ```json
  {
    "items": [
      {
        "productId": 1,
        "quantity": 2,
        "unitPriceMinor": 45000,
        "lineTotalMinor": 90000
      }
    ],
    "totalMinor": 90000
  }
  ```

- Запретить пустой request, duplicate Product IDs, нулевые/дробные/отрицательные quantities и неизвестные поля. Порядок quote items должен соответствовать порядку request items.
- При отсутствии или скрытии Product, который больше не входит в public catalog, возвращать контролируемую ошибку quote (предпочтительно отдельный `CART_ITEM_UNAVAILABLE` с HTTP 409). Partial quote без явного состояния ошибки не допускается.

### Backend and PostgreSQL

- Расширить существующий catalog repository или добавить узкий server-side read boundary, который одним запросом получает текущие `products.priceMinor` и public visibility с учётом видимой категории.
- Вычислять `lineTotalMinor` и `totalMinor` только из integer minor units, считанных Backend из PostgreSQL. Customer-provided price, line total или total не принимаются и не используются.
- Quote должен возвращать актуальную цену на момент запроса. Изменение цены в существующем Admin catalog должно отражаться в следующем quote без перезапуска приложения.
- Не создавать `carts`, `cart_items`, anonymous customer rows, cookies/tokens или server-side guest cart. Для этого slice cart является локальным client state; новая database migration не требуется.
- Если PostgreSQL недоступен, сохранить существующий safe `SERVICE_UNAVAILABLE` envelope; demo-цены и fallback products в production runtime не добавлять.

### Customer UI and storage

- Активировать добавление товара из каждой видимой карточки каталога. После добавления обновлять item count/badge и доступный переход к корзине; не показывать локально рассчитанную сумму как authoritative.
- Добавить Customer cart surface в стиле текущего React Native UI и reference-прототипа: список товара, фото/emoji, текущая цена за единицу из quote, quantity controls `− / значение / +`, line total и явное удаление позиции.
- Реализовать отдельное действие «Очистить корзину» с безопасным состоянием после очистки. При quantity `1` нажатие `−` удаляет позицию либо UI явно предлагает удалить её; отдельная кнопка удаления остаётся доступной.
- Для пустой корзины показать явный empty state («Корзина пуста») и переход обратно в меню. Не делать quote request для пустой корзины.
- Восстанавливать гостевую корзину после reload/перезапуска клиента через platform adapter:
  - Web — `localStorage`;
  - iOS/Android — native persistent storage, например `@react-native-async-storage/async-storage`.
- Общая cart logic не должна читать DOM API. Storage interface и Web/native adapters должны быть изолированы; component tests должны подставлять in-memory adapter.
- Хранить в storage только версионированный payload вида `{ version: 1, items: [{ productId, quantity }] }`. Не сохранять название, цену, image URL, total или данные пользователя. Malformed/устаревший payload валидировать через runtime schema, отбросить безопасно и начать с пустой корзины.
- После каждого изменения state persistence должен выполняться без гонок записи. Ошибка storage не должна ломать текущую in-memory корзину и должна иметь явное контролируемое состояние/сообщение.
- При открытии cart surface, после каждой мутации и по Retry получать новый quote через Backend. Пока quote не подтверждён, показывать loading/recalculating state; при ошибке не выдавать старую сумму за актуальную. Stale response от предыдущего количества не должен перезаписывать последний state.
- Не добавлять действующий checkout/order button. Если reference требует сохранить место под него, показывать disabled/unavailable state без создания заказа.

### Admin UI and cross-app boundary

- Не создавать Admin cart screen: локальная гостевая корзина не является Admin business entity и не доступна Admin для просмотра.
- Сохранить существующий Admin catalog как authoritative UI для `priceMinor` и `isVisible`. При необходимости внести только минимальные изменения в loading/error state, чтобы Admin mutation корректно использовалась в cross-app verification.
- Добавить проверку, что изменение цены или скрытие товара в Admin влияет на следующий Customer quote; Customer не должен продолжать считать по старой локальной цене.

### Documentation and verification artifacts

- Обновить применимую документацию только в пределах cart contract/границ, если реализация выявит расхождение с README/architecture/roadmap.
- Добавить automated tests и один реальный web-сценарий с PostgreSQL; mocks разрешены только внутри isolated tests и не считаются доказательством production quote.

## Out of Scope

- Checkout, orders, order items, historical snapshots, payment, refund, SBP и любые подтверждённые заказовые side effects.
- iiko mapping, stop-list, operational availability и отправка заказа в iiko. В текущем quote проверяется только public catalog visibility; проверка наличия будет обязательной boundary будущего checkout.
- Authentication, SMS OTP, customer account, cart merge после login, cross-device sync и server-side persistent customer cart.
- Промокоды, loyalty/угольки/XP, delivery, pickup time, service fee, tips, modifiers, combos и минимальная сумма заказа.
- Admin просмотр, редактирование или ручное восстановление гостевых корзин.
- Redis, отдельный cart service, message broker, object storage или другая новая инфраструктура.
- Перенос demo-данных, фиктивных цен или prototype `localStorage` state в production runtime.

## Architecture / Constraints

- Backend + PostgreSQL остаются authoritative source для Product ID, названия, visibility и `priceMinor`. Customer state является только локальным представлением последнего подтверждённого cart/quote state.
- Все деньги — integer minor units. Нельзя вычислять бизнес-total через floating point или принимать client total как основание для будущей оплаты.
- Cart persistence не требует database table: локальный storage содержит только references и quantities. Это сохраняет modular-monolith и single-PostgreSQL архитектуру и не создаёт преждевременную server-side state.
- Public quote принимает только строгий validated contract. Ответ внешнего API проходит `safeParse` в shared client; safe API errors не раскрывают внутренние детали.
- Quote должен быть атомарным с точки зрения UI: при неизвестном/скрытом item не показывать partial total как итоговый. Для следующей попытки Customer должен обновить каталог/удалить проблемную позицию и повторить quote.
- Product visibility и future iiko availability — разные состояния. Admin может скрыть Product, но текущая задача не даёт Admin права объявлять operationally unavailable Product доступным.
- Общая cart model, normalization, storage contract, API client и request lifecycle должны быть совместимы с Web/iOS/Android. DOM используется только в Web storage adapter и не попадает в общую бизнес-логику.
- Сохранить текущие `AbortSignal`, timeout, cancellation и latest-request-wins semantics для quote requests. Быстрые `+/-`, retry и unmount не должны публиковать устаревшие результаты.
- UI следует визуальному языку текущего Customer catalog и cart reference в `/Users/rotman/Desktop/prototypes/index.html`; prototype является design reference, но не source of truth для цен, заказов или availability.
- Никакие изменения production schema не выполняются вручную. Если во время реализации появится обоснованная потребность в schema change, она должна идти отдельной versioned migration и быть явно отражена в этом plan до реализации.

## Implementation Requirements

- Вынести Cart/Quote schemas в `packages/contracts`; обновить общий `ApiError` contract, если выбран отдельный `CART_ITEM_UNAVAILABLE` code.
- Добавить shared cart quote client в `packages/api-client` без чтения env, React, React Native или DOM; Customer env adapter передаёт `EXPO_PUBLIC_API_URL` аналогично catalog client.
- Добавить quote request controller или эквивалентный framework-independent latest-request-wins boundary. Он должен поддерживать initial load, re-quote, retry, abort/dispose и не публиковать устаревшие responses.
- Сохранить server wiring через `buildApp()`/dependency injection: API tests должны подставлять memory repository, а production `startServer()` — существующий PostgreSQL catalog repository.
- Для storage использовать explicit interface с test double. Storage payload и восстановленные items проходят schema validation до попадания в UI state.
- Не дублировать цены в cart state. Cart line price и total в Customer UI должны происходить из последнего успешного Backend quote; до него UI отображает loading/unknown state.
- Обеспечить доступность controls: meaningful labels для add, increment, decrement, remove, clear, open cart, retry; disabled/loading states не должны допускать двойного неконтролируемого действия.
- Если Admin изменил `priceMinor` между двумя quote requests, второй response должен использовать новую цену. Если Product стал hidden, UI должен показать controlled stale/unavailable state и дать удалить его локально.

## Tests

- Contracts:
  - valid quote request/response с minor-unit prices;
  - empty array, duplicate IDs, unknown fields, float/zero/negative/out-of-range quantity;
  - integer line/total validation и `CART_ITEM_UNAVAILABLE` error contract, если он добавляется.
- Cart domain/storage:
  - add new item, add same item, increment/decrement, max quantity, remove и clear;
  - normalization duplicate/invalid items;
  - storage round-trip, version mismatch, malformed JSON, storage failure;
  - подтверждение, что persisted payload не содержит price/name/total.
- Shared API client/controller:
  - корректный `POST /cart/quote` request и runtime validation ответа;
  - HTTP/network/timeout/abort/invalid-response handling;
  - latest-request-wins при быстрых quantity changes и Retry, dispose/unmount safety.
- Backend API/repository:
  - quote считает сумму по текущим `products.priceMinor`, не по данным клиента;
  - response сохраняет порядок request и возвращает integer `unitPriceMinor`, `lineTotalMinor`, `totalMinor`;
  - Admin price update отражается в новом quote;
  - hidden/missing product даёт atomic controlled error, без partial total;
  - malformed payload не echo-ит unknown fields, unavailable PostgreSQL даёт safe 503;
  - проверка отсутствия новой cart table/migration, если schema не меняется.
- Customer UI:
  - add from catalog, badge/open-cart state, cart list;
  - quantity changes, remove, clear и empty state;
  - guest persistence after remount/reload через injected storage;
  - quote loading/success/error/retry, current Backend price and total;
  - no quote for empty cart, no checkout/order request;
  - stale quote cannot overwrite current cart state; accessible labels and disabled states.
- Admin UI/cross-app:
  - существующий Admin price edit/visibility mutation остаётся рабочим;
  - web E2E: Admin создаёт/редактирует Product → Customer добавляет его → Admin меняет цену → Customer re-quotes и показывает новую сумму; затем clear/empty flow.

## Acceptance Criteria

- [x] Customer может добавить любое видимое блюдо из каталога; повторное добавление увеличивает quantity в одной позиции.
- [x] Customer может изменить quantity, удалить одну позицию и полностью очистить корзину; после очистки отображается явный empty state.
- [x] Гостевая корзина переживает Web reload и native app restart через соответствующий platform storage; malformed storage не ломает запуск.
- [x] В persisted cart нет цен, названий, total или пользовательских данных — только versioned Product references и quantities.
- [x] `POST /cart/quote` принимает только валидные IDs/quantities, читает текущие цены из PostgreSQL и возвращает integer line/total amounts.
- [x] Изменение цены через существующий Admin catalog влияет на следующий Customer quote; Customer-provided total никогда не используется.
- [x] Скрытый/отсутствующий Product не превращается в partial или stale successful quote; Customer получает контролируемое состояние и может удалить проблемную позицию.
- [x] Customer показывает loading, success, unavailable/error и retry states; устаревший quote не заменяет актуальный.
- [x] Admin/Customer работают через Backend API; прямого доступа frontend к PostgreSQL/provider нет. Новая Admin cart page и server-side guest cart отсутствуют.
- [x] В задаче нет order/payment/checkout/iiko side effects; ни один тест не считает mock order доказательством готовности этих интеграций.
- [x] Contracts, Backend, repository, API client, storage/domain, Admin/Customer UI и web E2E покрыты automated tests в заявленном объёме.

## Verification

Базовые проверки из repository:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Проверки с реальной PostgreSQL:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_test \
  pnpm --filter @vse-pro-zhar/database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_test \
  pnpm --filter @vse-pro-zhar/database test
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_test \
  pnpm exec playwright test e2e/cart.spec.ts
```

Также проверить:

- Customer Web через `http://localhost:8082` и Admin Web через `http://127.0.0.1:5173` с реальным API;
- отсутствие secrets, fake production data, direct frontend DB access, order/payment/iiko requests и невалидных price calculations;
- native-safe TypeScript/Expo build и storage adapter без требования запускать Xcode/Android Studio для ежедневной проверки;
- `git status --short`: сохранить все исходные пользовательские изменения и не изменять `output.pptx`.

## Progress

- [x] Изучить `AGENTS.md`, `PLANS.md`, README, architecture, product, roadmap, completed plans и active-plan directory.
- [x] Проверить текущие Catalog contracts, PostgreSQL schema/repository, Backend routes, shared API client, Customer/Admin UI и tests.
- [x] Сверить cart reference в `/Users/rotman/Desktop/prototypes` и зафиксировать production-safe границы.
- [x] Зафиксировать отсутствие зависимости cart-only slice от checkout/payment/iiko.
- [x] Реализовать contracts, Backend quote и repository boundary.
- [x] Реализовать shared cart model/client/controller и Web/native storage adapters.
- [x] Реализовать Customer cart UI и минимально необходимые Admin/cross-app checks.
- [x] Добавить automated tests и PostgreSQL web E2E.
- [x] Выполнить verification, обновить Discoveries/Decision Log/Outcome и только затем закрыть plan.

## Discoveries

- Текущий Customer catalog уже получает Product через shared runtime-validated catalog client, но action `+` намеренно disabled; это естественная точка включения cart flow.
- Admin catalog владеет `priceMinor` и `isVisible`; отдельной Admin cart boundary нет и при локальной guest persistence она не нужна.
- Existing `products.priceMinor` и catalog contracts уже запрещают floating-point business money, поэтому quote может использовать текущую Product model без новой money abstraction.
- В проекте нет storage abstraction и native persistence dependency; guest persistence нельзя реализовать общей логикой через browser-only `localStorage` без нарушения Web-first/native-compatible границы.
- Prototype cart содержит client-side totals, delivery, promo и checkout; для этой задачи допустимо использовать только cart layout/interactions и не переносить demo business rules.
- M1/M2 catalog/media implementation зафиксирована в текущем checkout (`f4df5df`); task creation не должна менять эти файлы или существующий `output.pptx`.
- `docs/ROADMAP.md` ставит M3 iiko mapping + availability перед M4, но заданный scope требует только catalog quote и прямо исключает iiko. Поэтому M3 не является технической зависимостью этой cart-only task; checkout обязан будет добавить availability boundary позднее.
- Существующей schema `categories`/`products` достаточно для quote: отдельная cart table и migration не нужны; public availability получается одним PostgreSQL query через visible Product и Category.
- Для native persistence добавлен `@react-native-async-storage/async-storage`; общий storage contract и cart logic остаются platform-independent, а DOM ограничен Web adapter.
- У Customer quote surface есть явная повторная проверка и derived loading state, поэтому после quantity mutation или stale response старая сумма не показывается как текущая.

## Decision Log

- Guest cart не сохраняется в PostgreSQL: при отсутствии authentication server-side cart не имеет authoritative customer identity и добавил бы state, которого не требует текущий сценарий.
- Для authoritative суммы используется отдельный side-effect-free `POST /cart/quote`, а не расчёт в Customer и не order endpoint. Это позволяет проверить актуальную цену до появления checkout, не создавая заказ.
- Cart state хранит только `{ productId, quantity }`; цены, названия, изображения и total берутся из catalog/quote response и не становятся persisted snapshot.
- Quote использует current public catalog visibility (`Product.isVisible` и visibility категории), но не обращается к iiko. Operational availability остаётся будущим checkout concern.
- Admin не получает cart page. Его существующий catalog mutation используется как проверяемый источник актуальной цены/видимости в cross-app E2E; это сохраняет domain boundary и не создаёт недоступный Admin view локальных browser carts.
- Для текущего масштаба достаточно PostgreSQL, существующего Backend modular monolith и обычных Web/native storage adapters; Redis, queue, отдельный service и server-side cart не добавляются.
- Client и controller дополнительно проверяют, что quote относится к тому же ordered набору Product references и quantities, что и текущий запрос.

## Outcome

M4 завершён. Реализованы strict Cart/Quote contracts, public `POST /cart/quote` с current PostgreSQL prices и atomic `CART_ITEM_UNAVAILABLE`, shared cart domain/storage/quote lifecycle, Customer Web/native-safe local persistence и cart UI без checkout/order side effects. Admin catalog остаётся authoritative boundary для price/visibility; Admin cart page и database migration не добавлялись.

Verification:

- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — passed: 89 tests passed; PostgreSQL suite без `DATABASE_URL` штатно skipped.
- `pnpm build` — passed: Backend, Admin Vite и Customer Expo Web export.
- `git diff --check` — passed.
- `DATABASE_URL=...vse_pro_zhar_test pnpm --filter @vse-pro-zhar/database migrate` — passed.
- PostgreSQL integration suite с test database — passed: 8 tests.
- `e2e/cart.spec.ts` — passed against the running real PostgreSQL-backed API/Admin/Customer services; initial exact Playwright command was blocked by already occupied development ports, поэтому E2E был повторён без запуска duplicate web servers.
- Созданные E2E временные товары в `vse_pro_zhar_dev` удалены после проверки; `output.pptx` не изменялся.
