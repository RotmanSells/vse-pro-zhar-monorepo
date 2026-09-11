# M14 — Wheel of Fortune и Quests

Status: in_progress
Milestone: M14
Depends on: M13.4 Project closure и release-readiness verification

## Purpose

Добавить server-owned Wheel of Fortune и Quests как отдельный loyalty/gamification vertical slice, визуально повторяющий соответствующие screens prototype, но без переноса demo-only business logic и fake production data.

## Mandatory Project Rules

Эти правила обязательны:

- **🔴 MUST** — prototype `/Users/rotman/Desktop/prototypes/index.html` является visual source of truth для Wheel/Passport/Quest UI.
- **🔴 MUST** — prototype-only demo values не становятся production rewards, balances, progress или eligibility.
- **🔴 MUST** — Backend + PostgreSQL являются источником истины для quest definitions, progress, spins, prizes, rewards, eligibility и claims.
- **🔴 MUST** — Customer/Admin UI не вычисляют authoritative progress, chance, reward, balance или eligibility.
- **🔴 MUST** — сохранять lego boundaries:

  ```text
  contracts → repositories → domain services → routes → API clients/controllers → UI
  ```

- **🔴 MUST** — не добавлять прямой доступ UI к PostgreSQL, iiko, YooKassa или внешнему reward provider.
- **🔴 MUST** — все money/XP/coal values — integer units; floating-point business calculations запрещены.
- **🔴 MUST** — повторный spin, quest completion, reload, webhook/status replay и retry не создают duplicate reward или duplicate ledger effect.
- **🔴 MUST** — unknown/unavailable/failure state не становится success.
- **🔴 MUST** — использовать только canonical PostgreSQL database `vse_pro_zhar_dev`; не создавать `vse_pro_zhar_test` или другую database.
- **🔴 MUST** — новая инфраструктура не добавляется; использовать текущий modular monolith и обычный application process.
- **🔴 MUST** — Customer остаётся Expo/React Native приложением с iOS/Android targets; web используется для ежедневной проверки.
- **🔴 MUST** — responsive visual check на `320`, `375`, `768`, `1024`; touch targets минимум `44×44` px.
- **🔴 MUST** — невозможно закрыть task только tests; нужен screenshot/browser comparison с prototype.

## Current State

- M13 реализует server-owned XP/coal/rank/ledger и M13.1 Passport progress.
- Backend сейчас имеет `GET /loyalty`, `GET /loyalty/ledger`, Admin read-only ledger; Wheel/Quest routes отсутствуют.
- Current PostgreSQL schema не содержит production quest progress, spin history, prize claim или reward event boundaries для M14.
- Prototype data содержит demo prizes, wheel settings и hardcoded quest progress; эти значения нельзя автоматически переносить в production.
- Prototype mechanics обнаружены:
  - Wheel eligibility: `cart`, `customer_orders`, `always`;
  - minimum order amount;
  - cooldown and period limits;
  - max spins;
  - weighted active prizes;
  - quest definitions with goal/unit/progress/reward;
  - quest progress derived from customer/order activity.

## Mandatory Decision Gate

### Decision status

**Owner decision gate: approved.** Решения ниже подтверждены owner в текущей задаче и являются обязательным business contract для M14. Реализация не должна подменять эти правила более удобными для кода значениями или prototype demo-данными.

Все денежные значения ниже указаны в рублях для удобства чтения, но в коде и БД хранятся только в integer minor units:

```text
1 500 ₽ = 150 000 minor units
3 000 ₽ = 300 000 minor units
```

Decision gate включал следующие вопросы; утверждённые ответы зафиксированы ниже и обязательны для write-path:

### Wheel

1. Что даёт право на spin: сумма текущей корзины, подтверждённый заказ, completed order или другое событие.
2. Minimum order amount и currency.
3. Cooldown, max spins и limit period.
4. Можно ли spin anonymous Customer или нужна authenticated session.
5. Полный prize catalog: type, value, weight, visibility, active period.
6. Допустимые reward types: coal, XP, promo, physical prize, no-prize.
7. Как promo/physical prize создаётся и доставляется; без fulfillment contract reward нельзя выдавать как success.
8. Как spin idempotency и reward claim дедуплицируются.
9. Что происходит при payment cancellation/refund.

