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
    && pnpm --filter @roamlog/worker build \
    && pnpm --filter @roamlog/worker deploy --prod --ignore-scripts /out/worker

FROM base AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends procps \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --no-audit --no-fund tsx@4.23.15 \
    && groupadd --system --gid 10001 roamlog \
    && useradd --system --uid 10001 --gid roamlog --home-dir /home/roamlog --shell /usr/sbin/nologin roamlog

WORKDIR /app

COPY --from=build --chown=roamlog:roamlog /out/worker ./
COPY --from=build --chown=root:root /workspace/tsconfig.base.json /tsconfig.base.json

USER 10001:10001

# Worker readiness is queue-level. This healthcheck only catches a dead runtime;
# queue lag and failed-job rates are monitored separately.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["pgrep", "-f", "dist/main.js"]

CMD ["tsx", "dist/main.js"]
