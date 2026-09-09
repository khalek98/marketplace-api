# Marketplace API

Я вже працюю full-stack і збираю продукти в проді, але в цьому курсі хочу пройти саме production-шлях: NestJS, PostgreSQL, Redis, Docker, Kubernetes, CI/CD і секрети. Головна технічна мотивація — навчитися SQL і транзакцій на Postgres після досвіду з MongoDB, і зібрати стабільний сервіс, який витримує навантаження на сучасних інструментах курсу.

README — жива архітектурна записка курсового. Контракт OpenAPI з HW-09 лишається джерелом правди; рантайм зараз — NestJS (див. журнал рішень).

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
- **Секрети через `process.env` + zod** — Nest не знає про Infisical/Vault; хто завгодно може подати змінні (`.env`, Infisical, cloud SM, K8s). Пароль Postgres — окремо у файлі (ротація без рестарту).
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

## Configuration

Конфіг проходить fail-fast через zod (`src/config/env.schema.ts`) і `ConfigModule.validate`. Nest читає лише `process.env` — йому байдуже, хто підставив значення (`.env`, Infisical, інший secret manager).

Пароль Postgres — **не** з env для пулу: файл `secrets/db_password` + `password: () => readFile(...)`, щоб ротувати без рестарту процесу (AC HW-11).

### Змінні середовища

Повний контракт — `.env.example` (звірка: `npm run check:env`). Реальний `.env` у `.gitignore`.

| Змінна               | Обовʼязкова                       | Опис                                                                                      |
| -------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `PORT`               | так                               | HTTP-порт API                                                                             |
| `DB_URL`             | так                               | `postgres://…` для host/port/db/**user**. Пароль з URL **ігнорується** — береться з файлу |
| `CURSOR_HMAC_SECRET` | так                               | HMAC для cursor пагінації (без дефолту в схемі — має прийти ззовні)                       |
| `DB_PASSWORD_FILE`   | ні (дефолт `secrets/db_password`) | Шлях до файлу з паролем Postgres                                                          |
| `LOG_LEVEL`          | ні (`info`)                       | `debug` \| `info` \| `warn` \| `error`                                                    |
| `TIMEOUT_MS`         | ні (`5000`)                       | Таймаут зовнішніх викликів, мс                                                            |

Пароль БД: локальний файл `secrets/db_password` (теж у `.gitignore`). Стартове значення має збігатися з `init.sql` (`app-v1-password`).

### Запуск (основний шлях — без Infisical)

Потрібен Node.js ≥ 22.

```bash
cp .env.example .env
mkdir -p secrets
printf 'app-v1-password' > secrets/db_password

docker compose up -d --wait
npm install
npm start
```

API слухає на порту з `PORT` у `.env` (у `.env.example` — `3000`). Без обовʼязкових змінних процес не стартує (fail-fast).

- `GET /health` — uptime процесу (без рестарту росте)
- `GET /db` — пробний запит у Postgres через пул

Перевірка синхронності `.env.example` зі схемою: `npm run check:env`.

### Ротація пароля БД без рестарту

Порядок у `rotate.sh`: `ALTER ROLE` → оновити файл → `pg_terminate_backend`. Пул читає пароль з файлу на **кожне нове** зʼєднання (`password: async () => readFile(...)`).

1. Запусти Postgres і API (див. вище).
2. Запамʼятай uptime: `curl -s http://localhost:3000/health`
3. У іншому терміналі: `bash rotate.sh`
4. Перевір БД: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/db` → `200`
5. Знову `curl -s http://localhost:3000/health` — `uptimeSec` **більший**, ніж у кроці 2 (процес не перезапускався)

Після `docker compose down -v` Postgres знову бере пароль з `init.sql`, а файл може лишитись ротованим. Поверни файл:

```bash
printf 'app-v1-password' > secrets/db_password
```

### Optional: Infisical

Infisical **не** є залежністю Nest. Тека `infisical/` — локальний lab: self-host сейф + обгортка CLI. На іншій машині можна так само підняти compose, або використати **Infisical Cloud** / інший secret manager — головне, щоб у процесі зʼявились ті самі імена змінних зі схеми.

**Що в git / що ні**

| У git                                             | Не в git                                               |
| ------------------------------------------------- | ------------------------------------------------------ |
| `infisical/docker-compose.yml`, `up.sh`, `run.sh` | `infisical/.secrets/*` (machine identity, token cache) |
| `infisical/machine-identity.env.example`          | `.env`, `secrets/db_password`                          |

Пароль Postgres **лишається у файлі** навіть з Infisical: зміна секрету в vault дає лише новий env-знімок після рестарту процесу; ротація без рестарту на env не працює.

**Що кладемо в сейф зараз:** `CURSOR_HMAC_SECRET`.  
Несекрети (`PORT`, `DB_URL`, `LOG_LEVEL`, …) зручно тримати в локальному `.env`.

#### Self-host (інший ПК / чистий clone)

Вимоги: Docker, Node ≥ 22, CLI Infisical:

```bash
npm i -g @infisical/cli
```

1. Підніми Postgres застосунку (як у основному запуску): `secrets/db_password` + `docker compose up -d --wait`.
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

#### Cloud Infisical

Той самий `run.sh`: у `machine-identity.env` вкажи URL хмари, `projectId` і machine identity з cloud UI. Compose з `infisical/` тоді не потрібен.

#### Зупинити self-host Infisical

```bash
docker compose -f infisical/docker-compose.yml down
# том із даними сейфа: додати -v, якщо треба знести все начисто
```

Перевірки якості: `npm test`, `npm run openapi:lint`, `npm run check:env`. Доменний каталог і замовлення поки in-memory (Postgres у HW-11 — для пулу й ротації; дані домену — з L12).

## Журнал рішень

- **2026-08-29:** обрано домен Marketplace API для простоти навчання; ціль курсу — production-шлях і Postgres після MongoDB.
- **2026-08-29:** архітектура — NestJS modular monolith + PostgreSQL + Redis + outbox + S3 + Docker/K8s; секрети — через env-контракт (не зашиті в код); Express у HW-09 лише як contract adapter.
- **2026-08-29:** для ДЗ №9 — варіант Б (runtime-валідація) і contract-тести; валюта в контракті лишається `USD`.
- **2026-08-29:** у план закладено guest/admin, UAH/USD/EUR з зовнішнім курсом, платежі через LiqPay (sandbox + webhook); зараз — mock payment contract.
- **2026-09-07 (HW-11):** fail-fast env (zod + ConfigModule), `.env.example`/`check:env`, секрети поза git/образом, ротація `secrets/db_password` без рестарту (`rotate.sh` + `pg.Pool` password function).
- **2026-09-09:** Infisical як **optional** lab (`infisical/` + `npm run start:infisical`): Nest лишається 12-factor; у vault — `CURSOR_HMAC_SECRET`; пароль БД лишається файлом (AC5 ≠ env-знімок Infisical).
- Наступні зміни архітектури додаються сюди з причиною та наслідками, а не приховуються переписуванням історії.