### Quests

1. Утверждённый список quests для production, а не demo fixtures.
2. Event source каждой quest: order created, payment succeeded, order completed, unique products, categories или другой server event.
3. Exact goal/unit/progress formula и timezone.
4. Active period, repeatability и reset policy.
5. Reward type/value и claim/delivery contract.
6. Поведение при cancellation/refund.
7. Разрешённые Admin actions: definitions, visibility, ordering, active period, reward fields.
8. Нужен ли отдельный immutable quest event/history и idempotency key.

Если решение не подтверждено, соответствующий write-path должен оставаться unavailable; нельзя выбирать economics по удобству реализации.

### Approved Wheel contract

1. **Eligibility.** Spin доступен только authenticated Customer после оплаченного и завершённого заказа:

   ```text
   customer authenticated
   AND payment status = succeeded
   AND order status = completed
   AND order total >= 150 000 minor units
   AND no successful spin in the rolling last 24 hours
   ```

   Browser navigation, payment redirect, созданный заказ, `payment_confirmed`, `kitchen_accepted` или любой неизвестный статус не дают права на spin.

2. **Currency and minimum amount.** Валюта — RUB. Минимальная сумма подходящего заказа — 1 500 ₽, то есть `150000` integer minor units. Сумма берётся только из сохранённого Backend order total; client-provided amount не используется.

3. **Cooldown and limits.** Cooldown — 24 часа. Максимум — 1 успешный spin за rolling period 24 часа. Один completed order может быть источником только одного logical spin. Для нового заказа, попавшего в cooldown, Backend возвращает безопасный `cooldown`/`limit_reached` error без изменения состояния.

4. **Authentication.** Anonymous Customer крутить колесо не может. Customer session проверяется на Backend, а Customer может читать и изменять только собственное состояние.

5. **Prize catalog and Admin ownership.** Начальный seed-каталог состоит из следующих призов, а Admin может создавать и редактировать до 6 prize definitions. В production остаются допустимыми только `no-prize`, `coal` и `xp`; promo/physical rewards требуют отдельного fulfillment contract:

   | Code | Type | Integer value | Weight | Customer state |
   | --- | --- | ---: | ---: | --- |
   | `no_prize` | no-prize | `0` | `50` | spin completed, reward absent |
   | `coal_10` | coal | `10` | `25` | reward ledger entry |
   | `coal_25` | coal | `25` | `15` | reward ledger entry |
   | `xp_100` | XP | `100` | `10` | reward ledger entry |

   Total active weight is `100`. Weighted selection выполняется только на Backend среди активных призов. UI не показывает и не вычисляет authoritative probability; UI отображает только подтверждённый ответ Backend.

6. **Prize lifecycle.** Начальные призы активны с момента публикации M14 и не имеют даты окончания, пока Admin явно не изменит definition. Inactive, unknown, malformed или expired prize не может быть выбран. Изменение текущей prize definition не переписывает исторические spin/prize snapshots.

7. **Unsupported reward types.** Promo codes и physical prizes в M14 не выдаются: для них пока нет подтверждённого fulfillment contract. Они не должны появляться как success, placeholder reward или fake delivery. Допустимые production reward types M14: `no-prize`, `coal`, `xp`.

8. **Cancellation/refund.** Заказы, отменённые до `completed`, spin не дают. Если возврат произошёл после завершённого заказа и spin уже подтверждён, автоматический reversal reward в M14 не выполняется. Случай остаётся в immutable history и при необходимости попадает в reconciliation/manual review; автоматическое повторное списание или повторная выдача запрещены.

9. **Idempotency and retry.** Повтор того же запроса, webhook/status replay, reload или retry возвращает ранее сохранённый logical spin и не создаёт второй spin, второй ledger entry или вторую reward claim. Дедупликация защищена одновременно server-side idempotency key, уникальным source key и database constraint/row lock; одного client-side flag недостаточно.

