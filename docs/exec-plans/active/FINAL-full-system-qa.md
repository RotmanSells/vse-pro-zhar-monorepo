# FINAL — Полное тестирование системы и закрытие дефектов

Status: in_progress
Milestone: FINAL QA
Depends on: M0–M16 feature slices, M15 Push + SMS local slice, M14 release checkpoints

## Purpose

Провести полное release-readiness тестирование всего приложения и закрыть все обнаруженные дефекты до тех пор, пока каждый критический путь не будет подтверждён:

```text
Customer/Admin UI
→ shared client/controller
→ Backend route
→ domain service
→ repository
→ PostgreSQL
→ payment/iiko/provider boundary
→ persisted result
→ повторное чтение UI
```

Работа включает:

- каждый Customer screen;
- каждый Admin screen;
- каждую вкладку и navigation transition;
- каждый API route и contract;
- PostgreSQL migrations/constraints/queries;
- payment/refund/iiko/loyalty/Wheel/Quest/Promo/Communications flows;
- cache/storage/session behavior;
- intentional failure testing;
- responsive и visual comparison с prototype;
- исправление каждого найденного дефекта;
- повторную проверку после каждого исправления;
- итоговую release-readiness verification.

## Definition of test completion

Тестирование не считается завершённым по факту прохождения smoke-test.

Задача завершена только когда:

- каждый implemented feature имеет happy-path и negative-path evidence;
- каждый найденный P0/P1/P2 defect исправлен или явно approved как known issue;
- на каждый исправленный баг есть regression test;
- повторный test run подтверждает исправление;
- все существующие функции не регрессировали;
- UI совпадает с prototype на обязательных ширинах;
- Admin login не блокирует легитимный вход и E2E;
- unknown/failure/unavailable state не становится success;
- полный verification report сохранён в plan.

Нельзя заявлять «100% без багов» без перечисленного evidence. Можно заявить только подтверждённые проверками факты.

## Mandatory project rules

- **🔴 MUST** — прочитать `AGENTS.md`, `PLANS.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` и все active plans до начала.
- **🔴 MUST** — prototype `/Users/rotman/Desktop/prototypes/index.html` и `/Users/rotman/Desktop/prototypes/admin.html` являются visual source of truth.
- **🔴 MUST** — Backend + PostgreSQL являются источником истины для денег, заказов, payment, availability, loyalty, promo, segments, drafts, progress, spins и claims.
- **🔴 MUST** — использовать только canonical database `vse_pro_zhar_dev`.
- **🔴 MUST** — нельзя создавать или использовать `vse_pro_zhar_test`, другую `*_test` database или вторую локальную БД.
- **🔴 MUST** — нельзя использовать fake business data для маскировки отсутствующей production functionality.
- **🔴 MUST** — нельзя использовать client-provided total, price, discount, XP, coal, rank, progress, eligibility или delivery status как authoritative.
- **🔴 MUST** — все money/XP/coal/discount values проверяются как integer units.
- **🔴 MUST** — нельзя отключать production auth/rate limit/security, чтобы тесты прошли.
- **🔴 MUST** — controlled fault injection разрешён только локально/dev/test-mode и должен быть обратимым.
- **🔴 MUST** — не использовать `git reset --hard`, `git checkout --`, широкое удаление файлов, `DROP DATABASE`, `TRUNCATE` business tables или ручную запись бизнес-состояний SQL-командами.
- **🔴 MUST** — UI не получает прямой доступ к PostgreSQL, iiko, YooKassa, Push provider или SMS provider.
- **🔴 MUST** — новая инфраструктура не добавляется ради теста.
- **🔴 MUST** — любой найденный баг сначала локализуется, затем исправляется, покрывается regression test и проверяется повторно.

## Admin login and rate-limit hardening

У Admin уже были проблемы с входом и rate limit. Это отдельный обязательный release gate.

### Expected behavior

- Валидные test/admin credentials проходят с первой попытки.
- Ошибка старой cookie/session не блокирует новый корректный login.
- Logout действительно завершает server session.
- Expired/revoked session возвращает пользователя на login без бесконечного redirect loop.
- Login error не раскрывает password/hash/session internals.
- Rate limit не блокирует легитимного Admin после одного корректного входа.

### Test architecture

