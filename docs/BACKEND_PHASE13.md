# Backend Phase 13 — Platform Security Hardening, Backups, Disaster Recovery and Production Deployment

Status: implemented in the repository and verified on the development workstation and database. **No production deployment was performed**, and none was authorized. Verdict: **not yet ready for production approval** (see *Remaining manual production approvals*).

Related documents:
- [Production operations](PRODUCTION_OPERATIONS.md)
- [Readiness matrix](PRODUCTION_READINESS.md)
- [Threat model](security/THREAT_MODEL.md)
- [Runbooks](runbooks/README.md)
- [Drill evidence](evidence/restore-drill-2026-09-25.json)

## Production deployment topology
- One host with a Docker Compose project per environment (`deploy/production/compose.yaml`).
- **Services:**
  - proxy: nginx-unprivileged, and the **only** service with published ports (80 and 443);
  - web (SPA), api and worker;
  - migrate (one-off, profile `migrate`);
  - db (PostgreSQL 17.6 with pgBackRest);
  - redis (password required);
  - backup-agent (profile `backup`);
  - Prometheus (profile `observability`).
- **Networks:** ingress, app (internal), data (internal), egress, backup and observability (internal).
- **Images:** referenced only by digest from an immutable release manifest.
- **Legacy stack:** the old `deploy/vps-prod` stack is marked superseded. The Phase 13 code deliberately refuses its configuration; the cut-over is part of the final, separately approved deployment.

## Environment separation
- `APP_ENV` selects development, test, staging or production (`server/src/config/`). Staging and production are strict profiles: secrets come from files (`/run/secrets`, or `NAME_FILE`), and the processes **refuse to start** on any of the following:
  - missing or weak secrets, default passwords or the development key;
  - secrets passed as environment variables;
  - a wildcard or http origin;
  - insecure cookies;
  - `TRUST_PROXY=true`;
  - debug logging;
  - the bootstrap flag left on;
  - a missing backup repository or audit retention.
- Only setting names are printed, never values. The profile also namespaces rate limits (`rl:<env>:`) and the monitoring label.
- **Development:** unchanged. The `.env` files aren't touched, and the root `docker-compose.yml` still serves Docker Desktop development.
- **Templates:** `deploy/production/env/{production,staging}.env.example` (no secrets; a test enforces this) and `server/.env.example`.

## Threat model
`docs/security/THREAT_MODEL.md` covers 35 threats, each with asset, trust boundary, scenario, existing and required controls, detection, recovery, residual risk, owner and review date (2027-03-25). It is an engineering artifact, not a compliance claim.

Highest residual risks:
- the open dependency advisories;
- volumetric DoS on a single host;
- malware in documents, once uploads exist;
- application-only tenant isolation (no RLS is claimed).

## Container hardening
- **API image** (`server/Dockerfile`):
  - multi-stage build on `node:22.20.0-alpine3.22`, pinned by digest;
  - production dependencies only; npm, npx and corepack removed;
  - `USER node`, OCI version and revision labels, a HEALTHCHECK;
  - `.dockerignore` excludes `.env`, tests, keys and simulators.
- **Web image:** `Dockerfile.web`, built without sourcemaps, running nginx-unprivileged as uid 101.
- **PostgreSQL image:** pinned by digest, running as `USER postgres`.
- **Compose, every service:** read-only root filesystem with tmpfs, `cap_drop: ALL`, `no-new-privileges`, init, memory, CPU and PID limits, log rotation and grace periods. Nothing is privileged, uses host namespaces or mounts the Docker socket.
- **Enforcement:** `scripts/security/policyCheck.js` and `infrastructure.test.js`.

## Network and TLS protections
- **Proxy** (`deploy/production/proxy/`):
  - TLS 1.2 and 1.3 (Mozilla intermediate profile), HTTP→HTTPS redirect, ACME webroot;
  - body, header and timeout limits; rate and connection limits;
  - request IDs, SSE and WebSocket support, a file-switch maintenance page;
  - CSP, HSTS (off until proven, never preloaded), `nosniff`, Referrer-Policy, Permissions-Policy, frame denial, `no-store` on authenticated responses.
