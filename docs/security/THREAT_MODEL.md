# Caspira CRM — Threat Model

Version 1 · Backend Phase 13 · 2026-09-25 · next full review **2027-03-25** (or after any change to authentication, tenancy, deployment topology or backup design).

This is an engineering artifact. It records what the repository actually does, what is still required, and what risk remains. It is **not** a compliance claim or certification.

## Scope and trust boundaries

| ID | Boundary | Crosses |
|----|----------|---------|
| B1 | Internet → reverse proxy | Untrusted browsers, API clients, webhook senders, OAuth redirects |
| B2 | Proxy → web / API | Only HTTP from the proxy, over the internal `app` network, with forwarded headers from one trusted hop |
| B3 | API / worker → data tier | PostgreSQL and Redis on the internal `data` network. The runtime role has DML only. |
| B4 | Tenant ↔ tenant | Organization scope, enforced in the application (no row-level security) |
| B5 | Organization admin ↔ platform operator | Platform RBAC (`platform.*`). Organization roles grant nothing here. |
| B6 | Application → external providers | Egress network: email, AI, payment and integration providers, OAuth |
| B7 | Worker ↔ backup agent | File-based control volume holding an allowlist of typed requests. No commands and no Docker socket. |
| B8 | Host → off-site backup storage | Encrypted pgBackRest repo2, with credentials separate from the application |
| B9 | Build and CI → registry → host | Digest-pinned images, SBOMs and scans. Deployments need approval. |
| B10 | Operator → host | SSH from the administrative source only; secrets are files owned by root |

Owners are role names. The organization must map each role to a named person before production approval. Owner roles are: **System Owner**, **Security Admin**, **Deployment Operator**, **Backup Operator**, **Restore Operator**, **DR Coordinator**, **Engineering Lead** and **Finance Owner**.

Residual risk is rated **Low**, **Medium** or **High** after the existing controls.

---

### T01 Authentication
- **Asset:** user accounts, sessions. **Boundary:** B1.
- **Scenario:** credential stuffing, password spraying or brute force against `/auth/login`.
- **Existing control:**
  - bcrypt/argon hashes;
  - generic errors and equal-cost failures (a dummy hash for unknown accounts);
  - Redis login rate limit per IP and account;
  - audit of every attempt;
  - TOTP enforced on session login when enabled (Phase 13);
  - legacy bearer API disabled in staging and production.
- **Required control:** MFA mandatory for System Owners and platform roles; breached-password screening.
- **Detection:** `login_failures`, `password_spraying` and `privileged_login_failures` alert policies; audit `auth.login` Failure.
- **Recovery:** runbook 17 (revoke sessions, force a reset).
- **Residual risk:** Medium, because MFA is optional per user.
- **Owner:** Security Admin.

