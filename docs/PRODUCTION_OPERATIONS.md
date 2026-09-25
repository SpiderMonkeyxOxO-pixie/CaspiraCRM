# Caspira CRM — Production Operations

Backend Phase 13 · 2026-09-25. This is the operator's reference for the single-host production and staging stack in `deploy/production/`. Procedures live in [`docs/runbooks/`](runbooks/README.md); threats are in [`docs/security/THREAT_MODEL.md`](security/THREAT_MODEL.md); the current evidence is in [`docs/PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md).

Every statement below carries one label:
- **[Implemented]:** in the repository and covered by tests or a drill run here.
- **[Configurable]:** implemented, and its value is chosen per deployment.
- **[Recommended]:** advice the repository can't enforce.
- **[Unverified]:** implemented, but not yet exercised in the target infrastructure. For example, the Docker and pgBackRest path hasn't been run on a real host from this workstation, which has no Docker.
- **[Future]:** not built.

---

## 1. Deployment architecture [Implemented, Unverified on a host]
**Layers.** `compose.yaml` is the core stack and publishes no ports. It runs with one edge layer, listed in `COMPOSE_LAYERS` in `env/<environment>.env`, and every script (and `./dc <environment> …`) passes the layers for you:
- `compose.edge.yaml` (a dedicated host): our own TLS proxy on 80 and 443, plus the web container.
- `compose.aapanel.yaml` (the current production VPS): aaPanel's nginx, behind Cloudflare, proxies to the API on `127.0.0.1:4010`. The SPA is hosted on the website VPS. Images are built on the host from an exact commit (`scripts/build-local.sh`) and verified by image ID. Mailpit catches email. The off-site backup copy goes to the website VPS over SFTP. The one-time move from the legacy stack is `docs/deploy/AAPANEL_CUTOVER.md`.

One Linux host runs Docker Engine with one Compose project per environment (`caspira-production`, `caspira-staging`). There is **no** standby, cluster or load balancer, and **no high-availability or zero-downtime claim**.

| Service | Image | Networks | Published | Runs as |
|---|---|---|---|---|
| proxy | nginx-unprivileged (pinned by digest) | ingress, app | **80, 443** (the only published ports) | uid 101 |
| web | caspira web (SPA on nginx-unprivileged) | app | no | uid 101 |
| api | caspira api | app, data, egress, observability | no | uid 1000 |
| worker | caspira api image, `src/worker.js` | data, egress | no | uid 1000 |
| migrate | caspira migrator (profile `migrate`) | data | no | uid 1000 |
| db | caspira postgres (PostgreSQL 17.6 + pgBackRest) | data | no | uid 999 |
| redis | redis 7.4 (password required) | data | no | uid 999 |
| backup-agent | caspira postgres image (profile `backup`) | data, backup | no | uid 999 |
| prometheus | (profile `observability`) | observability | no | nobody |

Hardening, applied to every service:
- read-only root filesystem, with a tmpfs for `/tmp`;
- `cap_drop: ALL` and `no-new-privileges`;
- an init process;
- memory, CPU and PID limits;
- JSON log rotation (20 MB × 5);
- health checks;
- graceful stop periods: API 30 s, worker 40 s, database 120 s.

No container is privileged, uses host namespaces or mounts the Docker socket. The policy check (`server/scripts/security/policyCheck.js`) and `infrastructure.test.js` enforce this.

## 2. Trust boundaries and network flows [Implemented]
See the threat model (boundaries B1–B10).

| Network | Flows allowed | Notes |
|---|---|---|
| **ingress** | Internet to the proxy | |
| **app** (internal) | proxy to web:8080, proxy to api:4000 | |
| **data** (internal) | api, worker and migrate to db:5432 and redis:6379; backup-agent to db (socket volume) | |
| **egress** | api and worker to providers: email, AI, payments, integrations, OAuth | |
| **backup** | backup-agent to the off-site repository (repo2) | |
| **observability** (internal) | prometheus to `api:4000/metrics`, which needs the metrics token | |

The worker and the backup agent exchange requests through the `backup_control` volume, which carries files, not network traffic.

## 3. Ports and DNS
- **Public ports:** 80 (the ACME challenge and a redirect to HTTPS) and 443 (TLS 1.2 and 1.3). SSH is open only from the administrative source address; the port is your choice. **[Implemented: `scripts/firewall.sh` with confirmation]**
- **Private ports:** 4000 (api), 8080 (web), 5432, 6379 and 9090. These are never published.
- **DNS [Configurable]:**
  - `crm.<domain>`: A and AAAA records to the host, for the SPA.
  - `api.<domain>`: A and AAAA records to the host, for the API.
  - Optional: `status.<domain>` on an external status page, **not** this host.
  - Lower the TTL (300 s) before any planned host move.
  - CAA records naming your certificate authority are **[Recommended]**.

