# M15 — Native Push + SMS

Status: completed
Milestone: M15
Depends on: M5 customer authentication, M10 kitchen statuses, M16.5 communications persistence

## Purpose

Сделать native Push реальным каналом Customer-приложения: iOS/Android регистрируют push-устройство на Backend. SMS provider boundary сохраняется для будущих уведомлений, но вход по уточнённому owner decision работает только по номеру телефона без кодовых сообщений.

## Current State

- Customer имеет native Expo targets iOS/Android и подключённый `expo-notifications`.
- Backend хранит lightweight customer session через `/auth/identify`; номер телефона не подтверждается SMS-кодом по owner decision.
- Admin communications сохраняет push/SMS drafts, но каналы помечены `provider_not_connected`.
- Основная БД — canonical `vse_pro_zhar_dev`; отдельные test databases запрещены.

## Scope

- Native push permission/token registration для iOS и Android через `expo-notifications`.
- PostgreSQL device registry, push preference и защищённые Customer API для регистрации/отзыва устройства.
- Server-side SMS.ru provider adapter для будущих transactional/campaign messages; auth flow его не вызывает.
- Test-only provider doubles, idempotent request handling и regression tests.
- Обновление Customer UI и app config с явными loading/error/unavailable состояниями.

## Out of Scope

- Email delivery и dark theme.
- Отправка реальных сообщений во время локальных тестов.
- Реальные APNs/FCM credentials, SMS.ru API key и TestFlight/Google Play release gate.
- Массовая рассылка Admin drafts: она требует отдельного dispatch/outbox execution plan после подключения provider credentials.

## Architecture / Constraints

- Backend + PostgreSQL — источник истины; native app не хранит business state как источник истины.
- Native push token передаётся только по authenticated bearer session и не принимается как доказательство личности.
- Auth остаётся lightweight phone-only; SMS-код не создаётся и не отправляется.
- Никаких Redis/очередей/микросервисов: на текущем масштабе используются PostgreSQL и application process.
- Expo push project id и SMS.ru credentials обязательны только на deployment; отсутствие конфигурации даёт безопасный unavailable state.

## Implementation Requirements

- Strict Zod contracts → API clients/controllers → native UI.
- Migration `0022_m15_push_sms.sql` и соответствующие Drizzle schema exports.
- `/auth/identify` принимает phone-only request; существующие Web/native session transports сохраняются.
- `/notifications/devices` POST/DELETE и `/notifications/preferences` GET/PATCH.
- Native registration вызывается только на iOS/Android после подтверждённой session; web не запрашивает native permission.

## Tests

- Contracts, database repository, API boundaries, API client and Customer UI.
- Native config inspection confirms iOS/Android platforms and notification plugin.
- Existing package suite, lint, typecheck, build, audit and Playwright regression.
- SMS provider boundary остаётся server-only и не вызывается во время auth.

## Acceptance Criteria

- На native target пользователь вводит только номер телефона и получает bearer session.
- Auth не создаёт и не отправляет OTP, поэтому кодовые сообщения не могут попасть в Customer flow.
- Native app запрашивает permission, получает Expo token только при настроенном project id и регистрирует его на Backend.
- Device registration идемпотентна, logout/revoke не оставляет активное устройство.
- При отсутствии credentials UI показывает понятное unavailable состояние; fake production token/message не создаётся.
- Все automated checks проходят, а plan переносится в `completed/` только после фактической проверки.

## Verification

```text
pnpm --filter @vse-pro-zhar/contracts test:root
pnpm --filter @vse-pro-zhar/database test:root
pnpm --filter @vse-pro-zhar/api test:root
pnpm --filter @vse-pro-zhar/customer test:root
pnpm lint
pnpm typecheck
pnpm build
pnpm audit --prod
pnpm e2e
```

## Progress

- [x] Зафиксировать native/SMS scope и provider boundaries.
- [x] Добавить contracts, migration, repositories и Backend routes.
- [x] Подключить native registration и Customer UI.
- [x] Выполнить automated verification и обновить документацию.

## Discoveries

- Prototype содержит SMS login flow, но owner decision для production Customer изменил boundary на phone-only lightweight identify без кодовых сообщений.
- Native app использует Expo SDK 57; совместимый `expo-notifications` доступен как `57.0.17`.

## Decision Log

- SMS provider выбран через серверный adapter SMS.ru: это сохраняет возможность заменить provider и не помещает credentials в iOS/Android bundle.
- Push использует Expo push token, а не прямой APNs/FCM token: это соответствует текущей Expo native architecture и уменьшает количество provider-specific credentials на первом релизе.
- Admin mass-dispatch оставлен отдельным scope: сначала закрываются verified native devices и SMS identity boundary.

## Outcome

M15 local slice реализован. Native Customer подключает `expo-notifications`, не запрашивает разрешение в Web, получает Expo push token только при наличии EAS project id и регистрирует его через authenticated `/notifications/devices`. Backend хранит device registry/preferences в PostgreSQL, применяет idempotency fingerprint и отдаёт подтверждённое состояние Push в Profile.

Native authentication использует тот же `/auth/identify`, что и Web, но bearer token хранится в secure storage. SMS.ru provider adapter не подключён к auth route и не отправляет кодовые сообщения.

Verification: 325 package tests passed (contracts 52, API client 84, API 117, Customer 28, Admin 19, database 25), Playwright 22/22 before the phone-only auth correction, canonical migration/probe, lint, typecheck, build, audit and diff check passed. The follow-up M15.1 correction removes SMS OTP from auth; real SMS delivery, EAS/APNs/FCM receipt, TestFlight/Google Play and Admin mass-dispatch remain operational follow-up gates.
