# 02 — Host firewall and production secrets

**Who:** System Owner (firewall), Security Admin (secrets). **Where:** host shell.

> Changing firewall rules on a live server can lock you out. Do this from a stable session, and make sure the provider's out-of-band console works first.

## Part A — Firewall (ports 80 and 443 only, SSH from the admin source)
1. Find the address you are connected from: `echo "$SSH_CLIENT" | cut -d' ' -f1`.
2. Run the script. It shows the current rules and your session, checks the hostname and asks for confirmation:
   ```bash
   sudo /opt/caspira/deploy/production/scripts/firewall.sh crm-prod-1 203.0.113.10/32 22
   ```
   Replace the hostname, source CIDR and SSH port with your values.
3. From a **second** terminal, confirm a new SSH login still works. Then confirm that `https://<your domain>` answers after runbook 03.
4. Also enable the same rules in the cloud provider's security group, if it has one.
5. **Never publish** 5432 (PostgreSQL), 6379 (Redis), 9090 (Prometheus) or any backup-agent port. `compose.yaml` publishes only the proxy's 80 and 443, and a test enforces that.

## Part B — Create production secrets
1. Create the missing secret files. The script never prints or overwrites a value:
   ```bash
   cd /opt/caspira/deploy/production
   sudo ./scripts/create-secrets.sh production
   ```
2. Paste the provider-issued values with an editor (never `echo`, which would land in shell history):
   ```bash
   sudoedit secrets/production/smtp_password
   sudoedit secrets/production/backup_offsite_credentials
   ```
   The off-site credentials file holds `key=…`, `secret=…` and `cipher=…` lines.
3. Check the permissions:
   ```bash
   sudo ls -l secrets/production/
   ```
   The directory must be `root:1500 0750` and every file `0440`.
4. **Escrow the backup keys** outside this host, in the organization's password manager or HSM. Two people should be able to retrieve them:
   - `backup_repo_cipher_pass`
   - `backup_logical_passphrase`
   - `backup_offsite_credentials`
   - `integrations_keys`: needed to decrypt stored integration credentials after a rebuild

   Without these keys the backups can't be decrypted. Never store them in the backup repository or the off-site bucket.
5. Create the environment file from the template. It holds no secrets:
   ```bash
   cp env/production.env.example env/production.env && nano env/production.env
   ```
   Set the domains, image digests from the release manifest, `TLS_CERT_DIR` and the SMTP host and user.
6. Staging uses `secrets/staging/` and `env/staging.env` with **different** values. Never copy files between environments.
7. After first start (runbook 03), record the secret metadata in *Platform → Security → Secrets*: owner, rotation interval and last rotation.

**Done when:**
- `ufw status` shows only 80, 443 and SSH from the admin source;
- every secret file exists with mode 0440;
- the backup keys are escrowed and a second person has confirmed they can retrieve them.
