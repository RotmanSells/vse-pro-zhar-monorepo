# M16 — Admin completion

Status: planned
Milestone: M16
Depends on: M11 Admin Orders, M13 Loyalty local slice, M14 Wheel + Quests local slice

> Push и SMS намеренно не входят в M16. Их provider lifecycle, device tokens, permissions и реальная отправка будут отдельной последней задачей перед общим тестированием приложения. M16 не должен создавать fake `sent`, `delivered` или `read` statuses.

## Purpose

Завершить Admin Web как production-backed vertical slice, визуально повторяющий Admin prototype, но без переноса demo storage, фиктивной аналитики, fake customer data, fake campaigns или client-side business authority.

M16 добавляет недостающие Admin surfaces:

- Dashboard / Analytics;
- Promos;
- Customers;
- Segments;
- Messages surface без реальной Push/SMS dispatch.

Существующие Catalog, Orders, Loyalty, Wheel и Quests не переписываются без необходимости и должны продолжить работать через текущие boundaries.

Целевой vertical slice:

```text
Admin intent
→ shared contracts
→ API client/controller
→ protected Backend route
→ domain service
→ repository/query
→ PostgreSQL authoritative data
→ Admin UI
```

## Visual source of truth

Обязательный visual source of truth:

- `/Users/rotman/Desktop/prototypes/admin.html`;
- Admin CSS variables, sidebar, mobile topbar, cards, tables, modals и responsive breakpoints из prototype;
- page ids `page-dashboard`, `page-promos`, `page-customers`, `page-segments`, `page-messages`;
- соответствующие prototype functions `renderDashboard`, `renderPromos`, `renderCustomers`, `renderSegments`, `renderMessages`.

В production должны быть сохранены:

- VPZ Admin sidebar и mobile navigation;
- page header/title/subtitle hierarchy;
- cards, tables, filters, badges, buttons, modals и empty states;
- orange/red/charcoal visual language;
- Montserrat/Inter typography hierarchy;
- spacing, radii, shadows, dividers и responsive behavior;
- prototype composition на `320`, `375`, `768`, `1024`.

Prototype visual composition переносится максимально точно, но prototype business logic и demo data не переносятся автоматически.

## Current State

- Admin production app имеет staff auth, Catalog, Orders, Loyalty, Wheel и Quests.
- Dashboard в current Admin sidebar disabled.
- Promos disabled.
- Customers disabled.
- Segments отсутствуют.
- Messages отсутствуют.
- Prototype Admin содержит client-side/local data paths, которые нельзя использовать как production source of truth.
- Current Backend routes покрывают auth, catalog/media, orders/recovery, loyalty, Wheel и Quests; analytics/promos/customers/segments/messages API boundaries отсутствуют.
- PostgreSQL остаётся единственным authoritative store.
- Push/SMS providers и реальные message delivery contracts намеренно откладываются.

## Mandatory Project Rules

- **🔴 MUST** — `/Users/rotman/Desktop/prototypes/admin.html` является visual source of truth для Admin screens.
- **🔴 MUST** — Backend + PostgreSQL являются источником истины для analytics, promo definitions, customers, segments, message drafts/history и delivery states.
- **🔴 MUST** — Admin UI не вычисляет authoritative revenue, order counts, customer segments, promo validity, discount totals или delivery status.
- **🔴 MUST** — все Admin mutations проходят auth, origin, runtime validation, permission boundary и audit-safe persistence.
- **🔴 MUST** — не переносить prototype `data/store.json`, localStorage business state, fake customers, fake orders, fake analytics или fake campaign statuses в production runtime.
- **🔴 MUST** — сохранять lego boundaries:

  ```text
  contracts → repositories → domain services → routes → API clients/controllers → Admin UI
  ```

- **🔴 MUST** — Admin не получает прямой доступ к PostgreSQL, iiko, YooKassa, Push provider, SMS provider или любому внешнему provider.
- **🔴 MUST** — использовать только canonical PostgreSQL database `vse_pro_zhar_dev`.
- **🔴 MUST** — не создавать `vse_pro_zhar_test`, другие `*_test` databases или новую инфраструктуру.
- **🔴 MUST** — денежные значения, discounts, limits и loyalty values — integer units; floating-point business calculations запрещены.
- **🔴 MUST** — unknown, stale, malformed, failed или unavailable state не становится success.
- **🔴 MUST** — PII показывается только в approved bounded view: не выводить passwords, session tokens, payment instruments или raw provider payloads.
- **🔴 MUST** — Admin operations должны быть pagination-bounded и не загружать неограниченные таблицы.
- **🔴 MUST** — M16 не меняет бизнес-смысл M12/M13/M14 и не добавляет Push/SMS dispatch скрытым образом.
- **🔴 MUST** — responsive visual check на `320`, `375`, `768`, `1024`; интерактивные controls минимум `44×44` px.
- **🔴 MUST** — перед завершением нужен browser/screenshot comparison с prototype.

