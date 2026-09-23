-- Tiny local playground (NOT the graded seed).
-- After schema.sql: psql -f db/smoke.sql
-- Full ≥100k seed comes later in db/seed.sql.

INSERT INTO users (email, role) VALUES
  ('BuyerOne@Example.COM', 'buyer'),
  ('seller_aurora@shop.ua', 'seller'),
  ('seller_northstar@shop.ua', 'seller');

INSERT INTO products (seller_id, name, description, price_cents, stock_qty, status)
SELECT s.id, p.name, p.description, p.price_cents, p.stock_qty, p.status
FROM (VALUES
  ('seller_aurora@shop.ua',
   'Шкіряні кросівки Nike',
   'Зручні шкіряні кросівки для міста. Доставка по Україні.',
   349900, 12, 'active'),
  ('seller_aurora@shop.ua',
   'Пара кросівок Adidas',
   'Легкі кросівки для бігу. Колір чорний.',
   279900, 8, 'active'),
  ('seller_northstar@shop.ua',
   'Шкіряна сумка ручної роботи',
   'Жіноча сумка зі шкіри. Підходить на щодень.',
   189900, 5, 'active'),
  ('seller_northstar@shop.ua',
   'Ноутбук Lenovo IdeaPad',
   'Офісний ноутбук 15 дюймів. Гарантія 12 місяців.',
   2499900, 3, 'active'),
  ('seller_aurora@shop.ua',
   'USB кабель (архів)',
   'Старий лістинг кабелю USB-C.',
   19900, 0, 'archived')
) AS p(seller_email, name, description, price_cents, stock_qty, status)
JOIN users s ON s.email = p.seller_email;

INSERT INTO orders (buyer_id, status, currency, total_amount_cents, created_at)
SELECT u.id, o.status, 'UAH', o.total_amount_cents, o.created_at
FROM (VALUES
  ('BuyerOne@Example.COM', 'pending', 349900, now() - interval '2 days'),
  ('BuyerOne@Example.COM', 'placed', 279900, now() - interval '10 days'),
  ('BuyerOne@Example.COM', 'cancelled', 19900, now() - interval '40 days')
) AS o(buyer_email, status, total_amount_cents, created_at)
JOIN users u ON u.email = o.buyer_email;

INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents, line_total_cents)
SELECT o.id, p.id, p.name, 1, p.price_cents, p.price_cents
FROM orders o
JOIN users u ON u.id = o.buyer_id
JOIN products p ON p.name = 'Шкіряні кросівки Nike'
WHERE u.email = 'BuyerOne@Example.COM' AND o.status = 'pending'
LIMIT 1;
