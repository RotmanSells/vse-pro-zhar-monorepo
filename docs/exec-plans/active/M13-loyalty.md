# M13 — Loyalty: угольки, XP и rank

Status: blocked
Milestone: M13
Depends on: M7 Orders, M8 Card Payment, M9–M10 iiko Fulfillment, M11 Admin Orders, M12 local cancellation/refund boundary

> M12 остаётся активным execution plan по прямому решению owner: его manual YooKassa test-payment gate будет закрыт отдельно. M13 может разрабатываться поверх уже реализованных локальных order/payment/refund boundaries, но не должен ослаблять их и не должен объявлять production readiness для возвратов.

## Purpose

Добавить server-owned loyalty vertical slice для Customer и Admin:

- Customer видит подтверждённые угольки, XP, текущий rank и историю начислений/списаний;
- XP/rank и spendable угольки имеют явно разделённую модель и историю;
- начисление появляется только после завершённого оплаченного заказа;
- повторный webhook, повторный iiko status, retry processor’а или reload не создают второе начисление;
- использование угольков, если оно входит в утверждённую экономику M13, выполняется через Backend с блокировкой баланса и идемпотентностью;
- Admin управляет только разрешёнными loyalty definitions и видит безопасную историю, но не меняет баланс прямым присваиванием;
- Customer/Admin UI никогда не являются источником истины для баланса, XP, rank, reward cost или eligibility.

## Current State

Проверенное состояние перед задачей:

- Backend — modular monolith; используется одна canonical PostgreSQL database `vse_pro_zhar_dev`.
- Customer authentication и Customer-owned orders уже существуют.
- Payment fact подтверждается server-side YooKassa webhook + provider GET; `payment.status = succeeded` не равен завершённому заказу.
- iiko processor сохраняет monotonic order history и переводит заказ в `completed` только после подтверждённого iiko status.
- M12 хранит cancellation/refund отдельно и не начисляет loyalty reward.
- В schema нет loyalty tables, в contracts нет XP/coal/rank/reward contracts, Customer/Admin loyalty routes и UI отсутствуют.
- Точные ставки начисления, thresholds rank, сроки действия, reward catalog и правила redemption ещё не утверждены в repository.

## Mandatory decision gate

До реализации loyalty write-path owner должен подтвердить в этом plan:

1. Что именно означает `уголёк`: только spendable balance или отдельная единица рядом с XP.
2. Разделяются ли XP и угольки; какие целые единицы и максимальные значения допустимы.
3. Формула начисления XP и угольков: от суммы заказа, позиций, фиксированного события или другой величины.
4. Триггер начисления: только `completed` + payment `succeeded` или другое подтверждённое событие.
5. Таблица rank, названия, пороги XP и benefits каждого rank.
6. Срок действия угольков и XP, правила обнуления/сгорания и часовой пояс расчёта.
7. Разрешены ли отрицательные correction entries; кто, по какой причине и с каким audit может их создавать.
8. Какие rewards доступны, их cost в угольках, active/inactive, лимиты, срок действия и нужны ли остатки/availability.
9. Разрешено ли Customer списывать угольки в M13; если да — нужен ли reward redemption intent, подтверждение выдачи и отмена redemption.
10. Как loyalty ведёт себя при cancellation/refund: conservative baseline не начисляет до `completed` и не делает автоматический bonus reversal в M13.
11. Какие Admin actions разрешены: reward definitions, read-only customer history или ledger correction; прямое редактирование aggregate balance запрещается.
12. Нужны ли персональные, birthday, promo, campaign или manual multiplier rules; по умолчанию они не входят в M13.

Если решение не подтверждено, соответствующая mutation возвращает безопасное `operation unavailable`; нельзя выбирать экономику по удобству реализации.

### Conservative baseline до отдельного owner decision

- XP и угольки — разные целочисленные поля и разные ledger deltas.
- Earn event создаётся только когда order имеет status `completed`, payment имеет `status = succeeded` и `providerStatus = succeeded`.
- `pending_payment`, `payment_confirmed`, `kitchen_accepted`, `preparing`, `ready_for_pickup`, `fulfillment_problem`, `canceled` и refund states не дают earn.
- Один order даёт максимум один earn event каждого утверждённого типа; source key уникален на уровне БД.
- Никаких floating-point, client-provided amount, client-provided XP/coal/rank/cost или пересчёта по текущей цене каталога.
- Aggregate balance обновляется только в той же PostgreSQL transaction, что и immutable ledger entry; history не переписывается.
- Без подтверждённого reward catalog redemption disabled; Customer видит явно unavailable state.
- Если redemption будет подтверждён, Backend сам читает текущую reward definition и стоимость, блокирует loyalty account, проверяет balance и создаёт один debit/redemption intent; отрицательный balance запрещён constraint’ом.
- Cancellation/refund не восстанавливает и не списывает loyalty автоматически; M12 deliberately creates no reward before completion, а bonus reversal остаётся отдельной policy/task.
- Admin corrections, если они будут разрешены, только append-only compensation entry с safe reason, actor и audit; `UPDATE balance = ...` из UI запрещается.

