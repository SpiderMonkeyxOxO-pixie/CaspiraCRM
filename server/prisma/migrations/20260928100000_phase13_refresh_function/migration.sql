-- Backend Phase 13: the runtime role (caspira_app) does not own the schema,
-- so it can't REFRESH materialized views directly. This SECURITY DEFINER
-- function (owned by the migration role) refreshes only the allowlisted
-- analytics views and nothing else.
CREATE OR REPLACE FUNCTION analytics.refresh_view(view_name text, concurrent boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, analytics
AS $$
BEGIN
  IF view_name NOT IN ('mv_pipeline_daily', 'mv_invoice_monthly', 'mv_activity_daily') THEN
    RAISE EXCEPTION 'view % is not refreshable', view_name;
  END IF;
  IF concurrent THEN
    EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.%I', view_name);
  ELSE
    EXECUTE format('REFRESH MATERIALIZED VIEW analytics.%I', view_name);
  END IF;
END
$$;

REVOKE ALL ON FUNCTION analytics.refresh_view(text, boolean) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'caspira_app') THEN
    GRANT EXECUTE ON FUNCTION analytics.refresh_view(text, boolean) TO caspira_app;
  END IF;
END
$$;