10. **Admin boundary.** Admin может безопасно просматривать, создавать и изменять до 6 wheel prize definitions: code, name, description, visibility, active period, weight, order, allowed reward type и integer value. Backend отклоняет седьмую definition, unsupported reward type, invalid value и отсутствие selectable active prize. Admin не может переключить Wheel на неподтверждённую eligibility-механику (`cart`, `always` или customer-order total), установить Customer balance, XP, rank, вручную создать spin или изменить immutable history. Изменения действуют prospectively и не переписывают прошлые spins/claims.

### Approved Quest contract

В первой production-версии публикуются только три квеста. Demo quests и hardcoded prototype progress не импортируются.

| Code | Goal and formula | Reward | Repeatability |
| --- | --- | --- | --- |
| `first_order` | `min(completed_paid_orders, 1)` order | `+100 XP` | once per Customer |
| `regular_guest` | `min(completed_paid_orders, 3)` orders | `+30 coal` | once per Customer |
| `warming_up` | `min(sum(completed_paid_order.total), 300000)` minor units | `+150 XP` | once per Customer |

1. **Authoritative event.** Progress начисляется только по событию, для которого Backend подтвердил одновременно `payment.status = succeeded` и `order.status = completed`. Один order учитывается максимум один раз. Текущие цены каталога, cart state и данные клиента не используются для пересчёта истории.

2. **Launch boundary.** Retroactive backfill исторических заказов не выполняется автоматически. В первой версии учитываются только подходящие события после публикации и активации соответствующего quest definition. Любой будущий backfill должен быть отдельным owner-approved task с отдельным audit/idempotency contract.

3. **Period and timezone.** Квесты постоянные, без даты окончания и без периодического reset. Расчёты и отображаемые даты используют `Europe/Moscow`. Если definition inactive, новый progress/reward не создаётся.

4. **Reward claim.** При достижении goal Backend один раз создаёт persisted reward claim и применяет XP/coal через существующий loyalty service и append-only ledger. Route и UI не меняют balance напрямую. До подтверждённого результата Customer видит `pending`, `unavailable` или `reconciliation`, но не success.

5. **Cancellation/refund.** Отменённый или возвращённый до completion order не даёт progress. После completion автоматический reversal прогресса или уже выданной награды не выполняется; история остаётся неизменной, а спорные случаи доступны для reconciliation.

6. **Admin boundary.** Admin может менять название, описание, goal, unit, reward type/value, active period, visibility и sort order definition. Admin не может менять progress Customer, вручную устанавливать XP/coal/rank, выдавать reward в обход claim или удалять event/claim history.

7. **Quest idempotency.** Повторная доставка одного order event, повторная обработка processor, reload и retry создают одну progress projection и одну reward claim. Нужны unique source/event keys, immutable quest event/history records и безопасный known-result response.

### Non-negotiable execution discipline

M14 относится к деньгам, loyalty balance, заказам и персональным данным. Реализация выполняется поэтапно и считается незавершённой при наличии хотя бы одного необъяснённого failing test, неизвестного состояния или визуального расхождения.

- Перед каждым изменением проверять границы `contracts → repositories → domain services → routes → API clients/controllers → UI`; UI не получает доступ к PostgreSQL, iiko, YooKassa или provider.
- Сначала добавлять и запускать contract/domain/repository tests для нового правила, затем implementation; для критических transitions обязательны positive и fail-closed cases.
- Любое изменение schema выполнять только через versioned migration в canonical `vse_pro_zhar_dev`; запрещено использовать `vse_pro_zhar_test` или создавать вторую БД.
- Не добавлять demo fixtures в production runtime. Если definitions отсутствуют, Customer/Admin показывают явный `empty`, `unavailable` или `not configured` state.
- Денежные, XP и coal значения всегда integer; нельзя использовать floating point, client totals, client reward values или optimistic local balance.
- Все side effects делать transactionally и idempotently: повторный request, retry, concurrent request, restart processor и replay provider/order event должны давать один logical result.
- Не скрывать ошибки через `catch` без безопасного состояния, не считать HTTP 2xx/redirect доказательством reward, payment или fulfillment success.
- Не ослаблять существующие M13/M12/M8/M9–M11 правила ради прохождения M14 tests. При regression сначала остановить реализацию и локализовать причину.
- После каждого законченного слоя запускать узкий набор тестов, затем полный repository verification. Нельзя пропускать failing check, заменять его ручным утверждением или завершать задачу только потому, что UI открывается.
- До закрытия задачи выполнить browser comparison с prototype на `320`, `375`, `768`, `1024`, проверить отсутствие horizontal overflow, доступность, labels, keyboard/focus behavior и touch targets минимум `44×44`.
- Native Customer targets iOS и Android не считать автоматически совместимыми по результату web-проверки: пройти обязательные checkpoints и не дублировать business logic платформенно.
- В конце заново проверить `git diff --check`, список изменённых файлов и соответствие фактического результата этому plan. Не переносить plan в `completed/`, пока все acceptance criteria и verification не подтверждены.

