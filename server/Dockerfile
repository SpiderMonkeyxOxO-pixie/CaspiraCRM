# syntax=docker/dockerfile:1.7
# Caspira CRM API and worker image (one image; the worker overrides CMD).
#
# Backend Phase 13 — production hardening:
#   * base images pinned by version AND digest (no floating tags);
#   * multi-stage: compilers only in the build stages, runtime has production
#     dependencies only (no Prisma CLI, no vitest/supertest, no package build
#     tools), tests and local fixtures excluded via .dockerignore;
#   * no secrets in any layer or build argument — secrets arrive at run time
#     as files under /run/secrets (Docker Compose secrets);
#   * runs as the unprivileged `node` user (uid 1000) with a read-only root
#     filesystem in production (writes go to tmpfs /tmp only);
#   * OCI labels carry the release version and git revision;
#   * a separate `migrator` target carries the Prisma CLI for the dedicated
#     migration identity.
ARG NODE_IMAGE=node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# ---- prod-deps: production dependencies only (argon2 compiles here) --------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
ENV npm_config_nodedir=/usr/local
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts=false \
 && npm cache clean --force

# ---- build: full dependencies to generate the Prisma client ----------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
ENV npm_config_nodedir=/usr/local
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate

# ---- migrator: Prisma CLI + migrations, run once per deployment -------------
FROM ${NODE_IMAGE} AS migrator
WORKDIR /app
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root package.json ./
COPY --chown=root:root prisma ./prisma
COPY --chown=root:root src/config ./src/config
COPY --chown=root:root scripts/migrate.js ./scripts/migrate.js
# Security updates for the base system, and no package managers: the migrator
# runs the Prisma CLI with node directly (npm bundles its own vulnerable deps).
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
# The migration identity (schema owner) — never the runtime role.
CMD ["node", "scripts/migrate.js"]

# ---- runtime -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="caspira-crm-api" \
      org.opencontainers.image.description="Caspira CRM API and worker" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/SpiderMonkeyxOxO-pixie/CaspiraCRM"
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    APP_VERSION=${VERSION} \
    APP_REVISION=${REVISION}
WORKDIR /app
# Application files are owned by root and read-only to the runtime user.
COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=root:root /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --chown=root:root package.json ./
COPY --chown=root:root prisma ./prisma
COPY --chown=root:root src ./src
COPY --chown=root:root scripts ./scripts
# Security updates for the base system; remove package managers (npm/npx/corepack/yarn).
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir -p /app/tmp && chown node:node /app/tmp
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "src/healthcheck.js"]
# Plain `node` receives SIGTERM directly (compose adds an init process);
# src/index.js and src/worker.js drain and close connections on SIGTERM.
STOPSIGNAL SIGTERM
CMD ["node", "src/index.js"]
