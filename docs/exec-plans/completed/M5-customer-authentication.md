# M5 — Customer identification перед добавлением в корзину

Status: completed
Milestone: M5
Depends on: completed M4 guest cart and Backend quote; M3 iiko availability is not a dependency of this slice

## Purpose

Сделать короткий Customer flow перед изменением корзины: каталог и карточки товаров доступны без данных, но при первом нажатии «Добавить в корзину» у anonymous Customer открывается модальное окно. В окне пользователь вводит номер телефона и имя, а дату рождения — по желанию. После успешного сохранения Customer в PostgreSQL исходное добавление товара выполняется и товар попадает в локальную M4 guest cart.

Отдельной регистрации, OTP, SMS, пароля или любого другого подтверждения нет. Введённый номер не доказывает владение телефоном; техническая session нужна только для сохранения текущего Customer между запросами и перезапусками клиента. Будущий checkout/order flow должен быть доступен только при наличии такой session, но сами checkout, заказ и payment остаются отдельными slices.

## Current State

Проверено перед созданием задачи:

- M4 завершён и перенесён в `docs/exec-plans/completed/M4-cart.md`; в `docs/exec-plans/active/` находится только этот план и `.gitkeep`.
- Customer — universal Expo-приложение с Web, iOS и Android targets. Каталог и карточки товаров доступны без authentication; cart state хранит только Product references и quantities.
- M4 уже реализует локальную guest cart и актуальный quote через `POST /cart/quote`. Текущий guest add flow не требует Customer данных; M5 добавляет modal gate перед первой мутацией cart.
- В `packages/contracts` есть runtime-validated health, catalog, media и cart contracts, но нет customer/session contracts.
- `packages/api-client` не содержит customer client, session controller или session storage boundary. Customer не имеет phone/name entry surface, modal gate или session hydration.
- Backend — Fastify modular monolith с DI через `buildApp()`. Public customer identification routes отсутствуют.
- PostgreSQL/Drizzle schema содержит `categories` и `products`; `customers` и sessions отсутствуют. Любое изменение schema должно идти через versioned migration.
- В проекте нет OTP, SMS provider, customer session или auth secret configuration. Admin customer management и staff roles не реализованы.
- Существующий пользовательский `output.pptx` не относится к задаче и должен остаться нетронутым.

## Scope

### Anonymous catalog and add-to-cart modal gate

- Anonymous Customer может открыть каталог, карточку товара и просматривать корзину без ввода profile data.
- При попытке anonymous Customer добавить товар или увеличить его quantity UI не изменяет cart сразу, а открывает modal с Customer flow.
- Modal должен содержать:
  - phone — обязательный номер телефона;
  - name — обязательное непустое имя;
  - birth date — необязательная дата в формате date-only для будущих скидок.
- Отдельный registration screen не добавлять: это modal для быстрого сохранения Customer перед добавлением товара.
- При отмене modal исходная cart остаётся без изменений, pending add action удаляется.
- При успешном submit сначала выполнить `POST /auth/identify`; только после server success добавить исходный Product/quantity в M4 guest cart. Pending action может содержать только `productId` и `quantity`, без PII и session token.
- При ошибке валидации, Backend или session товар не добавлять; показать понятное состояние ошибки и дать повторить действие.
- Повторный submit и повторное открытие modal не должны добавлять один и тот же товар больше одного раза.
- Customer с валидной текущей session добавляет товары напрямую без modal. При истёкшей или отозванной session снова требуется modal.
- Будущий checkout/order entry должен проверять `identified` state и не продолжаться для anonymous Customer. Реализацию checkout, заказа и payment в M5 не добавлять.

### Customer profile input

- Принимать пользовательский формат телефона и нормализовать его на Backend в единую E.164-compatible representation. В PostgreSQL хранить только normalized phone.
- Валидация даты рождения должна запрещать невозможные и будущие даты, но не должна вычислять скидку или подтверждать возраст в рамках M5.
- При submit Backend выполняет upsert Customer по normalized phone. Повторная отправка того же номера не создаёт новую запись; разрешённые name и optional birth date обновляются согласно контракту.
- Response содержит только server-confirmed normalized phone, name, optional birth date и техническое session result. Не возвращать чужую историю заказов, loyalty balance, скидки или внутренние поля.
- Никаких OTP, code input, resend, SMS, звонков или provider callbacks.

### Backend and PostgreSQL

- Добавить strict runtime-validated contracts для:
  - phone/name identification request;
  - Customer profile response;
  - `/auth/me` response;
  - logout и safe authentication errors.
