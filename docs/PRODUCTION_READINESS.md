# Caspira CRM — Production Readiness Matrix

Backend Phase 13 · first assessed 2026-09-25 on the development workstation; **re-assessed 2026-09-26 on production** (aaPanel DB VPS, release `2026.09.26-5ae0b16804fe`).

## Verdict: **NOT ready for production approval**

"Ready for production approval" may be used only when every repository-controlled requirement passes.

**Update 2026-09-26 (production, after the cut-over).** Phases 8–13 run in production on the new stack (cut-over 2026-09-25, owner-approved). Resolved since the first assessment:
- **Backups proven on production:** pgBackRest full, incremental and WAL to repo1 (local) and repo2 (website VPS over SFTP); logical and configuration backups; `pgbackrest verify` passed.
- **Isolated restore drills passed through the agent from both copies:** repo1 set `20260925-151759F`, RTO 42 s, **Verified**; repo2, RTO 8 min, RPO 0 s. A repo2 read runs at about 3.5 MB/min (237 ms link), so off-site restore time grows with database size.
- **Container scan run** by `build-local.sh` on every release: 0 Critical/High (migrator: 2 Medium). **Dependency scan:** 0 Critical.
- **Leaked deploy key** (`eaeeece`) confirmed revoked; recorded as a gitleaks exception.
- **Website VPS hardened (owner-approved):** firewall allows 22, 80, 443 and the aaPanel port only; SSH is key-only, with no root password login.
- **Account security screens are real:** 2FA setup and disable with recent auth; session list and revocation; password change ending other sessions.
- **Defects found and fixed on production:** the agent's JSON and result files (successful jobs were recorded as nothing), repo selection for restores, the WAL `restore_command` bypassing the passphrase wrapper, file permissions for configuration backups, jobs orphaned by an agent restart, and a failure-alert flood.

**Still open before "Ready for production approval":**
1. **Rollback has not been exercised on a host.** Rehearse `rollback.sh`, or `select-release` to the previous release, which is schema-compatible because there were no migrations.
2. **Rollouts bypass the approval workflow.** Releases are selected with `cutover-aapanel.sh select-release` on the host because the Platform UI can't yet create the automation token that `register-release.sh` and `deploy.sh` need. Deployment approval and gates exist in the API but aren't used.
3. **Point-in-time recovery to a named timestamp** has only been drilled with native tools (2026-09-25), not through the agent in production.
4. **No DR drill recorded, and the DR plans are unapproved.** The same goes for the RPO/RTO targets, the mapping of owner roles to people, and escrow of the backup keys with two people.
5. **Host-restart recovery is unverified** (both hosts have a pending reboot). So is the Docker Desktop matrix: the team no longer uses Docker Desktop, and development runs against the VPS.
6. **The DB VPS firewall and SSH settings are not yet reviewed.** Only the website VPS was hardened.
7. **Alerts go nowhere external.** Email is Mailpit, and there's no external uptime monitor.
8. **The CI `images` job fails.** Releases are built and scanned on the host instead.
9. **MFA has no recovery codes.** Recovery is an operator database change.

### Earlier notes (2026-09-25, before the cut-over — superseded by the update above)
- **Dependency findings fixed:** jsPDF 3.0.4 → 4.2.1 and SheetJS 0.18.5 → 0.20.3 (the official SheetJS distribution) for the web app, which now has **0 vulnerabilities**. On the server, deepmerge-ts was overridden to 8.0.2. What's left are 2 Moderate findings in vitest, which is test tooling and never ships.
- **Pre-existing lint errors fixed.** They had stopped CI at its first step, so tests, builds and scans never ran in CI.
- **New blocker, found by scanning the full git history:** an SSH deploy key for the website VPS was committed in `eaeeece` (2025-11-24) to this public repository. It must be revoked and replaced before the cut-over (`docs/deploy/AAPANEL_CUTOVER.md`, Part A). CI keeps failing on it until then.
- **Production is now layered:** the core stack, plus either our own proxy (`compose.edge.yaml`) or the aaPanel VPS layer (`compose.aapanel.yaml`). The aaPanel layer uses images built on the host by `build-local.sh` and verified by image ID. Off-site backups go to the website VPS over SFTP, with a pinned host key.
- **Four configuration defects found and fixed while preparing:**
  - the database container could not push WAL off-host: wrong network, no passphrase, no credentials;
  - OAuth and webhook URLs weren't passed to the API;
  - the bootstrap script had no database URL in containers;
  - the backup agent tried to write logs on a read-only filesystem.

Items 2–4 below remain open until the cut-over runs on the server. Items 3 and 4 are exercised there by `build-local.sh` (Trivy scan), `cutover-aapanel.sh` (rehearsal, restore and verification) and the first agent restore drill.

