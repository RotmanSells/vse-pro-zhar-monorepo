# Все Про Жар

Технический фундамент цифрового контура одного ресторана в Краснодаре. M0 собирает запускаемые границы Customer Web, Admin Web и Backend API, shared contracts, PostgreSQL/Drizzle foundation, CI и foundation smoke. Ресторанная business functionality начинается после M0 вертикальными срезами.

## Требования

- Node.js `>=24.14.1 <25`
- pnpm `>=11.24.0 <12`

## Структура

```text
apps/api/       # Fastify Backend API
apps/customer/  # Expo + React Native + React Native Web + Expo Router
apps/admin/     # React + Vite Web Admin
packages/contracts/  # shared Zod contracts
packages/database/   # PostgreSQL pool + Drizzle migrations
docs/           # product, architecture, roadmap and execution plans
e2e/            # small foundation browser smoke
```

## Документация

- [Execution Plans](PLANS.md)
- [Описание продукта](docs/PRODUCT.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [Дорожная карта](docs/ROADMAP.md)
- [M0 milestone](docs/milestones/M0-foundation/README.md)
- [Execution plan history](docs/exec-plans/)

## Environment setup

```bash
pnpm install
cp .env.example .env
```

Безопасные development defaults позволяют запустить Web/API без локального PostgreSQL. `DATABASE_URL` нужен для database commands и integration tests. `.env` игнорируется Git.

| Переменная | Где используется | Доступность |
| --- | --- | --- |
| `APP_ENV` | Backend runtime | server-only |
| `API_HOST` / `API_PORT` | Backend listener | server-only |
| `CORS_ALLOWED_ORIGINS` | Backend browser allowlist, comma-separated | server-only; в production обязателен |
| `EXPO_PUBLIC_API_URL` | Customer API boundary | public bundle, не secret |
| `VITE_API_URL` | Admin API boundary | public bundle, не secret |
| `DATABASE_URL` | PostgreSQL/Drizzle | server/CI-only; никогда не frontend |

`EXPO_PUBLIC_API_URL` и `VITE_API_URL` по умолчанию используют `http://127.0.0.1:3000`. Не помещайте secrets в public-prefixed variables.

## Development

Запустить API, Customer Web и Admin Web одной командой:

```bash
pnpm dev
```

Development URLs:

- Customer Web: <http://localhost:8082>
- Admin Web: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:3000>
- Health: <http://127.0.0.1:3000/health>

Customer и Admin знают только Backend API. Они получают `/health` через небольшой API boundary и runtime-валидируют ответ через `@vse-pro-zhar/contracts` / `HealthResponseSchema`. Оба экрана имеют loading, success, error и retry состояния.

Customer — universal Expo project с targets `web`, `ios`, `android`; web проверяется ежедневно. Это не WebView wrapper. Native build и Xcode/Android Studio не требуются для обычной foundation-проверки.

## Проверки

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` собирает contracts, Backend, Admin Vite bundle и Customer Expo web export. Если `DATABASE_URL` не задан, локальный PostgreSQL integration suite отмечается Vitest как skipped; CI запускает его с реальным PostgreSQL service.

Foundation E2E:

```bash
pnpm exec playwright install chromium
pnpm e2e
```

Smoke поднимает API, Customer Web и Admin Web, проверяет `Connected` в обоих приложениях, `pageerror` и browser console errors.

## Database foundation

Пакет использует PostgreSQL через `pg` и Drizzle ORM. В M0 нет business tables; migration metadata Drizzle является единственной технической частью migration mechanism.

```bash
pnpm --filter @vse-pro-zhar/database generate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
  pnpm --filter @vse-pro-zhar/database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
  pnpm --filter @vse-pro-zhar/database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
  pnpm --filter @vse-pro-zhar/database test
```

Migration files находятся в `packages/database/drizzle/`. Новые business schemas добавляются только в соответствующих vertical slices и проходят versioned migration.

## API foundation

`GET /health` возвращает shared-contract-valid response с `service`, `status`, `environment` и ISO `timestamp`. Unknown routes и unexpected errors возвращают безопасный JSON envelope с request ID без внутренних деталей. API использует явный runtime-validated CORS allowlist и graceful shutdown.

## CI

`.github/workflows/ci.yml` запускается на Pull Request и push в `main`. Workflow устанавливает зависимости через `pnpm install --frozen-lockfile`, поднимает отдельный PostgreSQL service, применяет migrations и выполняет lint, typecheck, tests, builds и foundation Playwright smoke.
