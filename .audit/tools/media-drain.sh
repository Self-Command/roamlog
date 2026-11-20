#!/usr/bin/env bash
# Points the media drain at the local stack.
#
# The drain exists because this host cannot run BullMQ: there is no Docker, no
# WSL and no real Redis, and the in-process Redis the API exposes on 46379
# (e2e/live-support/redis-stub.ts) is a passive cache stub — BullMQ drives jobs
# through Lua scripts, so the worker connects and then fails
# (`stalled.forEach is not a function`, `job ingress failed: Unexpected token
# 'K'`). Media rows therefore stay in `processing` forever and never get a
# signed url.
#
# media-drain.mts runs the worker's own handleMediaJob, unchanged, against the
# same prisma client, the same S3 bucket and the same image pipeline; only the
# queue transport is replaced by a poll over `status = processing`. It verifies
# the media pipeline and the attachment flow, NOT queue delivery, retries or
# stalled-job recovery — those still need a real Redis.
set -u

REPO="/c/Users/BY9700/Desktop/UI/roamlog"
cd "$REPO" || exit 1

export DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public'
export REDIS_URL='redis://127.0.0.1:46379'
export S3_ENDPOINT='http://127.0.0.1:9000'
export S3_BUCKET='roamlog-local'
export S3_PUBLIC_BASE_URL='http://127.0.0.1:9000/roamlog-local'
export LOG_LEVEL="${LOG_LEVEL:-warn}"

node node_modules/tsx/dist/cli.mjs .audit/tools/media-drain.mts "$@"