## Scope

### Customer

- Authenticated `GET /loyalty` с текущим XP, rank, spendable coal balance, version/updated timestamp и безопасными benefits.
- Authenticated `GET /loyalty/ledger` с bounded pagination/filtering; только собственные entries.
- Отображение состояния `loading`, `empty`, `unavailable`, `error`, `earned`, `spent` и `reconciliation/unavailable` без optimistic balance.
- Reward catalog и redemption UI только после утверждения decision gate; до этого Customer не видит фиктивных rewards и fake costs.
- Повторный клик, reload и повторный запрос не дублируют redemption.

### Admin

- Защищённый Admin loyalty surface с безопасными aggregate/history данными.
- Управление reward definitions только через versioned Backend mutations, если это одобрено: название, description, cost в целых coal units, visibility, active period и sort order.
- Explicit confirmation для publish/deactivate/reward change.
- Просмотр source order, ledger type, delta, reason, actor и timestamps без password, session token, payment instrument, raw provider payload или лишних персональных данных.
- Никакой ручной кнопки `set balance`, `set XP`, `set rank` или изменения прошлого ledger entry.

### Backend and PostgreSQL

- Shared contracts для loyalty summary, ledger entry, rank, reward definition, redemption и safe errors.
- Versioned migration только в текущей PostgreSQL database.
- `loyalty_accounts`: one account per customer, integer XP/coal aggregates, rank snapshot/version and timestamps.
- `loyalty_ledger`: append-only deltas for XP/coal, source type/id, idempotency key, safe reason, actor and balance snapshots where needed; unique source/event key prevents duplicate earn/debit.
- `loyalty_rank_history`: significant rank transitions with old/new rank, XP snapshot and created timestamp.
- `loyalty_rewards`: Backend-owned reward definitions and safe availability fields; no fake production rewards.
- `loyalty_redemptions`: one idempotent redemption intent per request, persisted reward/cost snapshot, status and timestamps; no redemption on insufficient balance.
- Constraints: one account/customer, non-negative aggregate coal, valid integer deltas, valid rank/reward/redemption statuses, positive reward cost where applicable, bounded strings, foreign keys and source uniqueness.
- Completion earn is recovered through a small in-process `LoyaltyProcessor` using PostgreSQL and the existing application process; no Redis, queue, worker service or second database.
- Processor rechecks order/payment status under deterministic row locks before creating a ledger entry and survives process restart through durable source uniqueness.
- All critical updates use transaction/row-lock; provider/order data is revalidated at the business boundary.

## Out of Scope

- Quests, wheel, push/SMS, promo campaigns, birthday multipliers, referrals, reviews, cash and delivery.
- Automatic bonus reversal/compensation for M12 cancellation or refund.
- Partial refund interaction with loyalty.
- Exchange of coal for money, transfer between Customers, gifting or external loyalty provider.
- Direct Admin balance/rank editing, arbitrary SQL correction and deletion of ledger history.
- Multiple restaurants, per-location wallets and multi-currency loyalty.
- Reward issuance outside the approved M13 redemption contract.
- New infrastructure, separate worker service, event bus or second PostgreSQL database.

## Architecture / Constraints

### Sources of truth

- Backend + PostgreSQL are authoritative for loyalty account, ledger, rank, reward definitions and redemption state.
- Completed order and succeeded payment are authoritative inputs to earn eligibility; current catalog price is not used to reconstruct history.
- Customer/Admin local state is only the last confirmed representation.
- iiko status does not itself grant loyalty until the Backend verifies both order completion and succeeded payment.

### Money and integer units

- Money remains integer minor units and is never converted through floating point.
- Loyalty units are also integer values; no decimal XP/coal and no client-supplied conversion rate.
- If reward cost is based on a monetary rule, Backend resolves and snapshots it before debit; UI value is never authoritative.

### Idempotency and concurrency

