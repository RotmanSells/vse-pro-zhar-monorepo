# M0 — Health boundaries and configuration diagnostics quality

Status: completed
Milestone: M0
Depends on: M0 — Complete Project Foundation

## Purpose

Устранить выявленные проблемы качества foundation-кода без изменения пользовательской функциональности: убрать дублирование `/health` transport/domain logic, обеспечить корректные timeout/abort/latest-request-wins semantics, сделать lifecycle Customer/Admin надёжным и улучшить secret-safe server diagnostics.

## Current State

Проверены `AGENTS.md`, `PLANS.md`, `README.md`, `docs/ARCHITECTURE.md` и `docs/exec-plans/completed/M0-complete-foundation.md`. В `active/` до начала задачи был только `.gitkeep`. Customer и Admin имеют отдельные health clients с повторяющейся логикой; UI использует локальное lifecycle-состояние. API и database имеют отдельные runtime env validators и startup/CLI error paths.

## Scope

- Минимальный shared package или корректный shared boundary только для существующего `/health` client.
- Раздельные Customer/Admin environment adapters.
- Timeout, external abort, unmount cancellation, retry и latest-request-wins.
- Безопасные структурированные diagnostics для API/database configuration без secret leakage.
- Точечные Vitest tests для client, UI lifecycle и diagnostics.
- Применимые docs/plan updates и лёгкая verification.

## Out of Scope

M1 и любая business functionality; новые endpoints или универсальный SDK; state-management/data-fetching libraries; изменение `output.pptx`; push/merge; тяжёлые Playwright E2E, native export, Docker/PostgreSQL integration, полный dependency audit или production build.

## Architecture / Constraints

- Backend остаётся modular monolith, PostgreSQL — единственная основная БД.
- Общий client не обращается к `process.env`, `import.meta.env`, DOM или React Native API.
- Customer использует `EXPO_PUBLIC_API_URL`, Admin — `VITE_API_URL`; adapters передают URL в shared client.
- Runtime validation выполняется через `HealthResponseSchema` из `@vse-pro-zhar/contracts`.
- Ошибки наружу контролируемые; внутренние error details и secrets не раскрываются.
- Strict TypeScript; без `any`, `@ts-ignore`, необоснованных assertions и лишних зависимостей.
- Сохранять посторонние пользовательские изменения и не рефакторить несвязанные файлы.

## Implementation Requirements

- Shared health client должен типизированно различать malformed URL, HTTP, network, timeout, abort и invalid response cases.
- Timeout настраивается через options с разумным default; fetch получает совместимый `AbortSignal`.
- UI сохраняет loading/success/error/retry и не принимает результат устаревшей попытки.
- Diagnostics указывают переменную/категорию настройки, но не печатают URL credentials, password или весь environment.

## Tests

Покрыть valid/invalid health response, HTTP/network errors, malformed URL, timeout, abort, retry, stale response, unmount, StrictMode и Customer/Admin loading → error → retry → success. Проверить, что diagnostics не содержат пароль из `DATABASE_URL`.

## Acceptance Criteria

- [x] Customer и Admin используют одну общую реализацию health transport/domain logic.
- [x] Timeout, abort, unmount cancellation и latest-request-wins работают наблюдаемым образом.
- [x] Retry и StrictMode не оставляют экран в ошибочном/loading состоянии.
- [x] Startup diagnostics полезны и secret-safe; fail-fast сохранён.
- [x] Точечные тесты покрывают перечисленные сценарии.
- [x] Diff минимален, scope не выходит за M0 и финальный review не находит race/secret/duplication issues.

## Verification

Разрешённые проверки: точечные Vitest suites, `pnpm lint`, `pnpm typecheck`, точечная сборка shared package при необходимости, `git diff --check`, `git status --short`. Тяжёлые проверки из запроса намеренно не запускать.

## Progress

- [x] Проверены инструкции, документация и завершённый M0 plan.
- [x] Проверен baseline и определён минимальный shared boundary.
- [x] Реализован shared client/controller и UI lifecycle fix.
- [x] Усилены configuration diagnostics.
- [x] Добавлены/обновлены точечные tests.
- [x] Выполнена verification, review diff и заполнен Outcome.

## Discoveries

- `react-test-renderer` позволяет проверить обе presentation-реализации без DOM/native export; Customer test требует Vitest mock `react-native`, поскольку исходный RN entry содержит Flow, который Vite не парсит напрямую.
- Shared package должен быть собран до typecheck/test/build приложений, потому что workspace exports указывают на `dist`; root и standalone scripts получили явную подготовку.
- Timeout/abort errors не сохраняют `cause`, чтобы внутренние fetch/parser details не могли утечь через случайное логирование Error object.

## Decision Log

План создан как единственная active task для пользовательского M0 quality-fix запроса; переход к M1 не допускается.

- Общая lifecycle-семантика вынесена в health-specific framework-independent controller: он отменяет предыдущую попытку, проверяет sequence и блокирует callbacks после dispose; React Web/native остаются только presentation adapters.
- Configuration errors преобразуются в safe `{ path, message }` diagnostics; CLI/startup formatter никогда не сериализует исходный `ZodError`, `DATABASE_URL` или runtime error message.

## Outcome

Реализован минимальный M0 quality fix без перехода к M1.

- Создан `packages/api-client` с единственным `/health` transport/domain implementation: URL normalization, typed safe errors, HTTP/network/timeout/abort handling, `AbortSignal`, timeout race и `HealthResponseSchema` runtime validation. Customer и Admin оставили раздельные env adapters для `EXPO_PUBLIC_API_URL` и `VITE_API_URL`.
- В `packages/api-client` добавлен health-specific framework-independent request controller: retry отменяет предыдущую попытку, sequence защищает от stale response, dispose отменяет запрос и блокирует state callbacks. Customer React Native и Admin React Web используют его раздельно в presentation code; StrictMode flow покрыт component tests.
- API/database configuration errors преобразуются в safe structured diagnostics с variable/category paths. Startup/CLI выводят JSON без исходных Zod inputs, `DATABASE_URL`, credentials или runtime error details; fail-fast сохранён.
- Добавлены shared client/controller tests и observable Customer/Admin component tests. Проверены valid/invalid/malformed response, HTTP/network error, malformed URL, timeout, external abort, retry, stale response, dispose/unmount и StrictMode.

Проверки:

- PASS: `pnpm install --frozen-lockfile`.
- PASS: `pnpm lint`.
- PASS: `pnpm typecheck` (включая `packages/api-client`).
- PASS: `pnpm test` — API 10, Customer 4, Admin 4, api-client 12; database config 4, PostgreSQL integration 2 skipped без `DATABASE_URL`.
- PASS: `pnpm --filter @vse-pro-zhar/api-client build`.
- PASS: ожидаемый fail-fast CLI smoke для invalid production API config и invalid database URL; оба вывода не содержали secrets и указывали safe issue path.
- PASS: `git diff --check`.

Намеренно не запускались запрещённые тяжёлые проверки: Playwright E2E, Expo native export, Docker/PostgreSQL integration, полный dependency audit и полный production build. `output.pptx` и посторонние пользовательские изменения не изменялись. Финальный code review проверил race/cancellation semantics, StrictMode/unmount, env boundaries, secret leakage и отсутствие transport duplication.
