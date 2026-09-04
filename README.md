# Marketplace API

Я вже працюю full-stack і збираю продукти в проді, але в цьому курсі хочу пройти саме production-шлях: NestJS, PostgreSQL, Redis, Docker, Kubernetes, CI/CD і секрети. Головна технічна мотивація — навчитися SQL і транзакцій на Postgres після досвіду з MongoDB, і зібрати стабільний сервіс, який витримує навантаження на сучасних інструментах курсу.

README — жива архітектурна записка курсового. Контракт і код зростатимуть у наступних ДЗ; HW-09 фіксує OpenAPI і тонкий runtime-adapter.

## Що це за сервіс

Backend маркетплейсу: каталог товарів продавців і оформлення замовлень покупцями. Одна система, де checkout списує залишок, а продавець дізнається про нове замовлення через подію.

**Ролі зараз (v1):** `buyer`, `seller`.

**Заплановані ролі (не в HW-09):** `guest` — перегляд каталогу без реєстрації й без checkout; `admin` — модерація контенту, користувачі, базові звіти.

User stories:

1. Як покупець, я хочу гортати каталог із пагінацією й відкривати картку товару, щоб вирішити, що купити.
2. Як покупець, я хочу оформити замовлення один раз навіть після повторного запиту, щоб не списати залишок двічі.
3. Як продавець, я хочу керувати своїми товарами, цінами, залишками й зображеннями, щоб каталог був актуальним.
4. Як продавець, я хочу отримувати `order.placed`, щоб почати обробку замовлення.
5. Як гість _(план)_, я хочу дивитися каталог без акаунта, але без оформлення.
6. Як адмін _(план, не HW-09)_, я хочу модерувати товари й бачити базову аналітику.

## Домен

- `User` — покупець або продавець; надалі також guest/admin на рівні доступу, не окремі таблиці «на кожну роль».
- `Product` — товар продавця; ціна в цілих мінорних одиницях валюти, `stock_qty` — конкурентний ресурс.
- `ProductImage` — метадані зображення; файл — у S3 через presigned URL.
- `Order` / `OrderItem` — замовлення зі статусом і snapshot назви/ціни/кількості в позиціях.
- `OutboxEvent` — подія в тій самій транзакції, що й зміна домену, щоб seller гарантовано дізнався про замовлення.
- _(план)_ `Currency` / `ExchangeRate` — UAH, USD, EUR і курс із зовнішнього API; у HW-09 контракт лишається з `USD`.

Зв’язки: `User (seller) 1—N Product`, `Product 1—N ProductImage`, `User (buyer) 1—N Order`, `Order 1—N OrderItem`, `Product 1—N OrderItem`, `Order 1—N OutboxEvent`.

### Перевірка придатності домену

- [x] Дві ролі з різними правами вже зараз (`buyer` / `seller`); guest і admin закладені в план RBAC.
- [x] Конкурентний ресурс: `Product.stock_qty` — без транзакції легко отримати овербукінг.
- [x] Незворотна операція: checkout створює замовлення і списує залишок атомарно.
- [x] Подія сповіщення: `order.placed` через outbox, щоб seller не залежав від синхронного HTTP.
- [x] Файли: зображення товару (`ProductImage` + S3).
- [x] Часті читання каталогу — природний кандидат на Redis cache-aside.
- [x] Важкий запит: замовлення з позиціями й товарами (індекси / N+1 у наступних ДЗ).

## Архітектурні рішення

- **NestJS modular monolith** — хочу вивчити фреймворк курсу на одному deployable сервісі з модулями каталогу, замовлень, користувачів і подій. Express 4 у HW-09 — лише тонкий contract adapter (`src/app.js`), не фінальний стек.
- **PostgreSQL** — перша серйозна SQL-база після MongoDB; checkout + декремент stock потребують ACID-транзакції.
- **Redis** — cache каталогу і idempotency keys з TTL; не source of truth.
- **Outbox** — `order.placed` пишеться разом із замовленням; worker публікує в чергу, споживачі ідемпотентні.
- **S3** — зображення через presigned URL; у БД лише метадані.
- **Infisical** — секрети за курсом, без `.env` у git і з fail-fast валідацією конфігу.
- **Docker + Kubernetes** — локальна розробка в контейнерах; цільовий deploy — окремі процеси API й outbox worker у K8s.

## Trade-offs

