-- Query-tuning indexes (HW-12). Apply after schema + seed; then ANALYZE.

-- q1: buyer + date range (equality left, range right)
CREATE INDEX idx_orders_buyer_created ON orders (buyer_id, created_at DESC);

-- q2: admin pending inbox — partial (~5% rows; placed would stay Seq Scan)
CREATE INDEX idx_orders_pending_created ON orders (created_at DESC)
WHERE status = 'pending';

-- q3: case-insensitive email — UNIQUE(email) stores raw; lower() needs its own tree
CREATE INDEX idx_users_email_lower ON users (lower(email));

-- q4: FTS on generated search_vector
CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector);