- **Host:** `scripts/firewall.sh` allows 80, 443 and SSH from the admin source only. It requires the host name and an explicit confirmation. `check-host.sh` is a read-only baseline check.
- **API:** also sets the security headers itself (so a misconfigured proxy can't drop them), a CORS allowlist, a trusted-proxy hop count, and HTTP server timeouts.

## Secrets and key management
- One loader: compose secrets or `*_FILE`, with log redaction of every loaded value. Secrets never appear in images, build arguments, environment values, logs or error responses.
- `create-secrets.sh` creates only missing files, never prints them, and uses mode 0440 with group 1500.
- **Inventory:** 18 secrets, metadata only.
- **Rotation:** ordered steps with overlapping validity: create, accept both, re-encrypt (credential-vault rewrap), verify, revoke old (refused while the old key is still in use), complete.
- **JWT:** a rotation overlap through `jwt_secret_previous`.
- **Emergency revocation:** opens a Critical finding.
- **Backup keys:** escrowed off-host, never stored beside backups.
- **Automation tokens** (`cpat_`): stored as HMAC with a pepper, scoped, expiring, revocable and audited.
- **Scanning:** gitleaks in CI plus the repository secret scan, currently at 0 findings. Two public Firebase web keys are allow-listed with a review note.

## Authentication and API hardening
- **Session login:**
  - TOTP is now **required** for two-factor accounts; it was previously checked only by the legacy login;
  - equal-cost failures;
  - absolute session lifetime, which refresh can't extend;
  - `sid` and `auth_time` in access tokens.
- **Privileged routes:**
  - `requireLiveSession` (rejects revoked sessions and follows rotation);
  - `requireRecentAuth` plus `POST /auth/reauthenticate` for sensitive actions: secret rotation, restores, disaster declaration, deployment approval, role changes and exception decisions.
- **Legacy surface:** in strict profiles the legacy bearer API and Swagger are off. The 2FA-pending token lasts 5 minutes. The legacy `authenticate` rejects non-access tokens and inactive users.
- **Every request:** a safe error envelope `{code, message, correlationId}` (5xx is generic), sanitized correlation IDs, 415 on non-JSON bodies, 413 and invalid-JSON handling, a handler timeout, an optional global rate limit, and JSON access logs in strict profiles.
- **Frontend:** the backend-mode login now asks for the authenticator code on `MFA_REQUIRED`. The Platform page asks for the password again when the API requires recent authentication.

## Tenant and database protections
- **Roles:**
  - `caspira_owner` (migrations; owns the schemas);
  - `caspira_app` (runtime DML only, with statement, lock and idle-transaction timeouts and a connection limit);
  - `caspira_readonly`, `caspira_monitor`;
  - `postgres` (socket only).
- **Analytics refresh:** the runtime role refreshes materialized views only through the allowlisted `SECURITY DEFINER` function `analytics.refresh_view`.
- **Existing databases:** `roles-upgrade.sql` performs the one-time move.
- **Found by the drill and fixed:** the migration role lacked `CREATE` on the database. That would have broken the `pg_trgm` migration on a fresh production cluster.
- **Tenant isolation:** applied before retrieval and aggregation (Phase 12 tests, plus `tenantIsolation.test.js` for retention and platform access). Organization roles never grant platform access. No row-level security is claimed.
- **Retention:** a central registry (10 purgeable categories plus managed ones), with tenant overrides, legal holds, dry runs, batched and audited purges and failure reporting.

## PostgreSQL backup strategy
- pgBackRest:
  - repo1: local and encrypted (aes-256-cbc);
  - repo2: off-site, encrypted, with separate credentials, configured through `PGBACKREST_REPO2_*`.
- Schedule: full weekly, differential daily, incremental hourly.
- Continuous WAL archiving through a wrapper, with `archive_timeout` of 300 s.
- A daily logical `pg_dump`, GPG-encrypted. It is portable, but not a PITR replacement.
- **Execution:** only the isolated backup agent runs the tools, through a file control protocol: allowlisted, typed requests, never commands. The API and worker never hold backup credentials or the Docker socket.
- **Artifacts** record the type, times, tool and database versions, WAL range, recoverable window, location, encryption, size and checksum.
- **Verified** status requires existence, checksum, WAL continuity, encryption, a native check, an **isolated restore** and an **application smoke test**. It is recorded separately from job success.
- **Planning targets:** RPO 15 min and RTO 4 h. They are configurable, and changing them resets approval.

## Object-storage backup strategy
The Documents service (uploads and object storage) is **not built**. Branding and templates live in PostgreSQL and are covered by database backups and PITR. Export files are encrypted, short-lived and regenerated rather than restored. Configuration and release manifests have an encrypted configuration backup.

The object-storage backup policy and the agent operations (`object_backup`, `object_restore`) exist so coverage is ready when documents ship. The plan is versioned buckets plus a replicated copy with separate credentials (runbook 07).

## Restore and PITR verification
- **API:**
  - recovery points are validated against the backup and the archived WAL;
  - restores go to **isolated targets only**, with separation of duties;
  - a production-in-place restore returns `MANUAL_RUNBOOK_REQUIRED` (runbook 05 Part C);
  - post-restore validation checks connectivity, migration version, counts, auth tables, roles and audit;
  - drills can never target production.
- **Drills run here** (`server/scripts/drills/restoreDrill.js`, native PostgreSQL 17.6 tools, development data only, targets deleted afterwards): **25 of 25 checks passed**.
  - **Drill 1** (logical backup to an isolated cluster, built with the production role scripts):
    - the encrypted dump's checksum was verified before the restore;
    - migration version and table counts matched the source;
    - the runtime role can't create or drop tables;
    - views refresh only through the function;
    - the **API ran against the restored copy as the runtime role**, and sign-in plus a tenant-scoped query both succeeded;
    - **measured RTO 17 s**.
  - **Drill 2** (continuous archiving):
    - base backup plus `pg_verifybackup`, encrypted archive, WAL archived;
    - **PITR to a timestamp between two writes** recovered exactly the first write;
    - the source was untouched;
    - **measured RPO 2 s and RTO 49 s**.
  - Both drills are recorded as restore-drill records (`rd_tdMcm2_NfZs`, `rd_lNT79XStyps`) with the evidence hash.
- **Not run:** the Docker/pgBackRest drill (`deploy/production/tests/backup-pitr-drill.sh`), because this workstation has no Docker. **Backups made by the production containers are therefore not yet proven restorable.**

## Disaster-recovery plans and drills
- **Plans:** 20 plans, each with detection, severity, owner role, participants, containment, evidence, steps, backups, communication, RPO and RTO, validation, return criteria and review. The plans spell out the single-host limitation.
- **States:**
  - plans: Draft → Ready for Review → Approved;
  - drills: Scheduled → Running → Passed or Failed. The result must be signed by another person, and a failure opens a finding.
  - incidents: Declared → Containment → Recovery → Validation → Service Restored → Post-Incident Review → Closed. States can't be skipped, closing needs a review of at least 20 characters, and every transition is audited.
- **Drill record:** the restore drills above are recorded. A full DR drill on staging is an open approval item.

## Release, deployment and rollback workflow
1. **Build:** `build-release.sh` runs lint and every test suite, builds the images once, records their **digests**, and runs the scans and SBOMs (CycloneDX 1.5). It writes an immutable manifest.
2. **Register:** the API refuses a different image under an existing release ID (`RELEASE_IMMUTABLE`) and any tag-pinned image. The registrant can't approve their own release.
3. **Deploy:**
   - a deployment plan needs a different approver;
   - `execute` evaluates the gates: tests, dependency, container and secret scans, SBOM, critical findings, approvals, configuration, backup readiness and WAL lag, a restore drill within 30 days, disk, database, migration preflight, rollback procedure and communication;
   - only listed gates can be waived, through a scoped, approved, time-limited exception;
   - `deploy.sh` (scoped automation token) acts only on **Deploying**. It pulls by digest, backs up, runs the preflight and migrations as the migration role under the lock, replaces the containers, runs the smoke tests and reports every step.
4. **Roll back:** an image rollback happens only when the schema is compatible. Otherwise the deployment becomes **Manual Recovery Required** (forward fix or approved PITR). Migrations are never rolled back automatically.
5. **CI:** the GitHub deploy workflow changed from **deploy on push to `main`** to **manual only** (`workflow_dispatch`, `confirm: DEPLOY`, `production` environment). *This is a behaviour change you may want to review or revert.* The new `security.yml` runs gitleaks, the audits, Trivy and the SBOM with actions pinned by SHA.

## Observability and alerting
- **Health:** `/health` is liveness and doesn't depend on providers. `/ready` is minimal (database and Redis). Detailed health needs a platform permission and covers 12 checks: database, Redis, queue, worker and scheduler heartbeats, migrations, backup and WAL, backup agent, secrets, disk, capacity and mailer.
- **Metrics:** `/metrics` adds per-minute HTTP counters, database capacity, backup age, WAL lag, drill age, job and alert series, all with the environment label. Prometheus is an optional profile.
- **Alert policies:** 30, covering the 14 required plus security signals: login failures, password spraying, privileged login failures, token reuse, permission and platform-role changes, secret events, failed secret access, exports and downloads, API volume, authorization failures, webhook and OAuth failures, restores, disaster declarations and deployments. Policies have dedupe, cooldown, resolution, runbook links, owners and email notification.
- **Platform jobs:** DB leases, timeouts, retries with backoff, a dead letter after 3 failures, cancellation on shutdown and a scheduler heartbeat. A 60 s API-side watchdog alerts when the worker heartbeat is missing.

## RBAC and separation of duties
- **Permissions:** 27 `platform.*` permissions.
- **Roles:** Security Administrator, Deployment Operator, Change Approver, Backup Operator, Restore Operator, DR Coordinator and Platform Auditor. The System Owner (Super-Admin) holds all of them. Organization administrators get **none**, and their denials are audited.
- **Separation of duties:**
  - requester ≠ approver for restores, deployments, rollbacks, releases and Critical exceptions;
  - drill results are signed by someone else;
  - a staffing exception is possible only with `PLATFORM_ALLOW_SINGLE_OPERATOR=true` and an audited reason.
- **Recent authentication:** required on the sensitive actions listed under *Authentication and API hardening*.
- **UI:** a new *Platform Operations* page (`/platform`) shows only the tabs the member's permissions open.

## Operational runbooks
There are 23 runbooks in `docs/runbooks/`, covering all 24 required topics. Each names its terminal, uses explicit paths and named targets, and never uses destructive wildcards or `down -v` (a test enforces the latter).

| # | Topic |
|---|---|
| 01 | Host preparation |
| 02 | Firewall and secrets |
| 03 | Start |
| 04 | TLS and maintenance |
| 05 | PITR and production restore |
| 06 | Controlled deployment |
| 07 | Objects and configuration |
| 08 | Rollback |
| 09 | Roles and migrations |
| 10 | Failed migration |
| 11 | On-demand backup |
| 12 | Lost server |
| 13 | Verify a backup |
| 14 | Isolated restore and drills |
| 15 | Signing keys |
| 16 | Encryption keys |
| 17 | Compromised credentials |
| 18 | Disk exhaustion |
| 19 | Backup failure |
| 20 | Declare and close a disaster |
| 21 | Return to service |
| 22 | Incident evidence |
| 23 | Docker install and upgrade |

## Security and infrastructure tests
**New server tests:**

| Test file | Tests | Covers |
|---|---|---|
| `config.test.js` | 12 | Profiles and fail-closed configuration |
| `infrastructure.test.js` | 21 | Images, compose topology, templates, secret scan, SBOM |
| `platformLogic.test.js` | 20 | Agent protocol, pgBackRest artifacts, recovery points, restore validation, separation of duties, RBAC, alert dedupe and cooldown, manifests, rollback compatibility, scan scoping, incident transitions |
| `tenantIsolation.test.js` | 9 | Retention legal holds and overrides; organization roles get no platform access |
| `security.test.js` | 11 | Headers, 415/413/400, safe errors, correlation IDs, timeouts, proxy trust, CORS, legacy API |
| `auth2Controller.test.js` (additions) | 5 | MFA, `sid`/`auth_time`, absolute lifetime, recent auth, live session |

**New frontend tests:**
- `platform.test.jsx`: 7 tests covering the access gate, tabs by permission, drills, backup run and the password prompt.
- An MFA login client test.

**Live HTTP check** against the development API: **18 of 18 passed**. It covered:
- the access split, with 6 denials audited;
- the metadata-only secret inventory;
- agent-not-configured handling;
- the recorded drills;
- refusal of production restores and production drills;
- reauthentication;
- release immutability and tag refusal;
- a delegated approver;
- separation of duties;
- gates blocking an unready release (11 failed gates);
- automation-token scope and revocation;
- 20 DR plans, and an incident walked through every state with review enforcement;
- detailed health, capacity, 30 policies, evaluation, jobs and a retention dry run;
- HTTP hardening;
- cleanup.

**Bug found and fixed by the live evidence run:** ingesting one scan target could auto-resolve another target's findings. Findings are now scoped by scan target, with a test.

**Findings ingested:** 13 open (2 Critical, 9 High, 2 Medium).

**Not run here:** `deploy/production/tests/backup-pitr-drill.sh` and the image scans, which need Docker.

## Remaining manual production approvals
1. **Blocker:** fix or disposition the 2 Critical and 9 High dependency findings. jsPDF needs a major-version upgrade.
2. **Blocker:** on a staging host with Docker:
   - build the release with image scans;
   - run `backup-pitr-drill.sh`;
   - deploy with `deploy.sh` and roll back with `rollback.sh`;
   - run an agent restore drill and a DR drill.
3. Approve:
   - the DNS records and TLS issuance;
   - the firewall change;
   - the RPO/RTO targets and the 20 DR plans;
   - the owner-role mapping to named people;
   - backup-key escrow with two people;
   - retention periods;
   - reviewers for the GitHub `production` environment.
4. Approve the one-time production cut-over from `deploy/vps-prod`: new secrets, `roles-upgrade.sql`, migrations and the proxy switch. This is part of the single final deployment.
5. Decide whether to keep the manual-only deploy workflow.

Separately, `src/services/firebase/firebase.js` has a `storageBucket` value that looks like a pasted FCM device token. It is reported, not changed.

## Known single-host limitations
- **No high availability:** the host, database, Redis and local backup repository share one failure domain. Host loss means downtime until a rebuild from the off-site repository (runbook 12). The measured RTO for that path is not yet known.
- **Deployments** restart containers, causing a short interruption. **No zero-downtime claim.**
- **Volumetric DoS** needs an upstream provider.
- **Self-alerting:** a dead host can't send its own alerts, so an external uptime check is recommended.
- **Next phase:** high availability is the subject of Phase 14.

## Build, lint and test results
| Check | Result |
|---|---|
| Server tests | **618 / 618 passed** (65 files; previously 540) |
| Frontend tests | **1571 / 1571 passed** (129 files; previously 1563) |
| Lint | 43 problems, the same pre-existing count; no new problems from this phase |
| Type checks | not applicable (JavaScript codebase without a type checker; recorded as `not_applicable` in the release gate) |
| Production build | passes (`vite build`) |
| Policy check and secret scan | 0 findings |
| Restore drills | 25 / 25 checks passed |
| Live platform check | 18 / 18 passed |
