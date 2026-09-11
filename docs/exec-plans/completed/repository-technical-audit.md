# Полный технический аудит репозитория

Status: completed
Milestone: M8
Depends on: M8-card-payment

## Purpose

Проверить текущее фактическое состояние всего репозитория, исправить только подтверждённые дефекты внутри уже реализованных границ M0–M8 и получить воспроизводимый набор automated/manual verification результатов.

## Current State

В `docs/exec-plans/active/` не было активного execution plan. Рабочая копия содержит большой набор существующих изменённых и новых файлов M4–M8; они принадлежат владельцу и не должны откатываться, удаляться или механически перезаписываться. Документация описывает Customer Web/iOS/Android, Admin Web, модульный Fastify Backend, shared runtime contracts/API clients и одну PostgreSQL database `vse_pro_zhar_dev`.

## Scope

- Статический и динамический аудит frontend, backend, contracts, API clients и database layer.
- Проверка authentication/authorization, каталога, корзины, checkout, orders и YooKassa payment boundary.
- Проверка iiko read-only availability boundary, fail-closed поведения, timeout/retry/idempotency и конкурентных сценариев.
- Проверка миграций, constraints, транзакций, money invariants и runtime validation.
- Проверка React lifecycle, Web/native совместимости, accessibility, конфигурации, CI, production build и секретов.
- Минимальные исправления подтверждённых дефектов и regression tests для каждого исправления.
- Применимые automated checks, PostgreSQL integration на `vse_pro_zhar_dev`, E2E и ручная browser-проверка.

## Out of Scope

- Новые product features и переход к следующему milestone.
- iiko order submission, kitchen status, refunds, loyalty и rewards, отсутствующие в текущем M0–M8 contract.
- Архитектурные изменения, новый public contract или provider choice без owner decision.
- Предположительные оптимизации и визуальный redesign.
- Новая инфраструктура, отдельные services или любая дополнительная/test database.
- Изменение существующей пользовательской работы, не необходимое для подтверждённого исправления.

## Architecture / Constraints

- Модульный монолит, один application process и одна PostgreSQL database `vse_pro_zhar_dev`.
- Backend + PostgreSQL являются source of truth; денежные значения — только integer minor units.
- Availability fail-closes; webhook/payment transitions обязаны быть server-verified и idempotent.
- Customer Web остаётся основной средой проверки, общая логика не зависит от DOM, native adapters изолированы.
- Существующие незакоммиченные изменения сохраняются; исправления должны быть минимальными и локальными.

## Implementation Requirements

- Каждая правка опирается на воспроизводимый дефект, доказанный code path/invariant или test, падающий до исправления.
- Для исправлений добавляются regression tests, включая negative/replay/concurrency варианты там, где применимо.
- Нельзя доверять client/provider/database payload без соответствующей runtime/invariant проверки.
- Нельзя создавать или использовать `*_test` database.

## Tests

- Root lint, typecheck, unit tests и production build.
- Database migrations/probe/integration tests только с `DATABASE_URL`, указывающим на `vse_pro_zhar_dev`.
- Playwright E2E и ручная browser-проверка доступных основных сценариев.
- Targeted regression tests для подтверждённых исправлений.
- `git diff --check`, secret/config scan и проверка generated/native configuration.

## Acceptance Criteria