- Earn idempotency is derived from server-owned source identity `(order_id, earn_rule_version)` and protected by a database unique constraint.
- Redemption uses one stable server-side idempotency key for the local intent and the same key on retry; client input cannot choose amount or balance.
- Concurrent earn processor runs and concurrent redemption requests produce one logical ledger effect.
- Unknown/unavailable state never becomes a successful earn, debit or reward delivery.
- Historical ledger entries and rank history are immutable; corrections append a new safe entry.

### JavaScript/TypeScript lego boundaries

- Contracts own schemas/types; repositories own SQL and locks; loyalty service owns eligibility/formula/state transitions; processor owns durable continuation; routes own auth/parse/error mapping; clients/controllers own transport/lifecycle; UI owns presentation only.
- No `any`, `@ts-ignore`, hidden global mutable balance, direct DB from route, direct provider/API calls from UI or new dependency without a measured need.
- No copy of rank/eligibility state machine in Customer, Admin, route and processor.

## Implementation Requirements

### 1. Contracts

Add strict Zod schemas only after decision gate:

- `LoyaltySummary`, `LoyaltyLedgerEntry`, `RankSummary`, `RewardDefinition`, `RedemptionSummary`;
- Customer read/redemption requests with no client authority over XP, coal, rank, balance or cost;
- Admin reward definition requests with safe bounds and explicit fields;
- safe errors for unavailable, insufficient balance, redemption pending, duplicate/idempotency conflict and invalid transition;
- no provider payload, credentials, password/session values or raw database internals.

### 2. Database and repositories

- Add migration and schema with FK/unique/check/index constraints.
- Implement repository methods for account read, bounded ledger read, complete-order earn claim, rank transition, reward definitions and redemption claim/confirmation.
- Keep source order snapshot and reward cost snapshot; later catalog/reward changes must not rewrite history.
- Lock account before debit and use deterministic order for order/payment/account/ledger rows.
- Reconcile aggregate against append-only ledger in tests and provide a safe unavailable result on invariant mismatch.

### 3. Earn boundary and processor

- Trigger earn only after confirmed `completed` order and succeeded payment.
- Never grant loyalty from browser navigation, payment redirect, payment create response, `payment_confirmed`, iiko `submitted` or an unconfirmed kitchen state.
- Processor claims eligible completed orders through ordinary application process, revalidates state, inserts one idempotent ledger event and updates account/rank atomically.
- On restart or duplicate completion, source uniqueness returns the existing result without a second earn.
- Graceful shutdown stops the processor cleanly.

### 4. Redemption boundary, if approved

- Backend reads reward definition and authoritative account under lock.
- Validate active period, customer eligibility, exact integer cost and available balance immediately before debit.
- Persist redemption intent and coal debit atomically before any later reward fulfillment side effect.
- A pending/unknown fulfillment result remains visible as pending/reconciliation; it never restores balance or creates a second debit automatically.
- If the reward has no real delivery contract in M13, expose only a persisted redemption/unavailable state and do not pretend that a coupon or physical benefit was delivered.

### 5. API routes

Add only approved routes:

- Customer: `GET /loyalty`;
- Customer: `GET /loyalty/ledger`;
- Customer: `POST /loyalty/redemptions` only if reward redemption is approved;
- Admin: safe loyalty/reward read and definition mutations only if approved;
- all Customer/Admin mutations use existing auth/origin boundaries, strict input parsing, safe errors and idempotency where side effects exist.

### 6. Clients, controllers and UI

- Extend shared `@vse-pro-zhar/api-client` with transport/runtime validation and lifecycle controllers; Customer env/native adapters remain thin.
- Customer UI shows only confirmed summary/history, disables duplicate redemption and clearly distinguishes earned, spent, pending and unavailable states.
- Admin UI shows exact integer units, source/reason/actor/timestamps and explicit disabled states for unsupported manual adjustments.
- No direct PostgreSQL, iiko, YooKassa or reward provider access from frontend.

## Tests

### Contract and unit tests

- strict summary/ledger/rank/reward/redemption validation;
- client cannot override XP, coal, rank, balance, reward cost, order ID or status;
- rank threshold boundaries, integer overflow/negative values and unknown definition fail closed;
- only approved order/payment states can earn;
- reward active-period/eligibility and insufficient-balance rules;
- safe errors never contain secrets, PII beyond the approved view or raw provider data.

### Database and concurrency tests

