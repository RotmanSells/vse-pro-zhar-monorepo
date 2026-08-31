# Все Про Жар

Цифровой контур одного ресторана в Краснодаре: customer application, admin и backend будут добавляться поэтапно согласно [дорожной карте](docs/ROADMAP.md).

Текущий этап — `M0.1 Workspace Foundation`. Бизнес-функциональность и приложения пока не реализованы.

## Документация

- [Описание продукта](docs/PRODUCT.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [Дорожная карта](docs/ROADMAP.md)

## Требования

- Node.js `>=24.14.1 <25`
- pnpm `>=11.24.0 <12`

## Структура

```text
apps/      # будущие приложения
packages/  # будущие общие пакеты
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

`test` и `build` используют workspace-оркестрацию с `--if-present`; пока в workspace нет приложений и пакетов, реальные targets для них отсутствуют.