1. ~~**Critical dependency findings are open.**~~ Fixed; see the update above.
2. **The Docker and pgBackRest path hasn't run on real infrastructure.** This workstation has no Docker, so none of these ran:
   - the production images, `compose.yaml`, the backup agent and pgBackRest;
   - `deploy/production/tests/backup-pitr-drill.sh`.

   The backup, restore and PITR **mechanics** were proven with native PostgreSQL 17 tools (below), but not through the production containers.
3. **No container image scan exists yet.** Trivy runs in CI (`.github/workflows/security.yml`) and in `build-release.sh`, but it hasn't been run against built images.
4. **Deployment rollback hasn't been exercised on a host.** Compatibility checking and the Manual Recovery Required path are tested in code and live against the API, but `deploy.sh` and `rollback.sh` haven't run on a host.

At the time of these notes no production deployment had been performed; the cut-over followed on 2026-09-25 with the owner's approval.

## Matrix

**State** is one of Implemented, Configurable, Recommended, Unverified or Open.
- **Auto** is the repository test or check that verifies the control.
- **Manual** is the operator's verification.
- **Evidence** is where the proof is.
- **Approval** marks controls that need a named approver before production.

| Control | State | Auto | Manual | Evidence | Owner | Residual risk | Approval |
|---|---|---|---|---|---|---|---|
| Threat model (35 threats) | Implemented | — | Review at 6 months | `docs/security/THREAT_MODEL.md` | Security Admin | see file | ✔ required |
| Environment separation and fail-closed configuration | Implemented | `config.test.js` (12) | Start staging with the real env | strict-profile refusals | Engineering Lead | Low | |
| Secrets as files, never env, images or logs | Implemented | `config.test.js`, `infrastructure.test.js`, secret scan (0 findings) | `ls -l secrets/<env>` | `deploy/production/secrets/README.md` | Security Admin | Low | |
| Secret inventory and ordered rotation | Implemented | live check (18 secrets, metadata only) | Rotate once on staging (runbooks 15 and 16) | Platform → Secrets | Security Admin | Low | |
| Hardened images (non-root, digest-pinned, no dev tooling) | Implemented, Unverified | `infrastructure.test.js`, policy check | `docker build`, then run as uid 1000 | `server/Dockerfile`, `Dockerfile.web` | Deployment Operator | Low | |
| Only the proxy is public; internal networks | Implemented, Unverified | `infrastructure.test.js` | `ss -tlnp` on the host shows only 80, 443 and SSH | `compose.yaml` | System Owner | Low | |
| Host firewall | Website VPS hardened 2026-09-26; **DB VPS not yet reviewed** | — | `firewall.sh` with confirmation | runbook 02 | System Owner | Medium | ✔ required |
| TLS proxy (TLS 1.2 and 1.3, headers, limits, maintenance page) | Implemented, Unverified | — | SSL Labs grade; `nginx -t` | `deploy/production/proxy/` | System Owner | Low | ✔ DNS and certificates |
| Auth hardening: MFA on session login, absolute lifetime, live session, recent auth, equal-cost login | Implemented | `auth2Controller.test.js` (17), live check | — | this phase | Security Admin | Medium (MFA optional) | |
| API hardening: headers, 415, safe errors, correlation IDs, timeouts, rate limits | Implemented | `security.test.js` (11), live check | — | — | Engineering Lead | Low | |
| Tenant isolation before retrieval and calculation | Implemented | analytics tenant tests, `tenantIsolation.test.js` (9) | — | release gate | Engineering Lead | Medium (no RLS) | |
| Least-privilege database roles | Implemented, **drilled** | restore drill steps 5–13 | Apply `roles-upgrade.sql` to the live database once | `docs/evidence/restore-drill-2026-09-25.json` | Deployment Operator | Low | ✔ one-time cut-over |
| Migration role can create trusted extensions | **Fixed this phase** (found by the drill) | drill step 6 | — | `10-roles.sh`, `roles-upgrade.sql` | — | — | |
| Encrypted backups, key kept apart | Implemented; drilled (GPG and native tools) | drill steps 2–4 and 19 | Escrow the keys with 2 people | runbook 02 | Backup Operator | Low | ✔ key escrow |
| pgBackRest encrypted repo1 and off-site repo2 | Implemented, **verified on production** | agent drills from repo1 and repo2 (2026-09-25/26) | — | Platform → Restores & drills | Backup Operator | Medium (repo2 read ~3.5 MB/min) | ✔ |
| Continuous WAL archiving and PITR | Implemented; **drilled with native tools** | drill steps 18–26 | Agent drill on staging | evidence file (RPO 2 s, RTO 49 s) | Restore Operator | Medium | |
| Isolated restore and application smoke test | **Drilled** | drill steps 1–17 (API as the runtime role; sign-in; tenant query) | — | evidence file; restore drill `rd_tdMcm2_NfZs` | Restore Operator | Low | |
| Backup verification needs a restore | Implemented | `platformLogic.test.js` | — | Platform → Backups | Backup Operator | Low | |
| Object-storage backup | Future (no Documents service) | — | — | runbook 07 | — | n/a | |
| DR plans (20) and drill workflow | Implemented | live check (20 plans; states can't be skipped) | Approve each plan; run one DR drill on staging | Platform → DR | DR Coordinator | Medium | ✔ plan approval |
| Immutable, digest-pinned releases | Implemented | live check (`RELEASE_IMMUTABLE`, tags refused) | — | `build-release.sh` | Deployment Operator | Low | |
| Deployment approval and gates | Implemented | live check (11 gates failed an unready release; separation of duties) | — | Platform → Deployments | Change Approver | Low | ✔ |
| Rollback compatibility and Manual Recovery Required | Implemented, Unverified on a host | `platformLogic.test.js` | `rollback.sh` on staging | runbook 08 | Deployment Operator | Medium | |
| Dependency scan, SBOM and licences | Implemented; 0 Critical | CI `security.yml`, `dependencyScan.js`, `build-local.sh` | — | release manifest | Engineering Lead | Low | |
| Container scan | Implemented; run on every release | Trivy in `build-local.sh` (CI `images` job fails) | — | release manifest (0 Critical/High) | Deployment Operator | Low | |
| Health, readiness, detailed health | Implemented | live check | External uptime monitor | `/health`, `/ready`, Platform → Health | System Owner | Low | |
| Alerts (30 policies), metrics | Implemented | `platformLogic.test.js` (dedupe and cooldown), live check | Configure `ALERT_EMAIL_TO`; external uptime check | `/metrics` | System Owner | Medium (a dead host can't alert) | |
| Platform RBAC; org admin gets nothing | Implemented | `platformLogic.test.js`, `tenantIsolation.test.js`, live check (6 denials audited) | Map roles to people | Platform → Security | System Owner | Low | ✔ |
| Platform jobs (leases, retries, dead letter) | Implemented | live check (job runs recorded) | — | Platform → Alerts & jobs | Engineering Lead | Low | |
| Centralized retention and legal hold | Implemented | `tenantIsolation.test.js`, live dry run | Set the periods | Platform → Retention | Security Admin | Low | ✔ periods |
| Runbooks (23) | Implemented | `down -v` test | Rehearse runbooks 03, 06, 08 and 14 on staging | `docs/runbooks/` | System Owner | Medium | |
| Manual deploy workflow (no auto-deploy on push) | Implemented | — | Configure the GitHub `production` environment reviewers | `.github/workflows/deploy.yml` | System Owner | Low | ✔ |

## Measured RPO and RTO (non-production drill, 2026-09-25)

These are measurements on a workstation with a 0.7 MB development database. They are not production figures and not service commitments.

| Drill | Backup | Recovery point | RTO (restore to validated) | RPO |
|---|---|---|---|---|
| Logical backup to an isolated cluster, with the API smoke test | `pg_dump` + GPG | end of dump | **17 s** | 308 s: the dump's age when the restore began, which is the data a logical-only strategy would lose |
| Continuous archiving, then PITR to T | `pg_basebackup` + WAL archive | T = 02:36:51.435Z; recovered to 02:36:49.898Z, the last commit before T | **49 s** | **2 s**: the gap between the requested point and the last transaction before it |

The planning targets are RPO 15 min and RTO 4 h. They are **not** approved commitments.

## External dependencies and assumptions (not verified here)
- **Single host.** Loss of the host means downtime until a rebuild from repo2 (runbook 12). There is no high availability and no zero-downtime deployment.
- **Database:** one PostgreSQL instance, no replica.
- **DNS:** records and TTLs at the registrar; changes need approval.
- **Certificates:** Let's Encrypt HTTP-01 over port 80.
- **Backup storage:** repo2 needs a provider bucket with versioning or object lock. Its immutability is untested.
- **Operator access:** SSH keys, the password manager for escrowed keys, and two people for approvals. Where only one operator exists, `PLATFORM_ALLOW_SINGLE_OPERATOR` exceptions are audited but weaken separation of duties.
- **Manual recovery:** a production-in-place restore (runbook 05 Part C) and an incompatible rollback (forward fix or PITR) are manual by design.
- **Untested assumptions:**
  - pgBackRest behaviour in the container, including `archive-push` through the wrapper;
  - rclone off-site sync;
  - certbot renewal with the hook;
  - `live-restore` during Docker upgrades;
  - Prometheus scraping with the metrics token.

## Before asking for production approval
1. Fix or disposition the Critical dependency findings (jsPDF major-version upgrade), then re-scan.
2. On a staging host with Docker:
   - build the release (`build-release.sh`), including the Trivy image scan;
   - run `deploy/production/tests/backup-pitr-drill.sh`;
   - deploy with `deploy.sh`;
   - roll back with `rollback.sh`;
   - run an agent restore drill from the Platform UI.
3. Record the evidence in the Platform UI.
4. Approve the DR plans and the RPO/RTO targets, map the owner roles to people, and escrow the backup keys.
5. Re-assess this matrix.