## Scope

### Contracts

- Wheel settings, spin request/response, prize definition, spin history, safe errors.
- Quest definition, customer progress, quest event/history, reward/claim state.
- Strict schemas with bounded integer fields and no provider payloads/secrets.

### Database/repositories

- Versioned migration only in `vse_pro_zhar_dev`.
- Backend-owned quest definitions and progress storage.
- Immutable spin/event/claim records where required for idempotency and audit.
- Constraints for valid status, integer reward values, active periods, weights, non-negative balances and unique source/event keys.
- Repository methods own SQL, row locks and unique/idempotent claims.

### Domain services/processors

- Wheel eligibility, weighted selection, cooldown/limit checks and idempotent spin claim.
- Quest progress projection from authoritative server events.
- Reward application through existing loyalty service/ledger boundaries; no direct balance update from routes/UI.
- Durable retry/reconciliation for any external fulfillment; no new queue/worker service without owner decision.

### API/routes

- Authenticated Customer read routes for active wheel/quest state.
- Idempotent Customer spin/claim routes only after decision gate.
- Protected Admin read/mutation routes for approved definitions/settings.
- Safe error mapping for unavailable, cooldown, limit, insufficient eligibility, duplicate and reconciliation states.

### Clients/controllers/UI

- Shared API clients with runtime validation and lifecycle controllers.
- Customer Wheel screen matching prototype visual language.
- Customer Passport/Quest section matching prototype cards/progress states.
- Admin Wheel/Quest management only for approved production definitions.
- Loading, empty, disabled, unavailable, error, earned/claimed and reconciliation states.

## Out of Scope

- Delivery or courier workflows.
- New payment provider or iiko business boundary.
- Fake production rewards or demo-only balances.
- Marketing campaigns, referrals, birthday multipliers unless explicitly approved in decision gate.
- New infrastructure, queues, Redis/Kafka/RabbitMQ or second database.
- Direct Admin balance/XP/rank setter.

## Tests

- Contract parsing and rejection of client-controlled reward/balance/progress values.
- Wheel weighted selection, deterministic test seed/double, eligibility, cooldown, max spins and period limits.
- Concurrent/repeated spin requests produce one logical spin/reward.
- Quest progress boundary and event idempotency tests.
- Cancellation/refund/completed-order event rules.
- Ledger and aggregate reconciliation after rewards.
- API auth/origin/error/idempotency tests.
- Customer/Admin component tests for all state variants.
- Browser E2E with canonical `vse_pro_zhar_dev` and local simulator where applicable.
- Responsive checks at 320/375/768/1024 with no overflow.
- Native checkpoints for iPhone and Android before release claim.

Обязательные детали verification, которые нельзя заменять общим smoke-test:

