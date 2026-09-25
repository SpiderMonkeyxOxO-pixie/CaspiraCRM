# Production cut-over on the aaPanel VPS (Phases 8–13)

This checklist moves production from the old backend stack to the Backend Phase 13 stack, on the **same database VPS**, behind the **same address**:
- the old stack is `deploy/vps-prod`, project `caspira-prod`;
- the new stack is `deploy/production` with the aaPanel layer, project `caspira-production`;
- the address stays `api.caspirasolutions.com`: Cloudflare, then aaPanel nginx, then `127.0.0.1:4010`.

Your data moves across as a verified dump. The old database and its volume stay untouched, so going back is one command until you decide to retire them.

**Terminals used**

| Label | What it is |
|---|---|
| 💻 **VS Code** | The VS Code terminal on your PC, in `D:\Caspira-CRM` |
| 🗄️ **DB VPS** | The database VPS (202.61.87.220): aaPanel → Terminal, or `ssh -p 16441 root@202.61.87.220` |
| 🌐 **Website VPS** | The server that hosts `caspiracrm.caspirasolutions.com`: its aaPanel → Terminal |
| 🖱️ **Browser** | GitHub, Cloudflare, the CRM |

**Rules for the whole checklist**
- Run one step at a time, and check the result the step describes before going on.
- If a step says **STOPPED** or anything looks different from what's described, don't improvise. Send me the output. **Never paste passwords, keys or tokens into the chat.**
- Nothing here touches the `mjw-*` or mysql containers, aaPanel sites, DNS or the firewall of the database VPS.
- **Downtime:** only Part E stops the live site, for about 15–30 minutes. Everything before it runs next to the live system.
- **Going back:** at any point in Part E or F, `sudo ./scripts/cutover-aapanel.sh rollback` on the DB VPS brings the old stack back in about a minute.

---

## Part A — Security first: the leaked deploy key (do this today)

Commit `eaeeece` (2025-11-24) put an SSH **private key** directly into `.github/workflows/deploy.yml`. It was later removed from the file, but it's still in the git history of this **public** repository, so anyone can read it. It was the key GitHub Actions used to log in to the **website VPS**.

**A1. 🌐 Website VPS: find the leaked key's fingerprint.** The site folder there is a git clone with the full history. A fingerprint is safe to show. The key itself goes into a root-only temporary file, which the last command destroys:
```bash
cd /www/wwwroot/caspiracrm.caspirasolutions.com
( umask 077; git show eaeeece:.github/workflows/deploy.yml | sed -n '/-----BEGIN/,/-----END/p' | sed 's/^[[:space:]]*//' > /root/leaked.key )
ssh-keygen -l -f /root/leaked.key
shred -u /root/leaked.key
```
Write down the `SHA256:…` fingerprint it prints.

**A2. 🌐 Website VPS: list which keys can log in:**
```bash
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do [ -f "$f" ] && echo "== $f" && ssh-keygen -l -f "$f"; done
```
If a line shows the same `SHA256:…` fingerprint as A1, **the leaked key still works**. Open that `authorized_keys` file (for example `nano /root/.ssh/authorized_keys`) and delete that one line.

**A3. 🌐 Website VPS: create a new deploy key for GitHub Actions:**
```bash
ssh-keygen -t ed25519 -N "" -C "github-actions-frontend-2026" -f /root/.ssh/github_frontend_deploy
cat /root/.ssh/github_frontend_deploy.pub >> /root/.ssh/authorized_keys
cat /root/.ssh/github_frontend_deploy
```
Copy the printed **private** key, including the BEGIN and END lines, straight into 🖱️ **GitHub → CaspiraCRM → Settings → Secrets and variables → Actions → `SSH_PRIVATE_KEY` → Update**. Don't paste it anywhere else. Then remove the file from the server:
```bash
shred -u /root/.ssh/github_frontend_deploy
```
If your GitHub secret `SERVER_USER` isn't `root`, use that user's home folder in place of `/root` in this step.

