# Архитектура

```text
Customer Web/iOS/Android ──┐
                            ├──► Backend API ───► PostgreSQL
Admin Web ──────────────────┘          │
                                       └── shared Zod contracts
```

## Foundation boundaries

- Customer — universal Expo application: Expo, React Native, React Native Web, Expo Router. Web — основная ежедневная среда; iOS и Android targets сохраняются в app config. Production strategy не строится на WebView.
- Admin — отдельное web-only приложение на React + Vite.
- Backend — Node.js + TypeScript + Fastify modular monolith.
- `packages/contracts` — shared Zod runtime schemas and types.
- `packages/api-client` — shared `/health` transport/domain boundary and request lifecycle controller without env or UI dependencies.
- `packages/database` — server-side PostgreSQL pool, Drizzle connection and versioned migration runner.

```text
apps/customer ──HTTP──► apps/api ──future DB access──► packages/database ──► PostgreSQL
apps/admin    ──HTTP──► apps/api
apps/api / frontends ──► packages/contracts
apps/customer / apps/admin ──► packages/api-client ──► apps/api
```

Frontend applications не подключаются к PostgreSQL, iiko, payment provider или другим integrations напрямую. Они знают только Backend API.

## API and runtime validation

`GET /health` остаётся liveness endpoint самого API и не проверяет database readiness. Customer и Admin используют маленький health API client boundary:

```text
fetch /health
    ↓
unknown response
    ↓
HealthResponseSchema.safeParse()
    ↓
loading / Connected / controlled error + retry
```

Response внешнего API не считается доверенным без runtime validation. Safe API errors скрывают internal error details; request IDs генерируются Backend и не принимаются из произвольного client header как authoritative ID.

`packages/api-client` не читает environment и не использует DOM, React или React Native API. Customer и Admin отдельно передают ему `EXPO_PUBLIC_API_URL` и `VITE_API_URL`; общий boundary выполняет URL normalization, `/health` request, timeout, abort, HTTP/network handling и `HealthResponseSchema` validation. Health-specific request controller обеспечивает cancellation, unmount safety и latest-request-wins, а Web/native presentation остаётся в соответствующих приложениях.

## Browser CORS

Backend регистрирует официальный Fastify CORS plugin с явным runtime-validated `CORS_ALLOWED_ORIGINS`. Development defaults ограничены локальными Customer (`localhost:8082`) и Admin (`localhost:5173`) origins; production без корректного allowlist не стартует. Wildcard `*` не используется.

## Database

Database foundation использует `pg` pool и Drizzle ORM/Kit. `DATABASE_URL` валидируется как PostgreSQL URL и существует только в server/CI environment. Pool можно закрыть явно; migration runner использует `packages/database/drizzle/`.

API/database configuration failures сохраняют fail-fast поведение. Startup и CLI выводят только структурированные safe issue paths и категории; значения environment, credentials и полные connection URLs не логируются.

M0 намеренно не создаёт business schema (`products`, `orders`, `customers`, `payments` и т. п.). При запуске Drizzle migration mechanism создаёт только собственную техническую metadata table; новые business tables приходят вместе с их vertical slice и versioned migration.

## Development experience

Root pnpm workspace не использует Nx, Turborepo, Redis, Kafka, RabbitMQ, Kubernetes, microservices или другую инфраструктуру «на будущее». `pnpm dev` параллельно запускает ровно три приложения:

- Customer Web — `http://localhost:8082`;
- Admin Web — `http://127.0.0.1:5173`;
- API — `http://127.0.0.1:3000`.

Root-команды, которым нужны shared packages, сначала последовательно выполняют сборку `packages/contracts` и `packages/api-client`, а затем запускают package `*:root` scripts. Поэтому параллельный запуск приложений не записывает в один shared `dist`; standalone `dev`/`build` команды приложений сами имеют явную подготовку packages.

`apps/customer/expo-env.d.ts` — generated Expo declaration и игнорируется Git. Управляемая типизация public `EXPO_PUBLIC_API_URL` находится в `apps/customer/src/env.d.ts`.

PostgreSQL не нужен для health-screen development. Он нужен только database commands/integration checks и предоставляется CI service или явно настроенным development PostgreSQL.

## Sources of truth

Внутренние business entities принадлежат Backend + PostgreSQL. Customer Web, iOS, Android и Admin никогда не являются источником истины для prices, totals, orders, payments, availability, promo validity или rewards. iiko и payment provider в будущих slices будут внешними providers за Backend adapters и runtime validation.
