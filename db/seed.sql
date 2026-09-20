TRUNCATE TABLE order_items, orders, products, users RESTART IDENTITY;

-- Buyers ids 1..5000, sellers 5001..5500 (FK math below depends on this order).
INSERT INTO users (email, role)
SELECT
  'Buyer' || gs || '@Example.COM',
  'buyer'
FROM generate_series(1, 5000) AS gs;

INSERT INTO users (email, role)
SELECT
  'seller_' || gs || '@shop.ua',
  'seller'
FROM generate_series(1, 500) AS gs;

-- 100k products, Ukrainian text, ~1.5% «шкіряні»+«кросівки», status ~95/5.
INSERT INTO products (seller_id, name, description, price, stock_qty, status, created_at, updated_at)
SELECT
  5000 + 1 + (x.n % 500),
  CASE
    WHEN x.r_fts < 0.015 THEN
      (ARRAY[
        'Шкіряні кросівки Nike',
        'Шкіряні кросівки Adidas',
        'Шкіряні кросівки для міста'
      ])[1 + (x.n % 3)]
    ELSE
      (ARRAY[
        'Ноутбук Lenovo IdeaPad',
        'USB кабель Type-C',
        'Бездротові навушники Sony',
        'Рюкзак для ноутбука',
        'Механічна клавіатура',
        'Монітор 27 дюймів',
        'Павербанк 20000 мАг',
        'Чохол для телефону',
        'Настільна лампа LED',
        'Фітнес-браслет Xiaomi',
        'Кавоварка крапельна',
        'Електрочайник з металу',
        'Сумка жіноча текстильна',
        'Зимова куртка чоловіча',
        'Дитячий конструктор',
        'Набір посуду кераміка',
        'Книга з програмування',
        'Велосипедний шолом',
        'Йога-мат товстий',
        'Термос 1 літр'
      ])[1 + (x.n % 20)]
  END,
  CASE
    WHEN x.r_fts < 0.015 THEN
      'Зручні шкіряні кросівки. Доставка по Україні. Артикул ' || x.n
    ELSE
      (ARRAY[
        'Офісний ноутбук 15 дюймів. Гарантія 12 місяців.',
        'Швидка зарядка. Довжина кабелю 1 метр.',
        'Чистий звук без дротів. До 30 годин роботи.',
        'Місткий відділ під ноутбук 15 дюймів.',
        'Тиха клавіатура для роботи вдома.',
        'IPS-матриця Full HD. Підходить для офісу.',
        'Швидка зарядка телефону і планшета.',
        'Силіконовий чохол. Захист від ударів.',
        'Мʼяке світло для читання ввечері.',
        'Трекер сну і пульсу. Водонепровідний.',
        'Смачна кава вдома за 5 хвилин.',
        'Швидке кипʼятіння. Автовимкнення.',
        'Легка сумка на щодень. Кілька відділів.',
        'Тепла куртка на зиму. Водовідштовхувальна.',
        'Яскраві деталі. Для дітей від 6 років.',
        'Набір із 6 тарілок. Міцна кераміка.',
        'Практичний посібник українською.',
        'Легкий шолом з вентиляцією.',
        'Нековзкий килимок для йоги.',
        'Тримає тепло до 12 годин.'
      ])[1 + (x.n % 20)]
  END,
  round((10 + random() * 4990)::numeric, 2),
  (random() * 200)::int,
  CASE WHEN x.r_status < 0.95 THEN 'active' ELSE 'archived' END,
  now() - (random() * interval '730 days'),
  now() - (random() * interval '30 days')
FROM (
  SELECT
    gs AS n,
    random() AS r_fts,
    random() AS r_status
  FROM generate_series(1, 100000) AS gs
) AS x;

-- 100k orders, status skew ~93/5/2 (placed/pending/cancelled).
INSERT INTO orders (buyer_id, status, currency, total_amount, created_at)
SELECT
  1 + (x.n % 5000),
  CASE
    WHEN x.r < 0.93 THEN 'placed'
    WHEN x.r < 0.98 THEN 'pending'
    ELSE 'cancelled'
  END,
  (ARRAY['USD', 'EUR', 'UAH'])[1 + (x.n % 3)],
  round((random() * 5000)::numeric, 2),
  now() - (random() * interval '730 days')
FROM (
  SELECT
    gs AS n,
    random() AS r
  FROM generate_series(1, 100000) AS gs
) AS x;

-- One line item per order (name/price snapshot at order time).
INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, line_total)
SELECT
  o.id,
  p.id,
  p.name,
  q.qty,
  p.price,
  round(p.price * q.qty, 2)
FROM orders o
CROSS JOIN LATERAL (SELECT 1 + ((o.id * 17) % 3)::int AS qty) AS q
JOIN products p ON p.id = 1 + ((o.id * 31) % 100000);

VACUUM (ANALYZE);

SELECT 'users' AS tbl, count(*) FROM users
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'order_items', count(*) FROM order_items
ORDER BY 1;

SELECT status, count(*) FROM orders GROUP BY status ORDER BY count(*) DESC;
SELECT status, count(*) FROM products GROUP BY status ORDER BY count(*) DESC;
