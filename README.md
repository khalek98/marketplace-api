# Marketplace API

Я вже працюю full-stack і збираю продукти в проді, але в цьому курсі хочу пройти саме production-шлях: NestJS, PostgreSQL, Redis, Docker, Kubernetes, CI/CD і секрети. Головна технічна мотивація — навчитися SQL і транзакцій на Postgres після досвіду з MongoDB, і зібрати стабільний сервіс, який витримує навантаження на сучасних інструментах курсу.

README — жива архітектурна записка курсового.

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

- **NestJS modular monolith** — хочу вивчити фреймворк курсу на одному deployable сервісі з модулями каталогу, замовлень, користувачів і подій. Express 4 був лише contract adapter у HW-09; зараз рантайм — Nest (див. журнал).
- **PostgreSQL** — перша серйозна SQL-база після MongoDB; checkout + декремент stock потребують ACID-транзакції.
- **Redis** — cache каталогу і idempotency keys з TTL; не source of truth.
- **Outbox** — `order.placed` пишеться разом із замовленням; worker публікує в чергу, споживачі ідемпотентні.
- **S3** — зображення через presigned URL; у БД лише метадані.
- **Секрети через** `process.env` **+ zod** — Nest не знає про Infisical/Vault; хто завгодно може подати змінні (`.env`, Infisical, cloud SM, K8s). Креденшели Postgres — окремо у файлі `secrets/db_auth` (ротація без рестарту, alternating users).
- **Docker + Kubernetes** — Postgres локально в compose; Nest на хості через npm. Цільовий deploy — окремі процеси API й outbox worker у K8s.

## Trade-offs

- **Не мікросервіси на старті.** Спочатку один моноліт із чіткими межами модулів — простіше транзакції й деплой, ніж мережа сервісів, яку я ще не відпрацював на цьому домені.
- **Postgres замість Mongo.** Свідомий вибір для практики SQL і транзакцій, а не «бо так прийнято»; Mongo я вже знаю з роботи.
- **Без мультивалютності в HW-09.** Контракт стабільний з `USD`; UAH/USD/EUR + зовнішній курс (наприклад, НБУ або exchangerate-api) — наступні ДЗ, інакше зараз перепишу OpenAPI заради майбутнього.
- **Guest / admin / повний auth не в v1 adapter.** Ролі закладені в домен і майбутні Nest-модулі; HW-09 перевіряє контракт каталогу й checkout, а не RBAC.
- **Snapshot у** `OrderItem`**.** Дублюю назву й ціну, щоб історія замовлення не «пливла» після правок каталогу.
- **HTTP-каталог і checkout поки in-memory.** Контракт HW-09 не чіпаємо; SQL-схема домену вже в `db/schema.sql`, рядки каталогу в API — наступні ДЗ.
- **Платежі не в HW-09.** Спочатку інваріанти залишку й ідемпотентності; оплату підключу окремим модулем (див. плани нижче).

## Плани далі

- Мультивалютність: UAH, USD, EUR; курс з публічного API (НБУ / exchangerate-api — уточню при імплементації).
- Платежі: зараз mock + контракт webhook; далі **LiqPay**. Обрав його через явний sandbox (`sandbox: 1`), callback на `server_url` з підписом і наявність NestJS-friendly інтеграцій — зручно відпрацювати підтвердження оплати без живих грошей і без зміни HW-09 контракту.
- Guest mode: read-only каталог без checkout.
- Admin API: модерація, користувачі, базові звіти.
- Auth / RBAC на ресурсах (seller — лише свої товари).
- Redis cache-aside для каталогу + idempotency storage з TTL.
- Outbox worker + черга для `order.placed`.

## Запуск

Потрібен Node.js ≥ 22. `docker compose` піднімає **лише Postgres**; Nest — на хості через `npm`. Infisical для цього шляху не потрібен.

```bash
cp .env.example .env
mkdir -p secrets
cp secrets/db_auth.example secrets/db_auth

docker compose up -d --wait
npm install
npm start
```

API слухає на порту з `PORT` у `.env` (у `.env.example` — `3000`). Без обовʼязкових змінних процес не стартує (fail-fast).

- `GET /health` — uptime процесу (без рестарту росте)
- `GET /db` — пробний запит у Postgres через пул

## Configuration

Конфіг проходить fail-fast через zod (`src/config/env.schema.ts`) і `ConfigModule.validate`. Nest читає лише `process.env` — йому байдуже, хто підставив значення (`.env`, Infisical, інший secret manager).