**A4. 🌐 Website VPS: look for logins you don't recognise.** How far back this reaches depends on the server's log retention.
```bash
last -Fw | head -40
journalctl -u ssh -u sshd --since "2025-11-24" 2>/dev/null | grep -i "accepted" | tail -40
```
If you see logins you don't recognise, **stop and tell me** before continuing. The off-site backups will live on this server.

**A5. 🗄️ DB VPS: remove the old backend deploy key.** The old backend GitHub job has been removed, so its key isn't needed any more. Only do this if you added it by following `VPS_PROD_SETUP.md` step 8:
```bash
ssh-keygen -l -f /root/.ssh/github_deploy.pub
ssh-keygen -l -f /root/.ssh/authorized_keys
```
Delete the matching line from `/root/.ssh/authorized_keys`, then run `shred -u /root/.ssh/github_deploy /root/.ssh/github_deploy.pub`. In 🖱️ GitHub, delete the secrets `BACKEND_SERVER_IP`, `BACKEND_SERVER_PORT`, `BACKEND_SERVER_USER` and `BACKEND_SSH_PRIVATE_KEY`.

**A6. Tell me when A1–A4 are done.** I'll then record the revoked key as a reviewed exception for the history scan, with today's date. Until then the CI "checks" job fails on purpose, and releases can't be built.

---

## Part B — Code and CI

**B1. 💻 VS Code:** push the prepared commit, plus the key-exception commit from A6:
```powershell
git push caspiracrm main
```
**B2. 🖱️ Browser:** open GitHub → CaspiraCRM → **Actions** → "Security and release evidence", then the run for the newest commit. The **checks** job must be green. It covers lint, migrations, server and frontend tests, build, and the policy, secret and dependency scans. If it's red, send me the name of the failed step.

---

## Part C — Prepare both servers (no downtime)

**C1. 🌐 Website VPS: the off-site backup user.** It can only use SFTP, locked into one folder, with no shell.
```bash
useradd --system --home-dir /srv/caspira-backup --shell /usr/sbin/nologin caspira-backup
install -d -o root -g root -m 0755 /srv/caspira-backup /srv/caspira-backup/.ssh
install -d -o caspira-backup -g caspira-backup -m 0700 /srv/caspira-backup/repo
touch /srv/caspira-backup/.ssh/authorized_keys && chmod 0644 /srv/caspira-backup/.ssh/authorized_keys
df -h /srv
```
The last line shows the free space. Backups need a few GB and grow slowly.

**C2. 🌐 Website VPS: SSH rules for that user.** Add these lines at the **end** of `/etc/ssh/sshd_config` with `nano /etc/ssh/sshd_config`:
```
Match User caspira-backup
    ChrootDirectory /srv/caspira-backup
    ForceCommand internal-sftp
    AllowTcpForwarding no
    X11Forwarding no
    PermitTTY no
    PasswordAuthentication no
    # The backup image's SSH library (libssh2 on libgcrypt) signs with ssh-rsa (SHA-1):
    # allowed for this jailed, SFTP-only user alone; backups are encrypted before upload.
    PubkeyAcceptedAlgorithms +ssh-rsa
```
Then check the file and reload SSH. **Keep your current session open.**
```bash
sshd -t && (systemctl reload ssh 2>/dev/null || systemctl reload sshd) && echo "reloaded"
grep -iE "^(Port|AllowUsers|AllowGroups)" /etc/ssh/sshd_config
```
- If `sshd -t` prints an error, remove the lines you added, then tell me.
- If an `AllowUsers` or `AllowGroups` line exists, add `caspira-backup` to it.
- Note the SSH `Port`; the default is 22.
- If the website VPS's aaPanel firewall limits SSH, allow that port from `202.61.87.220` only.

**C3. 🗄️ DB VPS: tools, groups and code:**
```bash
apt-get update && apt-get install -y jq git curl
getent group 1500 || groupadd -g 1500 caspira-secrets
getent group 1600 || groupadd -g 1600 caspira-backup-control
cd /opt/caspira-crm && git pull
docker compose version
```
The last line must show **2.24** or newer. If it's older, tell me.

