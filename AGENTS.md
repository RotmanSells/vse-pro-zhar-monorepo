### 15. Принцип простоты и соответствия реальному масштабу

Проект проектируется для реальной нагрузки бизнеса, а не для гипотетических миллионов пользователей.

Ожидаемая нагрузка первого production-релиза — десятки заказов в день. Архитектура должна обеспечивать корректность, безопасность и возможность разумного роста, но не должна заранее моделировать инфраструктуру крупной распределённой платформы.

* **🔴 MUST** — новая инфраструктурная технология добавляется только для решения конкретной существующей проблемы или подтверждённого требования.
* **🔴 MUST** — запрещено добавлять Redis, Kafka, RabbitMQ, Kubernetes, Elasticsearch, отдельные микросервисы, read replicas, sharding и аналогичные компоненты только «на будущее».
* **🔴 MUST** — по умолчанию Backend является модульным монолитом.
* **🔴 MUST** — по умолчанию используется одна основная PostgreSQL database.
* **🟡 SHOULD** — сначала использовать возможности PostgreSQL и обычного application process, прежде чем вводить дополнительную инфраструктуру.
* **🟡 SHOULD** — оптимизация выполняется после измерения проблемы, а не по предположению.
* **🟢 MAY** — инфраструктура может быть усложнена, если метрики, функциональные требования или требования надёжности объективно показывают необходимость.

Маленькая нагрузка не является основанием упрощать требования к корректности платежей, заказов, refund, идемпотентности, персональным данным или интеграции с iiko.

## 16. Web-first, но не WebView-first

Customer application разрабатывается по принципу **web-first, but not WebView-first**.

Основная функциональность приложения сначала должна быть доступна и проверяема через браузер без обязательного запуска Xcode, iOS Simulator, Android Studio или Android Emulator.

При этом production-приложения iOS и Android не должны представлять собой простую WebView-обёртку веб-сайта.

* **🔴 MUST** — Web является основной средой ежедневной разработки Customer application на ранних и средних этапах проекта.
* **🔴 MUST** — Customer architecture должна предусматривать полноценные native targets iOS и Android.
* **🔴 MUST** — запрещено строить App Store / Google Play release strategy на простом отображении production-сайта внутри WebView.
* **🔴 MUST** — бизнес-логика Customer не должна зависеть от браузерного DOM API, если функция должна работать на native target.
* **🟡 SHOULD** — максимально возможная часть бизнес-логики, API-клиентов, contracts, validation и application state должна быть общей между Web, iOS и Android.
* **🟡 SHOULD** — platform-specific реализация изолируется за отдельными адаптерами.
* **🟢 MAY** — Web, iOS и Android могут иметь различия в UI/UX, если это делает приложение естественным для конкретной платформы.

Допустимые platform-specific возможности включают:

* push notifications;
* deep links;
* secure device storage;
* haptics;
* application badges;
* native permissions;
* platform lifecycle;
* native share;
* другие функционально оправданные native integrations.

Не требуется искусственно добавлять native-функции только для визуального отличия от web-версии.

## 17. Стратегия тестирования Web и Native

Основная функциональная разработка выполняется и тестируется через Web.

Native-среда используется для контрольных проверок и обязательной release validation.

* **🔴 MUST** — бизнес-сценарии не должны требовать Xcode или Android Studio для обычной ежедневной разработки.
* **🔴 MUST** — функциональность, которая должна быть общей для Web/iOS/Android, сначала должна проходить соответствующие automated tests независимо от платформы.
* **🔴 MUST** — перед production-релизом Customer application полностью проверяется как минимум на реальном iPhone и реальном Android-устройстве.
* **🔴 MUST** — перед App Store release выполняется TestFlight validation.
* **🔴 MUST** — перед Google Play production release выполняется internal или closed testing.
* **🟡 SHOULD** — native compatibility проверяется не только в самом конце проекта, но и в контрольных точках разработки.

Рекомендуемые native checkpoints:

1. базовая навигация, layout и каталог;
2. authentication, session storage, checkout и platform integrations;
3. полный release candidate.

Если native checkpoint обнаруживает архитектурную несовместимость, она исправляется до продолжения значительного объёма разработки поверх проблемного решения.

Platform-specific ошибки не должны исправляться путём дублирования общей бизнес-логики без отдельного архитектурного обоснования.

## 18. Источники истины

Каждый тип данных должен иметь однозначно определённый authoritative source.

* **🔴 MUST** — PostgreSQL + Backend являются источником истины для внутренних business entities.
* **🔴 MUST** — Customer Web, iOS, Android и Admin не являются источником истины для цены, заказа, оплаты, баланса, XP, promo validity или availability.
* **🔴 MUST** — Backend повторно проверяет все критические данные перед совершением бизнес-операции.
* **🔴 MUST** — локальное состояние клиента считается только представлением последнего подтверждённого или предварительного состояния.
* **🔴 MUST** — данные внешнего provider не становятся доверенными только потому, что пришли от внешнего API; они проходят runtime validation.

Для первого production-релиза:

```text
Category / Product / название / описание / цена
→ Backend + PostgreSQL

Product visibility
→ Backend + PostgreSQL + Admin

Operational availability / stop-list
→ iiko через Backend

Checkout total
→ Backend

Payment fact
→ Payment provider + persisted Backend state

Kitchen execution status
→ iiko + persisted Backend history

Order history
→ Backend + PostgreSQL

Promo validity
→ Backend

Угольки / XP / Rank / rewards
→ Backend + PostgreSQL
```

## 19. Правила каталога и iiko

