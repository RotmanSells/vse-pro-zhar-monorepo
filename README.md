# Все Про Жар

Цифровой контур одного ресторана в Краснодаре: backend foundation уже создан, а customer application и admin будут добавляться поэтапно согласно [дорожной карте](docs/ROADMAP.md).

Текущий этап — `M0.2 API + Shared Contracts Foundation`. Бизнес-функциональность, Customer и Admin пока не реализованы.

## Документация

- [Описание продукта](docs/PRODUCT.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [Дорожная карта](docs/ROADMAP.md)

## Требования

- Node.js `>=24.14.1 <25`
- pnpm `>=11.24.0 <12`

## Структура

```text
apps/      # приложения; сейчас apps/api
packages/  # общие пакеты; сейчас packages/contracts
docs/      # проектная документация
```

## Разработка

Установить зависимости:

```bash
pnpm install
```

Запустить проверки:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Root-команды используют workspace-оркестрацию с `pnpm`. На текущем этапе реальные targets есть у `apps/api`; продуктовые приложения и database foundation пока не создавались.

## API foundation

Локально запустить API:

```bash
pnpm --filter @vse-pro-zhar/api dev
```

Проверить:

```text
GET /health
```

Ответ `/health` имеет shared Zod contract `HealthResponseSchema`. Неизвестные маршруты возвращают JSON envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Ресурс не найден",
    "requestId": "..."
  }
}
```

Текущие API error codes: `NOT_FOUND` и `INTERNAL_ERROR`.
