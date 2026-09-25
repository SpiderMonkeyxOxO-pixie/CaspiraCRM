#!/usr/bin/env bash
# Backend Phase 13 — least-privilege roles, created once at cluster init.
# Passwords come from Docker secret files; they are passed to psql as
# variables (never on the command line or in logs).
#
#   caspira_owner     owns the schema; used ONLY by the migrator
#   caspira_app       runtime API/worker: DML on application tables, no DDL,
#                     does not own the schema
#   caspira_readonly  read-only reporting
#   caspira_monitor   pg_monitor for health/metrics
#   postgres          superuser: local socket only (init, pgBackRest)
# Existing clusters: apply deploy/production/postgres/roles-upgrade.sql with
# the database-roles runbook instead.
set -euo pipefail

read_secret() { tr -d '\r\n' < "/run/secrets/$1"; }
APP_PW="$(read_secret db_password)"
OWNER_PW="$(read_secret db_migrator_password)"
RO_PW="$(read_secret db_readonly_password)"
MON_PW="$(read_secret db_monitor_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_pw="$APP_PW" -v owner_pw="$OWNER_PW" -v ro_pw="$RO_PW" -v mon_pw="$MON_PW" <<'SQL'
\set QUIET on
CREATE ROLE caspira_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE caspira_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 60;
CREATE ROLE caspira_readonly LOGIN PASSWORD :'ro_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 10;
CREATE ROLE caspira_monitor LOGIN PASSWORD :'mon_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 5;
GRANT pg_monitor TO caspira_monitor;

-- Session safety limits per role.
ALTER ROLE caspira_app SET statement_timeout = '60s';
ALTER ROLE caspira_app SET lock_timeout = '10s';
ALTER ROLE caspira_app SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE caspira_readonly SET statement_timeout = '120s';
ALTER ROLE caspira_readonly SET default_transaction_read_only = on;
ALTER ROLE caspira_owner SET lock_timeout = '10s';

-- The schema belongs to the migration role; nobody else can create objects.
REVOKE ALL ON DATABASE caspira_crm FROM PUBLIC;
-- The migration role creates schemas and trusted extensions (e.g. pg_trgm) in migrations.
GRANT CONNECT, TEMPORARY, CREATE ON DATABASE caspira_crm TO caspira_owner;
GRANT CONNECT, TEMPORARY ON DATABASE caspira_crm TO caspira_app;
GRANT CONNECT ON DATABASE caspira_crm TO caspira_readonly, caspira_monitor;
ALTER SCHEMA public OWNER TO caspira_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO caspira_app, caspira_readonly;
CREATE SCHEMA IF NOT EXISTS analytics AUTHORIZATION caspira_owner;
GRANT USAGE ON SCHEMA analytics TO caspira_app, caspira_readonly;

-- Everything the migrator creates becomes usable (DML only) by the runtime role.
ALTER DEFAULT PRIVILEGES FOR ROLE caspira_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO caspira_app;
ALTER DEFAULT PRIVILEGES FOR ROLE caspira_owner IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO caspira_app;
ALTER DEFAULT PRIVILEGES FOR ROLE caspira_owner IN SCHEMA public GRANT SELECT ON TABLES TO caspira_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE caspira_owner IN SCHEMA analytics GRANT SELECT ON TABLES TO caspira_app, caspira_readonly;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
echo "[init] least-privilege roles created"
