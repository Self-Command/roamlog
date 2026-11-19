# AI provider configuration

Status: contract landed in `packages/contracts/src/api/ai.ts`; the API adapter
slice (`apps/api/src/modules/ai`) reads the variables below from the process
environment. AI is **optional**: a deployment without AI configuration is valid
and serves `503 AI_NOT_CONFIGURED` instead of failing to boot.

Related files:

- `apps/api/src/modules/ai/ai.settings.ts` — parsing, defaults and the
  `configured` flag
- `apps/api/src/modules/ai/adapters/{openai-chat,openai-responses,anthropic-messages}.adapter.ts`
- `packages/contracts/src/api/ai.ts` — tool catalogue, plan/run schemas and the
  `AI_ERROR_CODES` inventory
- `tooling/scripts/check-env.ts` — conditional preflight

## 1. Variables

| Variable               | Required                   | Default       | Accepted values / range                                 |
| ---------------------- | -------------------------- | ------------- | ------------------------------------------------------- |
| `AI_ENABLED`           | no                         | `false`       | `true` / `false`                                        |
| `AI_PROTOCOL`          | no                         | `openai-chat` | `openai-chat`, `openai-responses`, `anthropic-messages` |
| `AI_BASE_URL`          | yes when `AI_ENABLED=true` | empty         | Absolute API root, no path after `/v1`                  |
| `AI_API_KEY`           | yes when `AI_ENABLED=true` | empty         | Provider key or gateway token, server-side              |
| `AI_MODEL`             | yes when `AI_ENABLED=true` | empty         | Exact model id from the provider                        |
| `AI_TIMEOUT_MS`        | no                         | `60000`       | Integer `5000`–`120000`                                 |
| `AI_MAX_OUTPUT_TOKENS` | no                         | `6000`        | Integer `256`–`32000`                                   |
| `AI_DAILY_QUOTA`       | no                         | `20`          | Integer `0`–`100000`; `0` disables the cap              |

`pnpm check:env` only requires the three endpoint values when
`AI_ENABLED=true`. With AI disabled it never turns a missing provider into a
startup failure.

`AI_ENABLED` is the **deployment switch used by the preflight**; the API does
not read it. `resolveAiSettings().configured` is `AI_BASE_URL && AI_MODEL`, so
the API will call the provider whenever those two are set. Keep the two in
sync: to turn AI off, set `AI_ENABLED=false` **and** empty `AI_BASE_URL`,
`AI_API_KEY` and `AI_MODEL`. If the preflight sees endpoint values while
`AI_ENABLED` is false it prints a warning, because the API would still be
active and billing.

Use a secret store for `AI_API_KEY`, never a committed file, and never a
`NEXT_PUBLIC_*` variable. The preflight rejects placeholder fragments such as
`change_me`, `placeholder`, `your-`, or `xxxx`, so a local gateway token must be
a real non-empty string (for example `local-gateway-token`) rather than
`CHANGE_ME`.

## 2. Protocols

| Protocol             | Upstream call                         | Auth                                            | Notes                                                           |
| -------------------- | ------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `openai-chat`        | `POST {AI_BASE_URL}/chat/completions` | `Authorization: Bearer {AI_API_KEY}`            | Chat completions + function tools. Widest gateway support.      |
| `openai-responses`   | `POST {AI_BASE_URL}/responses`        | `Authorization: Bearer {AI_API_KEY}`            | Responses API with `input`/`instructions` and typed tools.      |
| `anthropic-messages` | `POST {AI_BASE_URL}/messages`         | `x-api-key: {AI_API_KEY}` + `anthropic-version` | Messages API; system prompt separate, tools use `input_schema`. |

The planner is an **agent loop with tools**, not a free-form text generator: the
model may only propose tool calls from `AI_TOOL_NAMES`. Model output that does
not match the plan/tool contract is exposed as `AI_SCHEMA_INVALID` and is never
applied to data.

### Tool whitelist

`packages/contracts/src/api/ai.ts` defines the eight names; the server rejects
anything else before a tool runs:

| Tool | Kind | Purpose |
| --- | --- | --- |
| `places.search` | read-only | resolve autocomplete results during planning |
| `trips.get` | read-only | read the target trip |
| `stops.list` | read-only | read existing stops |
| `trips.create` | write | create a trip |
| `stops.add` | write | add one stop |
| `itinerary.addDay` | write | add a day |
| `packing.add` | write | add a packing item |
| `budget.setSummary` | write | set the budget summary |

`AI_READ_ONLY_TOOLS = ["places.search", "trips.get", "stops.list"]`. Tool
arguments are validated server-side; each tool silently drops arguments outside
its own allow-list, so a model cannot smuggle extra fields into a write.

### Two-phase plan → execute