**C4. 🗄️ DB VPS: settings files.** These hold no secrets.
```bash
cd /opt/caspira-crm/deploy/production
cp env/aapanel-production.env.example env/production.env
cp env/backup-offsite.sftp.env.example env/backup-offsite.env
nano env/backup-offsite.env
```
In `backup-offsite.env`, fill in:
- `PGBACKREST_REPO2_SFTP_HOST=`: the website VPS's IP address;
- `PGBACKREST_REPO2_SFTP_HOST_PORT=`: its SSH port from C2.

`production.env` is already filled in for your domains. Leave it as it is.

**C5. 🗄️ DB VPS: create the production secrets.** Values are never printed; only the backup **public** key is shown.
```bash
cd /opt/caspira-crm/deploy/production
./scripts/create-secrets.sh production
```
Copy the `ssh-rsa AAAA… caspira-production-backup` line it prints at the end. That's the public key, and it's safe to copy.

**C5b. 🗄️ DB VPS: send the public key to the website VPS** (no copy-paste; asks once for the website VPS root password):
```bash
cd /opt/caspira-crm/deploy/production
cat secrets/production/backup_offsite_sftp_key.pub | ssh root@<website-ip> 'printf "restrict %s
" "$(cat)" > /srv/caspira-backup/.ssh/authorized_keys && ssh-keygen -l -f /srv/caspira-backup/.ssh/authorized_keys'
```
If you use this, skip the manual paste in C6 (still note the host fingerprint it prints).

**C6. 🌐 Website VPS: authorize that public key.** Paste the line from C5 between the quotes:
```bash
echo 'restrict PASTE-THE-ssh-rsa-LINE-HERE' >> /srv/caspira-backup/.ssh/authorized_keys
ssh-keygen -l -E sha256 -f /etc/ssh/ssh_host_ed25519_key.pub
```
Keep the `SHA256:…` fingerprint the second line prints. It's the website VPS's identity.

**C7. 🗄️ DB VPS: pin the website VPS's identity and test SFTP.** Replace `<ip>` and `<port>`:
```bash
cd /opt/caspira-crm/deploy/production
ssh-keyscan -p <port> -t ed25519,ecdsa,rsa <ip> > env/offsite_known_hosts 2>/dev/null
ssh-keygen -l -E sha256 -f env/offsite_known_hosts
printf 'ls\nmkdir probe\nrmdir probe\n' | sftp -b - -i secrets/production/backup_offsite_sftp_key \
  -o UserKnownHostsFile=env/offsite_known_hosts -o StrictHostKeyChecking=yes -P <port> caspira-backup@<ip>
```
- The ED25519 fingerprint printed here must equal the one from C6. If it doesn't, **stop and tell me**.
- The `sftp` test must list `repo` and finish without errors.

**C8. 🗄️ DB VPS: keep the backup keys somewhere other than this server.** Without these three values the backups can't be decrypted. Open each file and copy its value into your password manager, then close the terminal output. **Never paste them into the chat.**
```bash
cd /opt/caspira-crm/deploy/production/secrets/production
cat backup_repo_cipher_pass; echo; cat backup_logical_passphrase; echo; grep '^cipher=' backup_offsite_credentials
```
The credential-vault keyring gets copied from the old stack in Part D.

---

## Part D — Build, check and rehearse (no downtime)

**D1. 🗄️ DB VPS: build the release** from the pushed commit. It takes about 10–15 minutes and doesn't touch the running site.
```bash
cd /opt/caspira-crm/deploy/production
./scripts/build-local.sh origin/main production
```
At the end it prints a summary and the release ID, for example `2026.09.26-1a2b3c4d5e6f`. **Send me the summary lines**; they are scan counts, with no secrets. Any `critical` in a container line means we fix that first.

**D2. 🗄️ DB VPS: select the release and run the preflight:**
```bash
./scripts/cutover-aapanel.sh select-release <release-id>
./scripts/cutover-aapanel.sh import-secrets
./scripts/cutover-aapanel.sh preflight
```
The preflight lists OK/FAIL lines and ends with **Preflight passed.** If it doesn't, send me the FAIL lines.