## 4. TLS [Implemented, Unverified on a host]
- nginx uses the Mozilla "intermediate" profile: TLS 1.2 and 1.3 with forward-secret ciphers. Certificates are mounted read-only from `TLS_CERT_DIR` and renewed through certbot's webroot mode with a reload hook ([runbook 04](runbooks/04-tls-certificates.md)).
- HSTS is off until it is proven (`HSTS_ENABLED`); it is never preloaded.
- The `certificate_expiry` alert fires below 21 days.

## 5. Environment separation and configuration schema [Implemented]
`APP_ENV` selects the profile: development, test, staging or production.

**Staging and production are strict profiles.** On any of the following, `src/config/load.js` makes the API and worker **refuse to start**, printing setting names only, never values:
- a missing or weak secret, a default password or an all-zero development key;
- secrets passed as environment variables (unless `ALLOW_ENV_SECRETS`);
- a wildcard CORS origin, or an http origin;
- insecure cookies, or HTTPS disabled;
- `TRUST_PROXY=true`;
- debug logging;
- the bootstrap flag left on;
- a missing backup repository, or a missing off-site repository in production;
- audit retention under 90 days.

The profile sets `RATE_LIMIT_PREFIX` (`rl:<env>:`) and `MONITORING_ENV_LABEL`, so Redis keys and metrics can't collide across environments.

Each environment has **its own**:
- secrets directory;
- database, Redis, keys, OAuth apps, webhook secrets and provider credentials;
- backup repositories, URLs and origins;
- monitoring label, queue namespace and retention settings.

Staging never shares a value with production. Development keeps working with `.env` and no secret files; the developer's `.env` is untouched.

| Variable | Profile | Purpose |
|---|---|---|
| `APP_ENV` | all | development, test, staging or production |
| `NODE_ENV` | strict: `production` | |
| `SECRETS_DIR` | strict | `/run/secrets` (compose secrets); any secret can also come from `<NAME>_FILE` |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_SSLMODE`, `DB_CONNECTION_LIMIT`, `DB_POOL_TIMEOUT` | strict | The URL is assembled from these plus the `db_password` file |
| `REDIS_HOST`, `REDIS_PORT` | strict | Plus the `redis_password` file |
| `CLIENT_ORIGIN`, `CORS_ALLOWED_ORIGINS`, `PUBLIC_API_URL`, `APP_URL` | all | https in strict profiles; no wildcards |
| `TRUST_PROXY` | strict: required | a hop count or CIDRs; never `true` |
| `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN` | all | Secure is forced in strict profiles |
| `ACCESS_TOKEN_TTL_MINUTES` (15), `REFRESH_TOKEN_TTL_DAYS` (30, idle), `SESSION_ABSOLUTE_TTL_DAYS` (30), `RECENT_AUTH_MINUTES` (10), `PASSWORD_RESET_TTL_MINUTES` | all | Session policy |
| `HSTS_ENABLED`, `HSTS_MAX_AGE` | all | Off by default |
| `API_REQUEST_TIMEOUT_MS`, `HTTP_HEADERS_TIMEOUT_MS`, `HTTP_REQUEST_TIMEOUT_MS`, `HTTP_KEEPALIVE_TIMEOUT_MS`, `SHUTDOWN_GRACE_MS` | all | Timeouts |
| `API_RATE_LIMIT_PER_MINUTE` | all | On by default in strict profiles |
| `LEGACY_USER_API`, `API_DOCS_ENABLED` | strict | Both off unless explicitly enabled |
| `BACKUP_REPO_PRIMARY`, `BACKUP_REPO_OFFSITE`, `BACKUP_CONTROL_DIR`, `BACKUP_JOB_TIMEOUT_MS`, `RESTORE_TARGET_TTL_HOURS` | strict | Backups |
| `AUDIT_LOG_RETENTION_DAYS` | strict: 90 or more | |
| `PLATFORM_ALLOW_SINGLE_OPERATOR` | all | Allows audited self-approval with a reason; keep `false` where staffing allows |
| `ALERT_EMAIL_ENABLED`, `ALERT_EMAIL_TO` | all | Alert notification |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SECURE`, `SMTP_FROM` | all | Plus the `smtp_password` file |

