# OPTIMIZATIONS (HW-12)

`EXPLAIN (ANALYZE, BUFFERS)` на локальній базі: schema + seed (≥100k), потім drop indexes → «до», apply `db/indexes.sql` + `ANALYZE` → «після». q4 — третій прогін (теплий GIN).

---

## q1 — buyer + період

**Індекс:** `idx_orders_buyer_created (buyer_id, created_at DESC)`

**До:** Seq Scan по всій `orders` (~100k рядків), ~938 buffers, ~7 ms.

```
Sort  (cost=2935.01..2935.02 rows=2 width=37) (actual time=7.246..7.248 rows=4 loops=1)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=938
  ->  Seq Scan on orders  (cost=0.00..2935.00 rows=2 width=37) (actual time=0.214..7.213 rows=4 loops=1)
        Filter: ((buyer_id = 3000) AND (created_at >= (now() - '90 days'::interval)))
        Rows Removed by Filter: 99996
        Buffers: shared hit=935
Planning Time: 0.855 ms
Execution Time: 7.298 ms
```

**Після:** `Bitmap Index Scan on idx_orders_buyer_created` → Bitmap Heap Scan; buffers ~10, ~0.2 ms.

```
Sort  (cost=12.22..12.22 rows=2 width=37) (actual time=0.123..0.124 rows=4 loops=1)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=10 read=3
  ->  Bitmap Heap Scan on orders  (cost=4.44..12.21 rows=2 width=37) (actual time=0.069..0.085 rows=4 loops=1)
        Recheck Cond: ((buyer_id = 3000) AND (created_at >= (now() - '90 days'::interval)))
        Heap Blocks: exact=4
        Buffers: shared hit=7 read=3
        ->  Bitmap Index Scan on idx_orders_buyer_created  (cost=0.00..4.44 rows=2 width=0) (actual time=0.052..0.052 rows=4 loops=1)
              Index Cond: ((buyer_id = 3000) AND (created_at >= (now() - '90 days'::interval)))
              Buffers: shared hit=3 read=3
Planning Time: 1.380 ms
Execution Time: 0.222 ms
```

Чому: equality зліва + range справа — композитний B-tree; Seq Scan зник, читаємо лише релевантні сторінки.

---

## q2 — pending inbox

**Індекс:** `idx_orders_pending_created (created_at DESC) WHERE status = 'pending'` (partial)

**До:** Seq Scan + Filter `status = pending`, ~938 buffers, ~10 ms.

```
Limit  (cost=2940.38..2940.43 rows=20 width=30) (actual time=10.003..10.007 rows=20 loops=1)
  Buffers: shared hit=938
  ->  Sort  (cost=2940.38..2940.88 rows=202 width=30) (actual time=10.001..10.003 rows=20 loops=1)
        Sort Key: created_at DESC
        Sort Method: top-N heapsort  Memory: 27kB
        Buffers: shared hit=938
        ->  Seq Scan on orders  (cost=0.00..2935.00 rows=202 width=30) (actual time=0.048..9.900 rows=183 loops=1)
              Filter: ((status = 'pending'::text) AND (created_at >= (now() - '30 days'::interval)))
              Rows Removed by Filter: 99817
              Buffers: shared hit=935
Planning Time: 1.259 ms
Execution Time: 10.081 ms
```

**Після:** `Index Scan using idx_orders_pending_created`; ~22 buffers, ~0.16 ms.

```
Limit  (cost=0.29..72.98 rows=20 width=30) (actual time=0.045..0.103 rows=20 loops=1)
  Buffers: shared hit=20 read=2
  ->  Index Scan using idx_orders_pending_created on orders  (cost=0.29..759.87 rows=209 width=30) (actual time=0.044..0.100 rows=20 loops=1)
        Index Cond: (created_at >= (now() - '30 days'::interval))
        Buffers: shared hit=20 read=2
Planning Time: 1.122 ms
Execution Time: 0.164 ms
```

