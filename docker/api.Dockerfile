# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.22.2
ARG PNPM_VERSION=12.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:${PATH}" \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /workspace

FROM base AS build

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm --filter @roamlog/api build \
    && pnpm --filter @roamlog/api deploy --prod --ignore-scripts /out/api

FROM base AS runtime

RUN npm install --global --no-audit --no-fund tsx@4.23.15 \
    && groupadd --system --gid 10001 roamlog \
    && useradd --system --uid 10001 --gid roamlog --home-dir /home/roamlog --shell /usr/sbin/nologin roamlog

WORKDIR /app

COPY --from=build --chown=roamlog:roamlog /out/api ./
COPY --from=build --chown=root:root /workspace/tsconfig.base.json /tsconfig.base.json

USER 10001:10001

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/v1/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["tsx", "dist/main.js"]

# One-shot migration target used by staging compose and release jobs.
FROM runtime AS migrate

USER 0:0

RUN npm install --global --no-audit --no-fund prisma@7.10.1

WORKDIR /app/node_modules/@roamlog/db

USER 10001:10001

CMD ["prisma", "migrate", "deploy"]
