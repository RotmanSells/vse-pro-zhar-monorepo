# M2: загрузка и оптимизация изображений товаров

Status: completed
Milestone: M2
Depends on: completed M1 catalog

## Purpose

Дать Admin возможность выбрать фотографию с компьютера и сохранить её для товара через Backend. До записи в каталог изображение должно быть проверено, автоматически повернуто по EXIF, уменьшено до рабочего размера и перекодировано в WebP.

## Scope

- multipart upload для Admin;
- серверная обработка и сохранение оптимизированного изображения;
- безопасная раздача сохранённых изображений через Backend;
- привязка возвращённого URL к Product;
- preview, loading и error states в форме товара;
- automated tests и web verification.

## Out of Scope

- object storage/CDN и новая инфраструктура;
- массовая загрузка и image gallery;
- crop editor;
- native photo picker;
- удаление orphaned media и полноценный media management.

## Architecture / Constraints

- Backend + PostgreSQL остаются source of truth для `Product.imageUrl`.
- Файл обрабатывается Backend, а не считается доверенным из browser metadata.
- Формат результата: WebP, максимум 1600×1600 px, quality 82; исходный upload ограничен 10 MB.
- Локальное файловое storage используется для текущего single-process dev/production масштаба и задаётся через `MEDIA_DIR`.
- Имя файла генерируется Backend; path traversal и неподдерживаемые форматы отклоняются.
- API/client contracts проходят runtime validation; без media storage API возвращает контролируемую ошибку.

## Tests

- contract/runtime validation для upload response;
- API tests для multipart upload, invalid type, size limit и safe media serving;
- media processing test, подтверждающий WebP и уменьшение изображения;
- Admin UI tests для file selection/upload/preview/product save;
- web E2E с реальным catalog API.

## Acceptance Criteria

- [x] Admin принимает фото с компьютера в форме товара.
- [x] Backend отклоняет неподдерживаемый/слишком большой input и не доверяет только MIME.
- [x] Сохранённый результат — WebP с ограничением размера и сжатым payload.
- [x] Product сохраняет URL оптимизированного файла, Customer отображает его.
- [x] Loading, success и error states видимы пользователю.
- [x] Automated tests и web verification проходят.

## Verification

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- применимые PostgreSQL/media checks;
- web E2E upload flow.

## Progress

- [x] Добавить contracts, storage, image processing и upload API.
- [x] Подключить Admin file picker и product image flow.
- [x] Добавить automated tests и documentation.
- [x] Выполнить verification.
- [x] Обновить Outcome и перенести plan в `completed/`.

## Discoveries

- M1 хранит `Product.imageUrl` как абсолютный `http(s)` URL и уже отображает fallback emoji; upload должен возвращать URL, совместимый с этим contract.
- В проекте нет media storage или multipart boundary; для текущего масштаба достаточно local filesystem и одного Backend process.
- Sharp подтвердил реальное преобразование PNG 2400×1200 в WebP 1600×800; итоговый файл отдаётся Backend с immutable cache headers.
- Для браузера достаточно стандартного file input: Playwright E2E выбирает локальный PNG через `setInputFiles`, после чего Admin сохраняет возвращённый URL в Product.

## Decision Log

- Использовать `sharp` для серверной проверки metadata, EXIF rotation, resize и WebP encoding.
- Загружать изображение отдельным upload request до сохранения Product, чтобы обычный JSON catalog contract остался typed и простым.
- Хранить обработанные файлы в локальном `MEDIA_DIR`; object storage/CDN не добавлять до появления подтверждённой потребности.

## Outcome

Реализована загрузка JPG/PNG/WebP из Admin: Backend принимает multipart-файл до 10 MB, проверяет декодируемый формат, применяет EXIF rotation, уменьшает изображение до 1600×1600 и сохраняет WebP quality 82 в `MEDIA_DIR`. В Product сохраняется только проверенный URL, а Customer получает изображение через безопасный Backend route.

Проверка завершена успешно:

- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test` — 60 passed, 3 skipped;
- `pnpm build`;
- чистый PostgreSQL web E2E — 3 passed;
- persistent dev API health/catalog — `200`.