- migration creates all loyalty tables and constraints on canonical schema;
- one loyalty account per Customer;
- duplicate completed-order processing creates one earn ledger entry and one rank transition;
- cancellation before completion and refund/pending/failed fulfillment create no earn;
- processor restart/lease recovery does not duplicate earn;
- concurrent earn claims serialize to one result;
- concurrent redemptions cannot overspend balance;
- aggregate balance equals ledger projection after earn/debit/correction scenarios;
- ledger/rank history is append-only and source/reward snapshots remain stable after current definition changes.

### API/browser tests

- anonymous Customer/Admin receives 401;
- Customer sees only own loyalty account and ledger;
- Admin mutations require staff session and explicit safe payload;
- duplicate click/reload returns known idempotent result;
- UI does not show optimistic XP/coal/rank or successful reward delivery before persisted confirmation;
- browser never calls PostgreSQL, iiko, YooKassa or an external reward provider directly.

### Manual test

Only after the decision gate and with a dedicated test order on canonical `vse_pro_zhar_dev`:

1. create and server-confirm a small test payment;
2. complete the order through the approved iiko test/simulator lifecycle;
3. verify exactly one XP/coal earn and the expected rank transition;
4. reload Customer and verify the same persisted state;
5. replay the completion/payment events and verify no duplicate ledger row;
6. if redemption is approved, redeem one test reward and verify exact debit/idempotency;
7. separately check cancellation before completion produces no loyalty earn;
8. verify Admin sees safe history and cannot directly set balance/rank.

No production credentials, production order, real reward fulfillment or real money refund is used for this manual check.

## Acceptance Criteria

- Loyalty state is calculated and persisted only by Backend + PostgreSQL.
- Earn occurs only for provider-confirmed payment plus Backend/iiko-confirmed completed order.
- A single order/rule version cannot create two earn events, even under webhook replay, duplicate status or process restart.
- XP, coal, rank and reward cost are integer and cannot be overridden by client input.
- Customer can read only its own safe loyalty state/history.
- Aggregate balance and immutable ledger remain consistent under concurrent requests.
- Approved redemption, if included, cannot overspend, duplicate debit or claim success from an unknown external result.
- Cancellation/refund cannot silently grant or reverse loyalty; unsupported policy remains visibly unavailable.
- Admin has only the approved one-level access and no direct balance/rank setter.
- Secrets, raw provider payloads, payment instrument data and unrelated Customer data never reach UI, logs or audit.
- Canonical PostgreSQL migration, automated tests, build and applicable browser checks pass.
- Documentation states the actual loyalty economics and does not claim production rewards before approved manual verification.

## Verification

Commands must use only the canonical database:

```bash
pnpm lint
pnpm typecheck
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm test
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm e2e -- --workers=1
pnpm build
pnpm audit --prod
git diff --check
```

Before manual loyalty/reward verification, confirm:

- decision gate is recorded with exact formula, rank thresholds and reward policy;
- test order/payment belongs to the dedicated test account and canonical database;
- no production credentials or production environment variables are loaded;
- cleanup targets only the dedicated test Customer/order/reward rows;
- any external reward delivery is test-only and has a known idempotent contract.

## Progress

- [x] Проверить product/roadmap/architecture и отсутствие существующей loyalty persistence.
- [x] Зафиксировать owner decision по XP/уголькам/rank/reward economics и M12 interaction.
- [x] Добавить contracts и versioned PostgreSQL migration.
- [x] Реализовать repositories, immutable ledger и transaction-safe account/rank transitions.
- [x] Реализовать completed-order earn boundary и durable in-process processor.
- [x] Зафиксировать redemption как явно недоступный в M13: rewards не seed-ятся, debit и delivery routes не включены.
- [x] Добавить Customer/Admin routes, clients, controllers и UI.
- [x] Выполнить presentation-only visual transfer существующих Customer/Admin surface из prototype и responsive smoke-check на 320/375/768/1024 без изменения API/backend/database.
- [x] Добавить unit, concurrency, restart, API и browser tests.
- [ ] Выполнить только test-mode manual loyalty verification — dedicated confirmed payment + iiko completed lifecycle не запускались; automated tests не подменяют этот external gate.
- [x] Обновить документацию; manual YooKassa/iiko test gate остаётся отдельным operational checkpoint.
- [ ] Перенести plan в `docs/exec-plans/completed/` только после полного acceptance; текущий внешний payment/iiko gate блокирует closure.

## Discoveries

