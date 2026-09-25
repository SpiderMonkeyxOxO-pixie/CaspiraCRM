# 06 — Controlled deployment

**Who:**
- a Deployment Operator plans and executes;
- a **Change Approver** (a different person) approves.

**Where:** the build machine, then the Platform UI, then the host shell.

1. **Build once** (build machine, clean checkout of the tagged commit):
   ```bash
   REGISTRY=registry.example.com/caspira ./deploy/production/scripts/build-release.sh 1.13.0
   ```
   The script:
   - runs lint and every test suite;
   - builds the images once and pushes them;
   - records their **digests**;
   - runs the policy, secret, dependency and licence scans (plus Trivy and Syft if installed);
   - writes the SBOMs and `releases/<id>/manifest.json`.

   Register the release with the API (token scope `release:register`), or upload the manifest in *Platform → Releases*.
2. **Approve the release:** a person other than the registrant approves it in *Platform → Releases*.
3. **Stage first:**
   - Plan a deployment to **staging** with the same release. The same digests go to staging; nothing is rebuilt.
   - Deploy it (steps 5–6) and let it soak.
4. **Plan the production deployment** in *Platform → Deployments*:
   - Choose the release.
   - Set **maintenance required** if the release has a destructive or contract migration, and give a communication note of at least 10 characters.
5. **Approve** the deployment (a second person, with password confirmation). Then press **Execute**. The API:
   - takes the deployment lock;
   - evaluates every gate: tests, scans, SBOM, critical findings, approvals, configuration, backup freshness and WAL lag, a restore drill within the interval, disk, database health, migration preflight, rollback procedure and communication.

   If any gate fails, the deployment becomes **Failed** with the reasons. Fix the cause, or request a scoped, time-limited exception; only some gates allow that. Then plan again.
   When every gate passes, the status becomes **Deploying**.
6. **Run the host script** (host shell):
   ```bash
   cd /opt/caspira/deploy/production
   ./scripts/deploy.sh <deployment-id> production
   ```
   The script:
   - refuses unless the API says **Deploying**;
   - pulls images **by digest only** and checks them;
   - takes a pre-deployment backup;
   - runs `migrate --check`, then the migrations (reporting **Migrating**);
   - replaces the api, worker and web containers and waits for health (reporting **Verifying**);
   - runs the smoke tests and reports **Completed**.

   Any failure reports **Failed** and stops. The script never deletes volumes and never downgrades the schema.
7. **Watch:** *Platform → System health* and the alerts for 30 minutes.
8. If it goes wrong, follow [runbook 08](08-rollback-a-release.md) (rollback) or [runbook 10](10-failed-migration.md) (failed migration).

**Downtime:** a single host restarts the API containers. Expect a short interruption (seconds, usually), and longer when a migration takes locks. **No zero-downtime guarantee is made.**