- Добавить минимальные public routes:

  ```text
  POST /auth/identify
  GET  /auth/me
  POST /auth/logout
  ```

- `POST /auth/identify` принимает phone, name и optional birth date, нормализует вход и создаёт/обновляет Customer. Наличие номера в БД не является доказательством владения им.
- `GET /auth/me` возвращает текущий Customer только по server-backed session. Не принимать Customer ID или phone из query/body как основание для чтения другого profile.
- `POST /auth/logout` отзывает текущую session идемпотентно и не очищает guest cart.
- Добавить versioned migration с минимальными сущностями:
  - `customers`: identity, unique normalized phone, name, nullable `birth_date`, created/updated timestamps;
  - `customer_sessions`: hash opaque session token, Customer reference, expiry/revocation and timestamps.
- Raw session token в PostgreSQL не сохранять. Session token генерировать криптографически, хранить только hash, а клиенту отдавать только после успешного ввода данных.
- Добавить database constraints/indexes для normalized phone uniqueness, profile name/date validity, session lookup и expiry. Не добавлять `phone_verified = true`.
- Ошибки БД, session и валидации проходят существующий safe API error envelope с request ID; внутренние детали не возвращать.
- Rate-limit identify и session endpoints на уровне Backend/PostgreSQL настолько, чтобы защитить от простого abuse, не добавляя Redis или отдельную инфраструктуру.
- Логи и diagnostics должны редактировать phone, name, birth date, session token, authorization header и полные request payload. PII не должна попадать в error message, browser console или telemetry.

### Shared client, session transport and Customer UI

- Добавить framework-independent customer/session client и request controller в `packages/api-client`; он не читает env, DOM, React или React Native API.
- Customer env adapter передаёт `EXPO_PUBLIC_API_URL` аналогично существующим clients.
- Добавить auth state с явными состояниями `unknown/loading`, `anonymous`, `identified` и controlled `error`; hydration `/auth/me` не должна блокировать anonymous catalog.
- Изолировать session transport:
  - Web — HttpOnly/Secure/SameSite cookie, `credentials` и origin/CSRF protection для cookie-authenticated mutations;
  - iOS/Android — opaque session token через native secure storage, например `expo-secure-store`, с `Authorization: Bearer` adapter;
  - общая customer/session logic не должна обращаться к DOM или напрямую к platform storage.
- После reload/restart Customer вызывает `/auth/me`; invalid/expired/revoked session переводит UI в anonymous без потери cart contents.
- Добавить CustomerIdentifyModal в визуальном языке текущего приложения:
  - понятный заголовок о необходимости заполнить данные перед добавлением товара;
  - phone input с нормализацией и ошибками;
  - обязательный name input;
  - optional birth-date input с подписью «по желанию, для будущих скидок»;
  - cancel, submit loading, success и error states;
  - identified state с отображением только server-confirmed данных и logout.
- После server success повторить исходное add action ровно один раз; при отмене, unmount или ошибке pending action не выполнять.
- Кнопка добавления товара должна учитывать `unknown/loading`, `anonymous` и `identified` states, не допускать duplicate submit и не ломать quantity controls.
- Будущая кнопка checkout/order должна открывать тот же modal для anonymous Customer или оставаться недоступной до identify; фактический order flow не входит в M5.
- После сохранения показывать только данные, подтверждённые ответом Backend. Не показывать локально вычисленные discount, rank, balance или loyalty benefits.
- Identify, modal, logout и session expiry не должны очищать cart, выполнять cart merge или создавать order. Guest cart остаётся локальной reference-only state.
- Не добавлять Admin customer page или Admin возможность подтверждать номер.

## Out of Scope

- OTP, SMS, звонки, email verification, password authentication, social login и любая проверка владения номером.
- Отдельная регистрация, email, пароль и любые дополнительные profile fields.
- SMS provider, SMS campaigns и push notifications; M15 остаётся отдельным notification slice.
- Реальный расчёт скидок, birthday campaign, promo, loyalty, XP, rewards или discount eligibility rules; M5 только сохраняет Customer и optional birth date для будущих правил.
- Реализация checkout, orders, order items, payment, refund, SBP, iiko и любые order side effects. В M5 фиксируется только правило: эти операции нельзя начинать без identified session.
- Account recovery, protected account history, sensitive customer data access based only on phone/name, Admin customer management, staff auth и RBAC.
- Cart merge после identify, cross-device cart sync и server-side persistent cart.
- Delivery, pickup scheduling и analytics.
- Redis, Kafka, RabbitMQ, отдельный auth/profile service, hosted identity platform или другая инфраструктура «на будущее».
- Полный TestFlight/App Store/Google Play release validation; допускается auth/session and add-gate native checkpoint.
- Изменение `output.pptx` и перенос prototype auth/cart data в production.

