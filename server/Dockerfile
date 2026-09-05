# Multi-stage build. Same image serves both the `api` and `worker` compose
# services (worker overrides CMD) — one codebase, one build, per Backend
# Phase 1's Docker requirements.

# ---- deps: install once, including devDependencies (prisma CLI needs them
#      to generate the client below) ----
FROM node:20-alpine AS deps
WORKDIR /app
# argon2 has no prebuilt binary for this platform and falls back to
# compiling its native addon via node-gyp, which needs these.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build: generate the Prisma client against the schema, bring in source ----
FROM deps AS build
COPY prisma ./prisma
RUN npx prisma generate
COPY . .

# ---- runtime: only what's needed to run, as a non-root user ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
# node:20-alpine already ships an unprivileged `node` user (uid 1000) — no
# secrets are baked into any layer above; DATABASE_URL/JWT_SECRET/etc. are
# only ever injected at container-run time via env_file/environment.
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD ["node", "src/healthcheck.js"]
# Graceful shutdown: plain `node` forwards SIGTERM to the process (no shell
# wrapper swallowing it), and src/index.js installs its own SIGTERM/SIGINT
# handler to close the HTTP server and Prisma connection before exiting.
CMD ["node", "src/index.js"]
