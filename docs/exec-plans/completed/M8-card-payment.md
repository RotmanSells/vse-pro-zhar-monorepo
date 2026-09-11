# M8 — Тестовая оплата картой через YooKassa

Status: completed
Milestone: M8
Depends on: M7 Orders, existing M8 payment flow

## Purpose

Адаптировать текущий YooKassa payment slice для тестового магазина, в котором доступна банковская карта, но недоступна СБП. Customer должен получить redirect на страницу оплаты картой, а Backend сохранить прежние ownership, amount, idempotency и server-confirmed status boundaries.

## Scope

- заменить provider payment method `sbp` на `bank_card`;
- обновить Customer payment copy и accessibility labels;
- обновить adapter/UI tests и документацию M8;
- сохранить server-only credentials, persisted order amount/currency, webhook verification и отсутствие iiko submission.

## Out of Scope

- production payment mode;
- SBP enablement в YooKassa кабинете;
- iiko order submission, kitchen statuses, refund и M9+;
- новая инфраструктура или вторая database.

## Constraints

- credentials берутся только из локального Git-ignored `.env` и Backend process environment;
- не выводить секрет и не включать его в frontend, fixtures или git;
- canonical database: `vse_pro_zhar_dev`;
- test payment не считается подтверждённым без server-side YooKassa confirmation/webhook.

## Progress

- [x] Зафиксировать причину: test store не предоставляет SBP.
- [x] Создать active plan.
- [x] Переключить provider на `bank_card`.
- [x] Обновить Customer UI, tests и M8 documentation.
- [x] Выполнить automated checks.
- [x] Зафиксировать, что первый manual card attempt вернулся 503 без записи payment в PostgreSQL.
- [x] Включить безопасную диагностику provider response и подтвердить причину 503.
- [x] Исправить приоритет `.env.local` над `.env` при локальном запуске API.
- [x] Установить credentials тестового магазина приёма платежей и подтвердить их read-only запросом YooKassa.
- [x] Выполнить повторный manual payment-start verification после замены credentials на ключ тестового магазина приёма платежей.
- [x] Исправить найденные при code review retry/webhook race conditions и добавить regression tests.
- [x] Обновить Outcome и перенести plan в completed.

## Discoveries

- Credentials и test store доступны: `/v3/me` возвращает HTTP 200, `test=true`, статус магазина `enabled`.
- YooKassa test store поддерживает тестирование карт и YooMoney; SBP create request отклоняется provider, поэтому UI получал безопасный 503.
- После переключения на `bank_card` полный локальный verification прошёл, но первый внешний card create также вернул безопасный 503; в `payments` не появилась запись, поэтому order не получил неподтверждённый payment state.
- Указанная страница YooKassa относится к тестовым выплатам (payouts), а не к приёму платежей. Безопасная проверка `/v3/me` для текущих credentials показывает `test=true`, `payout_methods` и `payout_balance`, но не `payment_methods`; вероятно, в `.env` указан тестовый шлюз выплат вместо тестового магазина приёма платежей.
- Provider adapter теперь сохраняет в server log только безопасные поля YooKassa error response (`httpStatus`, `code`, `parameter`, provider error/request IDs и ограниченное описание); Customer по-прежнему видит общий safe error.
- Root `.env` credentials проходят `/v3/me`, но account сообщает только `payout_methods`; `POST /v3/payments` возвращает `invalid_credentials` с `Authentication type is not allowed`, что подтверждает credentials тестового шлюза выплат.
- User-provided key in `.env.local` returns `invalid_credentials` с сообщением о неверных shop ID или secret key даже на read-only запросе `/v3/me`; он не может запустить приём платежа.
- После установки `shop_id=1453401` та же test key проходит `/v3/me`; account имеет `payment_methods=["yoo_money", "bank_card"]`, поэтому credentials соответствуют тестовому магазину приёма платежей.
- Повтор отменённого платежа использовал прежний client idempotency key и поэтому всегда возвращал тот же `canceled` payment; для новой попытки требуется новый ключ.
- YooKassa notification может прийти до фиксации локальной строки payment. Дедупликация такого раннего события до появления payment блокировала бы его последующую обработку.
- Параллельные provider events должны сериализоваться на строке payment, иначе stale pending event может перезаписать одновременно подтверждённый `succeeded` status.
- Ручной Backend flow создал тестовый order `33` и payment `8`: persisted amount `50000 RUB`, provider status `pending`, confirmation `redirect` с HTTPS origin `https://yoomoney.ru`; iiko submission не выполнялся.

## Decision Log

- Для текущей локальной проверки выбран `bank_card`; способ оплаты не передаётся клиентом и остаётся server-side provider configuration.
- Для входящей оплаты нужны credentials именно тестового магазина из раздела «Приём платежей → Тестовый магазин → Интеграция → Ключи API»; credentials тестового шлюза выплат нельзя использовать для `POST /v3/payments`.
- Локальный `.env.local` загружается раньше `.env`, потому что `process.loadEnvFile` сохраняет первое загруженное значение переменной.
- Существующие payment/order idempotency и webhook rules не меняются.
- После `canceled` Customer создаёт новый payment attempt с новым idempotency key; сетевой retry незавершённой попытки по-прежнему использует прежний ключ.
- Ранний webhook для ещё не видимого локального payment получает retryable `503` и не попадает в event deduplication до появления payment.
- Обработка разных webhook events сериализуется PostgreSQL row lock; event type, webhook object status и подтверждённый YooKassa API status обязаны совпадать.

## Outcome

Карточный test-payment flow завершён и проверен через реальный Backend: YooKassa вернула pending payment и HTTPS redirect, сумма взята из persisted order, подтверждение оплаты не выставлялось, iiko не вызывался. Code review дополнительно устранил бесконечный retry canceled payment, потерю раннего webhook и конкурентную регрессию финального payment status. Полные `lint`, `typecheck`, unit/component tests, production build и PostgreSQL integration tests на canonical `vse_pro_zhar_dev` прошли.