- **Contracts:** reject floats, negative values, unsupported reward types, invalid weights/periods, unknown statuses и любые client-provided XP/coal/progress/balance/eligibility claims.
- **Wheel domain:** проверить все order/payment states, exact `150000` boundary, below/equal/above minimum, inactive/expired/malformed definitions, zero active weight, deterministic weighted selection, rolling `86400` boundary, duplicate source order, duplicate idempotency key и safe unavailable/error states.
- **Wheel concurrency:** одновременно отправить несколько spin requests для одного Customer/order и убедиться, что создан ровно один spin, один snapshot и максимум одна ledger/reward effect; повторный known-result не меняет aggregate повторно.
- **Quest domain:** проверить прогресс `0/1`, `0/3`, `299999/300000`, ровно `300000`, несколько orders, повтор одного order event, processor restart/retry, inactive definition, pre-activation events, cancellation/refund и Europe/Moscow boundary.
- **Ledger reconciliation:** после каждого coal/XP reward aggregate равен append-only ledger projection; duplicate source/event не создаёт второй delta; неполный или противоречивый aggregate возвращает reconciliation/unavailable, а не success.
- **API security:** anonymous/foreign Customer/Admin, origin/session checks, idempotency replay/conflict, malformed payloads, unsupported state transitions и отсутствие секретов/raw provider payloads в errors.
- **UI states:** loading, empty, disabled, unavailable, error, cooldown, insufficient eligibility, spinning, earned, claimed, pending и reconciliation. Никаких optimistic reward/balance updates до подтверждённого Backend response.
- **Regression:** все существующие M13 loyalty, orders, payment, cancellation/refund, iiko, catalog, auth и existing Customer/Admin tests должны пройти без изменения их business meaning.
- **Browser/native:** screenshot comparison Customer и Admin с prototype на `320`, `375`, `768`, `1024`; browser E2E на canonical DB; проверка no overflow, accessibility labels, focus/keyboard и touch targets; затем native checkpoint на реальном iPhone и Android устройстве согласно plan.

## Acceptance Criteria

- Owner decision gate is fully recorded before write-path implementation.
- Wheel and Quests state is calculated/persisted only by Backend + PostgreSQL.
- Spin and quest rewards are idempotent under retry/concurrency/reload.
- XP/coal/rank/balance cannot be overridden by Customer/Admin client input.
- No fake production reward or delivery success is exposed.
- Prototype visual composition is matched for all implemented states.
- Existing M13 loyalty ledger remains consistent.
- Canonical database, automated checks, browser checks and applicable native checkpoints pass.

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

## Progress

- [x] Изучить roadmap, текущие lego boundaries и prototype mechanics.
- [x] Зафиксировать mandatory decision gates и project rules.
- [x] Получить owner decisions по Wheel economics и Quest definitions.
- [x] Реализовать contracts и versioned schema migration.
- [x] Реализовать repositories.
- [x] Реализовать domain services/processors и idempotency.
- [x] Реализовать API clients/controllers/routes.
- [x] Перенести Customer/Admin UI по prototype.
- [x] Перенести ownership prize definitions в Admin и ограничить каталог шестью валидными definitions.
- [x] Исправить и покрыть regression-тестами сохранение Wheel prize `type/value`, version lock, idempotency и append-only update history.
- [x] Выполнить automated и browser verification; native device checkpoint ожидает доступные устройства.
- [x] Обновить Outcome и зафиксировать результаты полного QA-прогона.
- [ ] Перенести plan в `completed/` только после native/provider release checkpoints.

## Discoveries

