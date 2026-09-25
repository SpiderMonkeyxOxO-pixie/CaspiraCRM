#!/bin/sh
# Redis with a required password (Backend Phase 13). The password is read
# from the Docker secret into a config file on tmpfs, so it never appears in
# the process list, `docker inspect` or logs. Dangerous commands are disabled.
set -eu
umask 077
PASS="$(tr -d '\r\n' < /run/secrets/redis_password)"
cat > /tmp/redis.conf <<EOF
bind 0.0.0.0
protected-mode yes
port 6379
requirepass ${PASS}
# Queues and counters only: nothing needs to survive a restart.
save ""
appendonly no
maxmemory 384mb
maxmemory-policy noeviction
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command CONFIG ""
rename-command DEBUG ""
rename-command SHUTDOWN ""
dir /data
EOF
unset PASS
exec redis-server /tmp/redis.conf
