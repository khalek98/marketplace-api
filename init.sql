-- App role. Initial password MUST match secrets/db_password (see rotate.sh / up).
-- After `docker compose down -v`, Postgres resets to this password — reset the file too.
CREATE ROLE app_user LOGIN PASSWORD 'app-v1-password';
GRANT CONNECT ON DATABASE shop TO app_user;
