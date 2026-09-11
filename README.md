# Все Про Жар

Цифровой контур одного ресторана в Краснодаре. Репозиторий покрывает локальный срез M0–M15: Customer Web/native targets, phone-only auth и Expo Push registration, защищённый Admin Web, модульный Backend, PostgreSQL/Drizzle, каталог с изображениями, Customer sessions, корзину, read-only pickup checkout, внутренние заказы, test-mode оплату банковской картой через YooKassa, durable fulfillment через iiko simulator contract, безопасную отмену с provider-confirmed refund state и server-owned loyalty с XP, рангами, угольками, Wheel и Quests. Локальные automated/browser проверки проходят; production readiness для refund, внешнего YooKassa/iiko lifecycle и native store release не заявляется до обязательной ручной проверки.

## Требования

- Node.js `>=24.14.1 <25`
- pnpm `>=11.24.0 <12`

## Структура

```text
apps/api/       # Fastify Backend API
apps/customer/  # Expo + React Native + React Native Web + Expo Router
apps/admin/     # React + Vite Web Admin
packages/contracts/  # shared Zod contracts
packages/api-client/ # shared API clients, customer session and lifecycle boundaries
packages/database/   # PostgreSQL pool + Drizzle migrations
docs/           # product, architecture, roadmap and execution plans
e2e/            # browser smoke and catalog lifecycle E2E
```

## Документация