## Architecture / Constraints

- Backend + PostgreSQL — authoritative source для Customer normalized phone, name, birth date и session validity. Customer UI хранит только представление последнего подтверждённого ответа.
- Anonymous catalog browsing разрешён, но add-to-cart является Customer gate: локальная cart mutation начинается только после успешного identify.
- Введённые phone/name — пользовательское утверждение, а не verified identity. Техническая session поддерживает UX и будущий расчёт скидок, но не является подтверждением владения номером.
- M5 не вводит protected operations и не реализует order endpoints. Если checkout/order появятся позже, Backend также должен требовать current session, а не только client UI state.
- Customer-provided phone, name и birth date не считаются доверенными только потому, что пришли из формы. Backend нормализует и валидирует их на каждом write boundary, а session проверяется на каждом endpoint, который использует current Customer.
- Дата рождения хранится как date-only, если передана; Backend валидирует календарную корректность и допустимый диапазон. M5 не выводит из неё скидку, возрастной статус или право на benefit.
- Customer upsert по unique normalized phone должен быть race-safe. При параллельных submit не создавать duplicate Customer rows.
- Session token — opaque short-lived/renewable credential для device continuity, а не доказательство владения phone. Token hash хранится в PostgreSQL; raw token не логируется и не сохраняется в обычный localStorage/AsyncStorage.
- Для Web cookie transport обязательны `HttpOnly`, production `Secure`, подходящий `SameSite`, explicit CORS/origin allowlist и CSRF/origin protection. Для native session используется secure storage adapter.
- Общая customer/session domain, client, add-gate controller и pending cart action совместимы с Web/iOS/Android. Platform-specific код ограничен cookie/secure-storage adapters, lifecycle и UI.
- Guest cart из M4 остаётся локальным reference state и не переносится в PostgreSQL; identify/logout/session expiry не удаляют её. Anonymous UI не может изменить её через add action до прохождения modal gate.
- Rate limiting, session cleanup и expiry сначала реализуются средствами PostgreSQL и обычного application process. Новая инфраструктура допустима только при измеренной необходимости.
- PII minimization: хранить только normalized phone, name, optional birth date и технические timestamps/session metadata; не хранить лишние device fingerprints или полные IP/request payload без отдельного требования.
- Любая schema change выполняется только через versioned migration. Destructive cleanup sessions должен учитывать retention и существующие данные.

## Implementation Requirements

- Вынести Customer/session schemas, types, safe error codes и add-gate state types в `packages/contracts`.
- Добавить server-only configuration для session secret/TTL без вывода secret values. Production configuration не должна требовать SMS/OTP provider.
- Реализовать repository/service boundary для Customer и sessions; routes не должны обращаться к Drizzle напрямую.
- Использовать параметризованные Drizzle queries и transaction/upsert boundary для identify → Customer write → session create/refresh.
- Добавить auth middleware/hook, который устанавливает current Customer context только после server-side session lookup. Customer ID из body/query/header не является authoritative.
- Реализовать expiry/revocation/cleanup для sessions в существующем application process без отдельного worker.
- Добавить shared client/controller с timeout/abort/HTTP/network/runtime-validation semantics и 401-to-anonymous handling.
- Добавить shared add-gate controller: anonymous add сохраняет только безопасный pending `productId`/`quantity`, открывает modal, а после успешного identify выполняет add ровно один раз.
- Добавить Web cookie и native secure-storage adapters с injected test doubles; shared logic не должна импортировать `document`, `window`, `localStorage`, `AsyncStorage` или React Native.
- Не помещать phone, name, birth date или session token в M4 cart persistence payload. Guest cart должна остаться reference-only.
- Обновить README/ARCHITECTURE после реализации так, чтобы было явно указано: add-to-cart требует сохранённый Customer, phone не verified, Backend/DB — source of truth, discount calculation отсутствует.

## Tests

### Contracts and shared customer domain

- valid phone/name request, optional null/valid birth date, Customer response and session response;
- unknown fields, missing phone/name, malformed phone, empty/overlong name and invalid/future/out-of-range birth date;
- phone normalization idempotence and stable upsert input;
- add-gate state and pending action validation: only `productId`/`quantity`, no PII/session token, cancel/dispose clears action;
- session payload/error validation, 401/429/503 handling, timeout, abort, retry, stale response and dispose;
- proof that M4 cart storage contains no phone, name, birth date or session token.

### Backend and PostgreSQL

