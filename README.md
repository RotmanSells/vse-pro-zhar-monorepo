# Все Про Жар

Цифровой контур одного ресторана в Краснодаре. M0 собрал запускаемые границы Customer Web, Admin Web и Backend API, shared contracts, PostgreSQL/Drizzle foundation, CI и foundation smoke. M1 добавляет первый вертикальный бизнес-срез — каталог категорий и товаров.

## Требования

- Node.js `>=24.14.1 <25`
- pnpm `>=11.24.0 <12`

## Структура

```text
apps/api/       # Fastify Backend API
apps/customer/  # Expo + React Native + React Native Web + Expo Router
apps/admin/     # React + Vite Web Admin
packages/contracts/  # shared Zod contracts
packages/api-client/ # shared /health and /catalog clients + request lifecycle boundaries
packages/database/   # PostgreSQL pool + Drizzle migrations
docs/           # product, architecture, roadmap and execution plans
e2e/            # browser smoke and catalog lifecycle E2E
```

## Документация

- [Execution Plans](PLANS.md)
- [Описание продукта](docs/PRODUCT.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [Дорожная карта](docs/ROADMAP.md)
- [M0 milestone](docs/milestones/M0-foundation/README.md)
- [M1 catalog execution plan](docs/exec-plans/completed/M1-catalog.md)
- [Execution plan history](docs/exec-plans/)

## Environment setup

```bash
pnpm install
cp .env.example .env
```

Безопасные development defaults позволяют запустить Web/API без локального PostgreSQL. При отсутствии `DATABASE_URL` health-сценарий работает, а каталог явно показывает состояние недоступности; `DATABASE_URL` нужен для реального каталога, database commands и integration tests. `.env` игнорируется Git.

| Переменная | Где используется | Доступность |
| --- | --- | --- |
| `APP_ENV` | Backend runtime | server-only |
| `API_HOST` / `API_PORT` | Backend listener | server-only |
| `CORS_ALLOWED_ORIGINS` | Backend browser allowlist, comma-separated | server-only; в production обязателен |
| `EXPO_PUBLIC_API_URL` | Customer API boundary | public bundle, не secret |
| `VITE_API_URL` | Admin API boundary | public bundle, не secret |
| `DATABASE_URL` | PostgreSQL/Drizzle | server/CI-only; никогда не frontend |
| `MEDIA_DIR` | Backend local media storage | server-only |
| `MEDIA_PUBLIC_URL` | Public base URL для `/media/*` | server-only |

`EXPO_PUBLIC_API_URL` и `VITE_API_URL` по умолчанию используют `http://127.0.0.1:3000`. Не помещайте secrets в public-prefixed variables.

Expo CLI может создавать `apps/customer/expo-env.d.ts`; этот generated-файл игнорируется Git. Управляемая типизация `EXPO_PUBLIC_API_URL` хранится в `apps/customer/src/env.d.ts`.

## Development

Запустить API, Customer Web и Admin Web одной командой:

```bash
pnpm dev
```

Root `pnpm dev` сначала один раз собирает `packages/contracts` и `packages/api-client`, затем запускает API, Customer Web и Admin Web параллельно. Отдельные package-команды `dev` и `build` сами подготавливают shared packages перед своим запуском; root использует внутренние `*:root` scripts, чтобы не повторять эту подготовку в параллельных процессах.

Development URLs:

- Customer Web: <http://localhost:8082>
- Admin Web: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:3000>
- Health: <http://127.0.0.1:3000/health>

Customer и Admin знают только Backend API. Они получают `/catalog` через общий `@vse-pro-zhar/api-client`, который нормализует URL, валидирует ответы через `@vse-pro-zhar/contracts` и управляет timeout/abort; health-клиент сохраняет тот же boundary для `/health`. `EXPO_PUBLIC_API_URL` и `VITE_API_URL` остаются раздельными platform env adapters. Каталог имеет явные loading, empty, error и retry состояния.

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

Smoke поднимает API, Customer Web и Admin Web, проверяет каталоговые поверхности, `pageerror` и browser console errors. Отдельный catalog E2E с PostgreSQL проверяет lifecycle: Admin создаёт и скрывает товар, Customer получает актуальное состояние.

## Database foundation

Пакет использует PostgreSQL через `pg` и Drizzle ORM. M1 добавляет versioned schema для `categories` и `products`; migration создаёт начальную таксономию из семи категорий, но не добавляет фиктивные товары.

```bash
pnpm --filter @vse-pro-zhar/database generate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
  pnpm --filter @vse-pro-zhar/database migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
  pnpm --filter @vse-pro-zhar/database probe
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev \
  pnpm --filter @vse-pro-zhar/database test
```

Migration files находятся в `packages/database/drizzle/`, а catalog repository — в `packages/database/src/catalog-repository.ts`. Цены хранятся в целых minor units (`priceMinor`); новые business schemas добавляются только в соответствующих vertical slices и проходят versioned migration.

## API foundation

`GET /health` возвращает shared-contract-valid response с `service`, `status`, `environment` и ISO `timestamp`. `GET /catalog` отдаёт опубликованные категории и товары, `/admin/catalog` и catalog mutations используются Admin, а `POST /admin/media/images` принимает фото и возвращает оптимизированный WebP URL. Unknown routes, validation failures и unexpected errors возвращают безопасный JSON envelope с request ID без внутренних деталей. API использует явный runtime-validated CORS allowlist и graceful shutdown.

## Изображения товаров

Admin загружает JPG, PNG или WebP через `POST /admin/media/images`. Backend проверяет содержимое файла, применяет EXIF rotation, уменьшает изображение до `1600×1600`, конвертирует в WebP quality 82 и сохраняет его в `MEDIA_DIR`. В Product сохраняется только URL обработанного файла; исходный upload не хранится.

## CI

`.github/workflows/ci.yml` запускается на Pull Request и push в `main`. Workflow устанавливает зависимости через `pnpm install --frozen-lockfile`, поднимает отдельный PostgreSQL service, применяет migrations и выполняет lint, typecheck, tests, builds и foundation Playwright smoke.
