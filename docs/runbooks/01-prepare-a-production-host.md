# 01 — Prepare a production host

**Who:** System Owner. **Where:** host shell. **Time:** about 1 hour.

This runbook assumes Ubuntu 24.04 LTS (or Debian 12) with at least 4 vCPU, 8 GB RAM and 2 disks: one for the system and data, one for the local backup repository.

1. **Patch the OS and enable unattended security updates.**
   ```bash
   sudo apt-get update && sudo apt-get -y upgrade
   sudo apt-get install -y unattended-upgrades auditd chrony jq curl ufw
   sudo dpkg-reconfigure -plow unattended-upgrades
   ```
2. **Set the hostname** (used by the firewall script as a safety check):
   ```bash
   sudo hostnamectl set-hostname crm-prod-1
   ```
3. **SSH:** keys only, no root login.
   - Add your public key to `~/.ssh/authorized_keys`.
   - Then, in `/etc/ssh/sshd_config.d/10-caspira.conf`:
     ```
     PasswordAuthentication no
     PermitRootLogin no
     KbdInteractiveAuthentication no
     ```
   - Run `sudo systemctl reload ssh`.
   - Keep your current session open and confirm that a **new** session still logs in before closing it.
4. **Time sync:** check with `timedatectl`. It must show `System clock synchronized: yes`. Token expiry, TOTP and PITR timestamps depend on the clock.
5. **Disk encryption:** use provider-managed volume encryption or LUKS for the data and backup disks. Record which one in *Platform → Security → Baseline*.
6. **Backup disk:** mount it at `/srv/caspira-backup` (ext4, `noatime`). The backup repository volume is bound there. Keep it separate from the data disk, so losing one doesn't lose both.
7. **Audit logging:**
   ```bash
   sudo auditctl -w /var/run/docker.sock -k docker-socket
   sudo auditctl -w /opt/caspira/deploy/production/secrets -k caspira-secrets
   ```
   To make the rules persistent, add the same lines (without `sudo auditctl`) to `/etc/audit/rules.d/caspira.rules`.
8. **Install Docker:** follow [runbook 23](23-install-and-upgrade-docker.md). Add only named administrators to the `docker` group. Membership is root-equivalent.
9. **Get the code:**
   ```bash
   sudo mkdir -p /opt/caspira && sudo chown "$USER" /opt/caspira
   git clone <repository-url> /opt/caspira
   ```
   Check out the exact release tag or commit you will deploy.
10. **Create the groups the containers share:**
    ```bash
    sudo groupadd -g 1500 caspira-secrets
    sudo groupadd -g 1600 caspira-backup-control
    ```
11. **Run the read-only baseline check** and record the evidence:
    ```bash
    sudo /opt/caspira/deploy/production/scripts/check-host.sh
    ```
    Record each Met or Not met in *Platform → Security → Baseline*.
12. Continue with [runbook 02](02-firewall-and-secrets.md) (firewall and secrets).

**Done when:** `check-host.sh` shows every control Met, or an accepted exception is recorded for it.
