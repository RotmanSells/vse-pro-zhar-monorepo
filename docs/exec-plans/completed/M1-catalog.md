# M1: каталог

Status: completed
Milestone: M1
Depends on: completed M0 foundation and M0 code quality

## Purpose

Сделать первый пользовательский бизнес-срез приложения «Все Про Жар»: управляемый каталог товаров, доступный в Admin и Customer через реальный Backend API и PostgreSQL.

## Design Source and Fidelity

- Единственный источник дизайна для Admin и Customer — `/Users/rotman/Desktop/prototypes`.
- Реализованный интерфейс должен быть 100% визуально и поведенчески идентичен соответствующим прототипам: layout, typography, colors, spacing, states, interactions и responsive behavior.
- Перед реализацией каждого экрана нужно изучить соответствующий прототип и использовать его assets и UI-паттерны, если они там предусмотрены.
- Acceptance включает визуальную сверку каждого реализованного экрана и состояния с прототипом; самостоятельная замена дизайна или упрощённый placeholder без согласования не допускаются.

## Current State

Технический фундамент M0 завершён: существуют Backend, shared contracts, shared API client, PostgreSQL foundation, Admin и Customer health-сценарии, а также базовые проверки и диагностика.

## Scope

1. Добавить `Category` и `Product` в PostgreSQL через versioned migration.
2. Реализовать Backend API каталога с typed contracts и runtime validation.
3. Реализовать в Admin создание, редактирование и скрытие товара.
4. Реализовать в Customer просмотр категорий и товаров.
5. Добавить automated tests и проверить пользовательский сценарий целиком через web.

## Out of Scope

- authentication и role management в рамках текущего каталогового среза;
- корзина, checkout, заказы и оплата;
- интеграция с iiko, если она не потребуется для явно согласованного каталожного контракта;
- loyalty, promo и rewards;
- новая инфраструктура, отдельные сервисы и преждевременная оптимизация;
- native release validation и полноценный production deployment.

## Architecture / Constraints

- Backend и PostgreSQL являются источником истины для категорий, товаров, цен и видимости.
- Customer и Admin не принимают клиентские данные как authoritative source.
- Денежные значения хранятся и передаются в целых minor units.
- Изменение схемы выполняется только через versioned migration.
- Входные и выходные данные API проходят runtime validation.
- Общие contracts, API-клиент и бизнес-логика остаются совместимыми с Web, iOS и Android; platform-specific код ограничивается UI-адаптерами.

## Next Required Slice: phone authentication and ordering identity

Этот функциональный срез нужно реализовать сразу после каталога и до корзины, checkout и заказов:

- реализовать вход Customer по номеру телефона;
- перед созданием заказа обязательно требовать номер телефона и имя;
- валидировать и сохранять эти данные на Backend, а не считать Customer state источником истины;
- определить в отдельной задаче детали подтверждения номера, session management и security rules до начала реализации authentication.

Каталог при этом может быть доступен без входа. Такой порядок позволяет сначала закончить просмотр товаров, а затем добавить authentication до появления checkout-зависимостей и не переделывать поток заказа позже.

## Implementation Requirements

- Определить минимальную модель `Category` и `Product`, включая необходимое состояние видимости товара.
- Добавить migration и безопасные ограничения для инвариантов модели.
- Определить и реализовать API для чтения каталога Customer и mutations каталога Admin.
- Не показывать Customer скрытые товары.
- Вернуть явные loading, empty и error states в UI.
- Сохранить race-free request lifecycle и безопасную обработку ошибок из M0.

## Tests

- migration и repository/database tests для `Category` и `Product`;
- contract/runtime validation tests для успешных и некорректных запросов и ответов;
- Backend API tests для чтения, создания, редактирования и скрытия товара;
- Admin UI tests для основных mutation-состояний;
- Customer UI tests для загрузки, empty/error и отображения каталога;
- web smoke/e2e-проверка сценария: Admin создаёт/скрывает товар → Customer видит актуальное состояние.

## Acceptance Criteria

- [x] `Category` и `Product` созданы в PostgreSQL через versioned migration.
- [x] Backend API каталога типизирован, валидирует данные на runtime и использует PostgreSQL как source of truth.
- [x] Admin может создать, отредактировать и скрыть товар.
- [x] Customer видит категории и только опубликованные/не скрытые товары.
- [x] Ошибки, пустой каталог и loading state отображаются явно.
- [x] Automated tests покрывают основные backend, database и UI-сценарии.
- [x] Сквозной web-сценарий проверен.

## Verification

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- применимые migration/database tests с PostgreSQL;
- web smoke/e2e-сценарий каталога.

## Progress

- [x] Подготовить модель и migration каталога.
- [x] Реализовать и проверить Backend API.
- [x] Реализовать Admin и Customer сценарии.
- [x] Выполнить automated и web-проверки.
- [x] Обновить Outcome и перенести plan в `completed/`.

## Discoveries

- M0 содержит только health-сценарии: models, catalog contracts/API, repositories и catalog UI отсутствуют.
- В рабочем дереве уже есть неотслеживаемый `output.pptx`; он не относится к M1 и должен остаться нетронутым.
- Для первого runtime-среза достаточно одной PostgreSQL database и обычного application process; отдельная инфраструктура не потребовалась.
- Без `DATABASE_URL` API сохраняет health-доступность, а catalog endpoints возвращают явный `SERVICE_UNAVAILABLE`; фиктивные products в runtime не добавляются.
- `@fastify/cors` не включал `PATCH` в preflight methods по умолчанию, поэтому Admin mutation contract потребовал явной настройки CORS и отдельного preflight-теста.

## Decision Log

- Начать M1 с каталога как первого вертикального бизнес-среза после M0.
- Не добавлять новую инфраструктуру без конкретного требования текущего сценария.
- Хранить цены только в `priceMinor`; преобразование пользовательского ввода рублей выполнять на Admin boundary до API-запроса.
- Seed-ить только стабильную категорийную таксономию из семи категорий, а товары создавать через Admin API, чтобы не смешивать operational data и demo fixtures.
- Сохранить общий typed catalog client/controller для Web и native-compatible Customer UI; DOM-specific код ограничен Admin presentation.

## Outcome

M1 завершён. Добавлены versioned PostgreSQL schema и repository для `categories`/`products`, runtime-validated Backend API (`/catalog`, `/admin/catalog`, category/product mutations), Admin create/edit/hide flow и Customer catalog view с loading/empty/error/retry states. Добавлены contract, API, database, client/controller, Admin, Customer и E2E проверки; документация синхронизирована. Временная PostgreSQL проверка подтвердила migration/repository persistence, а полный web lifecycle E2E прошёл на реальной БД.
