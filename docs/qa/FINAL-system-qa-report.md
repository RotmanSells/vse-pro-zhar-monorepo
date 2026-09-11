# FINAL — System QA report

Дата прогона: 2026-09-10
Среда: local development, canonical PostgreSQL `vse_pro_zhar_dev`
Статус: локальный implemented scope подтверждён; production release gates остаются открытыми.

## 1. Что проверялось

### Customer

- запуск, каталог, категории, видимость товара и fallback изображения;
- идентификация Customer, reload, logout, истёкшая/отсутствующая сессия;
- phone-only auth на Web/iOS/Android и Expo Push device registration contract;
- корзина, количество, удаление, повторный quote и серверная цена;
- pickup options, stale slot, iiko availability и fail-closed checkout;
- внутренний order, собственные заказы, snapshots и статусы;
- payment return/pending/refresh boundary;
- loyalty summary, XP, угольки, rank, ledger, rewards/redemption states;
- Wheel и Quest server-owned states;
- Profile, navigation, responsive layout, focus/Escape и touch targets.

### Admin

- staff login/session/logout и защита от Customer/anonymous доступа;
- Dashboard/analytics, Orders/detail/recovery, Catalog/media;
- Promos, Loyalty/rewards, Quests, Wheel settings/prizes;
- Customers, built-in Segments и Communications drafts/preview;
- server-backed loading/error/empty/unavailable states, modal focus и responsive layout.

### Backend/provider boundaries

- все реализованные HTTP routes и strict contracts;
- PostgreSQL migrations, constraints, ownership, snapshots и idempotency;
- local YooKassa-compatible mock: pending → succeeded, webhook replay и provider GET;
- local iiko simulator: availability, stop-list, offline/faults, paid fulfillment и lifecycle;
- XP/coal ledger, reward debit, Wheel spin, Quest projection/claim и refund state;
- API/client error mapping и отсутствие секретов в Customer/Admin payloads.

## 2. Матрица проверки

| Область | Позитивные сценарии | Негативные и edge cases | Автотесты | Результат |
|---|---|---|---|---|
| Catalog/Admin catalog | create/edit/hide, Customer text search, server price/visibility | hidden/missing product, stale quote, client total, no-result search | `catalog.test.ts`, `catalog.spec.ts`, `cart.spec.ts` | PASS |
| Auth | identify, restore after reload, logout, staff session | anonymous, foreign owner, invalid input, rate limit | `auth.test.ts`, `admin-orders.test.ts`, `auth.spec.ts` | PASS |
| Cart/checkout | quote and pickup flow | stale slot, unavailable iiko, no order/payment side effect | `checkout.test.ts`, `checkout.spec.ts` | PASS |
| Orders | create, own list/detail, snapshots | duplicate idempotency, changed catalog, ownership | `orders.test.ts`, `admin-orders.spec.ts` | PASS |
| Payment | persisted amount, pending, server-confirmed success, discounted redemption payment | early webhook, mismatch, malformed/live response, replay | `payments.test.ts`, `yookassa-provider.test.ts`, `test:payment` | PASS local mock |
| Refund/cancel | persisted full-refund state, reconciliation boundary | duplicate/concurrent cancel, provider mismatch | DB integration M12 cases + provider tests | PASS local boundary |
| Loyalty economy | XP/coal earn, rank, ledger, fixed-discount reward | insufficient balance, limit, duplicate debit, snapshots | `loyalty*.test.ts`, DB integration, `loyalty-rewards.spec.ts` | PASS |
| Wheel/Quest | settings/prizes, prize type/value update, eligibility, spin, quest projections/claims | auth, min order, cooldown/limit, duplicate spin/event, stale prize version | `wheel-quest*.test.ts`, DB integration, E2E | PASS local |
| iiko | available, stop-list, terminal offline, order lifecycle | timeout, schema drift, cancelled/duplicate order | simulator 49 tests + payment harness | PASS simulator |
| Admin analytics | aggregates, filters, CSV, populated DB | empty data, malformed source, unauthorized | `admin-analytics.test.ts`, `analytics.spec.ts` | PASS |
| Promos/Segments | definitions, activation/archive, built-in previews | invalid economics, populated canonical DB, custom segment unavailable | API tests + E2E | PASS |
| Communications | draft create/update/archive/restore, preview | unknown variables, invalid promo, dispatch unavailable | `admin-communications.test.ts`, E2E | PASS |
| Native Push/SMS | phone-only auth, Expo notification plugin, device/preferences API | invalid phone, missing push project id, web does not request native permission | `auth.test.ts`, `notifications.test.ts`, client tests, Expo config | PASS local; real delivery gate |
| Media | upload/resize/WebP and serve | malformed/unsupported/oversized/cross-origin | `media.test.ts` | PASS |
| Visual parity | all implemented sections at 320/375/768/1024 | overflow, modal focus, disabled/unavailable states | `admin-integration.spec.ts` and module E2E | PASS |

