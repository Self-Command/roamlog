# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.22.2
ARG PNPM_VERSION=12.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:${PATH}" \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /workspace

FROM base AS build

ARG API_URL=http://api:4000
ARG NEXT_PUBLIC_ADMIN_DATA_MODE=api
ARG NEXT_PUBLIC_ADMIN_ASSET_PREFIX=
ARG NEXT_PUBLIC_ADMIN_LOGIN_PATH=
# Deployment identity inlined into the bundle at build time. Defaults to
# production; staging builds must pass --build-arg NEXT_PUBLIC_APP_ENV=staging,
# otherwise the inherited NODE_ENV=production fallback makes the Admin topbar
# badge claim PRODUCTION on staging.
ARG NEXT_PUBLIC_APP_ENV=production

ENV API_URL=${API_URL} \
    NEXT_PUBLIC_ADMIN_DATA_MODE=${NEXT_PUBLIC_ADMIN_DATA_MODE} \
    NEXT_PUBLIC_ADMIN_ASSET_PREFIX=${NEXT_PUBLIC_ADMIN_ASSET_PREFIX} \
    NEXT_PUBLIC_ADMIN_LOGIN_PATH=${NEXT_PUBLIC_ADMIN_LOGIN_PATH} \
    NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV} \
    NEXT_TELEMETRY_DISABLED=1

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm --filter @roamlog/admin build \
    && pnpm --filter @roamlog/admin deploy --prod --ignore-scripts /out/admin

FROM base AS runtime

RUN groupadd --system --gid 10001 roamlog \
    && useradd --system --uid 10001 --gid roamlog --home-dir /home/roamlog --shell /usr/sbin/nologin roamlog

WORKDIR /app

COPY --from=build --chown=roamlog:roamlog /out/admin ./
COPY --from=build --chown=root:root /workspace/tsconfig.base.json /tsconfig.base.json

RUN mkdir -p /app/.next/cache \
    && chown -R roamlog:roamlog /app/.next

USER 10001:10001

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
