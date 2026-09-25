#!/usr/bin/env bash
# Host firewall baseline with ufw (Backend Phase 13). NEVER run blindly:
# the script shows the current rules and your SSH session, requires the
# target host name and the administrative source address you are connected
# from, and asks for confirmation before changing anything.
#
#   sudo ./scripts/firewall.sh <expected-hostname> <admin-source-cidr> <ssh-port>
#   e.g. sudo ./scripts/firewall.sh crm-prod-1 203.0.113.10/32 22
#
# Result: deny inbound by default; allow 80 and 443 from anywhere; allow SSH
# only from the administrative source. Docker-published ports: only the
# proxy publishes 80/443 (compose.yaml). Note that Docker manages its own
# iptables chains — never publish database/Redis/agent ports at all.
set -euo pipefail
EXPECTED_HOST="${1:?expected hostname}"; ADMIN_CIDR="${2:?admin source CIDR}"; SSH_PORT="${3:?ssh port}"
[[ "$(id -u)" -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ "$(hostname -s)" == "$EXPECTED_HOST" ]] || { echo "This host is $(hostname -s), not $EXPECTED_HOST. Stopping." >&2; exit 1; }
[[ "$ADMIN_CIDR" =~ ^[0-9.]+/(3[0-2]|[12][0-9])$ ]] || { echo "Give a specific IPv4 CIDR (e.g. 203.0.113.10/32), never 0.0.0.0/0." >&2; exit 1; }
[[ "$SSH_PORT" =~ ^[0-9]{2,5}$ ]] || { echo "Invalid SSH port." >&2; exit 1; }
command -v ufw >/dev/null || { echo "ufw is not installed (apt-get install ufw)." >&2; exit 1; }

CURRENT_CLIENT="${SSH_CLIENT%% *}"
echo "Host: $(hostname -f)"
echo "Your SSH session comes from: ${CURRENT_CLIENT:-unknown}"
echo "SSH will be allowed only from: $ADMIN_CIDR on port $SSH_PORT"
echo "Current rules:"; ufw status verbose || true
if [[ -n "$CURRENT_CLIENT" ]] && ! python3 -c "import ipaddress,sys; sys.exit(0 if ipaddress.ip_address('$CURRENT_CLIENT') in ipaddress.ip_network('$ADMIN_CIDR', strict=False) else 1)"; then
  echo "WARNING: your current session ($CURRENT_CLIENT) is NOT inside $ADMIN_CIDR — you would lock yourself out. Stopping." >&2
  exit 1
fi
read -r -p "Type the host name ($EXPECTED_HOST) to apply these rules: " answer
[[ "$answer" == "$EXPECTED_HOST" ]] || { echo "Not confirmed; nothing changed."; exit 1; }

ufw default deny incoming
ufw default allow outgoing
ufw allow proto tcp from "$ADMIN_CIDR" to any port "$SSH_PORT" comment 'admin SSH'
ufw allow 80/tcp comment 'HTTP (redirect + ACME)'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
ufw status verbose
echo "Firewall applied. Verify from outside: only 80/443 (and SSH from $ADMIN_CIDR) respond."
