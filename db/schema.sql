-- Marketplace domain schema (HW-12, part 1).
-- Apply on a clean DB: psql -f db/schema.sql
-- No query-tuning indexes here — those belong in db/indexes.sql (later).
-- search_vector lives in schema so EXPLAIN "before indexes" can already see the column.

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text        NOT NULL,
  role       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_nonempty CHECK (length(trim(email)) > 0),
  CONSTRAINT users_role_check CHECK (role IN ('buyer', 'seller')),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE products (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id   bigint       NOT NULL REFERENCES users (id),
  name        text         NOT NULL,
  description text         NOT NULL,
  price       numeric(12, 2) NOT NULL,
  stock_qty   integer      NOT NULL,
  status      text         NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || description)) STORED,
  CONSTRAINT products_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT products_description_nonempty CHECK (length(trim(description)) > 0),
  CONSTRAINT products_price_nonnegative CHECK (price >= 0),
  CONSTRAINT products_stock_nonnegative CHECK (stock_qty >= 0),
  CONSTRAINT products_status_check CHECK (status IN ('active', 'archived'))
);

CREATE TABLE orders (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buyer_id     bigint         NOT NULL REFERENCES users (id),
  status       text           NOT NULL,
  currency     text           NOT NULL DEFAULT 'USD',
  total_amount numeric(12, 2) NOT NULL,
  created_at   timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT orders_status_check CHECK (status IN ('pending', 'placed', 'cancelled')),
  CONSTRAINT orders_currency_check CHECK (currency IN ('USD', 'EUR', 'UAH')),
  CONSTRAINT orders_total_nonnegative CHECK (total_amount >= 0)
);

CREATE TABLE order_items (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         bigint         NOT NULL REFERENCES orders (id),
  product_id       bigint         NOT NULL REFERENCES products (id),
  product_name     text           NOT NULL,
  quantity         integer        NOT NULL,
  unit_price       numeric(12, 2) NOT NULL,
  line_total       numeric(12, 2) NOT NULL,
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_items_unit_price_nonnegative CHECK (unit_price >= 0),
  CONSTRAINT order_items_line_total_nonnegative CHECK (line_total >= 0)
);
