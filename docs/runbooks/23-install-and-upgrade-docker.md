# 23 — Install and upgrade Docker

**Who:** System Owner. **Where:** host shell.

## Install (Docker Engine plus the Compose v2 plugin, from Docker's apt repository)
```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

Configure the daemon in `/etc/docker/daemon.json`, then run `sudo systemctl restart docker`:
```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true,
  "userland-proxy": false
}
```
- `live-restore` keeps containers running across daemon upgrades.
- Only named administrators join the `docker` group: `sudo usermod -aG docker <admin-user>`.
- Never expose the daemon over TCP.

Verify with `docker version`, `docker compose version` (v2.20 or later) and `docker info | grep -i "live restore"`.

## Upgrade
1. Read the release notes for breaking changes to Compose or the engine.
2. Take an on-demand full backup ([runbook 11](11-on-demand-backup.md)) and confirm it succeeded.
3. Upgrade:
   ```bash
   sudo apt-get update && sudo apt-get install --only-upgrade docker-ce docker-ce-cli containerd.io docker-compose-plugin
   ```
   With `live-restore`, containers keep running. Check with `docker compose --env-file env/production.env --profile backup ps`.
4. If a container didn't come back, run `docker compose --env-file env/production.env --profile backup up -d --wait`.
5. Record the new versions in *Platform → Security → Baseline*.

## Development (Docker Desktop)
Development uses the repository's root `docker-compose.yml` and is unaffected by the production files. Docker Desktop upgrades itself. After an upgrade, run `docker compose up -d` in the repository root and check the API's `/ready`.