- Product document names угольки, XP/rank and rewards, but does not define the loyalty economics or redemption contract.
- Prototype customer/admin surfaces include roulette, quests, profile, analytics and other demo-only screens that are not present in the current product; the visual transfer keeps them out of the production UI.
- Customer is already an Expo/React Native app with web export, so the customer visual shell can match the prototype while remaining native-target compatible.
- Current repository has no loyalty tables, contracts, routes, clients or UI.
- Current order lifecycle provides a safe conservative trigger: `completed` is confirmed only by iiko status, while payment success remains a separate persisted fact.
- M12 explicitly leaves bonus reversal/compensation out of scope, so M13 must not invent refund-to-loyalty behavior.
- M13 can use an ordinary PostgreSQL-backed in-process processor at the expected scale; no new queue or separate database is justified.
- Local browser E2E uses the existing `apps/customer/.env.local` API host; the verification command was aligned to that local port without modifying env files.

## Decision Log

- M13 is planned as a separate active execution plan by explicit owner request while M12 remains active; M12 manual refund closure is deferred and not silently marked complete.
- Owner-approved economics are fixed in the decision section: `floor(totalMinor / 100)` XP and `floor(totalMinor / 10_000)` coal with the four listed rank thresholds.
- Conservative baseline earns only after `completed` + provider-confirmed `succeeded` payment and keeps XP/coal separate.
- Ledger is append-only; aggregate changes are transactionally derived from ledger effects, and direct Admin balance setters are forbidden.
- Reward redemption remains unavailable unless a real reward definition and fulfillment/idempotency contract are approved.
- The implementation uses one PostgreSQL and the existing API process; Redis, Kafka, RabbitMQ, a worker service and a second database are explicitly excluded.
- Visual transfer (2026-09-05) is presentation-only: keep the existing Customer/Admin feature set and API contracts, center the Customer phone shell on tablet/desktop widths, and use a drawer/sidebar transformation for Admin.
- Customer navigation (2026-09-05) uses a persistent native bottom tabbar for the four existing surfaces only: menu, orders, loyalty and cart; checkout remains a focused flow and prototype-only tabs stay out of the UI.
- M13.4 automated/manual audit (2026-09-06) confirmed canonical migration/probe, full unit/integration suite, browser suite and responsive Customer/Admin checks. No dedicated provider-confirmed payment plus iiko-completed order was executed, so external earn lifecycle evidence is still unavailable.

### Owner decision (2026-09-04)

Owner approved the following M13 economics and boundaries:

- `угольки` and XP are separate integer units. XP is a rank progression value; coal is the spendable balance model, although redemption is not enabled in M13.
- Earn is created only after the Backend has both `order.status = completed` and a persisted payment with `status = succeeded` and `providerStatus = succeeded`.
- XP formula: `floor(order.totalMinor / 100)`, i.e. 1 XP for each full ruble of the server-owned completed order total. Kopecks do not produce a fractional XP.
- Coal formula: `floor(order.totalMinor / 10_000)`, i.e. 1 coal for each full 100 rubles of the server-owned completed order total.
- Rank thresholds are fixed for M13: `spark` / «Искра» from 0 XP, `heat` / «Жар» from 1,000 XP, `flame` / «Пламя» from 5,000 XP, and `volcano` / «Вулкан» from 15,000 XP. M13 adds no extra rank benefits; benefits are an empty safe list until a separate decision defines them.
- XP and coal do not expire in M13. Cancellation and refund do not create automatic loyalty reversal or compensation; an order earns nothing until it reaches the confirmed completed state.
- Admin has read-only loyalty access. Direct balance, XP or rank setters and manual correction entries are not enabled in M13.
- Reward catalog and Customer redemption are not enabled in M13. No production rewards, fake costs or reward-delivery success may be exposed.
- No campaigns, multipliers, birthday rules, referrals or other additional earn rules are included.

## Outcome

Owner decision is recorded above. Contracts, migration, PostgreSQL repositories, ledger/rank transitions, completed-paid earn processor, Customer/Admin routes and UI, automated tests, full browser suite and responsive checks are implemented on canonical `vse_pro_zhar_dev`. В QA-прогоне 2026-09-06 прошли lint, typecheck, migration/probe, 225 unit/integration tests, 11 browser E2E, build, audit и diff check; Admin loyalty surface подтвердил read-only boundary без кнопок прямого изменения balance/XP/rank, а Customer показал подтверждённые empty states. Rewards/redemption remain explicitly unavailable. M13 manual external payment/iiko lifecycle verification is not claimed because a dedicated confirmed test payment and write-capable iiko lifecycle were not run; plan has status `blocked` and remains in `active/`.