The templates are `deploy/production/env/{production,staging}.env.example`. They hold no secrets, and a test enforces that.

## 6. Secret inventory and rotation [Implemented]
- **Secrets as files:** secret files live in `deploy/production/secrets/<env>/`, owned by root with group 1500 and mode 0440. Containers read them at `/run/secrets/<name>`. Secrets are never in images, build arguments, environment values or logs (loaded values are redacted from log output).
- **Inventory:** *Platform → Security → Secrets* lists 18 secrets as **metadata only**: owner, purpose, rotation interval, last rotation and key version.
- **Rotation steps:** create → accept both → switch → re-encrypt (the credential vault rewraps stored credentials) → verify → revoke old → audit. The old version can't be revoked while data still uses it.
- **Emergency revocation:** records a Critical finding. See [runbooks 15, 16 and 17](runbooks/README.md).
- **Backup keys:** escrowed off-host by two people, and never stored with the backups. **[Recommended]**
- **Scanning:** gitleaks in CI plus the repository secret scan. **[Implemented]**

## 7. Database roles [Implemented and drilled]
| Role | Use |
|---|---|
| `caspira_owner` | Migrations only; owns the schemas; can create schemas and trusted extensions |
| `caspira_app` | Runtime DML only; no DDL; doesn't own the schema. Timeouts: statement 60 s, lock 10 s, idle-in-transaction 60 s; 60 connections. |
| `caspira_readonly` | Read-only reporting |
| `caspira_monitor` | `pg_monitor` |
| `postgres` | Local socket only: initialization and pgBackRest |

- The runtime role refreshes materialized views only through the allowlisted `SECURITY DEFINER` function `analytics.refresh_view()`.
- **No row-level security is claimed:** tenant isolation is enforced in the application and tested.
- The slow-query log records statements over 1 s.
- The restore drill verified the role scripts against restored non-production data.

## 8. Backups [Implemented, Unverified on a host]
- **Physical backups (pgBackRest):**
  - full weekly, differential daily, incremental hourly, and continuous WAL archiving with `archive_timeout` of 300 s (a segment is closed at least every 5 minutes); four full backups are kept;
  - repo1 is local and encrypted (aes-256-cbc);
  - repo2 is off-site, encrypted, with separate credentials. **[Configurable]** Use object lock or versioning on the bucket. **[Recommended]**
- **Logical exports:** daily `pg_dump -Fc` with GPG AES-256 encryption. Portable, but **not** a PITR replacement.
- **Configuration backups:** compose, env (no secrets), proxy, PostgreSQL configuration and release manifests.
- **Object storage:** no Documents service exists yet [Future]. Branding and templates live in the database.
- **Artifact records** hold: environment, source, type, times, status, tool and version, database version, WAL range, recoverable window, location, encryption and key version, size, checksum, verification and job.
- **Verified** status needs every check to pass, recorded separately from the job: existence, checksum, WAL continuity, encryption, native check, isolated restore and app smoke test ([runbook 13](runbooks/13-verify-a-backup.md)).
- **Planning targets:** **RPO 15 minutes, RTO 4 hours** [Configurable; changing them resets approval]. These are targets, not measurements; see the readiness document for measurements.
- **Alerts:** missed backup, failed backup, WAL lag, overdue restore verification, disk, and critical findings.

## 9. Retention [Implemented]
A central registry in *Platform → Retention* holds:
- per-category periods, tenant overrides, legal holds, dry runs, batched purges, audited runs and failed-purge reporting;
- categories governed by earlier phases (AI payloads, export files), listed with their owning policy.

Data deleted from the live system stays in backups until those backups expire; backups are never edited.

## 10. Restore and PITR [Implemented; drilled with native tools]
- Every restore targets a **new isolated** instance by default.
- Recovery points are validated against the backup and the archived WAL: nothing before the backup, after the last archived WAL, or in the future.
- A production-in-place restore is a manual, approved runbook ([runbook 05](runbooks/05-restore-and-pitr.md)), and the API refuses to execute it.
- Post-restore validation covers connectivity, migration version, counts, auth tables, roles and audit.
- Drills are scheduled, never target production, and a missed or failed drill creates a finding.

## 11. RPO and RTO
The targets are in section 8. The measured values from the drills in this repository are in `PRODUCTION_READINESS.md`. Production values must be measured on the production host with the agent drill ([runbook 14](runbooks/14-restore-to-an-isolated-environment.md)). **[Unverified]**

