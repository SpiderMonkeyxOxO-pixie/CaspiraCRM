# 08 — Roll back an application release

**Who:**
- a Deployment Operator requests;
- a **different** person approves.

**Where:** Platform UI, then the host shell.

1. In *Platform → Deployments*, open the current deployment and choose **Request rollback** with the target release (normally the previous one).
2. The API checks **schema compatibility**:
   - **Compatible:** the schema has no migrations the target doesn't know, or the current release declared itself backward-compatible with the target (expand-only migrations, no destructive change). The rollback gets an approval request.
   - **Incompatible:** the status becomes **Manual Recovery Required**. **Do not force an image rollback.** The old code can corrupt data under a newer schema. Choose one of:
     - a **forward fix**: a new release that fixes the bug (preferred);
     - **point-in-time recovery** to just before the migration ([runbook 05](05-restore-and-pitr.md), Part C). This loses writes made after that point, which the incident must accept explicitly.
3. The approver approves (with password confirmation).
4. Host shell:
   ```bash
   cd /opt/caspira/deploy/production
   ./scripts/rollback.sh <rollback-deployment-id> production
   ```
   The script:
   - pulls the target digests;
   - replaces the api, worker and web containers;
   - waits for health, runs the smoke tests and reports **Rolled Back**.

   **No migrations run and the schema is never downgraded.**
5. **Configuration-only rollback:** restore the previous `env/production.env` from the configuration backup (runbook 07), then run `docker compose --env-file env/production.env up -d --wait api worker`.
6. **Proxy-only rollback:** restore the previous `proxy/conf.d` files, then run `docker compose --env-file env/production.env exec -T proxy nginx -t && docker compose --env-file env/production.env exec -T proxy nginx -s reload`.
7. **Worker-only rollback:** follow the same flow as step 4. The worker image is the API image, so the rollback covers both.
