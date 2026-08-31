# M0 — Infrastructure P1 Fixes

Status: completed
Milestone: M0
Depends on: M0 — Complete Project Foundation

## Purpose

Устранить инфраструктурные P1-проблемы M0: сделать Admin и root orchestration воспроизводимыми без скрытой зависимости от `packages/contracts/dist`, а Expo-generated declarations — управляемыми через Git и исходную типизацию.

## Current State

Проверено перед реализацией: текущая ветка `task/m0-complete-foundation` содержит M0 implementation; рабочее дерево содержит только пользовательский untracked `output.pptx`. `apps/admin` импортирует `@vse-pro-zhar/contracts`, чей package export указывает на `dist`; Admin build не собирает contracts. Customer, API и Admin package scripts каждый частично вызывают сборку contracts, а root `pnpm dev` запускает приложения параллельно. `apps/customer/expo-env.d.ts` tracked, хотя Expo помечает его как генерируемый файл; управляемая `EXPO_PUBLIC_API_URL` типизация уже находится в `apps/customer/src/env.d.ts`.

## Scope

- Root scripts для однократной последовательной сборки contracts перед параллельным запуском API, Customer Web и Admin Web.
- Standalone Admin build/dev scripts, не зависящие от случайно существующего `packages/contracts/dist`.
- Удаление tracked Expo-generated declaration, точное `.gitignore` правило и сохранение managed env typing.
- Только затронутая README/architecture документация и этот execution plan.
- Разрешённые лёгкие проверки и read-only review diff.

## Out of Scope

Новая M1 functionality, архитектурные границы, новый task runner или инфраструктура, зависимости, payment/catalog/iiko/business changes, Playwright E2E, native export, Docker/PostgreSQL integration, полный dependency audit, push/merge и любые изменения пользовательского `output.pptx`.

## Architecture / Constraints

- Сохранить простой pnpm workspace и modular-monolith boundaries.
- `packages/contracts` остаётся единственным shared contract package; его `dist` не должен записываться конкурентными процессами.
- Root `pnpm dev` сохраняет API `127.0.0.1:3000`, Customer Web `localhost:8082` и Admin Web `127.0.0.1:5173`.
- Не считать ignored/generated output источником исходного кода; `EXPO_PUBLIC_API_URL` типизируется в управляемом `src` declaration.
- Строгий TypeScript, без `any`, `@ts-ignore` и необоснованных assertions; сохранять посторонние пользовательские изменения.

## Implementation Requirements

- `pnpm --filter @vse-pro-zhar/admin build` должен сам подготовить contracts перед `vite build`.
- `pnpm --filter @vse-pro-zhar/admin dev` должен быть запускаемым из checkout без заранее оставленного contracts `dist`.
- Root dev/build/typecheck/test orchestration должна собрать contracts ровно один раз перед parallel fan-out; app-level standalone scripts должны иметь явную подготовку, а root должен вызывать внутренние `*:root` scripts без повторной сборки.
- Expo-generated `apps/customer/expo-env.d.ts` должен отсутствовать среди tracked files и игнорироваться точным правилом; managed `apps/customer/src/env.d.ts` должен остаться.
- README и architecture должны описывать фактический порядок root development/build scripts, не добавляя M1 details.

## Tests

- Точечные builds contracts и Admin, включая Admin build из состояния без `packages/contracts/dist`.
- `pnpm lint`, `pnpm typecheck`, `git diff --check`, `git status --short`.
- Лёгкая проверка root/package scripts и read-only review diff.

## Acceptance Criteria

- [x] Standalone Admin build проходит без предварительного `contracts/dist`.
- [x] Root scripts не запускают конкурентные сборки contracts; root dev строит contracts один раз до трёх app processes.
- [x] Expo-generated declarations игнорируются Git, tracked generated file удалён, managed env typing сохранена.
- [x] Root documented ports сохраняются.
- [x] Изменён только разрешённый scope; `output.pptx` не изменён.
- [x] Выполненные проверки и сознательно не выполненные тяжёлые проверки отражены в Outcome.

## Verification