## 3. Фактические результаты

- Package tests: **325 passed** — contracts 52, API client 84, API 117, Customer 28, Admin 19, PostgreSQL integration 25.
- Playwright: **22/22 passed**, one worker against the canonical DB.
- iiko simulator: **49/49 passed**.
- `pnpm test:payment`: **exit 0**; local mock payment + Backend + iiko lifecycle reached `payment=succeeded`, `order=completed`; real money was not used.
- `expo config --type public --json`: **PASS**; Customer declares `ios`, `android` and `web` targets with Expo Router. Device/TestFlight/Google Play execution was not available.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, canonical migration/probe, `pnpm audit --prod` и `git diff --check`: **PASS**.

## 4. Исправленные дефекты

1. E2E workers конфликтовали через общую canonical DB. Включён один Playwright worker.
2. Полный Admin visual sweep превышал общий timeout. Для него установлен timeout 180 секунд.
3. Checkout-тест выбирал слот на границе получаса и получал корректный stale-slot error вместо iiko error. Тест выбирает последний доступный слот.
4. Local payment mock повторно выдавал `test-payment-1`, что нарушало уникальность provider ID в persistent DB. ID теперь уникален на каждый запуск.
5. Payment harness оставлял дочерний API/mock процесс после завершения. Добавлены прямой запуск API, bounded shutdown, force cleanup соединений и simulator reset.
6. Segment integration/E2E предполагали пустую БД и единственную архивную запись. Проверки сделаны data-aware и scoped к своим fixture.
7. README/roadmap описывали M13.5 как недоступный, хотя fixed-discount rewards уже реализованы. Документация синхронизирована с кодом.
8. Wheel prize update валидировал, но не сохранял `type/value` и не имел version/idempotency boundary. Добавлены сохранение всех полей, optimistic locking, append-only history, idempotency conflict и regression E2E/API/DB tests.
9. Payment revalidation не учитывала уже применённый redemption snapshot и отклоняла корректный discounted order. Backend теперь сравнивает текущий full quote минус persisted discount с order total; добавлен regression API test.
10. Loyalty contract не принимал `wheel_spin` и `quest_reward`, хотя эти источники уже записывались в DB. Контракт и regression fixtures синхронизированы.
11. Customer Loyalty загружал ledger, но не показывал его, а redemption retry создавал новый key и скрывал ошибку. Добавлены ledger UI, стабильный key на попытку и видимый retry/reconciliation state.
12. Customer Catalog не имел текстового поиска. Добавлены поиск по названию/описанию/категории, очистка и явный no-results state без изменения checkout/payment payloads.
13. Native Customer не имел native Push registration, а auth boundary был ошибочно расширен SMS OTP. Добавлены Expo native permission/token registration и PostgreSQL device registry/preferences; по owner decision вход возвращён к phone-only `/auth/identify`, SMS-коды не отправляются.

## 5. Что остаётся открытым

- Реальный YooKassa write/refund и бухгалтерская/receipt-проверка не выполнялись; credentials из чата не использовались.
- Реальный production iiko account conformance не выполнялся; проверен только simulator.
- Реальный iPhone и Android, TestFlight и Google Play internal/closed testing не выполнялись.
- Реальная Push-доставка требует EAS project id и iOS/Android credentials; SMS.ru adapter для будущих сообщений требует production `SMS_RU_API_ID`/согласованный Sender ID. Кодовые SMS для входа не используются. Реальные сообщения и TestFlight/Google Play delivery gates не выполнялись.
- Admin mass-dispatch, delivery statuses и consented campaign contract остаются отдельным scope; текущие Communications drafts не отправляют сообщения.
- Custom/user segments сознательно не реализованы; built-in сегменты работают read-only.
- В текущем согласованном webhook contract нет отдельного механизма подписи; scenario «неверная подпись» нельзя честно считать PASS без отдельного provider/security contract.
- Остаются неблокирующие предупреждения: simulator запущен под Node 22 при требовании Node 24, Expo deprecated style props и pg concurrent-query deprecation.

Эти пункты не маскируются тестовыми данными и не являются основанием заявлять production readiness.