- **Не мікросервіси на старті.** Спочатку один моноліт із чіткими межами модулів — простіше транзакції й деплой, ніж мережа сервісів, яку я ще не відпрацював на цьому домені.
- **Postgres замість Mongo.** Свідомий вибір для практики SQL і транзакцій, а не «бо так прийнято»; Mongo я вже знаю з роботи.
- **Без мультивалютності в HW-09.** Контракт стабільний з `USD`; UAH/USD/EUR + зовнішній курс (наприклад, НБУ або exchangerate-api) — наступні ДЗ, інакше зараз перепишу OpenAPI заради майбутнього.
- **Guest / admin / повний auth не в v1 adapter.** Ролі закладені в домен і майбутні Nest-модулі; HW-09 перевіряє контракт каталогу й checkout, а не RBAC.
- **Snapshot у** `OrderItem`**.** Дублюю назву й ціну, щоб історія замовлення не «пливла» після правок каталогу.
- **In-memory store у HW-09.** Тимчасово, щоб здати варіант Б; Postgres і Redis з’являться в наступних ДЗ.
- **Платежі не в HW-09.** Спочатку інваріанти залишку й ідемпотентності; оплату підключу окремим модулем (див. плани нижче).

## Плани після HW-09

- Мультивалютність: UAH, USD, EUR; курс з публічного API (НБУ / exchangerate-api — уточню при імплементації).
- Платежі: зараз mock + контракт webhook; далі **LiqPay**. Обрав його через явний sandbox (`sandbox: 1`), callback на `server_url` з підписом і наявність NestJS-friendly інтеграцій — зручно відпрацювати підтвердження оплати без живих грошей і без зміни HW-09 контракту.
- Guest mode: read-only каталог без checkout.
- Admin API: модерація, користувачі, базові звіти.
- Auth / RBAC на ресурсах (seller — лише свої товари).
- Redis cache-aside для каталогу + idempotency storage з TTL.
- Outbox worker + черга для `order.placed`.

## ДЗ №9: контракт

Обрано **варіант Б — runtime-валідація на кордоні**. OpenAPI — джерело правди; мінімальний Express 4 adapter перевіряє запити й відповіді. Згодом цю межу збереже NestJS.

### Запуск і перевірка

Потрібен Node.js 20 або новіший. Встановіть зафіксовані залежності та запустіть adapter:

```bash
npm install
npm start
```

За замовчуванням API доступний на `http://localhost:3000`; порт можна змінити через `PORT`. В іншому терміналі перевірте OpenAPI-контракт. Bundle `spec.json` є generated artifact і не комітиться:

```bash
npm run openapi:lint
npm run openapi:bundle

node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];\
 const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));\
 const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\
 console.log('операцій:',ops.length,'· ресурсів:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);\
 console.log('Idempotency-Key: required =',idem?.required,'· опис, символів =',(idem?.description??'').trim().length)"
```

Автоматичні contract-тести (`test/**/*.test.js`, без окремого процесу — app слухає на випадковому порту):

```bash
npm test
```

Форматування коду — Prettier через `npm run format`.

HTTP-перевірки варіанта Б (curl):

```bash
# Спека вимагає Idempotency-Key: очікується 400 problem+json.
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"product_id":"product_keyboard","quantity":1}]}'

# Порожній items відхиляється request validator: очікується 400 problem+json.
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: empty-items-demo' \
  -d '{"items":[]}'

# Перша спроба створює замовлення: очікується 201 та Location.
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-demo-1' \
  -d '{"items":[{"product_id":"product_keyboard","quantity":1}]}'

# Той самий ключ і тіло повертають те саме замовлення:
# очікується 201 та Idempotency-Replay: true.
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-demo-1' \
  -d '{"items":[{"product_id":"product_keyboard","quantity":1}]}'

# Той самий ключ з іншим тілом: очікується 422 problem+json.
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-demo-1' \
  -d '{"items":[{"product_id":"product_mouse","quantity":1}]}'
```

Дані, залишки та idempotency records поки зберігаються лише в памʼяті процесу й очищаються після перезапуску. У наступних ДЗ доменні дані перейдуть у PostgreSQL, а idempotency storage — у Redis із TTL.

## Журнал рішень

- **2026-08-29:** обрано домен Marketplace API для простоти навчання; ціль курсу — production-шлях і Postgres після MongoDB.
- **2026-08-29:** архітектура — NestJS modular monolith + PostgreSQL + Redis + outbox + S3 + Infisical + Docker/K8s; Express у HW-09 лише як contract adapter.
- **2026-08-29:** для ДЗ №9 — варіант Б (runtime-валідація) і contract-тести; валюта в контракті лишається `USD`.
- **2026-08-29:** у план закладено guest/admin, UAH/USD/EUR з зовнішнім курсом, платежі через LiqPay (sandbox + webhook); зараз — mock payment contract.
- Наступні зміни архітектури додаються сюди з причиною та наслідками, а не приховуються переписуванням історії.
