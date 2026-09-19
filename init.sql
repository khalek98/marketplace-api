-- Two app roles for alternating-user rotation (see rotate.sh).
-- After `docker compose down -v`, reset secrets/db_auth to match these passwords.
CREATE ROLE app_user_a LOGIN PASSWORD 'app-v1-password';
GRANT CONNECT ON DATABASE shop TO app_user_a;

CREATE ROLE app_user_b LOGIN PASSWORD 'app-v1-password';
GRANT CONNECT ON DATABASE shop TO app_user_b;