Наш каталог и каталог iiko являются разными моделями.

* **🔴 MUST** — iiko не является владельцем нашего Product.
* **🔴 MUST** — iiko не определяет название, описание, цену, изображение, Category или marketing flags Product.
* **🔴 MUST** — наш Product связывается с iiko через отдельный mapping.
* **🔴 MUST** — отсутствие или повреждение mapping не может означать `available = true`.
* **🔴 MUST** — stale, unknown, malformed или failed availability state является fail-closed.

Целевое правило:

```text
product_is_orderable =
    admin_enabled
    AND
    iiko_available
```

Admin visibility и operational availability являются разными состояниями.

Admin может скрыть Product.

Admin не может вручную объявить недоступный в iiko Product доступным.

## 20. Деньги

* **🔴 MUST** — денежные значения хранятся и рассчитываются только в целых minor units.
* **🔴 MUST** — floating-point значения не используются для бизнес-расчётов денег.
* **🔴 MUST** — окончательный total вычисляет Backend.
* **🔴 MUST** — Customer-provided total никогда не используется как основание для оплаты или создания подтверждённого заказа.
* **🔴 MUST** — перед payment initiation Backend повторно проверяет цены, quantity, promo, loyalty redemption, availability и остальные checkout conditions.

Пример:

```text
450,50 ₽
→ 45050 minor units
```

## 21. Заказы и исторические snapshots

Исторический заказ не должен изменяться вслед за текущим каталогом.

* **🔴 MUST** — `order_items` сохраняют snapshot значимых данных на момент заказа.
* **🔴 MUST** — историческая цена не читается из текущей Product price.
* **🔴 MUST** — историческое название товара не должно зависеть от последующего переименования Product.
* **🔴 MUST** — каждый значимый переход статуса заказа сохраняется в истории.
* **🔴 MUST** — изменение Product после заказа не переписывает исторические данные заказа.

Минимальный snapshot позиции:

```text
product_id
product_name
unit_price_minor
quantity
line_total_minor
```

Дополнительные необходимые данные добавляются в snapshot в момент введения соответствующей функциональности.

## 22. Платежи и идемпотентность

Платёжные операции считаются критическими.

* **🔴 MUST** — клиентский redirect или callback не является доказательством успешной оплаты.
* **🔴 MUST** — факт успешной оплаты подтверждается серверным событием payment provider.
* **🔴 MUST** — payment webhook обрабатывается идемпотентно.
* **🔴 MUST** — повторная доставка одного provider event не должна создавать повторный платёж, заказ, reward или другой side effect.
* **🔴 MUST** — provider event сохраняется или имеет надёжный механизм дедупликации.
* **🔴 MUST** — оплаченный заказ не теряется при сбое iiko.
* **🔴 MUST** — unpaid, failed или expired payment не отправляется как оплаченный заказ в iiko.
* **🔴 MUST** — пользователь не видит статус kitchen accepted до соответствующего подтверждения iiko.

Если payment подтверждён, но iiko временно недоступен:

```text
payment = succeeded
→ order сохраняется
→ integration failure фиксируется
→ выполняется ограниченный безопасный retry
→ ложный accepted не показывается
→ при невосстановимой ошибке запускается утверждённый recovery/refund flow
```

Точная provider-specific реализация определяется отдельным контрактом и при необходимости ADR.

## 23. Миграции и PostgreSQL

* **🔴 MUST** — изменение production schema выполняется только через versioned migration.
* **🔴 MUST** — ручное изменение production schema без соответствующей migration запрещено.
* **🔴 MUST** — migration является частью task, который изменяет соответствующую модель данных.
* **🔴 MUST** — удаление или destructive migration требует отдельного анализа существующих данных.
* **🔴 MUST** — запросы параметризованы или выполняются безопасным ORM/query builder.
* **🔴 MUST** — данные, прочитанные из БД на critical boundaries, не считаются автоматически корректными только потому, что находятся в нашей БД.
* **🟡 SHOULD** — использовать database constraints для инвариантов, которые естественно и надёжно выражаются на уровне БД.
* **🟡 SHOULD** — миграции должны поддерживать безопасное последовательное deployment, если изменение нельзя атомарно развернуть вместе со всем приложением.

## 24. Demo, mock и production functionality

* **🔴 MUST** — demo UI не является production functionality.
* **🔴 MUST** — mock provider не является доказательством готовности production integration.
* **🔴 MUST** — фиктивные цены, заказы, награды, balances, availability или customer data не должны незаметно попадать в production runtime.
* **🔴 MUST** — если настоящий Backend/provider contract ещё отсутствует, интерфейс показывает явно определённое unavailable, placeholder, empty или error state.
* **🔴 MUST** — milestone не считается завершённым, если основной сценарий работает только через mocks, когда этап требует реальной интеграции.
* **🟢 MAY** — mocks и simulators использовать в unit/integration tests и локальной разработке, если их test-only nature очевидна и технически изолирована.

## 25. Общий критерий инженерного решения

При выборе между двумя решениями при прочих равных предпочтение отдаётся решению, которое:

1. проще понять;
2. проще протестировать;
3. имеет меньше moving parts;
4. проще восстановить после ошибки;
5. соответствует текущему масштабу;
6. не создаёт vendor lock-in без необходимости;
7. не нарушает установленные domain boundaries;
8. позволяет заменить внешний provider через adapter;
9. уменьшает вероятность потери денег, заказа или данных;
10. требует меньшего количества инфраструктуры.

Сложность допустима только там, где она покупает конкретное и необходимое свойство системы.
