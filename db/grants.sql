-- db/grants.sql (run after schema.sql)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users, products, orders, order_items, reviews, db_calls TO app_user_a, app_user_b;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user_a, app_user_b;
GRANT EXECUTE ON FUNCTION product_projection(bigint) TO app_user_a, app_user_b;