1. **Plan** (`POST /v1/workspaces/:workspaceId/ai/chat`): the loop may execute **read-only** tools to
   gather context. Every *write* call the model requests is validated and
   recorded in `plannedCalls` with
   `message: "Not executed yet. The user must confirm the plan first."`
   **Nothing is written to the database during planning** — no trip, stop,
   packing item or budget row. The plan is persisted in the run store and the
   response returns the run id + planned calls.
2. **Execute** (`POST /v1/workspaces/:workspaceId/ai/runs/:runId/execute`): only calls that were in the
   recorded plan can run (`AI_RUN_CALL_NOT_PLANNED` otherwise), the run is
   single-use (`AI_RUN_CONSUMED`), and every call is audited. Arguments are not
   stored in the audit record, only tool identity and outcome.

Limits per plan run: `MAX_PLAN_ROUNDS = 8` model turns,
`MAX_TOOL_CALLS_PER_RUN = 40` tool calls (`AI_LOOP_LIMIT` when exceeded), and
`AI_TIMEOUT_MS` per upstream call. Past-dated write calls are rejected during
planning by a date gate, not left to the model's prompt compliance.

## 3. Recipes

### OpenAI

```dotenv
AI_ENABLED=true
AI_PROTOCOL=openai-chat          # or openai-responses
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=<from the secret store>
AI_MODEL=gpt-4o-mini             # use the exact id from the provider console
AI_TIMEOUT_MS=45000
AI_MAX_OUTPUT_TOKENS=4000
AI_DAILY_QUOTA=20
```

### Anthropic

```dotenv
AI_ENABLED=true
AI_PROTOCOL=anthropic-messages
AI_BASE_URL=https://api.anthropic.com/v1
AI_API_KEY=<from the secret store>
AI_MODEL=<exact Claude model id>
AI_TIMEOUT_MS=60000
AI_MAX_OUTPUT_TOKENS=6000
AI_DAILY_QUOTA=20
```

Do not append `/messages` to `AI_BASE_URL`; the adapter appends the endpoint.

### Self-hosted OpenAI-compatible gateway (local magpie)

`magpie` is treated like any OpenAI-compatible gateway: `openai-chat`, a local
base URL, and a local token. No real provider key is needed.

```dotenv
# Local development only. The API container must be able to reach this URL.
AI_ENABLED=true
AI_PROTOCOL=openai-chat
AI_BASE_URL=http://127.0.0.1:3425/v1
AI_API_KEY=local-gateway-token
AI_MODEL=magpie-local
AI_TIMEOUT_MS=60000
AI_MAX_OUTPUT_TOKENS=4000
AI_DAILY_QUOTA=10
```

- On Docker Desktop the API container reaches the host as
  `http://host.docker.internal:3425/v1`; in a compose network, use a service
  name with a shared network and keep the gateway private (backend network).
- A loopback `AI_BASE_URL` is only valid inside the same host/network. Never
  point production at `127.0.0.1` unless the gateway runs in the same container
  namespace as the API, and never expose an unauthenticated gateway to the
  ingress.
- `AI_API_KEY` may be a gateway token. It must still be non-empty when
  `AI_ENABLED=true`, per the preflight rule.

## 4. Timeout and quota

- `AI_TIMEOUT_MS` is a hard per-call upstream budget enforced with an
  `AbortController`. A timeout is reported as `AI_UPSTREAM`; it is not retried
  in a loop (the agent loop has its own `AI_LOOP_LIMIT`).
- `AI_MAX_OUTPUT_TOKENS` caps each model call. Keep it small: the planner only
  needs tool calls and a short message.
- `AI_DAILY_QUOTA` is a **per-user daily plan-run** cap enforced in Redis;
  `0` disables the cap. It is a product guardrail, not a token budget: a single
  run may still make several upstream calls.
- Rate limiting for AI routes uses the API-wide guards; keep
  `RATE_LIMIT_WINDOW_SECONDS` and the auth limits in mind when tuning quotas.
- The quota counter is Redis-backed and **fails open**: if Redis is unavailable
  the request is allowed with an `ai.quota_unavailable` warning (throttled to one
  log per 10 s). During a Redis outage `AI_DAILY_QUOTA` is not enforced.

### Verify a configured gateway

```bash
# 1. plan: read-only tools only, no DB writes (editor+ in the workspace)
curl -s -X POST "$API/v1/workspaces/$WS/ai/chat" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"message":"3 days in Kyoto"}' | jq '{runId, message, plannedCalls, readOnlyTrace, warnings}'

# 2. confirm nothing was written: plannedCalls are proposals only
psql "$DATABASE_URL" -c 'select count(*) from "Trip" where "createdById" = ...'

# 3. execute the accepted subset once (calls + idempotencyKey are required)
curl -s -X POST "$API/v1/workspaces/$WS/ai/runs/$RUN/execute" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"calls":[...],"idempotencyKey":"plan-'$RUN'-1"}' | jq '{results, partialFailure}'

# 4. a second execute must fail with AI_RUN_CONSUMED
```

