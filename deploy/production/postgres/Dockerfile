# syntax=docker/dockerfile:1.7
# caspira-postgres: PostgreSQL 17 + pgBackRest (from the PostgreSQL project's
# apt repository preconfigured in the official image), used by both the `db`
# service (WAL archive-push) and the `backup-agent` service.
# Backend Phase 13. No secrets in the image; runs as the postgres user.
ARG POSTGRES_BASE=postgres:17.6-bookworm@sha256:45cd22f8d32e189d245403954882f88e7a8714301fda80dab6da90f1265b25a3
FROM ${POSTGRES_BASE}
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="caspira-postgres" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.description="PostgreSQL 17 with pgBackRest for Caspira CRM"
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest jq gnupg rclone ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -o postgres -g postgres -m 0750 /var/lib/pgbackrest /var/spool/pgbackrest /var/log/pgbackrest /etc/pgbackrest /control /restore
COPY --chown=root:root --chmod=0644 postgresql.conf pg_hba.conf roles-upgrade.sql /etc/caspira/
COPY --chown=root:root --chmod=0644 pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY --chown=root:root --chmod=0755 pgbackrest-wrapper.sh backup-agent.sh /opt/caspira/
COPY --chown=root:root --chmod=0755 init/ /docker-entrypoint-initdb.d/
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=10 CMD ["pg_isready", "-h", "/var/run/postgresql", "-U", "postgres"]
USER postgres