- versioned migration, constraints, unique normalized phone and repository tests on real PostgreSQL;
- first phone/name identify creates one Customer and session;
- repeated identify for the same normalized phone does not create duplicate Customer and persists current allowed fields;
- optional birth date is persisted as date-only and omitted/null remains safe;
- malformed/unknown fields are rejected; Backend never trusts client Customer ID or client session claims;
- session restore, expiry, revocation and idempotent logout;
- concurrent upsert behavior and rate limiting;
- no OTP/SMS/provider call exists in identify flow; production configuration has no test/fake authentication path;
- safe errors/log assertions: no session token, authorization header or unnecessary PII in logs/errors.

### Customer Web/native-compatible UI

- anonymous catalog and product details remain usable;
- anonymous add-to-cart opens modal and does not mutate cart before successful identify;
- cancel, validation error, Backend error and session error leave cart unchanged;
- successful phone/name submit with optional birth date saves Customer and adds the original Product/quantity exactly once;
- identified add-to-cart bypasses modal; invalid/expired session returns to modal without losing existing cart;
- reload/restart session restore and cart preservation;
- checkout/order entry, when represented by the app later, is blocked for anonymous state and does not create side effects in M5;
- injected Web/native storage tests prove no DOM dependency in shared logic and no auth data in cart storage;
- accessible modal labels, input semantics, focus/close behavior, disabled/loading controls and no duplicate submits;
- existing M4 cart/quote tests remain green; no `/orders`, payment, iiko or discount calculation request is created.

### Web and native checkpoints

- real Backend + PostgreSQL web E2E: anonymous catalog → click add → modal opens → cancel and assert cart unchanged → enter phone/name/optional birth date → save Customer → assert item added once → reload/session restore → logout; assert there is no OTP/SMS/registration/order/payment/iiko flow;
- native checkpoint on an iPhone and Android device/emulator for modal presentation, phone/name entry, secure session persistence, restart restore, add-to-cart continuation, logout and expired-session handling. Full release validation remains outside M5.

## Acceptance Criteria

- [ ] Customer can browse catalog and product details without entering profile data.
- [ ] Anonymous Customer sees a modal when attempting to add a product or change cart quantity; cart remains unchanged until successful identify.
- [ ] Modal requires phone and name, accepts optional birth date, and has no OTP, SMS, call, password, registration or ownership-verification step.
- [ ] Cancel, validation failure or Backend failure closes/keeps the modal appropriately and never adds the pending product.
- [ ] Backend normalizes phone, upserts exactly one Customer in PostgreSQL and returns only server-confirmed phone/name/birth-date/session state.
- [ ] After successful identify the original product action completes exactly once; an already identified Customer can add directly without another modal.
- [ ] Customer session survives Web reload/native restart through cookie/secure-storage adapters; invalid session becomes anonymous without losing existing cart contents.
- [ ] Customer can logout; logout is idempotent and does not create order/payment side effects.
- [ ] Any future checkout/order entry requires identified session; M5 does not add checkout/order implementation.
- [ ] No code path marks the phone as verified or treats phone/name as proof of identity.
- [ ] Customer UI exposes accessible modal validation, loading, success, error, anonymous and identified states and explains that birth date is optional for future discounts.
- [ ] Shared customer/session/add-gate logic is free of DOM and direct platform-storage imports; adapters are isolated for Web/iOS/Android.
- [ ] No OTP/SMS provider, separate registration flow, extra profile fields, discount calculation, Admin customer page, server-side cart, checkout, order, payment or iiko side effect is added.
- [ ] Existing M4 tests plus new contracts, backend, database, client, UI and web/native checkpoint tests pass.
- [ ] Documentation, Progress, Discoveries, Decision Log and Outcome are updated; after completion this plan is moved to `docs/exec-plans/completed/`.

## Verification

Базовые проверки repository:

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
```

Web E2E должен использовать real Backend + PostgreSQL:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_test \
  pnpm exec playwright test e2e/auth.spec.ts
```

Также проверить:

- Customer Web через `http://localhost:8082` и API через `http://127.0.0.1:3000`;
- anonymous catalog/product browsing работает, а add-to-cart для anonymous открывает modal;
- отмена или ошибка modal не меняет cart, успешный submit сохраняет Customer в PostgreSQL и добавляет pending product ровно один раз;
- в UI явно сказано, что номер не проверяется, отдельной регистрации нет, а дата рождения вводится по желанию для будущих скидок;
- отсутствие OTP/SMS/provider calls, secrets, raw session tokens и лишней PII в logs/errors/browser console;
- отсутствие direct frontend PostgreSQL access, Admin customer page, order/payment/iiko/discount requests;
- native auth/session/add-gate checkpoint без требования native environment для обычной Web-разработки;
- `git status --short`: сохранить пользовательские изменения и не изменять `output.pptx`.

