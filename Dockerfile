# syntax=docker/dockerfile:1
# One multi-stage Dockerfile for every deployable (blueprint pattern):
# the monorepo shares one lockfile, so dependencies install once and each
# runtime target copies only what it needs. Targets: frontend | backend | migrate.

ARG NODE_IMAGE=node:22-alpine

# ---------- base: patched alpine + pnpm via corepack ----------
FROM ${NODE_IMAGE} AS base
RUN apk upgrade --no-cache && corepack enable
WORKDIR /repo

# ---------- deps: full workspace install (dev deps included, build-only) ----------
FROM base AS deps
# toolchain for native modules (argon2) when no musl prebuild is published
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY packages/ui/package.json packages/ui/
COPY packages/schemas/package.json packages/schemas/
RUN pnpm install --frozen-lockfile

# ---------- build: compile backend (prisma generate + nest) and frontend (standalone) ----------
FROM deps AS build
COPY . .
# Rewrites (the frontend's internal reverse proxy to the backend service) are
# baked at build time; the compose service name is stable across environments.
ARG BACKEND_INTERNAL_URL=http://backend:3200
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}
# prisma generate is schema-only; the placeholder satisfies config-time env().
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    pnpm --filter @rl/backend exec prisma generate
RUN pnpm --filter @rl/backend build
RUN pnpm --filter @rl/web build

# ---------- prod-deps: backend production node_modules only ----------
FROM base AS prod-deps
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY packages/ui/package.json packages/ui/
COPY packages/schemas/package.json packages/schemas/
# @rl/schemas is a source-only TS package consumed at runtime (Node 22 type
# stripping), so its sources ship with the backend image.
COPY packages/schemas packages/schemas
RUN pnpm install --frozen-lockfile --prod --filter @rl/backend...

# ---------- migrate: one-shot jobs (prisma migrate deploy / seed) ----------
# Runs from the fat build stage: migrations are a pre-deploy job, NEVER the
# API container's CMD (30 replicas racing `migrate deploy` is the failure mode).
FROM build AS migrate
WORKDIR /repo/backend
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---------- backend runtime ----------
FROM base AS backend
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /data/storage && chown app:app /data/storage
COPY --from=prod-deps --chown=app:app /repo /repo
COPY --from=build --chown=app:app /repo/backend/dist /repo/backend/dist
COPY --from=build --chown=app:app /repo/backend/prisma /repo/backend/prisma
WORKDIR /repo/backend
USER app
EXPOSE 3200 9464
CMD ["node", "dist/main"]

# ---------- frontend runtime (Next.js standalone server) ----------
FROM base AS frontend
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /repo/frontend/.next/standalone ./
COPY --from=build --chown=app:app /repo/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=app:app /repo/frontend/public ./frontend/public
USER app
EXPOSE 3000
CMD ["node", "frontend/server.js"]