**D3. 🗄️ DB VPS: rehearsal.** This restores a copy of today's production data into a throwaway, network-less container and checks it. The live site keeps running.
```bash
./scripts/cutover-aapanel.sh dump-old
./scripts/cutover-aapanel.sh rehearse /root/caspira-cutover/legacy-<stamp>.dump
```
Use the dump file name that `dump-old` printed. The rehearsal must end with **Rehearsal PASSED**, and it reports how long the restore took.

---

## Part E — The switch (about 15–30 minutes of downtime)

Pick a quiet time, and tell your users beforehand.

**E1. 🗄️ DB VPS: stop the old api and worker.** It asks you to type `YES`. The old database keeps running.
```bash
cd /opt/caspira-crm/deploy/production
./scripts/cutover-aapanel.sh stop-old
```
**E2. Final copy of the data**, now that nothing is writing:
```bash
./scripts/cutover-aapanel.sh dump-old
```
**E3. Restore it into the new database:**
```bash
./scripts/cutover-aapanel.sh restore /root/caspira-cutover/legacy-<stamp-from-E2>.dump
```
This also proves WAL archiving to the website VPS works, **before** any data goes in. It ends with "counts and migration version match".

**E4. Apply the Phase 8–13 database changes:**
```bash
./scripts/cutover-aapanel.sh migrate
```
**E5. Built-in roles, integrations, AI registry and analytics:**
```bash
./scripts/cutover-aapanel.sh seed
```
**E6. Start the new backend:**
```bash
./scripts/cutover-aapanel.sh start
```
**E7. First full backup, local and off-site:**
```bash
./scripts/cutover-aapanel.sh backup-init
```
**E8. Verify:**
```bash
./scripts/cutover-aapanel.sh verify
```
It must end with **Verification passed.** The public check goes through Cloudflare and aaPanel, exactly as your users will.

> If E3–E8 stop with an error: `./scripts/cutover-aapanel.sh rollback` (type `YES`) puts the old stack back, then send me the output. Nothing is lost: the old database was never changed.

**E9. 🖱️ Browser: deploy the new frontend.** GitHub → CaspiraCRM → **Actions** → "Deploy Frontend (manual, approved)" → **Run workflow** → type `DEPLOY`. When it's green, open https://caspiracrm.caspirasolutions.com and sign in as the System Owner.

---

## Part F — After the switch (the same day)

1. 🖱️ **Two-factor authentication:** Settings → Security → turn on two-factor authentication for the System Owner.
2. 🖱️ **Automation token:** Platform Operations → Security & secrets. Create a token with scopes `deployment:read`, `deployment:report` and `release:register`, valid for 90 days. Copy it once. Then save it on the server; the value is typed, never shown:
   ```bash
   install -d -m 0700 /etc/caspira/production
   read -rs -p "token: " T && printf '%s' "$T" > /etc/caspira/production/deploy-token && unset T && chmod 0400 /etc/caspira/production/deploy-token && echo
   ```
3. 🗄️ **Register the release**, so its scans become findings:
   ```bash
   cd /opt/caspira-crm/deploy/production && ./scripts/register-release.sh <release-id> production
   ```
4. 🖱️ **Restore drill:** Platform Operations → Restores & drills → **Start a restore drill**. It must show **Passed**. This is the proof that the new backups actually restore.
5. 🖱️ **Health:** Platform Operations → Health should show the database, Redis, worker and scheduler heartbeats, the backup agent and the WAL archive as ok.
6. 🗄️ **Mail:** Mailpit works as before: `ssh -N -p 16441 -L 8026:127.0.0.1:8026 root@202.61.87.220`, then http://localhost:8026.

## Part G — Later (separate decisions)

- **Keep the old stack** (stopped api and worker, running database, volume `caspira-prod_caspira_prod_db_data`) for at least 7 days. Retiring it is a separate, approved step. Don't delete volumes by hand.
- **Every later release** goes through `build-local.sh`, then Platform → Releases & deployments (register, a second person approves, execute the gates), then `scripts/deploy.sh` ([runbook 06](../runbooks/06-controlled-deployment.md)). The cut-over scripts are for this one time only.
- **Still open:** the approvals listed in [PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md), such as DR plan approval, the RPO/RTO targets and naming the role holders.
