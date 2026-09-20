-- Admin inbox: fresh pending orders (skew ~5% → later partial index).
SELECT id, buyer_id, total_amount, created_at
FROM orders
WHERE status = 'pending'
  AND created_at >= now() - interval '30 days'
ORDER BY created_at DESC
LIMIT 20
