# syntax=docker/dockerfile:1.7
# caspira-postgres: PostgreSQL 17 + pgBackRest (from the PostgreSQL project's
# apt repository preconfigured in the official image), used by both the `db`
# service (WAL archive-push) and the `backup-agent` service.
# Backend Phase 13. No secrets in the image; runs as the postgres user.
ARG POSTGRES_BASE=postgres:17.11-bookworm@sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652
FROM ${POSTGRES_BASE}
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="caspira-postgres" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.description="PostgreSQL 17 with pgBackRest for Caspira CRM"
# Debian security updates; gosu is removed because these containers never
# start as root (it only switches users from root, and it carries its own Go
# runtime with known vulnerabilities).
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends pgbackrest jq gnupg rclone ca-certificates \
 && rm -rf /var/lib/apt/lists/* /usr/local/bin/gosu \
 && install -d -o postgres -g postgres -m 0750 /var/lib/pgbackrest /var/spool/pgbackrest /var/log/pgbackrest /etc/pgbackrest /control /restore
COPY --chown=root:root --chmod=0644 postgresql.conf pg_hba.conf roles-upgrade.sql /etc/caspira/
COPY --chown=root:root --chmod=0644 pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY --chown=root:root --chmod=0755 pgbackrest-wrapper.sh backup-agent.sh /opt/caspira/
COPY --chown=root:root --chmod=0755 init/ /docker-entrypoint-initdb.d/
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=10 CMD ["pg_isready", "-h", "/var/run/postgresql", "-U", "postgres"]
USER postgres
