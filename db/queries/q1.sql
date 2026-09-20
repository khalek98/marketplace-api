-- Buyer order history: owner + date range (API: my orders for a period).
SELECT id, buyer_id, status, total_amount, created_at
FROM orders
WHERE buyer_id = 3000
  AND created_at >= now() - interval '90 days'
ORDER BY created_at DESC