## 12. Disaster-recovery ownership
- **Plans:** 20 plans in *Platform → Disaster recovery*, each with detection, severity, an owner role, participants, containment, evidence, steps, backups, communication, RPO and RTO, validation, return criteria and review. They start in Draft and need an approver. **[Implemented]**
- **Owners:** the organization maps each role to named people. **[Recommended]**
- **Single-host notes:** several plans recover by rebuilding on a new host, not by failover.

## 13. Deployment approval [Implemented]
Build once, then promote the same digests to staging and production.

Production deployment needs:
- an approved release, registered by one person and approved by another;
- an approved deployment plan, with a different requester and approver;
- every gate passing:
  - lint, unit, integration, authorization, tenant-isolation and migration tests, and the build (type checking is recorded as not applicable to this JavaScript codebase);
  - dependency, container and secret scans, and an SBOM;
  - no open Critical finding;
  - approvals and configuration;
  - backup freshness and WAL lag, and a restore drill within 30 days;
  - disk and database health;
  - migration preflight, the rollback procedure, and maintenance communication.
- Only listed gates can be waived, through a scoped, approved, time-limited, audited exception.

The GitHub deploy workflow is **manual** (`workflow_dispatch` with `confirm: DEPLOY` and the `production` environment); a push to `main` no longer deploys.

## 14. Migration policy [Implemented]
- **Expand, then contract:** see [runbook 09](runbooks/09-database-roles-and-migrations.md).
- **Runs as:** the migration role, with `lock_timeout`, under the deployment lock.
- **Preflight checks:** unfinished migrations, expected version, unknown applied migrations and required extensions.
- **No automatic downgrade:** a failed migration follows [runbook 10](runbooks/10-failed-migration.md).

## 15. Rollback limits [Implemented]
- An image rollback is allowed only when the schema is compatible. Otherwise the deployment becomes **Manual Recovery Required**, and recovery is a forward fix or an approved PITR, which loses later writes.
- Configuration, proxy and worker rollbacks are covered in [runbook 08](runbooks/08-rollback-a-release.md).
- Irreversible migrations are never rolled back automatically.

## 16. Monitoring and alerting [Implemented]
- **Health:**
  - `/health` is liveness and doesn't depend on providers;
  - `/ready` reports only whether the database and Redis are ok;
  - detailed health needs a platform permission: database, Redis, queue, worker and scheduler heartbeats, migration, backup and WAL freshness, secrets, disk and capacity.
- **Metrics:** `/metrics`, token-protected, carries HTTP, platform, backup, WAL, drill, job, alert and AI metrics with an environment label. Prometheus runs under the `observability` profile. **[Configurable]**
- **Alert policies:** 30 policies (operational and security signals), with dedupe, cooldown, resolution, a runbook link, an owner and email notification. **[Configurable]**
- **External monitoring:** an uptime check from outside the host is **[Recommended]**, because a dead host can't alert about itself.

## 17. Single-host limitations
Stated plainly:
- The host is a single point of failure for compute, database, Redis and the local backup repository.
- Host loss means downtime until a replacement is built and restored from the off-site repository ([runbook 12](runbooks/12-lost-server.md)).
- Deployments restart containers, which causes a short interruption.
- Volumetric DoS protection needs an upstream provider.

High availability is Phase 14's subject; nothing here claims it.

## 18. Upgrades
- **OS:** unattended security updates, plus a monthly reboot window. **[Recommended]**
- **Docker:** [runbook 23](runbooks/23-install-and-upgrade-docker.md), with `live-restore`.
- **PostgreSQL:** minor versions arrive through a new image digest in a normal release. A **major** upgrade (17 to 18) needs `pg_upgrade` or a dump and restore into a new cluster, a new pgBackRest stanza and a full backup, as a planned maintenance with a drill on staging first. **[Future procedure]**
- **Application:** a normal controlled deployment ([runbook 06](runbooks/06-controlled-deployment.md)).

## 19. Decommissioning an environment
1. Take a final full and logical backup, verify them, and record them.
2. Revoke automation tokens and provider credentials, and remove webhooks.
3. Stop the stack with `./dc <env> --profile backup stop`, then remove the containers with `down` (**without** `-v`).
4. Keep the volumes and backups for the retention period. Then delete the **named** volumes explicitly, one by one, recording each deletion.
5. Shred the secret files after the backup keys' retention ends.
6. Remove DNS records, then destroy the host.