Expected error codes: `AI_NOT_CONFIGURED` (503) when `AI_BASE_URL`+`AI_MODEL`
are empty, `AI_QUOTA` (429) when the per-user daily cap is hit, `AI_UPSTREAM`
(502) on timeout/connection failure.

## 5. Failure codes

The API answers with a problem body whose `code` is one of the values in
`AI_ERROR_CODES` (`packages/contracts/src/api/ai.ts`). Operator-relevant codes:

| Code                      | Meaning                                                                           | Typical action                                                              |
| ------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `AI_NOT_CONFIGURED`       | Deployment has no usable base URL/model (AI off). HTTP `503`.                     | Expected when AI is disabled. Configure `AI_BASE_URL`/`AI_MODEL` to enable. |
| `AI_SCHEMA_INVALID`       | Model output did not match the tool/plan contract (contract code).                | Check model quality/tool support; lower temperature at the provider.        |
| `AI_QUOTA`                | Per-user daily plan-run cap reached. HTTP `429` with `limit`/`retryAfterSeconds`. | Wait for the reset, raise `AI_DAILY_QUOTA`, or keep the product cap.        |
| `AI_UPSTREAM`             | Upstream timeout, connection error, or non-JSON provider error. HTTP `502`.       | Check DNS/TLS, gateway health, `AI_TIMEOUT_MS`, and provider status.        |
| `AI_LOOP_LIMIT`           | Agent loop exceeded its tool-call budget.                                         | Expected for hard prompts; not an outage.                                   |
| `AI_RUN_NOT_FOUND`        | Plan run id expired or never existed.                                             | Client should start a new plan.                                             |
| `AI_RUN_CONSUMED`         | Plan run was already executed.                                                    | Do not retry execution; request a new plan.                                 |
| `AI_RUN_CALL_NOT_PLANNED` | Client tried to execute a call the model did not plan.                            | Reject client drift; refresh the plan.                                      |
| `UNRESOLVED_PLACE`        | Tool result could not resolve a place.                                            | User-facing; relevant to Places configuration.                              |
| `AI_TOOL_FAILED`          | A read/write tool failed during execution.                                        | Inspect API logs; partial failure is reported in `results`.                 |

## 6. Cost control

Order of magnitude, not a quote: one plan run makes **2–6 upstream calls** (up
to 8 turns), each carrying the tool schemas plus trip context, and the plan is
then executed once. With a small model in the `gpt-4o-mini` class and a
4 000-token output cap, a single plan is typically in the **US$0.01–0.05**
range; the default `AI_DAILY_QUOTA=20` therefore bounds a user at roughly
**US$0.2–1 per day**. A frontier model can multiply that by 10–30×, so model
choice dominates cost far more than the token caps. Measure your own provider
invoice after the first week instead of trusting this estimate.

1. Use a small, cheap model for the planning loop; reserve larger models for
   exceptional plans. Tool schemas are large, so prompt tokens dominate.
2. Keep `AI_MAX_OUTPUT_TOKENS` low (2000–4000) and `AI_DAILY_QUOTA` at the
   product limit; `AI_TIMEOUT_MS` also bounds runaway provider latency.
3. Set a hard budget/alert in the provider console and monitor token usage in
   the AI usage fields (`inputTokens`/`outputTokens`). A missed spike is a
   billing incident, not just an availability one.
4. Cap the tool loop (`AI_LOOP_LIMIT`) and never retry `AI_UPSTREAM` in an
   unbounded loop; retries amplify both cost and outage duration.
5. During an incident, disable the feature instead of debugging in production:
   set `AI_ENABLED=false` and empty `AI_BASE_URL`/`AI_MODEL`, restart the API;
   endpoints answer `503 AI_NOT_CONFIGURED`. Keep the secret key until the
   feature is re-enabled.

## 7. Troubleshooting

| Symptom                                  | Check                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Endpoints always `503 AI_NOT_CONFIGURED` | `AI_BASE_URL` and `AI_MODEL` are non-empty in the API environment; restart after change |
| Preflight fails with `AI_* is required`  | `AI_ENABLED=true` with empty endpoint values; fill all three or set `AI_ENABLED=false`  |
| `AI_UPSTREAM` on every request           | Container DNS/egress, TLS interception, gateway on loopback only, wrong protocol path   |
| Immediate auth errors from the provider  | Wrong auth scheme for the protocol (`Bearer` vs `x-api-key`) or a revoked key           |
| `AI_SCHEMA_INVALID` frequently           | Model does not support tools/JSON reliably; switch model or `AI_PROTOCOL`               |
| Costs higher than expected               | Output token cap, loop limit, daily quota, and provider-side budget alerts              |