- [Execution Plans](PLANS.md)
- [Описание продукта](docs/PRODUCT.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [Дорожная карта](docs/ROADMAP.md)
- [M0 milestone](docs/milestones/M0-foundation/README.md)
- [M1 catalog execution plan](docs/exec-plans/completed/M1-catalog.md)
- [Execution plan history](docs/exec-plans/)

## Environment setup

```bash
pnpm install
cp .env.example .env
```

Безопасные development defaults позволяют запустить Web/API без локального PostgreSQL. При отсутствии `DATABASE_URL` health-сценарий работает, а каталог явно показывает состояние недоступности; `DATABASE_URL` нужен для реального каталога, database commands и integration tests. `.env` игнорируется Git.

### Database policy

У проекта одна основная PostgreSQL database. Для локальной разработки и ручной проверки это `vse_pro_zhar_dev`; Backend, migrations и browser runtime всегда подключаются к ней через `DATABASE_URL`. Не создавайте и не используйте `vse_pro_zhar_test`, другие `*_test` databases или отдельный локальный PostgreSQL instance. Автоматические unit-тесты могут использовать test doubles, но они не добавляют database и не подменяют рабочие business-данные.

| Переменная | Где используется | Доступность |
| --- | --- | --- |
| `APP_ENV` | Backend runtime | server-only |
| `API_HOST` / `API_PORT` | Backend listener | server-only |
| `CORS_ALLOWED_ORIGINS` | Backend browser allowlist, comma-separated | server-only; в production обязателен |
| `AUTH_SESSION_SECRET` | HMAC key для opaque Customer sessions | server-only; в production обязателен |
| `AUTH_SESSION_TTL_SECONDS` | TTL Customer session | server-only |
| `STAFF_SESSION_TTL_SECONDS` | TTL отдельной Admin staff session | server-only |
| `EXPO_PUBLIC_API_URL` | Customer API boundary | public bundle, не secret |
| `VITE_API_URL` | Admin API boundary | public bundle, не secret |
| `DATABASE_URL` | PostgreSQL/Drizzle | server/CI-only; никогда не frontend |
| `MEDIA_DIR` | Backend local media storage | server-only |
| `MEDIA_PUBLIC_URL` | Public base URL для `/media/*` | server-only |
| `IIKO_*` | Backend iiko availability + paid-order fulfillment adapters | server-only; credentials никогда не frontend |
| `YOOKASSA_SHOP_ID` / `YOOKASSA_SECRET_KEY` | Backend test-mode YooKassa card adapter | server-only; credentials никогда не frontend |

Customer Web использует `http://localhost:3000` для сохранения HttpOnly cookie в той же host family, что и `http://localhost:8082`; Admin использует `http://127.0.0.1:3000`. Не помещайте secrets в public-prefixed variables.

Expo CLI может создавать `apps/customer/expo-env.d.ts`; этот generated-файл игнорируется Git. Управляемая типизация `EXPO_PUBLIC_API_URL` хранится в `apps/customer/src/env.d.ts`.

## Development

Запустить API, Customer Web и Admin Web одной командой:

```bash
pnpm dev
```

Root `pnpm dev` сначала один раз собирает `packages/contracts` и `packages/api-client`, затем запускает API, Customer Web и Admin Web параллельно. Отдельные package-команды `dev` и `build` сами подготавливают shared packages перед своим запуском; root использует внутренние `*:root` scripts, чтобы не повторять эту подготовку в параллельных процессах.

Development URLs:

- Customer Web: <http://localhost:8082>
- Admin Web: <http://127.0.0.1:5173>
- API: <http://localhost:3000>
- Health: <http://localhost:3000/health>

Customer и Admin знают только Backend API. Customer получает `/catalog`, auth и notifications endpoints через общий `@vse-pro-zhar/api-client`, который валидирует ответы через `@vse-pro-zhar/contracts` и управляет timeout/abort. При первом запуске Customer заполняет имя и номер телефона, а дату рождения может указать по желанию; Backend сохраняет профиль в PostgreSQL, Web получает HttpOnly cookie, iOS/Android — bearer token в secure storage. Действующая customer-сессия сохраняется на год и восстанавливается после reload/перезапуска; автоматического logout нет. SMS-код для входа не отправляется. Native push permission/token регистрируется через `POST /notifications/devices`, а preference хранится в PostgreSQL. SMS.ru adapter оставлен только как server-side boundary для будущих SMS-уведомлений и не вызывается auth flow. Гостевая корзина хранит только Product references и quantities, а актуальные цены получает через Backend quote.

### Подробные dev-логи Customer

Для локальной проверки через Expo Go можно включить realtime tracing:

```bash
EXPO_PUBLIC_DEBUG_LOGS=1 EXPO_PUBLIC_API_URL=https://public-api.example.com npx expo start --tunnel --go
```

В Metro terminal будут видны JSON-события `screen.open/close`, `ui.press.start/finish/error` и `api.request.start/finish/error` с timestamp, route, method, status, requestId и `durationMs`. Backend terminal дополнительно показывает каждый входящий запрос, ответ и безопасный `api.error`. Телефоны, токены, cookies, payment bodies и другие секреты в эти логи не записываются.

### Облачный Android preview

Customer настроен для облачного цикла EAS Update. Один раз создаётся APK и устанавливается на Android:

```bash
cd apps/customer
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest build --platform android --profile preview
```

После установки APK изменения JavaScript/UI публикуются без новой сборки приложения:

```bash
git push origin preview
```

Новый APK для native-изменений запускается вручную через GitHub Actions workflow `Customer Android preview APK`.

Workflow `.github/workflows/customer-preview-update.yml` запускает `eas update --channel preview` в GitHub Actions. Для его работы в GitHub нужен secret `EXPO_TOKEN` и repository variables `EXPO_PUBLIC_EAS_PROJECT_ID`, `EXPO_PUBLIC_API_URL`; последний должен содержать публичный адрес Backend и не может указывать на `localhost`. Те же значения нужно сохранить в EAS environment `preview`, чтобы cloud build/update использовали одинаковую конфигурацию.

Новая APK-сборка нужна после изменения native dependencies, Push permissions, Expo SDK или native app config. EAS Update обновляет только совместимый JS/style/assets слой и применяет его при следующем запуске приложения.

M6 добавляет read-only pickup checkout boundary: identified Customer получает серверные `/checkout/options` и `/checkout/quote`. Backend повторно проверяет session, references, visibility, current prices, operational availability и выбранный slot; Customer не передаёт total, availability, payment или order state. Pickup options генерируются из Backend configuration (одна точка, слоты 30 минут, `Europe/Moscow`, 10:00–22:00). При явно заданных `IIKO_*` переменных Backend использует read-only iiko adapter: получает token, проверяет terminal health и stop-list по обязательному `Product → iiko product` mapping. Если конфигурация отсутствует, mapping не найден, upstream недоступен или ответ невалиден, checkout остаётся fail-closed — public catalog visibility не считается наличием на кухне. Этот этап не создаёт Order, не запускает payment, iiko submission или kitchen status.

M7 добавляет внутренний order boundary: после успешной проверки checkout identified Customer отправляет только cart references, pickup selection и `Idempotency-Key` в `POST /orders`. Backend повторно проверяет session, catalog, цены, operational availability и slot, сам вычисляет integer `totalMinor`, сохраняет исторические item snapshots и атомарно записывает `orders`, `order_items` и начальную `pending_payment` историю статуса в PostgreSQL. Повтор с тем же ключом возвращает тот же заказ, а другой payload даёт `IDEMPOTENCY_CONFLICT`; Customer видит только собственные `/orders` и `/orders/:id`. M7 не запускает оплату, payment webhook или отправку заказа в iiko.

M8 добавляет payment boundary через YooKassa: identified Customer вызывает `POST /orders/:id/payments` только для собственного `pending_payment` заказа, а Backend повторно читает сумму и валюту из PostgreSQL, создаёт test-mode redirect payment картой с provider idempotency и сохраняет `payments`. `GET /orders/:id/payment` возвращает только безопасное состояние и confirmation URL; Customer открывает URL через platform adapter и остаётся в pending до server-side подтверждения. `POST /webhooks/yookassa` валидирует и дедуплицирует notification, получает актуальный payment object у YooKassa и только после проверки `test`, amount, currency, metadata и `paid` переводит payment в `succeeded` и order в `payment_confirmed`. Redirect не является доказательством оплаты, provider secrets не покидают Backend. В текущем YooKassa test store для локальной проверки используется банковская карта; SBP недоступна в этом режиме.

M9–M10 продолжают только server-confirmed payment: в той же транзакции Backend сохраняет один `iiko_order_dispatches` intent, а отдельный processor текущего Backend process отправляет pickup order через write adapter. Внешний HTTP не выполняется внутри webhook transaction; после restart processor подхватывает lease-expired intent, повторяет тот же stable correlation ID и восстанавливает duplicate без создания нового iiko order. Ответы iiko runtime-валидируются, `payment_confirmed` не считается kitchen acceptance, а `GET /orders/:id` возвращает безопасный fulfillment status. Подтверждённые iiko статусы отображаются как `Принят кухней`, `Готовится`, `Готов к выдаче` и `Завершён`; exhausted retry или cancellation дают `fulfillment_problem` без автоматического refund.

M11 добавляет отдельную staff identity boundary для Admin. `POST /admin/auth/login`, `GET /admin/auth/me` и `POST /admin/auth/logout` используют только opaque HttpOnly cookie `vse-pro-zhar-admin-session`, отдельные PostgreSQL tables и `scrypt` password hashes; Customer cookie не даёт доступа к Admin. У вошедшего администратора полный доступ к Orders, catalog/media и разрешённому fulfillment recovery. Default credentials не создаются: локальный staff появляется только через явный bootstrap с обязательными `STAFF_BOOTSTRAP_LOGIN`, `STAFF_BOOTSTRAP_PASSWORD` и `STAFF_BOOTSTRAP_DISPLAY_NAME`.

M12 добавляет `POST /orders/:id/cancel`, `/admin/orders/:id/cancel` и `/admin/orders/:id/refund/reconcile`. Отмена разрешена только для `pending_payment`/`payment_confirmed` до начала внешней iiko-работы; completed, kitchen states, `fulfillment_problem` и заказ с `providerOrderId` блокируются. Полный refund создаётся только для provider-confirmed `payment.succeeded`, с суммой из сохранённого платежа и одним server-generated idempotency key. Provider timeout/5xx/mismatch показывается как reconciliation-required, не как success; `payment.succeeded` и refund status хранятся раздельно. Customer не видит provider refund ID, Admin видит безопасные ID, amount/currency, timestamps и refund event history. Реальные возвраты и production credentials этим локальным срезом не выполнялись.

M13 добавляет `GET /loyalty`, `GET /loyalty/ledger` и защищённую Admin-историю `/admin/loyalty/ledger`. XP и угольки — разные целые единицы: Backend начисляет `floor(totalMinor / 100)` XP и `floor(totalMinor / 10_000)` угольков только после подтверждённых YooKassa payment и iiko `completed`. Ранги: «Искра» от 0 XP, «Жар» от 1 000, «Пламя» от 5 000 и «Вулкан» от 15 000. Ledger append-only, account и история обновляются одной PostgreSQL-транзакцией, повторная обработка заказа защищена уникальным source key. XP/угольки не сгорают; cancellation/refund не делают автоматический reversal. M13.5 добавляет Backend-owned fixed-discount rewards и идемпотентное списание угольков; фиктивные rewards не seed-ятся.
M14 добавляет `GET /loyalty/wheel`, `POST /loyalty/wheel/spin` и `GET /loyalty/quests`, а также защищённые Admin definitions/settings routes. Wheel доступен только authenticated Customer с succeeded payment + completed order от `150000` minor units и ограничен одним spin за rolling 24 часа. Production catalog фиксирован четырьмя weighted outcomes: `no_prize`, `coal_10`, `coal_25`, `xp_100`; promo/physical rewards не выдаются. Quests `first_order`, `regular_guest` и `warming_up` считаются processor-ом только по server-confirmed completed paid orders, без retroactive backfill; events, claims и ledger effects идемпотентны.

Admin Orders использует bounded newest-first pagination и фильтры по order/payment/fulfillment status, датам и order ID/phone. Detail показывает integer money, item/pickup snapshots, payment provider status без secrets, iiko dispatch IDs/attempts/safe error code и ordered history. Recovery блокирует completed, unpaid, invalid-snapshot и terminal-provider cases; failed dispatch атомарно requeues с тем же correlation ID, reconciles existing provider order вместо нового create и пишет staff audit. Статус кухни по-прежнему меняется только после подтверждённого iiko response. Browser Admin не вызывает iiko, не делает WebSocket/SSE и не хранит staff password/token в обычном frontend storage.

Явный staff bootstrap для локального Admin:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
STAFF_BOOTSTRAP_LOGIN=admin STAFF_BOOTSTRAP_PASSWORD='change-this-12+' \
STAFF_BOOTSTRAP_DISPLAY_NAME='Restaurant admin' \
pnpm --filter @vse-pro-zhar/api staff:bootstrap
```

Пример требует заменить пароль и не является seed/default credential.

### Local iiko simulator

Для локальной проверки operational availability и paid-order fulfillment используется внешний simulator из `/Users/rotman/Desktop/vse-pro-zhar-iiko-simulator`. Это development substitute, а не production dependency и не источник нашего каталога, цен или видимости.

```bash
cd /Users/rotman/Desktop/vse-pro-zhar-iiko-simulator
pnpm dev
```

В Backend нужно передать все `IIKO_*` значения из `.env.example`, включая явные UUID organization/terminal, `IIKO_PRODUCT_MAPPING`, `IIKO_ORDER_TYPE_ID` и `IIKO_PAYMENT_TYPE_ID`. Первые семь переменных включают availability, последние две дополнительно включают write processor. После этого запускайте обычный Backend с `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev`; Customer Web открывайте на `http://localhost:8082`. Нельзя подменять `vse_pro_zhar_dev` тестовой базой ради simulator-проверки. Сценарии simulator (`command-pending`, `duplicate-order`, `status-progression`, `cancelled-by-iiko`, faults) меняются только через его control API/UI; Backend всё равно доверяет только runtime-валидированным responses.

Customer — universal Expo project с targets `web`, `ios`, `android`; web проверяется ежедневно. Это не WebView wrapper. Native build и Xcode/Android Studio не требуются для обычной foundation-проверки.

## Проверки

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` собирает contracts, Backend, Admin Vite bundle и Customer Expo web export. Если `DATABASE_URL` не задан, локальный PostgreSQL integration suite отмечается Vitest как skipped; для обычной локальной разработки и ручной проверки используется только `vse_pro_zhar_dev`. Отсутствие `IIKO_*` не включает mock availability: Backend использует безопасный fail-closed provider.

Foundation E2E:

```bash
pnpm exec playwright install chromium
pnpm e2e
```

Smoke поднимает API, Customer Web и Admin Web, проверяет каталоговые поверхности, `pageerror` и browser console errors. Отдельный catalog E2E с PostgreSQL проверяет lifecycle: Admin создаёт и скрывает товар, Customer получает актуальное состояние.

M9–M10 simulator verification выполняется с canonical `vse_pro_zhar_dev`: server-confirmed payment создаёт durable intent, processor создаёт ровно один simulator order, а control API переводит его через `WaitCooking`, `CookingStarted`, `CookingCompleted` и `Closed`. Browser Customer refresh проверяет только Backend-confirmed statuses; direct iiko calls из браузера отсутствуют.

## Database foundation

M16.7 добавляет `categories.version` и append-only `category_versions`. Admin category create/update используют Staff session, safe Origin, обязательный `Idempotency-Key` и optimistic `expectedVersion`; slug immutable, hide/restore не удаляет category или Product, а Customer получает только подтверждённые видимые категории.

Пакет использует одну PostgreSQL database через `pg` и Drizzle ORM. Для текущего проекта это `vse_pro_zhar_dev`; M1 добавляет versioned schema для `categories` и `products`, migration создаёт начальную таксономию из семи категорий, но не добавляет фиктивные товары. Другие локальные databases, включая `vse_pro_zhar_test`, не используются.

```bash
pnpm --filter @vse-pro-zhar/database generate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
  pnpm --filter @vse-pro-zhar/database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
  pnpm --filter @vse-pro-zhar/database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
  pnpm --filter @vse-pro-zhar/database test
```

Migration files находятся в `packages/database/drizzle/`, catalog repository — в `packages/database/src/catalog-repository.ts`, customer/session repository — в `packages/database/src/customer-repository.ts`, order repository — в `packages/database/src/order-repository.ts`, payment repository — в `packages/database/src/payment-repository.ts`, dispatch repository — в `packages/database/src/iiko-dispatch-repository.ts`, staff repository — в `packages/database/src/staff-repository.ts`, Admin Orders repository — в `packages/database/src/admin-order-repository.ts`, loyalty repository — в `packages/database/src/loyalty-repository.ts`, M14 Wheel/Quest repository — в `packages/database/src/wheel-quest-repository.ts`, Communications repository — в `packages/database/src/admin-communication-repository.ts`. Цены хранятся в целых minor units (`priceMinor`); `POST /cart/quote` и `POST /checkout/quote` читают их через public catalog boundary. M5 добавляет `customers` и `customer_sessions`, M7 — `orders`, `order_items` и `order_status_history`, M8 — `payments` и `payment_events`, M9 — `order_iiko_items` mapping snapshots и `iiko_order_dispatches`, M11 — `order_customer_snapshots`, `staff_users`, `staff_sessions` и `staff_audit_log`, M12 — cancellation/refund tables, M13 — `loyalty_accounts`, append-only `loyalty_ledger`, `loyalty_rank_history`, reward definitions и redemption intents, M13.5 — fixed-discount reward targets, immutable reward versions и redemption-order snapshots, M14 — wheel settings/prizes/spins/claims и quest definitions/progress/events/claims, M16.5.1 — immutable communication template versions, drafts and append-only draft audit. Order/payment/dispatch/recovery/loyalty/communications writes выполняются транзакционно и сохраняют historical snapshots/events. M7 idempotency ограничена `(customer_id, idempotency_key)`, M8 дополнительно дедуплицирует provider events по `(provider, event_fingerprint)`, M13 защищает earn по `(source_type, source_id, rule_version)`, M13.5 защищает redemption row lock/idempotency и snapshots, M14 защищает spin/quest events/claims теми же PostgreSQL uniqueness и row locks, M16.5.1 защищает draft create уникальным idempotency key и mutations row lock + optimistic version. M6 не создаёт Order/Pickup tables и не меняет persistence payload гостевой корзины. Raw session token, iiko token, provider secret, recipient phone и provider payload в PostgreSQL не сохраняются. Новые business schemas добавляются только в соответствующих vertical slices и проходят versioned migration.

## Admin Communications

`GET /admin/communications`, `/admin/communications/drafts` и `/admin/communications/drafts/:id` возвращают server-owned templates, bounded drafts, immutable version snapshots и audit metadata. Draft create/update/archive/restore защищены staff session, safe origin, idempotency и optimistic version checks; `POST /admin/communications/preview` может сохранять только bounded count/time metadata. Native Push device registration/preferences работают через Customer API, а phone-only auth не отправляет SMS-коды; массовый Admin Send, delivery statuses и PII export остаются отдельным scope после provider/account policy.

## API foundation

M16.7 добавляет защищённый `GET /admin/categories` с server-owned count/status/order/version/timestamps и strict `POST /admin/categories`/`PATCH /admin/categories/:id` с безопасными category conflict codes. Hidden category и её продукты не проходят public catalog, cart quote или checkout.

`GET /health` возвращает shared-contract-valid response с `service`, `status`, `environment` и ISO `timestamp`. `GET /catalog` отдаёт опубликованные категории и товары, `POST /cart/quote` атомарно рассчитывает текущие цены видимых товаров по cart references, а `/auth/identify` принимает имя, телефон и необязательную дату рождения и создаёт web cookie или native bearer session. `/notifications/devices` и `/notifications/preferences` требуют Customer session; device token не является доказательством личности. `/checkout/options` отдаёт только session-authenticated серверные pickup options, а `POST /checkout/quote` повторно проверяет session, cart/catalog, operational availability и slot без создания Order. `POST /orders` создаёт только внутренний `pending_payment` order с idempotency, `GET /orders` и `GET /orders/:id` возвращают только заказы текущего Customer; detail response дополнительно содержит безопасное состояние fulfillment, если подключён persistence. M8 добавляет `POST /orders/:id/payments`, `GET /orders/:id/payment` и server-to-server `POST /webhooks/yookassa`; payment status становится authoritative только после проверенного YooKassa webhook + provider GET, а `payment_confirmed` не означает принятие заказа кухней. M9–M10 добавляют server-only iiko create/command/status polling через Backend processor; браузер не вызывает iiko и не получает его credentials/payloads. M11 добавляет `/admin/auth/*`, authenticated `/admin/orders`, `/admin/orders/:id` и `/admin/orders/:id/fulfillment/retry`; `/admin/catalog`, catalog mutations и `/admin/media/images` требуют staff auth. M13 добавляет authenticated Customer loyalty summary/history, M13.5 — rewards/redemptions и fixed-discount checkout claims; M14 добавляет authenticated Customer Wheel/Quest reads + idempotent spin и protected Admin definitions/settings management. Browser не получает direct database access и не может передать XP, угольки, rank, reward, progress, amount или eligibility. Unknown routes, validation failures и unexpected errors возвращают безопасный JSON envelope с request ID без внутренних деталей. API использует явный runtime-validated CORS allowlist, origin protection для cookie mutations и graceful shutdown.

## Изображения товаров

Admin загружает JPG, PNG или WebP через `POST /admin/media/images`. Backend проверяет содержимое файла, применяет EXIF rotation, уменьшает изображение до `1600×1600`, конвертирует в WebP quality 82 и сохраняет его в `MEDIA_DIR`. В Product сохраняется только URL обработанного файла; исходный upload не хранится.

## CI

`.github/workflows/ci.yml` запускается на Pull Request и push в `main`. Workflow устанавливает зависимости через `pnpm install --frozen-lockfile`, использует PostgreSQL service с canonical database name `vse_pro_zhar_dev` в CI environment, применяет migrations и выполняет lint, typecheck, tests, builds и foundation Playwright smoke. Локальные команды и ручная проверка не используют CI service и не создают test database.