## Mandatory Decision Gate

До реализации write-path для новых Admin domains owner должен подтвердить следующие правила. Если решение не подтверждено, соответствующая mutation остаётся unavailable, а UI показывает честный disabled/empty state.

### Promos

Нужно подтвердить:

1. Разрешённые типы: percent discount, fixed RUB discount или другие.
2. Minimum order amount и currency.
3. Active period и timezone.
4. Per-customer usage limit, global usage limit и whether one use per order.
5. Можно ли stack промокодов.
6. Можно ли применять promo к уже discounted/loyalty order.
7. Поведение при cancellation/refund.
8. Нужен ли Customer promo input в cart/checkout в рамках M16.
9. Нужны ли promo audit/history и versioned definitions.

До подтверждения этих правил Admin может иметь только read/unavailable surface без изменения checkout total.

### Customers

Рекомендуемая безопасная M16 boundary:

- read-only customer list;
- bounded search/pagination;
- masked phone;
- order count и confirmed spend из Backend;
- last activity только из persisted server data;
- loyalty summary/history через existing safe Admin boundary;
- никакого direct balance/XP/rank setter;
- никакого удаления Customer из Admin UI.

Нужно подтвердить, разрешены ли позднее:

- изменение Customer display name;
- export PII;
- manual deactivation;
- customer notes;
- data deletion/export request.

До отдельного решения эти mutations не входят.

### Segments

Сегмент считается только Backend query/projection, а не массивом клиентов в браузере.

Нужно подтвердить:

- разрешённые критерии;
- timezone для inactivity/date conditions;
- snapshot или live segment semantics;
- лимит результата;
- PII export policy;
- можно ли использовать segment для message draft preview.

Рекомендуемый baseline: read-only built-in segments + server-owned custom definitions, bounded preview, без удаления historical membership audit.

### Messages

В M16 разрешены только:

- template/draft UI;
- audience/segment preview;
- message history, если есть реальный persisted draft/history contract;
- явно disabled dispatch state до M15.

До M15 нельзя:

- отправлять Push;
- отправлять SMS;
- показывать `delivered`, `read` или `sent` как fake success;
- сохранять fake recipients/delivery results;
- подключать provider credentials;
- имитировать dispatch через localStorage или `data/store.json`.

## Scope

### 1. Admin Dashboard / Analytics

Реализовать server-owned read-only analytics:

- period selector `7 / 30 / 90` days;
- revenue;
- order count;
- average check;
- customer count;
- new/repeat customers;
- cancellations;
- recent orders;
- revenue series;
- top dishes;
- category distribution;
- order status distribution;
- order type distribution, только для реально поддерживаемых types.

Rules:

- Backend вычисляет значения из PostgreSQL;
- money возвращается integer minor units;
- timezone явно фиксируется;
- date range bounded;
- empty/no-data state вместо fake zeros where appropriate;
- unknown/failed analytics query показывает error/retry;
- Admin UI не делает client-side recomputation из partial rows.

### 2. Promos

После owner decision gate:

- strict promo definition contract;
- versioned migration;
- protected Admin list/create/update/deactivate routes;
- active period, bounds, usage policy и audit fields;
- Customer checkout integration только через Backend quote/total;
- historical order snapshot не меняется после изменения promo definition;
- no client-controlled discount or total;
- safe unavailable state, если promo contract ещё не approved.

Если owner gate не закрыт, реализовать только визуальный Admin placeholder с чётким `Функция пока недоступна`, без fake records и без checkout mutation.

### 3. Customers

- server-backed list;
- bounded search;
- pagination;
- masked phone/approved identity fields;
- order count;
- confirmed spend;
- last activity;
- loyalty summary/status;
- customer detail only for approved data;
- loading/empty/error/unavailable states;
- no manual balance/rank/XP editing;
- no raw payment/provider payloads;
- no unbounded export.

### 4. Segments