- Prototype Wheel demo использует weighted prizes и settings `eligibility`, minimum amount, cooldown, max spins и period limits.
- Prototype Quests содержит hardcoded progress fixtures, поэтому их нельзя считать production economics.
- Current repository имеет M13 server-owned loyalty ledger, который должен стать единственным reward balance boundary для M14.
- В `docs/PRODUCT.md` M14-specific Wheel/Quests/rewards остаются prototype/roadmap functionality; после подтверждения owner они становятся approved scope только для этого M14 plan, без импорта demo fixtures.
- Owner подтвердил production baseline: authenticated Customer, completed paid order, RUB minimum `150000` minor units, one spin per rolling 24 hours, four weighted prize outcomes, три one-time quests и только XP/coal rewards.
- Owner уточнил ownership: prize definitions настраиваются Admin; Backend валидирует и хранит максимум 6 разрешённых definitions, Customer только отображает подтверждённый активный каталог.
- Browser verification на canonical DB подтвердил Customer Wheel no-demo state, Admin Wheel/Quest management, no horizontal overflow и touch-target checks на `320`, `375`, `768`, `1024`.
- Полный QA-прогон 2026-09-06 подтвердил 11/11 browser E2E на canonical DB с одним worker-ом, Customer/Admin screenshots на `320`, `375`, `768`, `1024`, отсутствие console errors в manual browser session и безопасные anonymous 401 на Wheel/Quest/Admin endpoints.
- Первоначальный Admin E2E assertion ожидал устаревший англоязычный текст `approved eligibility`; assertion исправлен на фактический server-owned UI и проверяет лимит `1 spin / 24 часа` и minimum `1 500 ₽`, не ослабляя security/business invariant.
- Локальный `.env` пользователя задаёт API на `3001`; root launcher `scripts/dev.mjs` теперь передаёт этот порт в `EXPO_PUBLIC_API_URL`, `VITE_API_URL` и Vite proxy, поэтому обычный `pnpm dev` поднимает рабочую согласованную пару без изменения пользовательского `.env`.
- Для добавления исторического Wheel prize description после уже применённой migration использована отдельная sequential migration `0013_m14_spin_description`; повторная доставка same spin/order и quest processor replay проверены PostgreSQL integration test.
- Admin ранее мог менять только weight/visibility у seed-призов; для owner-approved каталога добавлены create/update boundaries, generic allowed `coal`/`xp` definitions и server-side limit 6.
- QA found that the first prize update implementation validated but did not persist `type`/`value` and had no version/idempotency boundary. Migration `0020_m14_4_wheel_prize_history.sql`, expected-version locking, append-only update snapshots and idempotency conflict handling now cover the full update path; the regression test changes `no_prize` to `xp` and restores it.

## Decision Log

- M14 создаётся отдельным plan и не расширяет M13 скрытыми reward mutations.
- Prototype visual structure переносится, но demo data не переносится без owner-approved production definitions.
- Wheel/Quest rewards проходят через existing Backend loyalty ledger/idempotency boundaries.
- Initial Wheel seed catalog: `no_prize` weight 50, `coal_10` weight 25, `coal_25` weight 15, `xp_100` weight 10. Admin-managed catalog capacity is six definitions; promo/physical rewards запрещены до отдельного fulfillment contract.
- Approved Wheel eligibility: authenticated Customer, succeeded payment, completed order, order total не ниже `150000` minor units, максимум один successful spin за rolling 24 hours; cancellation/refund не делает автоматический reversal.
- Approved Quest definitions: `first_order` → 100 XP, `regular_guest` → 30 coal after 3 completed paid orders, `warming_up` → 150 XP after 300000 accumulated minor units; each once per Customer, permanent, Europe/Moscow, no automatic historical backfill.
- Обязательное инженерное решение: сначала contracts/domain/repository tests и migration checks, затем implementation; любое unknown/retry/concurrency/failure состояние должно оставаться safe и не превращаться в success.
- Quest processing дополнительно ограничен immutable `definition.created_at`, поэтому изменение будущего active period не запускает автоматический retroactive backfill.
- QA assertion updates are limited to matching the implemented Russian Admin copy and server-owned limits; no business rule or security assertion was weakened.
- QA сохраняет fail-closed interpretation: при ошибке frontend/API alignment показывается unavailable state; launcher устраняет только конфигурационную рассинхронизацию и не добавляет fake catalog data или изменения canonical database.
- Root dev launcher reads the existing `.env` once and derives only public API URLs; explicit shell/frontend overrides remain authoritative.

## Outcome

Owner decision gate закрыт. Реализованы M14 contracts, PostgreSQL schema/migrations, transactional Wheel/Quest repository, server processor, authenticated API, shared clients/controllers, Customer prototype-aligned screens и Admin definitions/settings surface. В QA-прогоне 2026-09-09 дополнительно исправлен и доказан полный Wheel prize update path: type/value сохраняются, версия блокируется, update snapshot записывается, повтор idempotency key не создаёт второй side effect, stale version отклоняется; contract/API/DB regression tests и Admin E2E проходят. Полный локальный QA: 312 package tests, 21/21 browser E2E, 49/49 iiko simulator tests, lint, typecheck, migration/probe, build, audit и diff check. Native iPhone/Android, TestFlight и Google Play internal/closed checkpoint не выполнены в текущем окружении, так как подключённых устройств нет. Production provider-confirmed payment/iiko completed lifecycle также не запускался. Plan остаётся active до прохождения обязательных release checkpoints.