Креденшели Postgres — **не** з env для пулу: файл `secrets/db_auth` (рядок 1 = role, рядок 2 = password; шаблон `secrets/db_auth.example`). Пул читає обидва на кожне нове зʼєднання, щоб ротувати пароль без рестарту процесу. Стартові значення мають збігатися з `init.sql` (`app_user_a` / `app-v1-password`). Тека `secrets/*` у `.gitignore`, окрім `*.example`.

Запуск API — секція [Запуск](#запуск) вище. Перевірка синхронності `.env.example` зі схемою: `npm run check:env`.

### Змінні середовища

Повний контракт — `.env.example`. Реальний `.env` у `.gitignore`.

| Змінна               | Обовʼязкова                   | Опис                                                                                                                                                                                            |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`               | так                           | HTTP-порт API                                                                                                                                                                                   |
| `DB_URL`             | так                           | host/port/db для пулу. **Джерело: сховище** (локально gitignored `.env`; optional Infisical). User/password з URL ігноруються — з `secrets/db_auth`. У git лише фейковий рядок у `.env.example` |
| `CURSOR_HMAC_SECRET` | так                           | HMAC для cursor пагінації (без дефолту в схемі — має прийти ззовні)                                                                                                                             |
| `DB_AUTH_FILE`       | ні (дефолт `secrets/db_auth`) | Шлях до файла з role + password Postgres (два рядки)                                                                                                                                            |
| `LOG_LEVEL`          | ні (`info`)                   | `debug` \| `info` \| `warn` \| `error`                                                                                                                                                          |
| `TIMEOUT_MS`         | ні (`5000`)                   | Таймаут зовнішніх викликів, мс                                                                                                                                                                  |

### Ротація пароля БД без рестарту

У БД дві ролі: `app_user_a` і `app_user_b` (`init.sql`). `rotate.sh` ротує **неактивну** роль → атомарно переписує `secrets/db_auth` на неї → `pg_terminate_backend` для **старої**. Пул на кожне нове зʼєднання читає з файла і user, і password — процес API не рестартує.

1. Запусти Postgres і API (див. вище).
2. Запамʼятай uptime: `curl -s http://localhost:3000/health`
3. У іншому терміналі: `bash rotate.sh`
4. Перевір БД: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/db` → `200` (у відповіді `current_user` зміниться на іншу роль)
5. Знову `curl -s http://localhost:3000/health` — `uptimeSec` **більший**, ніж у кроці 2 (процес не перезапускався)

Після `docker compose down -v` Postgres знову бере паролі з `init.sql`, а файл може лишитись ротованим. Поверни файл:

```bash
cp secrets/db_auth.example secrets/db_auth
# або: printf 'app_user_a\napp-v1-password\n' > secrets/db_auth
```

## Postgres (локальний стенд)

Compose піднімає **лише** Postgres. Дев-креденшели — у `docker-compose.yml` (user `admin`, база `shop`, порт хоста **21110**). Ролі застосунку (`app_user_a` / `app_user_b`) створює `init.sql` на first boot (`CONNECT` + `CREATE` на `public`).

Два шляхи bootstrap — **не змішуй** на одній чистій БД:

| Шлях                        | Навіщо                                  | Схема                                     |
| --------------------------- | --------------------------------------- | ----------------------------------------- |
| **ORM (основний з HW-13+)** | Nest, seed, demo, checkout              | `npm run migrate`                         |
| **SQL-стенд HW-12**         | EXPLAIN до/після індексів, великий seed | `db/schema.sql` → grants → seed → indexes |

### ORM bootstrap (з нуля, без Infisical)

Після `docker compose down -v` скинь `secrets/db_auth` з example. У **тій самій** сесії shell:

```bash
cp secrets/db_auth.example secrets/db_auth
docker compose up -d --wait

export SKIP_VAULT=1
export DB_HOST=127.0.0.1 DB_PORT=21110 DB_USER=app_user_a DB_PASSWORD=app-v1-password DB_NAME=shop

npm run build
npm run migrate
npm run migrate:show   # усі міграції з [X]
npm run seed
```

`npm run migrate` / `seed` / `demo:*` завжди йдуть через `scripts/with-secrets.sh`. Без `SKIP_VAULT=1` CLI лізе на Infisical (**порт 21150**). Локально для стенда без vault — завжди цей export + `DB_*` (як у [Grading](#grading)).

**Підключитись як admin:**

```bash
# інтерактивно (є запрошення shop=#)
docker compose exec db psql -U admin -d shop

# один запит / скрипт (без TTY)
docker compose exec -T db psql -U admin -d shop -c '\dt'
docker compose exec -T db psql -U admin -d shop -f - < db/smoke.sql
```

`-T` вимикає TTY: без `-c` / `-f` / редіректу `psql` мовчки чекає SQL на stdin.

### SQL-стенд HW-12 (EXPLAIN, окремо від ORM)

Не використовуй цей шлях, якщо вже накатав TypeORM-міграції на той самий volume (або зроби `down -v` і обери один шлях).

1. `docker compose up -d --wait`
2. `db/schema.sql` — таблиці
3. `db/grants.sql` — DML для `app_user_*`
4. `db/seed.sql` — ≥100k рядків
5. `db/indexes.sql` + `ANALYZE`

```bash
docker compose exec -T db psql -U admin -d shop -f - < db/schema.sql
docker compose exec -T db psql -U admin -d shop -f - < db/grants.sql
docker compose exec -T db psql -U admin -d shop -f - < db/seed.sql

for n in 1 2 3 4; do echo "=== q$n ==="; docker compose exec -T db psql -U admin -d shop -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q$n.sql)"; done

docker compose exec -T db psql -U admin -d shop -f - < db/indexes.sql
docker compose exec -T db psql -U admin -d shop -c "ANALYZE;"
```

Звіт EXPLAIN до/після + «Морфологія»: `db/OPTIMIZATIONS.md`.
`DB_URL` для Nest — зі **сховища** / локального `.env` (таблиця Configuration); не новий env-файл у git.

## TypeORM (HW-13+)

Схема в коді: `src/entities/` + `src/migrations/` + `src/data-source.ts` (`synchronize: false` — схема лише міграціями). Гроші в ORM — **integer копійки** (`price_cents` тощо), не `numeric(12,2)` зі стенду HW-12.

DataSource читає **`dist/migrations/*.js`** і **`dist/entities/**/*.js`**. Після змін у `src/` завжди `npm run build`, інакше `migrate` / `migrate:show` бачать лише старий `dist`.

```bash
# SKIP_VAULT=1 + DB_* уже в сесії (див. ORM bootstrap вище)
npm run build
npm run migrate          # up
npm run migrate:show     # очікуй [X] на всіх файлах у src/migrations
npm run migrate:revert   # down останньої
npm run seed             # ідемпотентний seed
npm run demo:nplus1
npm run report
npm run demo:race        # 200× checkout, stock=10 → 10 успіхів
npm run demo:workers     # SKIP LOCKED, ≥2 воркери
npm run demo:retry       # REPEATABLE READ + withRetry
```

Нова міграція з diff entity ↔ БД (шлях **без** `.ts`; `--` щоб npm не зʼїв аргумент):

```bash
npm run build
npm run migrate:generate -- src/migrations/AddSomething
# переглянь згенерований SQL (інколи generate чіпає зайві індекси) → npm run build → npm run migrate
```

### Seed counts (після двох `npm run seed`)

```sql
SELECT count(*) FROM users;        -- 202 (2 sellers + 200 buyers)
SELECT count(*) FROM products;     -- 6 (вкл. «Race Test» зі stock=10)
SELECT count(*) FROM wallets;      -- 200 (покупці, надлишковий баланс)
SELECT count(*) FROM orders;       -- 10
SELECT count(*) FROM order_items;  -- 20
```

### N+1 (`npm run demo:nplus1`, граф `order → items → product`)

| Стратегія                         |                     Запитів |
| --------------------------------- | --------------------------: |
| наївно (`find` + запит у циклі)   | **11** (= 1 + N при N = 10) |
| `relations` / `leftJoinAndSelect` |                       **1** |
| `relationLoadStrategy: 'query'`   |    **5** (= 1 + 2 × рівнів) |

11 росте з N; 1 і 5 — константи.

### Repository vs QueryBuilder

`find()` / `save()` — коли потрібен **граф entity** (CRUD). QueryBuilder + `getRawMany()` — коли результат = **рядки звіту** (JOIN + `SUM` + `GROUP BY`), а не `Product`/`Order`. Звіт: `src/report.ts` (виторг по товарах).

### `onDelete`

- `CASCADE` — `order_items.order` (позиції без замовлення не мають сенсу).
- `RESTRICT` — `order_items.product`, `products.seller`, `orders.buyer` (історія продажів / замовлень).

Це DB-рівень FK; окремо від ORM `cascade: true` на `Order.items` (збереження графа при `save`).

## Конкурентність

Checkout (`src/checkout/checkout.ts`) — одна транзакція: атомарний `UPDATE … RETURNING` для `stock_qty` і `wallets.balance_cents`, потім INSERT `orders` / `order_items` / `jobs`. Якщо stock або баланс недостатні — ROLLBACK усієї операції (немає orphan-замовлень).

**Чому atomic UPDATE + RETURNING, а не `SELECT … FOR UPDATE`:** умова `stock_qty >= :qty` у тому ж `UPDATE` одночасно перевіряє наявність і блокує рядок; 0 рядків у `RETURNING` = товару немає. Немає вікна між «прочитав stock у JS» і «записав нове значення». Для балансу — той самий патерн. `FOR UPDATE` теж валідний, але тут достатньо одного round-trip на ресурс.

**Retry лише `40001` / `40P01`:** під `REPEATABLE READ` / `SERIALIZABLE` Postgres може відповісти «повтори транзакцію цілком» (serialization failure / deadlock). Це не бізнес-відмова (немає товару / коштів) і не unique/check (`23505` / `23514`) — ті не зникнуть від повтору. Обгортка `src/checkout/with-retry.ts` ловить тільки ці два SQLSTATE, з backoff+jitter, і перезапускає **усю** транзакцію (включно з читаннями). Checkout (`checkout()`) теж обгорнутий у `withRetry` — на випадок deadlock (`40P01`), якщо порядок локів коли-небудь розʼїдеться; `InsufficientStock` / `InsufficientFunds` не ретраяться.

| Демо           | Команда                | Очікуваний результат (локальний прогін)                  |
| -------------- | ---------------------- | -------------------------------------------------------- |
| Гонка checkout | `npm run demo:race`    | 200 спроб → **10** успішних, stock=0, відʼємних рядків=0 |
| Воркери        | `npm run demo:workers` | ≥2 воркери, **оброблено двічі: 0**, час < N×work_ms      |
| Retry          | `npm run demo:retry`   | ≥1 лог `40001` (або `40P01`) + retry; баланс сходиться   |

`demo:race` сам скидає stock «Race Test» на 10 і піднімає баланси покупців перед `Promise.all` — можна ганяти повторно без ручного SQL. Перед першим прогоном потрібні migrate + seed.

## Grading

Свіжий клон, чиста БД, без доступу до Infisical. Дев-креденшели стенда (не секрет хмари):

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=21110 DB_USER=app_user_a DB_PASSWORD=app-v1-password DB_NAME=shop
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
```

Далі: `npm ci && npx tsc --noEmit`, `npm run build && npm run migrate && npm run migrate:show`, `npm run migrate:revert && npm run migrate`, `npm run seed && npm run seed`, `npm run demo:nplus1`, `npm run report`, `npm run demo:race`, `npm run demo:workers`, `npm run demo:retry`.

## Optional: Infisical

Infisical **не** є залежністю Nest. Тека `infisical/` — локальний lab: self-host сейф + обгортка CLI. На іншій машині можна так само підняти compose, або використати **Infisical Cloud** / інший secret manager — головне, щоб у процесі зʼявились ті самі імена змінних зі схеми.

**Що в git / що ні**

| У git                                             | Не в git                                               |
| ------------------------------------------------- | ------------------------------------------------------ |
| `infisical/docker-compose.yml`, `up.sh`, `run.sh` | `infisical/.secrets/*` (machine identity, token cache) |
| `infisical/machine-identity.env.example`          | `.env`, `secrets/db_auth`                              |

Пароль Postgres **лишається у файлі** навіть з Infisical: зміна секрету в vault дає лише новий env-знімок після рестарту процесу; ротація без рестарту на env не працює.

**Що кладемо в сейф зараз:** `CURSOR_HMAC_SECRET`.  
Несекрети (`PORT`, `DB_URL`, `LOG_LEVEL`, …) зручно тримати в локальному `.env`.

### Self-host (інший ПК / чистий clone)

Вимоги: Docker, Node ≥ 22, CLI Infisical:

```bash
npm i -g @infisical/cli
```

1. Підніми Postgres застосунку (як у основному запуску): `secrets/db_auth` + `docker compose up -d --wait`.
2. Підніми Infisical (окремий compose, порт **21150**; не плутати з Postgres Nest **21110**):

```bash
bash infisical/up.sh
# UI: http://localhost:21150
```

Перший `docker pull` образу Infisical може зайняти час (~2+ GiB).

3. У UI (після першої ініціалізації інстанса): створи проєкт → оточення `dev` → секрет з іменем точно `CURSOR_HMAC_SECRET`.
4. Створи **Machine Identity** з Universal Auth, додай її до проєкту, скопіюй `clientId` / `clientSecret`.
5. Локальні креденшели машини (не комітити):

```bash
mkdir -p infisical/.secrets
cp infisical/machine-identity.env.example infisical/.secrets/machine-identity.env
# підстав INFISICAL_URL, INFISICAL_PROJECT_ID, INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET
```

6. У `.env` залиш несекрети (`PORT`, `DB_URL`, …). Рядок `CURSOR_HMAC_SECRET` можна прибрати або залишити плейсхолдер — значення зі сховища має опинитись у `process.env` через CLI (Nest / dotenv зазвичай не перезаписують уже задані змінні оточення).
7. Старт:

```bash
npm run start:infisical
# те саме: bash infisical/run.sh
# перевірка інʼєкції без Nest: bash infisical/run.sh dev env | grep CURSOR_HMAC
```

`infisical/run.sh` читає `machine-identity.env` → (за потреби) логіниться й кешує короткий токен у `machine-token` → **прибирає** довгоживучий `CLIENT_SECRET` з env → `infisical run -- npm run start`. Nest як і раніше валідує лише zod-схему.

### Cloud Infisical

Той самий `run.sh`: у `machine-identity.env` вкажи URL хмари, `projectId` і machine identity з cloud UI. Compose з `infisical/` тоді не потрібен.

### Зупинити self-host Infisical

```bash
docker compose -f infisical/docker-compose.yml down
# том із даними сейфа: додати -v, якщо треба знести все начисто
```

Перевірки якості: `npm test`, `npm run openapi:lint`, `npm run check:env`.

## Журнал рішень

- **2026-08-29:** обрано домен Marketplace API для простоти навчання; ціль курсу — production-шлях і Postgres після MongoDB.
- **2026-08-29:** архітектура — NestJS modular monolith + PostgreSQL + Redis + outbox + S3 + Docker/K8s; секрети — через env-контракт (не зашиті в код); Express у HW-09 лише як contract adapter.
- **2026-08-29:** для ДЗ №9 — варіант Б (runtime-валідація) і contract-тести; валюта в контракті лишається `USD`.
- **2026-08-29:** у план закладено guest/admin, UAH/USD/EUR з зовнішнім курсом, платежі через LiqPay (sandbox + webhook); зараз — mock payment contract.
- **2026-09-07 (HW-11):** конфіг — zod fail-fast + `.env.example`; пароль Postgres — файл, не env, щоб ротувати без рестарту процесу.
- **2026-09-09:** Infisical як **optional** lab: Nest лишається 12-factor; у vault — `CURSOR_HMAC_SECRET`; пароль БД лишається файлом (ротація без рестарту ≠ env-знімок Infisical).
- **2026-09-19:** вікно між `ALTER ROLE` і записом файла закриваємо **alternating users** (`app_user_a` / `app_user_b` + `secrets/db_auth` з role і password). Файл лише з паролем не дає змінити роль без рестарту.
- **2026-09-19 (HW-12):** `products.search_vector` — генерована колонка в `db/schema.sql`, не в індексах. Інакше EXPLAIN «до» не бачить tsvector, і немає з чим порівнювати «після». GIN під пошук житиме в `db/indexes.sql`. Гроші — `numeric`, час — `timestamptz`.
- **2026-09-21 (HW-13):** data layer на TypeORM: entities + міграції (`synchronize: false`), гроші в копійках (`integer`), схема для ORM з `npm run migrate`. `db/schema.sql` лишається стендом HW-12.
- **2026-09-29:** README: розділено ORM bootstrap (`SKIP_VAULT` + migrate) і SQL-стенд HW-12; виправлено `psql -T` без `-c`/`-f`; зафіксовано, що TypeORM читає лише `dist/**/*.js`.
- **2026-09-29 (HW-14):** transactional checkout (atomic UPDATE+RETURNING), таблиця `jobs` + `FOR UPDATE SKIP LOCKED`, retry лише `40001`/`40P01`; демо `demo:race|workers|retry`. Stock захищаємо атомарним UPDATE, не підняттям isolation до SERIALIZABLE.
- Наступні зміни архітектури додаються сюди з причиною та наслідками, а не приховуються переписуванням історії.