- built-in segments from Backend queries;
- approved custom segment definitions;
- criteria validation;
- server-side count;
- bounded preview;
- empty/no-match state;
- loading/error/unavailable states;
- deterministic timezone/date behavior;
- no client-side authoritative filtering;
- no leakage of customers outside Admin scope.

### 5. Messages / Campaign preparation

- prototype-aligned message templates UI;
- segment recipient preview from Backend;
- draft creation only if approved and persisted;
- preview text;
- channel shown as unavailable until M15 provider contract;
- no fake dispatch status;
- no real Push/SMS provider calls;
- history surface may show only persisted real drafts/events, never synthetic sent/delivered rows.

### 6. Admin shell

- Enable Dashboard, Promos, Customers, Segments and Messages navigation only when each actual screen is ready.
- Preserve current Catalog, Orders, Loyalty, Wheel and Quests navigation.
- Keep staff session boundary and logout behavior.
- Add mobile sidebar/topbar behavior from prototype.
- Keep disabled/unavailable labels honest where a dependency is intentionally deferred.

## Out of Scope

- Push provider, SMS provider, device tokens, permissions and real dispatch; M15.
- Email delivery provider and marketing consent workflow without separate contract.
- Real campaign delivery, delivery receipts or read receipts.
- Fake message statuses or prototype local message log.
- Direct Admin balance/XP/rank correction.
- Delivery business flow.
- New payment provider or iiko boundary.
- New Redis/Kafka/RabbitMQ/queue/worker service.
- Second PostgreSQL database.
- Full CRM automation unless explicitly approved.
- Unbounded PII export.

## Architecture / Implementation Requirements

- Contracts live in `packages/contracts` and reject unknown fields.
- SQL/query ownership lives in `packages/database` repositories.
- Aggregation and segment semantics live in Backend domain services.
- Routes own auth/origin/input parsing/safe error mapping.
- `packages/api-client` owns runtime parsing, timeout, abort and lifecycle controllers.
- Admin React UI owns only presentation and interaction state.
- Use versioned migration for every schema change.
- Add indexes for date range, status, customer search and segment criteria only when query evidence requires them.
- Use bounded pagination and explicit max limits.
- Add audit-safe actor/source/timestamp fields for Admin mutations.
- Preserve immutable order and loyalty history.
- Do not use current catalog price/name to rewrite historical analytics or orders.
- If analytics data is incomplete or reconciliation is required, show unavailable/reconciliation instead of fabricated metrics.

## Tests

### Contracts

- Reject floats, negative values, unknown fields, invalid dates, invalid ranges, unsupported promo types and unbounded limits.
- Reject client-provided revenue, order counts, customer spend, segment counts, promo discount totals or message delivery statuses.
- Validate masked PII shape and absence of secrets/provider payloads.

### Dashboard/Analytics

- Exact date boundaries for 7/30/90 days.
- Europe/Moscow timezone boundaries.
- Empty period.
- Orders with completed/canceled/pending/payment states.
- Revenue from authoritative order/payment facts only.
- Integer money aggregation.
- Repeat customer calculation.
- No double counting from replayed events.
- Query timeout/error/unavailable state.
- Bounded result size.

### Promos

- Contract and migration constraints.
- Active/inactive/expired periods.
- Minimum amount boundaries.
- Usage limits and duplicate use.
- Concurrent application.
- Checkout total always Backend-owned.
- Cancellation/refund behavior according to approved decision.
- Historical order snapshot stability.
- Unsupported reward/discount type fails closed.

### Customers

- Staff auth required.
- Search/pagination bounds.
- Customer isolation and masked PII.
- Correct order count/spend from persisted data.
- Empty/no-match/error/retry states.
- No balance/rank/XP setter.
- No raw provider/payment data.

### Segments

- Criteria validation.
- Date/timezone boundaries.
- Empty/no-match.
- Count consistency with Backend query.
- Deterministic custom definition evaluation.
- Concurrent definition update behavior.
- Bounded preview and no unbounded PII return.

### Messages

- Draft validation and persistence, if approved.
- Segment recipient preview is server-owned.
- M15 channel unavailable state.
- No provider request is made.
- No fake `sent`, `delivered`, `read` or `failed` events.
- Refresh/retry/duplicate draft behavior.

### Regression/security

- Existing Catalog, Orders, Loyalty, Wheel and Quests tests remain green.
- Anonymous Admin receives 401.
- Customer session cannot access Admin routes.
- Origin/session checks remain enforced.
- CSRF/unsafe mutation boundaries remain protected by existing rules.
- No secrets, password hashes, session tokens, card data or raw provider payloads in UI/logs.

