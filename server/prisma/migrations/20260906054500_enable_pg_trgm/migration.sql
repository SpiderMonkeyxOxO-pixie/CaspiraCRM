-- Enables fuzzy name-similarity matching for duplicate detection
-- (services/crm/duplicateDetectionService.js's rank-3 Lead/Contact/Company
-- name signal). Confirmed available in the postgres:17-alpine image used
-- by this project's docker-compose.yml before committing to it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
