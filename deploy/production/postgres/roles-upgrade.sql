-- Backend Phase 13 — move an EXISTING database to least-privilege roles.
-- Idempotent. Run as the superuser over the local socket, with passwords
-- passed as psql variables from the secret files (runbook 09):
--
--   psql -v ON_ERROR_STOP=1 -d caspira_crm \
--     -v app_pw="$(cat /run/secrets/db_password)" -v owner_pw="$(cat /run/secrets/db_migrator_password)" \
--     -v ro_pw="$(cat /run/secrets/db_readonly_password)" -v mon_pw="$(cat /run/secrets/db_monitor_password)" \
--     -v old_owner=caspira -f /etc/caspira/roles-upgrade.sql
--
-- Take a verified backup first. It reassigns object ownership from the old
-- single application user to caspira_owner and grants DML to caspira_app.
\set QUIET on
SELECT format('CREATE ROLE %I LOGIN', r) FROM unnest(ARRAY['caspira_owner','caspira_app','caspira_readonly','caspira_monitor']) r
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec
ALTER ROLE caspira_owner PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE caspira_app PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 60;
ALTER ROLE caspira_readonly PASSWORD :'ro_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 10;
ALTER ROLE caspira_monitor PASSWORD :'mon_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 5;
GRANT pg_monitor TO caspira_monitor;
ALTER ROLE caspira_app SET statement_timeout = '60s';
ALTER ROLE caspira_app SET lock_timeout = '10s';
ALTER ROLE caspira_app SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE caspira_readonly SET statement_timeout = '120s';
ALTER ROLE caspira_readonly SET default_transaction_read_only = on;
ALTER ROLE caspira_owner SET lock_timeout = '10s';

REASSIGN OWNED BY :"old_owner" TO caspira_owner;
ALTER SCHEMA public OWNER TO caspira_owner;
ALTER SCHEMA analytics OWNER TO caspira_owner;
REVOKE ALL ON DATABASE caspira_crm FROM PUBLIC;
-- The migration role creates schemas and trusted extensions (e.g. pg_trgm) in migrations.
GRANT CONNECT, TEMPORARY, CREATE ON DATABASE caspira_crm TO caspira_owner;
GRANT CONNECT, TEMPORARY ON DATABASE caspira_crm TO caspira_app;
GRANT CONNECT ON DATABASE caspira_crm TO caspira_readonly, caspira_monitor;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, analytics TO caspira_app, caspira_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO caspira_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO caspira_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public, analytics TO caspira_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO caspira_app;
ALTER DEFAULT PRIVILEGES FOR ROLE caspira_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO caspira_app;
ALTER DEFAULT PRIVILEGES FOR ROLE caspira_owner IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO caspira_app;
ALTER DEFAULT PRIVILEGES FOR ROLE caspira_owner IN SCHEMA public GRANT SELECT ON TABLES TO caspira_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE caspira_owner IN SCHEMA analytics GRANT SELECT ON TABLES TO caspira_app, caspira_readonly;
GRANT EXECUTE ON FUNCTION analytics.refresh_view(text, boolean) TO caspira_app;
-- The old all-powerful application user keeps no privileges or login.
ALTER ROLE :"old_owner" NOLOGIN;
\echo roles upgraded