### Visual/E2E

- Screenshots against `/Users/rotman/Desktop/prototypes/admin.html` at `320`, `375`, `768`, `1024`.
- No horizontal overflow.
- Sidebar/mobile drawer behavior.
- Tables scroll safely where needed.
- Modals remain usable on narrow screens.
- Keyboard/focus/accessibility labels.
- Touch targets minimum `44×44`.
- Empty/loading/error/unavailable/success states match Admin visual language.

## Acceptance Criteria

- Dashboard, Customers, Segments and appropriate Promos/Messages states are reachable through real Admin navigation.
- All implemented data comes from Backend + PostgreSQL, not prototype fixtures or browser local state.
- Analytics values are reproducible from authoritative persisted data and use integer money units.
- Customer data is bounded, masked and staff-protected.
- Segment counts and previews are server-owned.
- Promo mutation is either fully contract-backed or explicitly unavailable; no half-working discount path.
- Messages do not call Push/SMS providers and do not show fake delivery success before M15.
- Existing Catalog, Orders, Loyalty, Wheel and Quests behavior is unchanged.
- Prototype visual composition is matched at all required widths.
- Automated, API, database, browser and responsive checks pass.
- M15 Push/SMS remains a separate later task.
- Plan is not moved to `completed/` while any decision gate, provider boundary or verification item is unresolved.

## Verification

```bash
pnpm lint
pnpm typecheck
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar-database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar-database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm test
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm e2e -- --workers=1
pnpm build
pnpm audit --prod
git diff --check
```

Manual Admin verification:

1. Compare each implemented page with `/Users/rotman/Desktop/prototypes/admin.html`.
2. Check `320`, `375`, `768`, `1024` widths.
3. Check staff login, reload, logout and expired session.
4. Check Dashboard empty/loaded/error states.
5. Check Customers search/pagination/masked PII.
6. Check Segments criteria/count/empty/preview.
7. Check Promo unavailable or fully approved path.
8. Check Messages draft/preview/unavailable dispatch.
9. Check no provider requests are made by M16.
10. Check no console errors or unhandled promise rejections.

## Progress

- [ ] Прочитать `AGENTS.md`, `PLANS.md`, Product/Architecture docs и весь Admin prototype.
- [ ] Зафиксировать owner decisions для Promos, Customers, Segments и Messages.
- [ ] Зафиксировать authoritative data sources и PII policy.
- [ ] Реализовать contracts и versioned migrations.
- [ ] Реализовать repositories/domain services/analytics queries.
- [ ] Реализовать protected Admin routes и safe errors.
- [ ] Реализовать API clients/controllers.
- [ ] Реализовать Dashboard/Analytics.
- [ ] Реализовать Customers.
- [ ] Реализовать Segments.
- [ ] Реализовать approved Promos path или honest unavailable state.
- [ ] Реализовать Messages draft/preview/unavailable surface без Push/SMS dispatch.
- [ ] Перенести visual composition prototype в Admin UI.
- [ ] Добавить contract/domain/API/component/E2E tests.
- [ ] Выполнить responsive screenshot comparison `320/375/768/1024`.
- [ ] Обновить `Progress`, `Discoveries`, `Decision Log`, `Outcome`.
- [ ] Перенести plan в `docs/exec-plans/completed/` только после полного acceptance.

## Discoveries

- Prototype Admin содержит Dashboard, Promos, Customers, Segments и Messages, которых нет в текущем production Admin shell.
- Current Backend не имеет analytics/promo/customer/segment/message routes.
- Prototype использует local/demo data и delivery statuses; эти значения нельзя переносить в production.
- Push/SMS dispatch нужно оставить отдельной задачей M15.

## Decision Log

- M16 продолжает существующий Admin visual world из prototype; новая visual identity не создаётся.
- M16 реализует server-owned Admin surfaces, а не legacy client-side store.
- Push/SMS и provider delivery намеренно исключены из M16 и остаются M15.
- При отсутствии owner decision соответствующая mutation остаётся unavailable, а UI не создаёт fake success.
- Existing Catalog, Orders, Loyalty, Wheel и Quests boundaries не переписываются ради M16.

## Outcome

Execution plan создан после сравнения текущего Admin production-среза с prototype. Реализация M16 ещё не начиналась; Push и SMS явно отложены до отдельной задачи M15.