## Progress

- [x] Подтвердить phone/name contract: normalization, обязательные номер и имя, optional birth date, отсутствие регистрации/verification и modal gate перед add.
- [x] Добавить contracts, session configuration, migrations, repository/service и customer routes.
- [x] Реализовать Customer upsert, session middleware, `/auth/me` и logout.
- [x] Реализовать shared customer/session client/controller и Web/native session adapters.
- [x] Реализовать add-to-cart gate, pending action semantics и CustomerIdentifyModal, сохранив anonymous catalog и local M4 cart.
- [x] Добавить contract, unit, API, PostgreSQL, component, real web E2E и native-compatible adapter tests.
- [x] Обновить README/ARCHITECTURE и зафиксировать только реальные Discoveries/Decision Log.
- [x] Выполнить verification, заполнить Outcome и подготовить перенос plan в `completed/`.

## Discoveries

- Existing M4 `CartChange` already centralizes local reference-only mutations, so the gate wraps add/increase without changing cart persistence.
- Fastify CORS did not provide a cookie parser boundary in the existing stack; auth uses a small allowlisted cookie serializer/parser and explicit origin checks for cookie mutations.
- A static `expo-secure-store` import makes the current Vitest/Rolldown setup parse React Native Flow sources; the native adapter therefore lazy-loads SecureStore while tests inject a secure-store double.
- Browser E2E uses Customer `localhost` and API `127.0.0.1`; the Web auth adapter defaults to `http://localhost:3000` so the HttpOnly SameSite cookie survives reload in local development.
- Anonymous `/auth/me` intentionally returns safe 401; foundation smoke now ignores this expected resource failure while still failing on unexpected browser errors.

## Decision Log

- По требованию owner M5: при попытке anonymous Customer добавить товар сначала открывается modal; phone и name обязательны, birth date optional.
- Отдельной регистрации, OTP, SMS, звонков, паролей или любой проверки владения номером не будет.
- Товар добавляется в M4 guest cart только после успешного server-backed identify; отмена или ошибка не меняет cart.
- Введённые данные сохраняются в PostgreSQL как normalized Customer record; это лёгкая идентификация для UX, а не verified identity.
- Техническая session нужна только для continuity текущего Customer. Она не превращает номер в подтверждённый credential.
- Guest catalog остаётся anonymous-first, но add-to-cart и будущий checkout являются Customer-gated действиями; server-side cart и cart merge не добавляются.
- Для текущего single-process масштаба Customer/session state хранится в PostgreSQL; Redis, broker и hosted auth platform не добавляются.
- Web и native используют разные session transport adapters: HttpOnly cookie для Web и secure native storage для iOS/Android; общие contracts/client/controller не знают о platform storage.
- Discount rules, eligibility и начисление benefits будут отдельной бизнес-задачей; M5 сохраняет Customer и optional birth date для будущих правил.
- Session token is HMAC-digested before repository access and raw token is returned only for bearer transport or emitted as an HttpOnly cookie; it is never included in cart state or logs.
- Identify rate limiting is a bounded in-process fixed-window limiter keyed by request IP and route, appropriate for the current single-process scale.
- Identified add/increase performs a server `/auth/me` check before the local cart mutation, so an expired/revoked session returns to the modal without losing existing cart contents.

## Outcome

M5 завершён. Добавлены strict auth contracts, `customers`/`customer_sessions` versioned migration, transactional PostgreSQL upsert/session repository, HMAC-backed opaque sessions, safe `/auth/identify`, `/auth/me` and idempotent `/auth/logout`, rate limiting and origin protection. Customer Web/native используют общий auth client/controller с cookie и SecureStore bearer adapters.

Anonymous catalog browsing сохранился. Add-to-cart и увеличение quantity проходят через CustomerIdentifyModal; phone и name обязательны, birth date optional, pending action содержит только `{ productId, quantity }`, а cart persistence осталась reference-only. После успешного server response исходное действие выполняется ровно один раз; logout/session expiry не очищают cart. OTP/SMS/registration/verification, checkout/order/payment/iiko/loyalty/discount flows не добавлялись.

Verification: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `git diff --check`, PostgreSQL migration + integration suite и полный Playwright suite (`5 passed`) прошли. Physical iPhone/Android, TestFlight и Google Play validation не выполнялись: это release validation следующего этапа; native-compatible secure-storage adapter покрыт injected tests.