Чому: partial тримає лише ~5% `pending`; `status` уже в предикаті індексу, у плані лишився range по `created_at` + LIMIT.

---

## q3 — lower(email)

**Індекс:** `idx_users_email_lower ON users (lower(email))` (expression)

**До:** Seq Scan + `lower(email) = …`, ~52 buffers, ~3.4 ms.

```
Seq Scan on users  (cost=0.00..134.50 rows=28 width=43) (actual time=1.867..3.329 rows=1 loops=1)
  Filter: (lower(email) = 'buyer3000@example.com'::text)
  Rows Removed by Filter: 5499
  Buffers: shared hit=52
Planning Time: 0.784 ms
Execution Time: 3.394 ms
```

**Після:** `Index Scan using idx_users_email_lower`; ~3 buffers, ~0.11 ms.

```
Index Scan using idx_users_email_lower on users  (cost=0.28..8.30 rows=1 width=43) (actual time=0.032..0.033 rows=1 loops=1)
  Index Cond: (lower(email) = 'buyer3000@example.com'::text)
  Buffers: shared hit=1 read=2
Planning Time: 0.919 ms
Execution Time: 0.111 ms
```

Чому: UNIQUE(email) індексує сирий рядок; `lower()` у WHERE потребує expression-індексу з тим самим виразом.

---

## q4 — FTS каталог

**Індекс:** `idx_products_search_vector ON products USING GIN (search_vector)`

**До:** Seq Scan по `products` (~100k), ~4360 buffers, ~27 ms.

```
Limit  (cost=5604.64..5604.69 rows=20 width=48) (actual time=26.737..26.740 rows=20 loops=1)
  Buffers: shared hit=4360
  ->  Sort  (cost=5604.64..5604.71 rows=25 width=48) (actual time=26.735..26.737 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 28kB
        Buffers: shared hit=4360
        ->  Seq Scan on products  (cost=0.00..5604.06 rows=25 width=48) (actual time=0.024..26.239 rows=1558 loops=1)
              Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Rows Removed by Filter: 98442
              Buffers: shared hit=4354
Planning Time: 1.238 ms
Execution Time: 26.783 ms
```

**Після** (3-й прогін, теплий GIN): `Bitmap Index Scan on idx_products_search_vector`; ~1363 buffers, ~3.8 ms.

```
Limit  (cost=108.39..108.44 rows=20 width=48) (actual time=3.706..3.709 rows=20 loops=1)
  Buffers: shared hit=1363
  ->  Sort  (cost=108.39..108.46 rows=25 width=48) (actual time=3.705..3.706 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 28kB
        Buffers: shared hit=1363
        ->  Bitmap Heap Scan on products  (cost=13.12..107.81 rows=25 width=48) (actual time=0.565..3.426 rows=1558 loops=1)
              Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Heap Blocks: exact=1350
              Buffers: shared hit=1357
              ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..13.11 rows=25 width=0) (actual time=0.410..0.410 rows=1558 loops=1)
                    Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                    Buffers: shared hit=7
Planning Time: 1.037 ms
Execution Time: 3.794 ms
```

Чому: GIN по `tsvector` знаходить постинг-листи токенів замість повного скану таблиці; Seq Scan зник. Heap Blocks лишаються (ранг/сортування по знайдених рядках) — нормально для Bitmap Heap.

---

## Морфологія

Конфіг: `plainto_tsquery('simple', …)` / `to_tsvector('simple', …)`.

| форма | `count(*)` |
|-------|------------|
| кросівки | 1558 |
| кросівок | 0 |

`simple` не стеммить українську: токен = поверхнева форма. «кросівки» ≠ «кросівок» у словнику, тому інший відмінок дає 0. У стоковому Postgres немає uk stemming (`pg_ts_config` / `\dF` — english/russian/simple…, без української). Підміна на `russian` — самообман для UA-текстів.