```bash
pnpm --filter @vse-pro-zhar/contracts build
pnpm --filter @vse-pro-zhar/admin build
pnpm lint
pnpm typecheck
git diff --check
git status --short
```

Дополнительно проверить Admin build после временного удаления только generated `packages/contracts/dist`, затем восстановить локальный ignored output при необходимости. Playwright E2E, native export, Docker/PostgreSQL integration и полный dependency audit не запускать.

## Progress

- [x] Прочитать обязательные инструкции, README, architecture и completed M0 plan.
- [x] Проверить текущие scripts, package boundaries, generated files, git status и пользовательский `output.pptx`.
- [x] Реализовать воспроизводимые package/root scripts и Expo ignore boundary.
- [x] Обновить затронутую документацию.
- [x] Выполнить разрешённые проверки и read-only review diff.
- [x] Перенести заполненный plan в `docs/exec-plans/completed/`.

## Discoveries

- `apps/admin` package export contracts действительно указывает на `dist`, а Admin `build` и `dev` не подготавливают этот output.
- `apps/customer`, `apps/api` и Admin вызывают contracts build на уровне package scripts; при root parallel dev это создаёт риск конкурентной записи в один `packages/contracts/dist`.
- `apps/customer/expo-env.d.ts` tracked и не покрыт текущим `.gitignore`; managed `apps/customer/src/env.d.ts` уже содержит `EXPO_PUBLIC_API_URL` typing.
- В рабочем дереве есть пользовательский untracked `output.pptx`; файл не входит в scope и не должен изменяться.
- Установленный pnpm 11 не принимает `--ignore-scripts` как опцию `pnpm run`, поэтому для root fan-out используется явный набор `*:root` scripts.
- Expo SDK 57 поддерживает project-local `.gitignore` и проверяет наличие строки `expo-env.d.ts`; фиксация этого managed-файла предотвращает его появление как untracked после Expo запуска.

## Decision Log

- Для orchestration использовать только pnpm scripts: явная root prebuild contracts и параллельный запуск приложений, без Nx/Turborepo и дополнительной инфраструктуры.
- Standalone package-команды явно вызывают contracts build и затем `*:root` command; root сначала строит contracts один раз и запускает только `*:root` scripts, что исключает конкурентные writes.
- Expo-generated declaration исключить из tracked source и добавить точное правило `apps/customer/expo-env.d.ts`; public env typing оставить в управляемом `apps/customer/src/env.d.ts`.

## Outcome

Root orchestration и standalone package commands разделены через явные `*:root` scripts. Contracts собираются один раз перед root parallel fan-out; standalone Admin build/dev готовят contracts самостоятельно. Tracked Expo-generated declaration удалён, `apps/customer/.gitignore` и workspace-level `.gitignore` игнорируют его, managed env typing в `apps/customer/src/env.d.ts` сохранена.

Verification:

- `pnpm --filter @vse-pro-zhar/admin build` после временного удаления `packages/contracts/dist`: PASS.
- `pnpm --filter @vse-pro-zhar/admin dev` после временного удаления `packages/contracts/dist` и HTTP smoke на `127.0.0.1:5173`: PASS.
- `pnpm --filter @vse-pro-zhar/customer dev:root` подтвердил, что Expo создаёт ignored declaration, а project-local `.gitignore` не изменяется: PASS; generated file удалён после проверки.
- `pnpm --filter @vse-pro-zhar/contracts build`: PASS.
- `pnpm lint`: PASS.
- `pnpm typecheck`: PASS; один contracts build и четыре `*:root` typechecks.
- Root `pnpm dev` smoke: PASS; один contracts build, API `3000`, Customer `8082`, Admin `5173`, HTTP responses доступны.
- Script assertions, env boundary review и `git diff --check`: PASS.
- `git status --short`: только ожидаемые файлы задачи, новый `apps/customer/.gitignore`, active plan и неизменённый пользовательский `output.pptx`.

Not verified by request: `pnpm test`, full root `pnpm build`, Playwright E2E, native export, Docker/PostgreSQL integration, full dependency audit, push and merge.