- Весь tracked/untracked source scope проинвентаризирован и проверен по заявленным критическим границам.
- Все найденные безопасно исправимые подтверждённые дефекты в scope исправлены минимально и покрыты regression tests.
- Применимые проверки завершены; каждый skipped/blocked check явно объяснён.
- `Progress`, `Discoveries`, `Decision Log` и `Outcome` отражают фактический результат.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm --filter @vse-pro-zhar/database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm test
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev pnpm e2e
git diff --check
```

## Progress

- [x] Прочитать instructions, plans, README, architecture и package scripts.
- [x] Зафиксировать исходный git status и сохранить пользовательские изменения.
- [x] Проинвентаризировать код, contracts, migrations, tests, config и CI.
- [x] Выполнить baseline checks и воспроизвести подтверждённые дефекты.
- [x] Исправить дефекты и добавить regression tests.
- [x] Выполнить полный automated verification и browser-проверку.
- [x] Обновить Outcome и перенести plan в completed при выполнении критериев.

## Discoveries

- На старте активного execution plan не было; задача получила отдельный plan по правилам `PLANS.md`.
- Рабочая копия уже содержит незакоммиченные изменения и новые файлы M4–M8; аудит выполняется поверх них без отката.
- Проинвентаризировано 196 source/test/config/documentation files; frontend не обращается напрямую к PostgreSQL или provider API, а одна PostgreSQL database остаётся единственным внутренним source of truth.
- Checkout fallback через `getCatalog()` не учитывал `category.isVisible`: Product скрытой Category мог пройти первый availability gate, если repository не предоставлял специализированный `getProductsForCheckout()`.
- Production dependency audit воспроизводил две moderate advisory в транзитивных `decode-uri-component` и `uuid`; совместимые patched overrides устранили обе без добавления инфраструктуры.
- Expo CLI обнаружил рассинхронизацию patch-версий Expo packages и старый `expo-secure-store`; после выравнивания native/web dependency check проходит.
- Playwright server config не выводил CORS origins из фактических E2E URL, поэтому запуск на альтернативных портах ломал Admin API calls. E2E теперь сам передаёт оба origin Backend-процессу.
- Сохранённое абсолютное `mediaUrl` может указывать на ранее использованный local API port. Customer корректно показывает image fallback; E2E отдельно допускает только этот media failure и продолжает падать на любом non-media request failure.
- Admin catalog/media mutations не имеют staff authentication/authorization boundary. Origin/CORS не заменяет authorization, а запрос без `Origin` не доказывает принадлежность сотруднику.
- Текущий Customer flow идентифицирует профиль по телефону и имени без доказательства владения номером. После M7–M8 это позволяет знающему номер получить customer-scoped session и доступ к order/payment actions; перед production требуется отдельное решение verified identity boundary.
- Payment provider вызывается внутри database transaction до появления durable local payment row. Сбой после provider acceptance и до commit может оставить внешний платёж без локальной записи; исправление требует durable intent/reconciliation design, а не локального audit patch.
- React Native Web стабильно выдаёт deprecation warning для `shadow*` props. Это не runtime failure; механическая замена на web-only `boxShadow` могла бы ухудшить native target и поэтому не выполнялась без отдельной UI compatibility задачи.

## Decision Log

- Аудит ограничен фактически реализованными M0–M8 boundaries; отсутствующие post-M8 features фиксируются как out of scope, а не реализуются самовольно.
- Customer и Admin проверяются как две UI-поверхности; UI-правки допустимы только для подтверждённых accessibility/lifecycle/compatibility дефектов.
- M9–M10 plan не активируется автоматически: завершение аудита не даёт разрешения переходить к следующей задаче.
- Checkout исправлен в общем fallback path и покрыт regression test с repository без optional specialized read, чтобы fail-closed invariant не зависел от конкретной реализации repository.
- Уязвимые транзитивные версии закреплены workspace overrides: это минимальное решение, подтверждённое чистым production audit, без смены framework или package manager.
- Security boundaries staff access, verified customer identity и durable payment initiation оставлены явными blockers: их реализация меняет public/domain contracts и требует owner decision.
- Для browser smoke-check использован реальный Web runtime и существующая development database; отдельная test database не создавалась.

## Outcome

Аудит M0–M8 завершён. Исправлены checkout fail-closed fallback, dependency advisories, Expo dependency compatibility и переносимость E2E/CORS-конфигурации. Добавлен regression test скрытой Category и усилена проверка browser request failures. README и ROADMAP приведены к фактическому статусу: M2 и M8 завершены, M3 частично реализован внутри M6, следующий согласованный slice — M9–M10.

Финальная проверка:

- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `git diff --check` — passed.
- Полный test run с `vse_pro_zhar_dev` — 174 passed, 0 failed.
- PostgreSQL migration и probe на `vse_pro_zhar_dev` — passed; дополнительная database не создавалась.
- Playwright — 6 passed, 0 failed на фактических E2E URL.
- Expo dependency check — dependencies up to date; web production export входит в успешный root build.
- `pnpm audit --prod` — known vulnerabilities не обнаружены.
- Ручная browser-проверка — Customer catalog, восстановленная session, orders list и order detail открываются без page/runtime errors; unpaid order явно не показывается отправленным в iiko или принятым кухней.
- Secret/config scan — credential leaks и прямой runtime use test database не обнаружены.

Завершение audit task не означает production readiness. До production остаются обязательными staff authorization, verified customer identity и crash-safe durable payment initiation/reconciliation. Эти вопросы должны быть решены отдельными execution plans/owner decisions; M9–M10 не начат и не помещён в `active/`.
