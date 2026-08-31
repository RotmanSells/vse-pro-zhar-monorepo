# M0 — Complete Project Foundation

Status: in_progress
Milestone: M0
Depends on: M0.1 — Workspace Foundation; M0.2 — API + Shared Contracts Foundation

## Purpose

Завершить технический фундамент проекта без ресторанной business functionality: добавить Customer Web, Admin Web, database foundation, CORS, root development experience, CI, foundation E2E и актуальную документацию.

## Current State

Проверено перед реализацией: `main` и `origin/main` указывают на `9db311f` (`feat: add API and shared contracts foundation`). В repository уже есть pnpm workspace, строгий TypeScript, ESLint, Fastify API, `GET /health`, shared Zod contracts, runtime config, safe errors, request IDs, logging, graceful shutdown и Vitest tests. Customer, Admin, PostgreSQL/Drizzle, CI и E2E отсутствуют. Рабочее дерево до начала этой задачи содержало пользовательские изменения в `AGENTS.md`, `README.md` и документации execution plans; они сохранены.

## Scope

- `apps/customer`: Expo + React Native + React Native Web + Expo Router foundation screen, API health boundary, runtime validation, loading/success/error/retry и Web build.
- `apps/admin`: React + Vite + TypeScript foundation screen, API health boundary, runtime validation, loading/success/error/retry и production build.
- `packages/database`: PostgreSQL pool, Drizzle connection/config, `DATABASE_URL` validation, migration mechanism, testable boundary и shutdown.
- API CORS с runtime-validated explicit origins.
- Root `dev`/build orchestration, stable development ports and environment documentation.
- GitHub Actions CI with a real PostgreSQL service and a small Playwright foundation smoke.
- Applicable README, architecture, milestone and completed-plan documentation.
- Local verification, database/E2E verification where available, scope/security audit, final commit and branch push without merging to `main`.

## Out of Scope

Catalog, products, images, search, favorites, authentication, OTP, cart, checkout, orders, payments, SBP, iiko, promos, loyalty, XP, ranks, wheel, quests, push, SMS, analytics, admin authentication and all other product features.

## Architecture / Constraints

- Backend remains a modular monolith; PostgreSQL is the single primary database.
- Customer is a universal Expo application and is verified web-first, but is not a WebView wrapper.
- Admin is web-only React/Vite.
- Frontends call only the Backend API; they do not access PostgreSQL or providers directly.
- `/health` responses are validated with `HealthResponseSchema` from `@vse-pro-zhar/contracts` at the client boundary.
- Money, business schemas and provider integrations are not introduced in M0.
- Server-only secrets, especially `DATABASE_URL`, must not enter frontend bundles.
- Existing working-tree changes are preserved.

## Implementation Requirements

- Keep dependencies minimal and compatible with the existing Node/pnpm baseline.
- Use public environment prefixes only for frontend API URLs (`EXPO_PUBLIC_API_URL`, `VITE_API_URL`); use `DATABASE_URL` only server-side.
- Configure CORS with explicit runtime-validated origins and safe production behavior.
- Keep migration directory free of business tables.
- Make CI install with `pnpm install --frozen-lockfile`, run lint/typecheck/test/build, start PostgreSQL, run migrations and database integration checks.
- Provide one reproducible foundation browser smoke covering Customer and Admin connected states.

## Tests

- Existing API/config tests remain green.
- Customer and Admin API boundaries cover valid response, invalid response and network/API failure; applicable UI state behavior is covered minimally.
- Database integration tests use real PostgreSQL and check connection/probe plus migrations.
- Foundation E2E opens both web apps and verifies `Connected` after `/health`.

## Acceptance Criteria

- [x] Root install/lint/typecheck/test/build work.
- [x] Customer Web runs, builds, uses Expo + React Native Web, calls API through a small boundary, validates `/health`, and supports loading/success/error/retry.
- [x] Admin Web runs, builds, calls API through a small boundary, validates `/health`, and supports loading/success/error/retry.
- [x] API CORS is explicit, runtime-validated and safe for production configuration.
- [x] Database package provides PostgreSQL/Drizzle pool, migrations, config validation, testable probe and close behavior without business tables.
- [x] `pnpm dev` starts API, Customer and Admin with documented URLs.
- [x] CI workflow covers PRs and pushes to `main`/task branches, including PostgreSQL integration checks; remote run is pending push.
- [x] Foundation E2E passes for Customer → API and Admin → API.
- [x] Security and scope audit finds no secrets, WebView strategy, direct frontend DB/provider access, fake production data or business functionality.
- [x] Applicable documentation reflects the implementation; final branch/remote verification remains pending.
- [ ] Final branch is committed, clean and pushed if the remote is available; `main` is not merged.

## Verification

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

Additionally run the real PostgreSQL integration checks and foundation browser E2E. Record unavailable external checks honestly as `NOT VERIFIED`.

## Progress

- [x] Проверены repository, инструкции, документация, git history, packages/apps, scripts и текущие tests.
- [x] Создана `task/m0-complete-foundation` от `main` с сохранением существующих пользовательских изменений.
- [x] Реализовать Customer Web foundation.
- [x] Реализовать Admin Web foundation.
- [x] Реализовать database foundation и migrations.
- [x] Настроить CORS, root dev/build, CI и foundation E2E.
- [x] Обновить применимую документацию и выполнить доступные локальные проверки.
- [ ] Создать итоговый commit и push branch, если remote доступен.

## Discoveries

- В исходном repository нет Customer, Admin, database, CI или E2E; `main` действительно соответствует M0.2.
- В рабочем дереве уже были незакоммиченные execution-plan изменения, включая обязательное правило поддерживать active plan; они принадлежат текущей работе и сохранены.
- Expo SDK 57 с текущим CLI требует совместимую ветку React Native 0.86.3; RN 0.87 удалил `react-native/rn-get-polyfills`, из-за чего web export ломается до runtime-кода приложения.
- Порт `8081` занят внешним Expo-процессом в текущем окружении, поэтому Customer закреплён на `8082`; API и Admin оставлены на `3000` и `5173`.
- React StrictMode в Admin выявил lifecycle bug: после первого dev-effect cleanup состояние оставалось loading; mount ref теперь явно восстанавливается перед каждым effect cycle.
- Drizzle Kit на пустой M0 schema генерирует только `drizzle/meta/_journal.json`; runtime migrator создаёт собственную metadata table и не создаёт business tables.

## Decision Log

- Вся M0.3–M0.6 работа ведётся одной branch и одним active plan, поскольку пользователь запросил завершение foundation целиком.
- Branch создаётся от `main`, но подготовленные пользовательские незакоммиченные документы не удаляются и входят в итоговый результат.
- Для Customer оставлен минимальный Expo Router dependency set, дополненный official SDK 57 native-compatible peer versions; gesture/reanimated/worklets добавлены только для корректной Expo Router/native target compatibility.
- `pnpm dev` использует pnpm recursive parallel execution без отдельного task runner; PostgreSQL не включён в dev command, поскольку health foundation его не требует.
- CORS development defaults включают только локальные Customer/Admin origins; production требует явный `CORS_ALLOWED_ORIGINS`.

## Outcome

Заполняется после выполнения acceptance criteria и доступных verification checks.