- Playwright должен логиниться один раз на worker и переиспользовать `storageState`/cookie, где это безопасно.
- Тесты не должны логиниться заново перед каждым сценарием.
- Тесты не должны параллельно делать лишние failed login attempts с одного IP.
- Rate-limit behavior тестируется отдельно: допустимые попытки, блокировка после лимита, окно восстановления, safe error.
- Если owner-approved target равен 15 attempts per 15-minute window, эта цифра должна быть явно зафиксирована в config/test contract; production protection нельзя отключать.
- Для локального E2E разрешён только test-scoped reset/injectable clock/rate-limit namespace, не глобальное снятие limiter.
- Full suite запускается limiter-safe группами, если один общий запуск физически превышает лимит; ни один тест не пропускается.

### Acceptance

- Один правильный Admin login проходит сразу.
- Полный Admin E2E не получает ложные 401/429 из-за повторного login setup.
- Rate-limit test отдельно доказывает, что защита существует.
- Исправление не снижает security boundary.

## Test data and environment

### Canonical environment

Все локальные проверки используют:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev
```

Перед тестом проверить:

- `DATABASE_URL` указывает на canonical DB;
- production credentials не загружены;
- YooKassa/iiko/Push/SMS flags явно test-mode или unavailable;
- API и Admin/Customer используют согласованные ports;
- no stale server process serves an old build;
- current working tree changes сохранены.

### Test data rules

- Business state создаётся через Backend/API/application flow.
- Нельзя выставлять баланс, XP, coal, order status, payment status, reward claim или promo usage прямым SQL update.
- Cleanup разрешён только для явно созданного test Customer/order/draft с известными IDs.
- Historical snapshots после создания не переписываются.
- Test fixtures не должны попадать в production runtime.
- Если production data отсутствует, UI показывает empty/unavailable state.

## Phase 0 — Repository and baseline

До feature testing:

1. Снять `git status --short`.
2. Зафиксировать изменённые пользователем файлы.
3. Проверить все active/completed execution plans.
4. Построить inventory всех routes, screens, clients, controllers, repositories, migrations, providers и tests.
5. Запустить baseline:

```bash
pnpm lint
pnpm typecheck
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm test
pnpm build
pnpm audit --prod
git diff --check
```

Любое baseline failure превращается в отдельный defect: reproduce → root cause → fix → regression test → rerun.

## Phase 1 — Customer complete walkthrough

### Customer shell/navigation

Проверить:

- app launch;
- loading shell;
- API unavailable;
- safe retry;
- tab bar;
- active tab state;
- back navigation;
- reload;
- AppState/resume;
- no stale screen after logout;
- no horizontal overflow;
- touch targets;
- keyboard/focus Web behavior.

### Catalog/Menu

Проверить:

- catalog loading/success/empty/error;
- categories/all category;
- product cards;
- images and broken image fallback;
- hidden product;
- unavailable/stop-list product;
- price and description from Backend;
- add action anonymous → auth gate;
- add action authenticated;
- repeated add click;
- catalog refresh;
- changed Admin price/visibility reflected in Customer;
- no client-authoritative price.

### Authentication

Проверить:

- identify flow;
- valid/invalid input;
- expired session;
- logout;
- reload persistence;
- session revoke;
- unauthorized route;
- foreign customer isolation;
- rate limit and safe errors;
- no token leakage in UI/logs.

### Cart

Проверить:

- add/remove/change quantity;
- min/max quantity;
- duplicate clicks;
- local persistence;
- storage failure;
- unavailable product;
- server quote loading/success/error;
- quote invalidation after catalog change;
- no client-provided price/total;
- empty cart;
- checkout gate.

### Checkout/Pickup

Проверить:

- pickup options;
- unavailable iiko mapping/terminal/stop-list;
- selected slot;
- stale slot;
- changed cart;
- changed price;
- Backend quote;
- duplicate quote/create request;
- idempotency conflict;
- no order on failed quote;
- no delivery UI unless separately approved.

### Payment

Только test-mode/local simulator.

Проверить:

- payment create;
- redirect/return;
- pending;
- succeeded;
- failed;
- expired;
- refresh;
- duplicate callback;
- webhook replay;
- provider GET confirmation;
- client redirect is not payment proof;
- unpaid order never becomes paid/iiko-submitted.

### Orders

Проверить:

- list/detail/empty/loading/error;
- order snapshot name/price/quantity/total;
- all status transitions;
- payment status;
- fulfillment status;
- refresh/AppState;
- customer ownership;
- cancel allowed/blocked states;
- refund pending/succeeded/failed/reconciliation;
- duplicate cancel/refund/reconcile;
- no false success.

### Loyalty/Passport

Проверить:

- XP/coal/rank summary;
- ledger history;
- rank thresholds;
- empty/unavailable/reconciliation;
- completed paid order earn boundary;
- duplicate payment/iiko event;
- no optimistic balance;
- no client-controlled balance.

### Profile

Проверить:

- identity;
- order count;
- favorite product;
- next milestone;
- recent order history;
- bonus card open/close;
- Push/Email/Dark Theme unavailable states;
- logout;
- expired session;
- masked/approved data;
- prototype visual parity.

### Wheel

Проверить:

- anonymous blocked;
- no eligible order;
- exact minimum order;
- completed paid order eligibility;
- cooldown/limit;
- server prize selection;
- no demo mode;
- no client balance mutation;
- duplicate click/retry/concurrency;
- spin history;
- ledger/reward claim;
- unavailable/malformed prize state;
- refund/cancellation behavior;
- no promo/physical reward fake success.

### Quests

Проверить:

- each approved quest definition;
- zero/boundary/complete progress;
- completed paid order event;
- duplicate event/retry/restart;
- claim idempotency;
- inactive definition;
- no historical backfill unless approved;
- cancellation/refund behavior;
- reward ledger;
- unavailable/reconciliation state.

### Customer Promo flow

If Customer promo input is implemented:

- valid/invalid/expired/not-started code;
- min order boundary;
- fixed/percent integer discount;
- no negative total;
- usage limits;
- no stacking;
- quote/order snapshot;
- retry/concurrency;
- payment failure/cancel/refund;
- promo definition update does not rewrite old order.

If not implemented, verify explicit unavailable state and no fake input.

## Phase 2 — Admin complete walkthrough

### Admin auth/rate-limit first

Before every Admin suite:

- one correct login;
- reuse authenticated state;
- no repeated login per test;
- valid login not blocked;
- logout/relogin test separately;
- limiter test isolated.

### Dashboard/Analytics

- periods 7/30/90;
- KPI values;
- previous-period comparison;
- integer money;
- empty/reconciliation/error;
- revenue series;
- top dishes/categories;
- statuses/types;
- recent orders;
- CSV export boundary;
- no client aggregation;
- prototype parity.

### Catalog/Menu

- category/product list;
- search/filter;
- create/update/visibility;
- image upload/fallback;
- invalid price/payload;
- Customer reflection;
- historical snapshots unchanged;
- concurrency/error/retry;
- all modals/focus/keyboard.

### Orders

- filters/search/pagination;
- list/detail;
- payment/fulfillment/cancellation/refund;
- recovery/reconcile;
- idempotency;
- staff auth;
- no iiko browser calls;
- no raw provider payload.

### Loyalty

- read-only ledger;
- pagination/filters;
- source/order/reason/actor/time;
- reconciliation;
- no balance/XP/rank setter;
- PII masking.

### Wheel/Quests

- definitions list;
- visibility/active state;
- approved edit/create boundaries;
- max definitions;
- invalid values;
- immutable history;
- no manual spin/reward/progress mutation;
- Customer reflection.

### Customers

- search/pagination;
- masked phone;
- order count/spend;
- loyalty fields/unavailable;
- empty/no-match/error/retry;
- export disabled/unavailable;
- no CRM mutation.

### Segments

- built-in cards;
- custom definitions;
- live preview/count;
- criteria boundaries/timezone;
- masked detail preview;
- message handoff;
- export unavailable;
- no browser membership calculation.

### Promos

- list/create/update/activate/deactivate/archive;
- integer value/minimum/period validation;
- versions/history/redemption audit;
- Customer checkout unavailable or approved path;
- no fake usage;
- no destructive historical rewrite.

### Communications

- templates;
- segment preview;
- draft create/edit/archive/restore;
- idempotency;
- optimistic conflict;
- audit history;
- promo/segment version snapshots;
- Admin mass Send remains unavailable until the separate campaign dispatch/provider scope;
- no delivery statuses;
- export unavailable;
- no provider calls.

## Phase 3 — Backend/API/database audit

Inventory and verify every route:

- `/health`;
- `/auth/*`;
- `/admin/auth/*`;
- `/catalog` and `/admin/catalog`;
- `/cart/quote`;
- `/checkout/*`;
- `/orders/*`;
- `/admin/orders/*`;
- `/orders/:id/payments`;
- payment webhooks/status;
- cancellation/refund/reconcile;
- `/loyalty/*`;
- `/admin/loyalty/*`;
- `/profile`;
- `/admin/analytics/*`;
- `/admin/customers`;
- `/admin/segments/*`;
- `/admin/promos/*`;
- `/admin/communications/*`.

For every route verify:

- auth/origin;
- input schema;
- output schema;
- authorization/ownership;
- safe error mapping;
- timeout/abort/retry;
- idempotency for side effects;
- no raw provider/PII leakage;
- DB transaction/lock/constraint;
- no direct UI/provider access.

Database checks:

- every migration runs on canonical DB;
- constraints exist;
- indexes/query bounds;
- immutable snapshots;
- no duplicate ledger/reward/promo/draft effects;
- aggregate vs ledger reconciliation;
- no destructive data loss;
- restart-safe processors.

## Phase 4 — Payments, refunds, iiko, providers

### Payment provider

- test-mode credentials only;
- create/get/webhook status;
- duplicate webhooks;
- invalid signature/body;
- pending/failed/succeeded/expired;
- unknown result reconciliation;
- no real production money.

### Refund provider

- test-mode payment only;
- full refund;
- idempotency;
- pending/confirmed/canceled/reconciliation;
- duplicate refund;
- receipt/accounting policy evidence;
- no false refunded state.

### iiko

- availability/stop-list;
- mapping missing/stale/malformed;
- paid order submission;
- stable correlation ID;
- duplicate/retry/restart;
- monotonic kitchen statuses;
- fulfillment problem;
- no browser iiko calls;
- no paid order lost on failure.

### Push/SMS when M15 is implemented

- device registration;
- permission denial;
- consent/opt-out;
- provider timeout/5xx;
- idempotent send;
- delivery status only after provider event;
- retry/reconciliation;
- no credentials in UI/logs;
- no SMS/Push test accidentally sent to real recipients.

## Phase 5 — Cache, storage and stale state

Inventory real cache/storage layers:

- HTTP/browser cache;
- React/native state;
- localStorage/SecureStore;
- service worker/build cache;
- server memory/query cache, if any;
- database indexes are not a business cache.

For every real layer test:

- hit/miss;
- stale value;
- invalidation after Admin mutation;
- session isolation;
- logout cleanup;
- offline/reconnect;
- timeout with cached data;
- reload;
- app resume;
- no stale price/order/payment/balance/XP/coal/rank/availability success.

If no cache exists, document that fact. Do not add infrastructure.

## Phase 6 — Intentional failure/chaos pass

In local/test mode deliberately inject:

- offline;
- timeout;
- HTTP 400/401/403/404/409/422/429/500/503;
- malformed JSON/schema;
- expired session;
- duplicate request;
- double click;
- concurrent request;
- duplicate webhook;
- duplicate iiko event;
- duplicate spin/quest/draft/promo usage;
- DB transaction rollback;
- API process restart;
- stale segment/promo/version;
- missing mapping;
- provider unknown result.

After every fault verify:

- safe error/unavailable/reconciliation UI;
- no partial success;
- no duplicate money/order/reward/draft effect;
- retry result is deterministic;
- recovery after dependency restoration.

## Phase 7 — Visual parity and frontend audit

### Customer

Compare current UI with `/Users/rotman/Desktop/prototypes/index.html`:

- Menu;
- Roulette;
- Passport/Quests;
- Cart;
- Profile;
- Auth/checkout/order/loyalty states.

### Admin

Compare current UI with `/Users/rotman/Desktop/prototypes/admin.html`:

- Dashboard;
- Orders;
- Menu;
- Promos;
- Customers;
- Segments;
- Communications;
- Quests/Wheel/Loyalty integration.

Required widths:

- `320`;
- `375`;
- `768`;
- `1024`.

Check exactly:

- header/sidebar/tabbar;
- title/subtitle;
- colors/gradients/glow;
- typography/weights;
- spacing/radii/shadows;
- cards/tables/modals;
- empty/loading/error/unavailable/reconciliation/success states;
- no horizontal overflow;
- no clipped text;
- no hidden critical controls;
- accessible labels/roles;
- focus/keyboard/Escape;
- 44×44 targets.

Use a bounded visual cycle: capture → inspect → batch-fix → capture again. Do not endlessly polish unrelated surfaces.

## Defect workflow

For every issue:

1. Assign ID and severity P0/P1/P2/P3.
2. Record exact reproduction steps.
3. Record expected vs actual.
4. Identify affected layer.
5. Assess money/order/security/PII impact.
6. Fix root cause immediately.
7. Add regression test.
8. Run narrow test.
9. Run affected E2E/browser flow.
10. Run relevant full suite.
11. Recheck visual state if UI changed.
12. Update execution plan.

Never:

- weaken an assertion;
- skip a failing test without owner approval;
- hide an unavailable feature as success;
- fix only the screenshot while leaving the API bug;
- bypass the Admin rate limiter globally;
- use fake data to make the screen look populated.

## Final verification commands

```bash
pnpm lint
pnpm typecheck
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm test
pnpm build
pnpm audit --prod
git diff --check
```

E2E must be run without accidental extra separator:

```bash
pnpm exec playwright test --workers=1
```

If the whole suite exceeds the Admin limiter, run documented limiter-safe groups with one auth session per worker, then run the isolated Admin login/rate-limit test separately. No test may be skipped.

## Evidence package

Store/refer to:

- command outputs;
- test counts;
- E2E reports;
- Admin login/rate-limit evidence;
- screenshots for all required widths;
- defect list and fixes;
- regression test names;
- provider test-mode evidence;
- native device evidence;
- known limitations and owner decisions.

## Progress

- [x] Прочитать все project rules, product docs и active plans.
- [x] Составить inventory всех screens/routes/functions/providers/cache layers.
- [x] Исправить и доказать Admin login/rate-limit test architecture.
- [x] Выполнить Customer full walkthrough.
- [x] Выполнить Admin full walkthrough.
- [x] Выполнить Backend/API/database audit.
- [x] Выполнить local test-mode payment/refund boundary и iiko simulator checks.
- [x] Выполнить cache/storage/stale-state checks.
- [x] Выполнить intentional failure/chaos pass в automated/local provider checks.
- [x] Выполнить visual prototype comparison.
- [x] Исправить найденные defects и добавить regression coverage.
- [x] Выполнить final lint/typecheck/test/build/audit/E2E.
- [x] Обновить `Progress`, `Discoveries`, `Decision Log`, `Outcome`.
- [ ] Перенести plan в `docs/exec-plans/completed/` только после полного acceptance.

## Discoveries

- Current project includes Customer, Admin, Backend, PostgreSQL, payment, iiko, loyalty, Wheel/Quest, Profile, Promos, Segments and Communications slices with separate execution evidence.
- Admin login rate limiting previously caused false E2E failures when every test performed a fresh login; auth-state reuse and limiter-safe grouping are required.
- Prototype is visual authority, while prototype demo values and client-side business logic are not production truth.
- M15 local Push contract is implemented: native Expo registration and PostgreSQL device/preferences. Phone-only auth deliberately does not send SMS codes; SMS.ru adapter remains reserved for future transactional/campaign messages. Real credentials, device receipt and Admin mass dispatch remain release/operational gates.
- The baseline migration commands contained a stale package filter (`@vse-pro-zhar-database`); the active plan now uses the actual workspace package `@vse-pro-zhar/database`.
- Full E2E initially exceeded the real Admin limiter because each browser test logged in independently. `e2e/global-setup.ts` creates one test session, `e2e/admin-auth.ts` reuses it only in browser contexts, and anonymous API fixtures remain anonymous.
- The analytics E2E previously assumed an empty canonical database. It now derives the empty/loaded chart assertion from the authoritative `/admin/analytics?days=30` response, so a valid persisted test order does not create a false failure.
- The local iiko simulator passed 14 files / 49 tests. Positive availability and fulfillment passed; stop-list and terminal-offline faults returned safe `CHECKOUT_UNAVAILABLE` without creating an order.
- `scripts/test-payment.mjs` is an explicit local-only harness: it uses a loopback YooKassa-compatible mock, `YOOKASSA_TEST_MODE=true`, the canonical database and the existing iiko simulator. It created one persisted test order, replayed the payment webhook, and reached `payment=succeeded`, `order=completed`.
- Earlier QA history recorded 293 unit/integration tests and 18/18 Playwright tests; the later canonical rerun below supersedes that count. Non-blocking warnings remain from the simulator's Node 24 engine requirement while the current shell used Node 22, Expo deprecated style props, and pg's concurrent query deprecation warning.
- Final canonical verification on 2026-09-10 ran the previously skipped PostgreSQL integration tests explicitly: contracts 52, API client 84, API 117, Customer 28, Admin 19 and database 25, for 325 passing package tests; Playwright passed 22/22 with one worker before the phone-only auth correction.
- Initial parallel Playwright exposed shared-canonical-state races: Wheel settings, persistent segment membership and reward archive selectors assumed an empty/isolated database. The tests now use one worker and data-aware/scoped assertions; no business data was broadly deleted.
- Checkout E2E briefly selected a slot at a 30-minute boundary and received the correct stale-slot error. The test now selects the latest available slot before asserting the independent iiko fail-closed path.
- The local payment harness was made repeatable against persistent canonical data: mock provider IDs are unique per run, simulator state is reset at start, API/mock shutdown is bounded, and the final `pnpm test:payment` exits 0 without leaving listeners.
- Documentation was synchronized with completed M13.5 fixed-discount rewards/redemption; custom segments remain intentionally unavailable by owner scope.
- Wheel prize update was corrected after QA found that `type/value` were validated but dropped by the repository; the new migration/history, optimistic version lock and idempotency conflict path pass API/DB/E2E regression checks.
- Payment revalidation was corrected after QA found that a persisted fixed-discount redemption was omitted from the second quote check; the Backend now subtracts only that persisted discount and the discounted payment regression passes.
- Loyalty ledger source contracts now include Wheel/Quest reward entries; Customer shows confirmed ledger history and reuses the same redemption idempotency key across retries while exposing safe failure/reconciliation state.
- Customer catalog text search is now implemented and verified by component/E2E coverage; it filters only the confirmed catalog snapshot and composes with category filtering.

## Decision Log

- Final QA fixes defects immediately instead of producing a report-only backlog.
- Per-feature regression tests remain mandatory even though the exhaustive manual/E2E pass happens after feature completion.
- Admin rate limiter is never globally disabled; test setup reuses authenticated state and tests the limiter separately.
- Canonical DB and test-mode provider boundaries remain mandatory.
- Prototype visual parity is verified by screenshots at `320/375/768/1024`.
- Payment test automation uses a separate local mock provider process and a separate API process; no fake payment route or test provider is wired into production runtime.
- The test-payment order is intentionally retained as an explicit canonical-DB QA record; no broad SQL cleanup or destructive database operation was used.
- Playwright E2E is intentionally single-worker because the approved local environment has one canonical persistent database and several scenarios mutate global definitions/catalog state.

## Outcome

Final local full-system QA and defect-fix pass completed on 2026-09-10 for the implemented local scope. The repository passed lint, typecheck, canonical migration/probe, 325 package tests, build, `pnpm audit --prod`, `git diff --check`, 22/22 Playwright tests with one worker, 49/49 iiko simulator tests and the repeatable local `pnpm test:payment` harness.

Customer/Admin browser walkthrough passed for implemented surfaces, with no unexpected production console errors; prototype comparison and responsive checks were exercised at `320`, `375`, `768` and `1024`. Verified local critical paths include catalog → cart → checkout, auth/session ownership, order snapshots, mock payment → webhook replay → iiko lifecycle, loyalty ledger/rewards, Wheel/Quest, Admin CRUD/read surfaces, analytics, media and communications drafts.

The plan remains `in_progress` in `active/`: real YooKassa provider payment/refund/accounting verification, real production iiko conformance, native iPhone/Android validation, TestFlight and Google Play checkpoints were not available and are not claimed as complete. M15 Push registration is implemented locally, while real Push receipt, future SMS.ru delivery, EAS/APNs/FCM receipt and Admin mass-dispatch remain separate operational gates. Custom/user segments are intentionally unavailable by owner scope.

Detailed inventory, matrix, defect log and command evidence: `docs/qa/FINAL-system-qa-report.md`.