### T02 Session handling
- **Asset:** access and refresh cookies. **Boundary:** B1.
- **Scenario:** a stolen refresh token is replayed, or a session outlives the user's intent.
- **Existing control:**
  - httpOnly cookies, Secure outside development, SameSite lax by default;
  - 15-minute access tokens;
  - refresh rotation with family reuse detection;
  - idle and absolute lifetimes (absolute from password login; refresh can't extend it);
  - `requireLiveSession` on privileged platform routes;
  - logout and account-disable revoke sessions.
- **Required control:** device and session listing for users.
- **Detection:** audit `auth.refresh_reuse_detected`.
- **Recovery:** revoke the session family; runbook 17.
- **Residual risk:** Low.
- **Owner:** Security Admin.

### T03 Password reset
- **Asset:** account takeover path. **Boundary:** B1 and B6 (email).
- **Scenario:** reset token guessing, reuse, or enumeration through the reset form.
- **Existing control:** random tokens stored hashed, short expiry, single use, generic "if the account exists" response, rate limit.
- **Required control:** notify the user when a reset completes.
- **Detection:** audit of reset requests and completions.
- **Recovery:** runbook 17.
- **Residual risk:** Low.
- **Owner:** Security Admin.

### T04 MFA and recovery
- **Asset:** second factor. **Boundary:** B1.
- **Scenario:**
  - OTP brute force;
  - MFA bypass through the session login (fixed in Phase 13);
  - abuse of the recovery path.
- **Existing control:**
  - TOTP window of 1;
  - login rate limit;
  - a 5-minute 2FA-pending token;
  - MFA enforced on both login surfaces.
- **Required control:** recovery codes, with audited use and admin-assisted recovery with a second approver.
- **Detection:** audit `auth.mfa` Failure; login-failure alerts.
- **Recovery:** the System Owner resets MFA with a recorded reason.
- **Residual risk:** Medium, because there are no recovery codes yet.
- **Owner:** Security Admin.

### T05 Tenant boundary enforcement
- **Asset:** every tenant's CRM data. **Boundary:** B4.
- **Scenario:** a query without an organization filter returns another tenant's rows.
- **Existing control:**
  - organization scope resolved from membership before retrieval and aggregation;
  - analytics apply the scope before calculation (Phase 12 tests);
  - tenant isolation tests in the release gate.
- **Required control:** keep isolation tests mandatory for every new module. PostgreSQL RLS is **not** implemented and is not claimed.
- **Detection:** authorization-denial alerts; audit.
- **Recovery:** incident runbook 20; notify affected tenants.
- **Residual risk:** Medium, because isolation is enforced by the application only.
- **Owner:** Engineering Lead.

### T06 IDOR / broken object-level authorization
- **Asset:** records addressed by ID. **Boundary:** B4.
- **Scenario:** changing an ID in a URL to read or modify another tenant's or user's record.
- **Existing control:**
  - lookups are scoped by `organizationId` plus record permission;
  - 404 rather than 403 for foreign records;
  - public IDs on platform objects.
- **Required control:** keep scope-first lookups; add negative tests per new route.
- **Detection:** repeated 404 and 403 patterns (the `authorization_failures` alert).
- **Recovery:** runbook 20.
- **Residual risk:** Medium.
- **Owner:** Engineering Lead.

### T07 Administrative impersonation
- **Asset:** tenant data reached through support access. **Boundary:** B5.
- **Scenario:** an operator impersonates a user silently or indefinitely.
- **Existing control:** no impersonation feature exists; operators can't sign in as users.
- **Required control:** if impersonation is ever added, it must be time-boxed, require recent authentication and a reason, carry a banner and be audited.
- **Detection:** not applicable.
- **Recovery:** not applicable.
- **Residual risk:** Low.
- **Owner:** System Owner.

### T08 Role and permission escalation
- **Asset:** RBAC. **Boundary:** B4 and B5.
- **Scenario:** an organization admin grants themselves platform or cross-tenant power, or edits system roles.
- **Existing control:**
  - organization roles can't grant `platform.*`;
  - platform roles are granted only by the System Owner, with a reason and audit;
  - system roles are immutable;
  - permission changes are audited.
- **Required control:** a periodic access review, recorded in the baseline.
- **Detection:** `permission_changes` and `platform_role_changes` alerts.
- **Recovery:** revoke the role; runbook 17.
- **Residual risk:** Low.
- **Owner:** Security Admin.

### T09 SQL and command injection
- **Asset:** the database and the host. **Boundary:** B2 and B3.
- **Scenario:** injected SQL through filters or sorts; shell injection through backup or restore parameters.
- **Existing control:**
  - Prisma parameterized queries; raw SQL only as tagged templates;
  - sort and filter allowlists;
  - no user SQL in reports;
  - the backup agent accepts typed, allowlisted parameters, and the API never runs shell commands.
- **Required control:** keep the raw SQL review in code review.
- **Detection:** 5xx spikes (the `error_rate` alert); the slow-query log.
- **Recovery:** PITR (runbook 05).
- **Residual risk:** Low.
- **Owner:** Engineering Lead.

### T10 Stored and reflected XSS
- **Asset:** user sessions in the SPA. **Boundary:** B1.
- **Scenario:** script in CRM fields, documents or AI output runs in another user's browser.
- **Existing control:**
  - React escaping;
  - API CSP `default-src 'none'`;
  - SPA CSP at the proxy;
  - `nosniff`;
  - JSON-only API.
- **Required control:** tighten the SPA CSP to remove `'unsafe-inline'` styles when the UI allows it.
- **Detection:** CSP report endpoint (future).
- **Recovery:** revoke sessions; fix and redeploy.
- **Residual risk:** Low.
- **Owner:** Engineering Lead.

### T11 CSRF
- **Asset:** state-changing endpoints. **Boundary:** B1.
- **Scenario:** a cross-site form posts using the victim's cookies.
- **Existing control:**
  - double-submit CSRF token on cookie-authenticated mutations;
  - SameSite cookies;
  - JSON content type enforced (415);
  - CORS allowlist without wildcards.
- **Required control:** none additional.
- **Detection:** audit of CSRF failures.
- **Recovery:** not applicable.
- **Residual risk:** Low.
- **Owner:** Engineering Lead.

### T12 SSRF
- **Asset:** internal network and metadata endpoints. **Boundary:** B6.
- **Scenario:** a webhook target or integration URL points at an internal address.
- **Existing control:**
  - private and loopback webhook targets are refused;
  - production refuses `ALLOW_PRIVATE_WEBHOOK_TARGETS`;
  - the data network is internal (no egress).
- **Required control:** resolve DNS at request time and pin the resolved address.
- **Detection:** outbound delivery failures; integration logs.
- **Recovery:** disable the integration.
- **Residual risk:** Medium, because DNS rebinding is not yet pinned.
- **Owner:** Engineering Lead.

### T13 Open redirects
- **Asset:** user trust and OAuth flows. **Boundary:** B1.
- **Scenario:** `?redirect=` sends users to a phishing site.
- **Existing control:** redirects only to configured origins; OAuth callbacks are fixed per provider.
- **Required control:** none additional.
- **Detection:** not applicable.
- **Recovery:** not applicable.
- **Residual risk:** Low.
- **Owner:** Engineering Lead.

### T14 Unsafe file uploads
- **Asset:** the host and users. **Boundary:** B1.
- **Scenario:** executable or oversized uploads, or path traversal.
- **Existing control:**
  - JSON body limit;
  - branding uploads type- and size-checked;
  - read-only root filesystems;
  - no upload execution path.
- **Required control:** when the Documents service is built, use content sniffing, storage outside the web root and signed download URLs.
- **Detection:** 413 counts.
- **Recovery:** remove the object; restore it if needed (runbook 07).
- **Residual risk:** Medium, because the Documents service is not built.
- **Owner:** Engineering Lead.

### T15 Malware-bearing documents
- **Asset:** users who download files. **Boundary:** B1.
- **Scenario:** a user uploads an infected file that others download.
- **Existing control:** none; no scanning exists.
- **Required control:** ClamAV or a provider scan before a file becomes available, plus quarantine (retention category reserved).
- **Detection:** future `security_malware_detected` signal.
- **Recovery:** quarantine and notify.
- **Residual risk:** High **if** document uploads are enabled; not applicable until then.
- **Owner:** Security Admin.

### T16 Webhook forgery and replay
- **Asset:** payment and integration state. **Boundary:** B1 and B6.
- **Scenario:** a forged or replayed provider webhook marks invoices paid.
- **Existing control:**
  - signature verification on the raw body;
  - timestamp tolerance;
  - idempotent event IDs;
  - raw payloads subject to a retention policy.
- **Required control:** rotate webhook secrets (runbook 16).
- **Detection:** the `webhook_signature_failures` alert.
- **Recovery:** reconcile against the provider.
- **Residual risk:** Low.
- **Owner:** Finance Owner.

### T17 OAuth account-linking attacks
- **Asset:** integration connections. **Boundary:** B6.
- **Scenario:** a CSRF'd OAuth callback links the attacker's account, or a stolen code is redeemed.
- **Existing control:** a signed, expiring `state`; PKCE where the provider supports it; state bound to the session.
- **Required control:** none additional.
- **Detection:** the `oauth_state_failures` alert.
- **Recovery:** disconnect and reconnect.
- **Residual risk:** Low.
- **Owner:** Engineering Lead.

### T18 API token theft
- **Asset:** automation and integration tokens. **Boundary:** B9 and B10.
- **Scenario:** a deploy token leaks from the host or CI logs.
- **Existing control:**
  - `cpat_` tokens stored as HMAC with a pepper;
  - shown once, scoped, expiring after 1–90 days, revocable;
  - environment-bound;
  - use is audited.
- **Required control:** keep tokens out of CI output (the secret scan covers this).
- **Detection:** audit `automation_token.denied`.
- **Recovery:** revoke and reissue (runbook 17).
- **Residual risk:** Low.
- **Owner:** Deployment Operator.

### T19 Export and bulk-download abuse
- **Asset:** tenant data in bulk. **Boundary:** B4.
- **Scenario:** an insider exports everything before leaving.
- **Existing control:**
  - export permission;
  - governed exports with approval above thresholds;
  - encrypted, expiring files;
  - download audit;
  - recent authentication for sensitive exports.
- **Required control:** per-user export volume baselines.
- **Detection:** the `unusual_exports` and `large_downloads` alerts.
- **Recovery:** revoke the export; run the incident process.
- **Residual risk:** Medium.
- **Owner:** Security Admin.

### T20 Workflow or automation abuse
- **Asset:** outbound email and data changes. **Boundary:** B4 and B6.
- **Scenario:** a workflow loops, spams customers or mass-edits records.
- **Existing control:** per-organization rate limits, run limits and timeouts; AI workflow approvals; dead-letter queues.
- **Required control:** a per-workflow kill switch in the UI.
- **Detection:** queue delay and job failure alerts.
- **Recovery:** cancel runs; restore records through PITR only in extreme cases.
- **Residual risk:** Medium.
- **Owner:** Engineering Lead.

### T21 AI prompt injection and unsafe tool execution
- **Asset:** tenant data and actions. **Boundary:** B6.
- **Scenario:** injected content in CRM data makes the copilot exfiltrate or act.
- **Existing control:**
  - Phase 10 and 11 governance: tool allowlists, human approval for writes, per-tenant retrieval scope, output safety checks, redaction, kill switches and staged rollout.
- **Required control:** continuous evaluation sets (Phase 11).
- **Detection:** AI safety events and alerts.
- **Recovery:** kill switch; roll back the prompt version.
- **Residual risk:** Medium.
- **Owner:** Engineering Lead.

### T22 Payment and billing fraud
- **Asset:** invoices and payments. **Boundary:** B6.
- **Scenario:** tampered amounts, fake payment confirmations or refund abuse.
- **Existing control:** server-side totals, signed provider webhooks, approval for refunds and credit notes, finance audit.
- **Required control:** reconciliation reports reviewed monthly.
- **Detection:** finance audit; reconciliation mismatches.
- **Recovery:** reverse through the provider; restore through PITR in extreme cases.
- **Residual risk:** Low.
- **Owner:** Finance Owner.

### T23 Supply-chain compromise (build and CI)
- **Asset:** release images. **Boundary:** B9.
- **Scenario:** a compromised action or base image injects code.
- **Existing control:**
  - GitHub Actions pinned by SHA;
  - base images pinned by digest;
  - releases are immutable manifests with digests, SBOMs and scans;
  - deployments by digest only;
  - production deployment is manual and needs a second approver.
- **Required control:** image signing and verification (cosign), recommended.
- **Detection:** scan reports; digest mismatch in `deploy.sh`.
- **Recovery:** roll back the release (runbook 08).
- **Residual risk:** Medium, because images are not signed.
- **Owner:** Deployment Operator.

### T24 Dependency compromise
- **Asset:** npm dependencies. **Boundary:** B9.
- **Scenario:** a malicious or vulnerable package version.
- **Existing control:**
  - lockfiles and `npm ci`;
  - exact pins for new dev tooling;
  - `npm audit`, the policy check (floating versions, install scripts) and license report;
  - Critical findings block deployment.
- **Required control:** fix the open advisories (see the readiness matrix).
- **Detection:** the `critical_security_finding` alert.
- **Recovery:** pin or upgrade; redeploy.
- **Residual risk:** **High today**: 2 Critical and 9 High advisories are open in the web and server dependency trees.
- **Owner:** Engineering Lead.

### T25 Container escape
- **Asset:** the host. **Boundary:** B10.
- **Scenario:** an attacker with code execution in the API breaks out.
- **Existing control:**
  - non-root users, `cap_drop: ALL`, `no-new-privileges`;
  - read-only root filesystem, PID, memory and CPU limits;
  - no privileged containers and no host namespaces.
- **Required control:** rootless Docker or user-namespace remapping (recommended); a kernel patch cadence.
- **Detection:** host audit logs (auditd).
- **Recovery:** rebuild the host (runbook 12).
- **Residual risk:** Low.
- **Owner:** System Owner.

### T26 Docker daemon access
- **Asset:** root-equivalent control of the host. **Boundary:** B10.
- **Scenario:** a container or user with access to the Docker socket takes over the host.
- **Existing control:**
  - no container mounts the socket (the policy check enforces this);
  - the backup agent uses a control volume instead;
  - `docker` group membership is limited to named administrators (host baseline).
- **Required control:** a periodic group-membership review.
- **Detection:** `check-host.sh`; auditd on `/var/run/docker.sock`.
- **Recovery:** runbook 17.
- **Residual risk:** Low.
- **Owner:** System Owner.

### T27 Backup theft
- **Asset:** full copies of all tenant data. **Boundary:** B8.
- **Scenario:** a bucket or volume with backups is read by an outsider.
- **Existing control:**
  - pgBackRest repositories encrypted with aes-256-cbc;
  - logical and configuration backups encrypted with GPG AES-256;
  - keys escrowed separately and never stored with backups;
  - off-site credentials separate from the application.
- **Required control:** a bucket policy that denies public access; a write-only key where the provider supports it.
- **Detection:** provider access logs.
- **Recovery:** rotate backup keys (runbook 16) and take new full backups.
- **Residual risk:** Low.
- **Owner:** Backup Operator.

### T28 Backup poisoning
- **Asset:** recoverability. **Boundary:** B7 and B8.
- **Scenario:** an attacker alters or deletes backups so recovery fails when needed.
- **Existing control:**
  - pgBackRest checksums and `verify`;
  - verification recorded separately from jobs;
  - isolated restore drills with application validation;
  - failed artifacts are kept for investigation;
  - off-site copy.
- **Required control:** object lock or immutability on repo2 where the provider supports it (configurable, not verified here).
- **Detection:** `restore_verification_overdue` and `wal_archive_lag` alerts; artifacts that fail verification stay Unverified.
- **Recovery:** use the other repository; runbook 19.
- **Residual risk:** Medium, because immutability is not verified.
- **Owner:** Backup Operator.

### T29 Ransomware
- **Asset:** host data and backups. **Boundary:** B10.
- **Scenario:** host compromise encrypts volumes, including the local backup repository.
- **Existing control:** encrypted off-host copy (repo2) with separate credentials; documented rebuild from a new host.
- **Required control:** immutable off-site retention; an offline copy of the escrowed keys.
- **Detection:** disk and I/O anomalies; backup failures.
- **Recovery:** runbooks 12 and 05 onto a clean host.
- **Residual risk:** Medium on a single host.
- **Owner:** System Owner.

### T30 Accidental deletion
- **Asset:** tenant records and volumes. **Boundary:** B3 and B10.
- **Scenario:** an operator deletes data or runs `compose down -v`.
- **Existing control:**
  - soft deletes where implemented;
  - PITR to a timestamp before the mistake, into an isolated target;
  - runbooks never use `down -v` (enforced by tests);
  - named volumes and explicit targets.
- **Required control:** none additional.
- **Detection:** audit of deletions.
- **Recovery:** runbook 05 (PITR, then selective re-import).
- **Residual risk:** Low.
- **Owner:** Restore Operator.

### T31 Insider misuse
- **Asset:** tenant data and platform controls. **Boundary:** B5.
- **Scenario:** a privileged operator restores, exports or deploys without oversight.
- **Existing control:**
  - separation of duties (requester ≠ approver) for restores, deployments, rollbacks and Critical exceptions;
  - staffing exceptions only with `PLATFORM_ALLOW_SINGLE_OPERATOR` and an audited reason;
  - recent authentication on sensitive actions.
- **Required control:** a quarterly access review.
- **Detection:** audit and platform role-change alerts.
- **Recovery:** revoke access; investigate with the evidence runbook (22).
- **Residual risk:** Medium in small teams that use single-operator exceptions.
- **Owner:** System Owner.

### T32 Log tampering
- **Asset:** audit trail integrity. **Boundary:** B3 and B10.
- **Scenario:** an attacker deletes or edits audit events to hide activity.
- **Existing control:**
  - the runtime role has DML on audit tables. There is **no** database-level append-only guarantee and none is claimed.
  - audit retention is at least 90 days in strict profiles;
  - backups hold historical audit rows;
  - container logs are rotated and can be shipped off-host.
- **Required control:** off-host log shipping (recommended) or an append-only audit role.
- **Detection:** `audit_integrity` checks in restore validation; gaps in event counts.
- **Recovery:** compare against a restored copy.
- **Residual risk:** Medium.
- **Owner:** Security Admin.

### T33 Secret leakage
- **Asset:** keys and passwords. **Boundary:** B9 and B10.
- **Scenario:** secrets land in git, images, build args, logs or error responses.
- **Existing control:**
  - file-based secrets (`/run/secrets`), not environment values, in strict profiles;
  - startup refuses env secrets;
  - log redaction of loaded secrets;
  - safe error envelopes;
  - gitleaks and the repository secret scan in CI;
  - `.dockerignore` excludes `.env` and keys;
  - a metadata-only inventory.
- **Required control:** rotate any secret ever exposed (runbooks 15, 16 and 17).
- **Detection:** secret-scan findings; the `failed_secret_access` alert.
- **Recovery:** emergency revocation (runbook 17).
- **Residual risk:** Low.
- **Owner:** Security Admin.

### T34 Denial of service
- **Asset:** availability. **Boundary:** B1.
- **Scenario:** request floods or slowloris attacks exhaust the single host.
- **Existing control:**
  - proxy rate limits, connection limits, body and header limits and timeouts;
  - API rate limit per IP;
  - request timeout;
  - HTTP server header, request and keep-alive timeouts.
- **Required control:** an upstream CDN or DDoS provider for volumetric attacks (not provided).
- **Detection:** `api_unavailable`, `error_rate` and `high_volume_api` alerts.
- **Recovery:** maintenance page; raise limits.
- **Residual risk:** **High** for volumetric attacks on one host. There is no high-availability claim.
- **Owner:** System Owner.

### T35 Resource exhaustion
- **Asset:** disk, memory, database connections and the queue. **Boundary:** B3 and B10.
- **Scenario:** WAL, logs or exports fill the disk; runaway queries exhaust the connection pool.
- **Existing control:**
  - container memory, CPU and PID limits;
  - log rotation;
  - statement, lock and idle-in-transaction timeouts per role;
  - connection limits;
  - `disk_nearly_full`, `pool_exhaustion` and `queue_delay` alerts;
  - retention jobs.
- **Required control:** separate disks for data and backups (recommended).
- **Detection:** capacity alerts.
- **Recovery:** runbook 18.
- **Residual risk:** Medium on a single host.
- **Owner:** System Owner.
