#!/usr/bin/env bash
# Read-only host baseline check (Backend Phase 13). Changes nothing; prints
# Met / Not met per control so an operator can record evidence in
# Platform → Security → Baseline.
#
#   sudo ./scripts/check-host.sh
set -uo pipefail
ok() { printf 'Met       %s\n' "$1"; }
no() { printf 'Not met   %s — %s\n' "$1" "$2"; }
chk() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else no "$1" "$3"; fi; }

. /etc/os-release 2>/dev/null
case "${ID:-}-${VERSION_ID:-}" in ubuntu-22.04|ubuntu-24.04|debian-12) ok "Supported OS (${PRETTY_NAME})";; *) no "Supported OS" "${PRETTY_NAME:-unknown} — use Ubuntu 22.04/24.04 LTS or Debian 12";; esac
chk "Automatic security updates" "systemctl is-enabled unattended-upgrades" "install and enable unattended-upgrades"
chk "SSH password login disabled" "sshd -T | grep -qi '^passwordauthentication no'" "set PasswordAuthentication no"
chk "SSH root login restricted" "sshd -T | grep -Eqi '^permitrootlogin (no|prohibit-password)'" "set PermitRootLogin prohibit-password or no"
chk "Host firewall active" "ufw status | grep -q 'Status: active'" "run scripts/firewall.sh"
chk "Time synchronized" "timedatectl show -p NTPSynchronized --value | grep -q yes" "enable systemd-timesyncd or chrony"
chk "Audit logging (auditd)" "systemctl is-active auditd" "install and enable auditd"
chk "Docker daemon not exposed on TCP" "! ss -ltn | grep -Eq ':(2375|2376)\\b'" "remove -H tcp:// from the Docker daemon"
chk "Docker log rotation configured" "grep -q max-size /etc/docker/daemon.json" "set log-opts max-size/max-file in /etc/docker/daemon.json"
chk "Only proxy ports published" "! docker ps --format '{{.Ports}}' | grep -Eq '0\\.0\\.0\\.0:(5432|6379|9000|9090|4000|4001)'" "internal services must not publish ports"
chk "Nothing listens on database/Redis ports externally" "! ss -ltn | grep -Eq '0\\.0\\.0\\.0:(5432|6379)\\b'" "stop services listening publicly"
chk "Disk usage below 85%" "[ \"\$(df --output=pcent / | tail -1 | tr -dc 0-9)\" -lt 85 ]" "free space or grow the volume"
chk "Secrets directory restricted" "[ \"\$(stat -c %a deploy/production/secrets 2>/dev/null || echo 750)\" -le 750 ]" "chmod 0750 the secrets directory"
chk "Docker group membership limited" "[ \"\$(getent group docker | cut -d: -f4 | tr ',' '\\n' | grep -c .)\" -le 2 ]" "only operators may be in the docker group (it is root-equivalent)"
echo "Disk encryption: verify with the provider/lsblk (not checked automatically)."
