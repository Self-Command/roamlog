# Admin Settings Provider Platform Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to execute this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Do not start Task 1 until the
> baseline checks in Task 0 pass.

**Goal:** Replace the single-value AI/map configuration with a server-side
Provider Registry that supports multiple provider instances, encrypted
credentials, priority/failover, model discovery, audit, versioned writes, and a
legacy compatibility path.

**Architecture:** Keep scalar site settings in `SystemSetting`. Add
`ProviderGroupPolicy`, `ProviderConnection`, `ProviderSecret`,
`ProviderSecretHistory`, and `ProviderModel` tables. A provider catalog drives
adapter validation and discovery; a runtime resolver produces ordered,
decrypted snapshots; AI and Places consume those snapshots through explicit
priority/merge routing. The Admin UI plan consumes the contracts and endpoints
defined here, but does not change them.

**Tech Stack:** NestJS 12, Prisma 7, PostgreSQL 17, Redis 7, Zod 4,
OpenAPI + Orval, TypeScript, Vitest, Playwright for HTTP journeys, pnpm +
Turborepo.

**Spec:** `docs/superpowers/specs/2026-11-22-admin-settings-provider-architecture.md`

**Requirements:** `docs/superpowers/specs/2026-11-22-admin-settings-rebuild-requirements.md`
(D1–D17 are binding.)

## Global Constraints

- `group` is exactly `ai | places | mail | storage`; `adapter` is the wire
  adapter; `preset` is the operator-facing vendor preset; `label` is the
  editable provider name. Do not introduce `kind` or `providerType`.
- AI v1 routing is priority failover only. Places v1 defaults to `merge`, with
  explicit `priority_failover`. Mail/storage are single-active.
- One active `ProviderSecret` per `(providerId, field)` in v1. Replacing a
  secret atomically writes a `ProviderSecretHistory` row that expires after
  24h. Never return old or current plaintext from an Admin list/detail API.
- All Provider mutations require a valid session, `PlatformTwoFactorGuard`,
  `AdminGuard`, and the existing `admin:settings:read/write` actions.
- Every write and every real probe/discovery is audited. Audit metadata must not
  include plaintext secrets, authorization headers, or complete upstream URLs
  with query strings.
- Production already has a working `CONFIG_ENCRYPTION_KEY`. Never generate a
  second key in this plan. Import the Tencent/Geoapify keys from the operator's
  local secret source through stdin; report only provider ids and last4.
- No UI files are owned by this plan. Do not edit `apps/admin/**`,
  `apps/web/**`, theme/font specs, or another plan's plan file.
- No git commit or push is authorized by this plan. Use named checkpoints in
  `.superpowers/sdd/...` or the task report. A release commit is a separate
  root decision after all gates pass.
- Every task ends with a fresh command and expected result. A report without
  command output is not complete.
- Do not treat the uncommitted single-provider AI discovery files as the
  target contract. Reuse only their bounded parser/error safety ideas in Task 8.

## File Structure

Create:

```text
packages/contracts/src/api/providers.ts
packages/contracts/src/__tests__/providers.test.ts
packages/contracts/scripts/openapi/paths-providers.ts
packages/db/prisma/migrations/0016_provider_connections/migration.sql
apps/api/src/modules/providers/provider-catalog.ts
apps/api/src/modules/providers/provider-contracts.ts
apps/api/src/modules/providers/provider-egress.ts
apps/api/src/modules/providers/provider-secret.service.ts
apps/api/src/modules/providers/provider-secret.service.spec.ts
apps/api/src/modules/providers/provider-config.service.ts
apps/api/src/modules/providers/provider-config.service.spec.ts
apps/api/src/modules/providers/provider-model-discovery.service.ts
apps/api/src/modules/providers/provider-model-discovery.service.spec.ts
apps/api/src/modules/providers/provider-runtime.service.ts
apps/api/src/modules/providers/provider-runtime.service.spec.ts
apps/api/src/modules/providers/provider-catalog.controller.ts
apps/api/src/modules/providers/provider-groups.controller.ts
apps/api/src/modules/providers/providers.controller.ts
apps/api/src/modules/providers/provider-errors.ts
apps/api/src/modules/providers/providers.module.ts
apps/api/src/modules/providers/__tests__/provider-config.e2e.spec.ts
apps/api/scripts/import-provider.ts
apps/api/src/modules/ai/ai-provider-router.service.ts
apps/api/src/modules/ai/ai-provider-router.service.spec.ts
apps/api/src/modules/places/places-provider-runtime.service.ts
apps/api/src/modules/places/places-provider-runtime.service.spec.ts
```

Modify:

```text
packages/contracts/src/api/index.ts
packages/contracts/scripts/generate-openapi.ts
packages/db/prisma/schema.prisma
packages/db/src/index.ts                         (only if a new export is needed)
apps/api/src/app.module.ts
apps/api/src/modules/ai/ai.module.ts
apps/api/src/modules/ai/ai-plan.service.ts
apps/api/src/modules/ai/ai.controller.ts
apps/api/src/modules/ai/ai.settings.ts           (legacy adapter compatibility only)
apps/api/src/modules/places/places.module.ts
apps/api/src/modules/places/places.service.ts
apps/api/src/modules/places/places.settings.ts   (legacy compatibility only)
apps/api/src/modules/places/tencent.client.ts
apps/api/src/modules/places/geoapify.client.ts
apps/api/src/modules/places/photon.client.ts
apps/api/src/modules/settings/mail-settings.consumer.ts
apps/api/src/modules/settings/storage-settings.consumer.ts
apps/api/src/modules/settings/settings.module.ts
apps/api/src/config/environment.ts               (provider mode flag only)
package.json                                     (providers:import script)
```

Ownership note: if the theme plan is in flight, it owns
`packages/contracts/src/api/index.ts`, `packages/db/prisma/schema.prisma`,
`packages/db/src/settings-defaults.ts`, and `settings.registry.ts` for its
appearance additions. Wave 0 must be serialized: this plan adds provider
exports/schema first, or the theme plan confirms it has already added its
exports. Never edit those shared files concurrently.

---

### Task 0: Freeze the baseline and protect the WIP

**Files:**

- Create: `.audit/settings-provider/wip-baseline.txt`
- Create: `.audit/settings-provider/wip-backup/` (tracked patch + every untracked
  WIP file at its original relative path)
- Create: `.audit/settings-provider/plan-checkpoint.md`

**Interfaces:**

- No product interface. This task records the exact files that exist before
  implementation, including the uncommitted media fix and the narrow AI
  discovery experiment.

- [ ] **Step 1: Record status and CodeGraph freshness**

Run:

```bash
cd /c/Users/BY9700/Desktop/UI/roamlog
mkdir -p .audit/settings-provider
git status --short > .audit/settings-provider/wip-baseline.txt
codegraph status >> .audit/settings-provider/wip-baseline.txt
git diff --stat >> .audit/settings-provider/wip-baseline.txt
```

Expected: `codegraph status` says `[OK] Index is up to date`; the output lists
media-thumbnail changes, CI changes, and the single-provider AI discovery WIP.

- [ ] **Step 2: Copy tracked and untracked WIP without reverting it**

Run in PowerShell from the repository root:

```powershell
$backup = ".audit/settings-provider/wip-backup"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
git diff > "$backup/tracked.patch"
git ls-files --others --exclude-standard | ForEach-Object {
  $dest = Join-Path $backup $_
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
  Copy-Item -LiteralPath $_ -Destination $dest -Force
}
```

On Linux/bash, use the equivalent `mkdir -p`, `git diff > ...`, and a
`git ls-files --others --exclude-standard` read loop that copies each file to
the same relative path. The backup must include untracked files such as
`apps/api/src/modules/ai/ai-model-discovery.service.ts`,
`apps/api/src/modules/ai/ai-admin-settings.controller.ts`,
`apps/api/src/modules/ai/__tests__/ai-model-discovery.service.spec.ts`, and
`apps/admin/components/settings/ai-model-discovery.tsx`. `git diff` alone is not
sufficient because it omits untracked files.

Expected: a tracked patch and a complete untracked-file tree exist. Do not
apply, reset, checkout, stash, or delete the working tree.

- [ ] **Step 3: Write the checkpoint gate**

Create `.audit/settings-provider/plan-checkpoint.md` with:

```markdown
# Provider backend checkpoint

- [ ] Specs APPROVED
- [ ] CodeGraph up to date
- [ ] No theme/UI files touched by this plan
- [ ] Production keyring treated as existing and backed up
- [ ] WIP patch preserved, not silently reverted
```

**Acceptance:** The plan can proceed without destroying the existing media fix or
the experiment. No product code changed.

---

### Task 1: Define provider contracts and catalog types

**Files:**

- Create: `packages/contracts/src/api/providers.ts`
- Modify: `packages/contracts/src/api/index.ts`
- Test: `packages/contracts/src/__tests__/providers.test.ts`

**Interfaces:**

```ts
export const ProviderGroupSchema = z.enum(["ai", "places", "mail", "storage"]);
export const ProviderRoutingModeSchema = z.enum([
  "priority",
  "merge",
  "priority_failover",
  "single",
]);
export const ProviderHealthStatusSchema = z.enum(["unknown", "healthy", "degraded", "unhealthy"]);

export const ProviderConnectionSchema = z
  .object({
    id: UuidV7Schema,
    group: ProviderGroupSchema,
    adapter: z.string().min(1).max(40),
    preset: z.string().min(1).max(40).nullable(),
    label: z.string().min(1).max(80),
    enabled: z.boolean(),
    priority: z.number().int().min(0),
    config: z.record(z.string(), z.unknown()),
    version: z.number().int().positive(),
    secrets: z.array(ProviderSecretStateSchema),
    health: ProviderHealthSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();
```

The complete contract must include:

- `ProviderSecretStateSchema { field, hasValue, last4, version }`.
- `ProviderGroupPolicySchema { group, routingMode, maxAttempts,
cooldownSeconds, version }`.
- `ProviderGroupResponseSchema { group, label, routingMode, maxAttempts,
cooldownSeconds, version, providers }`. This is the one canonical group shape;
  `ProviderGroupPolicySchema` is persisted separately but must not be nested in
  the response. `PATCH /provider-groups/:group` returns the full
  `ProviderGroupResponse`, not a policy-only object.
- `ProviderCatalogSchema` with group labels, adapter definitions, presets,
  config fields, and secret fields.
- `CreateProviderRequestSchema`, `UpdateProviderRequestSchema` (including
  `expectedVersion`), `ReorderProvidersRequestSchema`,
  `ReplaceProviderSecretRequestSchema`, `ProviderProbeRequestSchema`,
  `ProviderModelDiscoveryRequestSchema`, `ProviderModelSchema`, and all
  response schemas.
- Stable error code union:
  `PROVIDER_NOT_FOUND | PROVIDER_VERSION_CONFLICT |
PROVIDER_ORDER_CONFLICT | PROVIDER_ADAPTER_UNSUPPORTED |
PROVIDER_CONFIG_INVALID | PROVIDER_SECRET_FIELD_UNKNOWN |
PROVIDER_SECRETS_UNAVAILABLE | PROVIDER_PROBE_FAILED |
PROVIDER_PROBE_TIMEOUT | PROVIDER_MODELS_DISCOVERY_FAILED |
PROVIDER_MODELS_DISCOVERY_TIMEOUT | PROVIDER_MODELS_RESPONSE_TOO_LARGE |
PROVIDER_MODELS_DISCOVERY_UNSUPPORTED | PROVIDER_MODEL_DEFAULT_REQUIRED |
PROVIDER_EGRESS_BLOCKED |
PROVIDER_ACTIVE_CONFLICT | AI_MODEL_NOT_ALLOWED |
AI_PROVIDERS_UNAVAILABLE`.

- [ ] **Step 1: Write the failing contract test**

Add tests that parse a valid AI connection, reject `group: "llm"`, reject
`routingMode: "round_robin"`, require `version > 0`, and assert that an
`adapter` cannot be changed without an `expectedVersion`. Add an exact-shape
test for `ProviderGroupResponse` with flat routing fields and a
create-with-secret request that keeps `secrets` out of `config`.

Run:

```bash
pnpm --filter @roamlog/contracts exec vitest run src/__tests__/providers.test.ts
```

Expected: FAIL because the provider schemas do not exist.

- [ ] **Step 2: Implement the schemas**

Use `.strict()` on every object. Keep `config` as a JSON object at this layer;
adapter-specific validation lives in the API provider catalog. Do not put
secrets in `config`; the request schema has a separate `secrets?: Record<string,
string>` only for create and replace operations.

- [ ] **Step 3: Export the module**

Add `export * from "./providers";` to `packages/contracts/src/api/index.ts`.

- [ ] **Step 4: Run the test and contract typecheck**

```bash
pnpm --filter @roamlog/contracts exec vitest run src/__tests__/providers.test.ts
pnpm --filter @roamlog/contracts typecheck
```

Expected: PASS, 0 TypeScript errors.

---

### Task 2: Register OpenAPI paths and regenerate the client

**Files:**

- Create: `packages/contracts/scripts/openapi/paths-providers.ts`
- Modify: `packages/contracts/scripts/generate-openapi.ts`
- Generated: `packages/api-client/src/generated/endpoints/providers/providers.ts`
  (Orval's exact file name may differ; use the generated output from the
  checked-in Orval config.)
- Test: `packages/contracts/src/__tests__/providers.test.ts`

**Interfaces:** The paths are exactly:

```text
GET    /v1/admin/provider-catalog
GET    /v1/admin/provider-groups/{group}
PATCH  /v1/admin/provider-groups/{group}
PUT    /v1/admin/provider-groups/{group}/order
POST   /v1/admin/providers
PATCH  /v1/admin/providers/{id}
DELETE /v1/admin/providers/{id}
POST   /v1/admin/providers/{id}/probe
POST   /v1/admin/providers/probe
POST   /v1/admin/provider-models/discover
POST   /v1/admin/providers/{id}/models/refresh
PATCH  /v1/admin/providers/{id}/models/{modelId}
PUT    /v1/admin/providers/{id}/secrets/{field}
POST   /v1/admin/providers/{id}/secrets/{field}/reveal
```

- [ ] **Step 1: Write the failing path/operation test**

Assert that the generated OpenAPI registry contains every operation id listed
in `paths-providers.ts`, with the expected method/path and without duplicate
operation ids. Do not assert array registration order in
`generate-openapi.ts`; presence and generated-client freshness are the contract.

Run:

```bash
pnpm --filter @roamlog/contracts contracts:generate
```

Expected: FAIL/unknown schema before the path file is wired.

- [ ] **Step 2: Implement the path registration**

Use `registerOperation` from `./helpers`. Every mutating route includes errors
`[400, 401, 403, 404, 409, 422, 429, 500, 502, 504]` where applicable and marks
idempotent operations explicitly. Use `ProviderProblemCode`/Problem Details
shapes; do not return upstream response bodies.

- [ ] **Step 3: Generate and inspect the client**

```bash
pnpm --filter @roamlog/contracts contracts:generate
pnpm --filter @roamlog/api-client api-client:generate
git diff --stat -- packages/contracts/openapi.json packages/api-client/src
```

Expected: the new provider client/catalog schemas exist and no unrelated
schemas changed.

- [ ] **Step 4: Run contract freshness**

```bash
pnpm contracts:check
```

Expected: PASS, 0 stale generated files.

---

### Task 3: Add the Provider schema and additive migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/0016_provider_connections/migration.sql`
- Test: `apps/api/src/modules/providers/__tests__/provider-migration.e2e.spec.ts`

**Interfaces:**

Add these models exactly (field names are consumed by the generated DB client):

```prisma
model ProviderGroupPolicy {
  group           String   @id @db.VarChar(40)
  routingMode     String   @default("priority") @db.VarChar(32)
  maxAttempts     Int      @default(1)
  cooldownSeconds Int      @default(30)
  config          Json     @default("{}") @db.JsonB
  version         Int      @default(1)
  updatedById     String?  @db.Uuid
  updatedAt       DateTime @updatedAt @db.Timestamptz(3)
  createdAt       DateTime @default(now()) @db.Timestamptz(3)

  @@map("ProviderGroupPolicy")
}

model ProviderConnection {
  id                  String   @id @default(uuid(7)) @db.Uuid
  group               String   @db.VarChar(40)
  adapter             String   @db.VarChar(40)
  preset              String?  @db.VarChar(40)
  label               String   @db.VarChar(80)
  enabled             Boolean  @default(true)
  priority            Int      @default(100)
  config              Json     @db.JsonB
  version             Int      @default(1)
  healthStatus        String   @default("unknown") @db.VarChar(20)
  consecutiveFailures Int      @default(0)
  cooldownUntil       DateTime? @db.Timestamptz(3)
  lastCheckedAt       DateTime? @db.Timestamptz(3)
  lastErrorCode       String?  @db.VarChar(80)
  legacyKey           String?  @db.VarChar(120)
  createdById         String?  @db.Uuid
  updatedById         String?  @db.Uuid
  createdAt           DateTime @default(now()) @db.Timestamptz(3)
  updatedAt           DateTime @updatedAt @db.Timestamptz(3)
  deletedAt           DateTime? @db.Timestamptz(3)

  secrets       ProviderSecret[]
  secretHistory ProviderSecretHistory[]
  models        ProviderModel[]

  @@unique([group, legacyKey])
  @@index([group, deletedAt, enabled, priority])
  @@map("ProviderConnection")
}
```

Add `ProviderSecret`, `ProviderSecretHistory`, and `ProviderModel` with the
fields from the approved spec. Required invariants:

- `ProviderSecret` unique `(providerId, field)`, `ciphertext` non-null,
  `last4` nullable, `keyVersion` default 1.
- `ProviderSecretHistory` unique `(providerId, field, expiresAt, id)` is not
  required; use an index and delete by `expiresAt`.
- `ProviderModel` unique `(providerId, modelId)`, `isDefault` boolean, and
  `enabled` boolean.
- Add DB CHECK constraints for group, priority, version, health status, secret
  field length, and model id length.
- Do not alter `SystemSetting` in this migration.

- [ ] **Step 1: Write the failing migration integration test**

Use the existing test database helper to run migrations against an empty
schema, assert all five tables exist, insert one row of each allowed group, and
assert that `group='llm'` and `priority=-1` violate constraints.

Run:

```bash
ROAMLOG_TEST_DATABASE_URL='postgresql://roamlog:roamlog@localhost:5432/roamlog?schema=provider_migration_test' \
pnpm --filter @roamlog/api exec vitest run src/modules/providers/__tests__/provider-migration.e2e.spec.ts
```

Expected: FAIL because the migration is absent.

- [ ] **Step 2: Add the schema models**

Keep all new tables additive. Use `@db.JsonB` for config/model capabilities and
`@db.Uuid` for provider/user ids, consistent with the existing schema.

- [ ] **Step 3: Add the SQL migration**

Create the tables, indexes, foreign keys, and named CHECK constraints. Include
an explicit comment that the migration is additive and does not copy or delete
the existing `SystemSetting` rows.

- [ ] **Step 4: Validate and run the migration on the test schema**

```bash
pnpm --filter @roamlog/db prisma validate
ROAMLOG_TEST_DATABASE_URL='postgresql://roamlog:roamlog@localhost:5432/roamlog?schema=provider_migration_test' \
pnpm --filter @roamlog/db prisma migrate deploy
```

Expected: migration succeeds on an empty schema; a second deploy says no
pending migrations.

- [ ] **Step 5: Prove the existing production schema is additive**

Against a restore/copy of the current production schema, run
`prisma migrate deploy`; verify existing `User`, `SystemSetting`, `Media`, and
`AuditLog` counts are unchanged. Do not run this against the live production
database; use the existing backup/restore path from the deployment runbook.

---

### Task 4: Implement the adapter catalog and config validation

**Files:**

- Create: `apps/api/src/modules/providers/provider-catalog.ts`
- Create: `apps/api/src/modules/providers/provider-contracts.ts`
- Create: `apps/api/src/modules/providers/provider-errors.ts`
- Test: `apps/api/src/modules/providers/provider-catalog.spec.ts`

**Interfaces:**

```ts
export type ProviderGroup = "ai" | "places" | "mail" | "storage";
export type ProviderAdapter =
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages"
  | "tencent"
  | "geoapify"
  | "photon"
  | "resend"
  | "smtp"
  | "s3";

export interface ProviderAdapterDefinition {
  readonly adapter: ProviderAdapter;
  readonly group: ProviderGroup;
  readonly label: string;
  readonly presets: readonly ProviderPreset[];
  readonly configSchema: z.ZodType<Record<string, unknown>>;
  readonly secretFields: readonly ProviderSecretField[];
  readonly capabilities: readonly ("model_discovery" | "probe" | "priority" | "merge")[];
}

export interface ProviderPreset {
  readonly preset: string;
  readonly adapter: ProviderAdapter;
  readonly label: string;
  readonly defaultBaseUrl: string | null;
  readonly modelDiscovery: "openai-models" | "anthropic-models" | "manual-only";
  readonly manualModelAllowed: boolean;
}
```

Freeze the AI presets:

```text
openai, deepseek, openrouter, groq, together, gemini-openai,
anthropic, openai-responses, custom-openai-compatible
```

The preset table MUST include `adapter`, default `baseUrl`, discovery path,
auth header, and whether manual model entry is allowed. OpenAI-compatible and
Anthropic catalogs use `GET {baseUrl}/models`; Gemini OpenAI-compatible uses
its official OpenAI-compatible base URL; if a catalog is unsupported, the
response is `PROVIDER_MODELS_DISCOVERY_UNSUPPORTED`, never a fabricated list.

- [ ] **Step 1: Write failing catalog tests**

Test every frozen preset, reject `preset`/`adapter` mismatches, reject unknown
config fields, and prove `tencent`/`geoapify` have required `apiKey` secrets
while `photon` has none.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-catalog.spec.ts
```

Expected: FAIL because the catalog does not exist.

- [ ] **Step 2: Implement the catalog**

Put stable catalog ids and schemas in this file; return copies from the
controller so callers cannot mutate module constants. Validate all config with
adapter-specific Zod schemas from `provider-contracts.ts`.

- [ ] **Step 3: Implement safe Problem Details helpers**

`provider-errors.ts` must expose stable codes and a function that maps internal
errors to `{ code, message }` with no upstream body, URL query, key, or stack.

- [ ] **Step 4: Run tests and lint**

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-catalog.spec.ts
pnpm --filter @roamlog/api typecheck
```

Expected: PASS.

---

### Task 5: Implement provider secret encryption, replace, and history

**Files:**

- Create: `apps/api/src/modules/providers/provider-secret.service.ts`
- Create: `apps/api/src/modules/providers/provider-secret.service.spec.ts`
- Modify: `apps/api/src/modules/settings/settings.module.ts` only if exporting a
  reusable `SecretBox` factory is cleaner than constructing it in this service.

**Interfaces:**

```ts
export interface ProviderSecretState {
  readonly field: string;
  readonly hasValue: boolean;
  readonly last4: string | null;
  readonly version: number;
}

export interface ReplaceProviderSecretInput {
  readonly providerId: string;
  readonly field: string;
  readonly value: string;
  readonly expectedVersion: number;
  readonly actor: AuthenticatedActor;
}

class ProviderSecretService {
  listStates(providerId: string): Promise<ProviderSecretState[]>;
  resolvePlaintext(providerId: string): Promise<Readonly<Record<string, string>>>;
  replace(input: ReplaceProviderSecretInput): Promise<ProviderSecretState>;
}
```

AAD is exactly `provider:${providerId}:${field}`. Use the existing
`SecretBox.encrypt/decrypt`; do not add a second cipher.

- [ ] **Step 1: Write failing secret tests**

Cover: encrypt/decrypt round trip; wrong provider id or field fails AAD;
replace writes a history row and updates last4; a second replace expires the
old history; missing keyring maps to `PROVIDER_SECRETS_UNAVAILABLE`; list never
returns plaintext.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-secret.service.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the service**

Reuse `SecretBox` construction from `AppConfigService.configEncryptionKey(s)`.
The current key is used for new writes; old records decrypt through the key
ring. `replace()` runs in one Prisma transaction: check provider version,
move current ciphertext into history with `expiresAt = now + 24h`, upsert the
new secret, bump the provider version, and audit the field name/last4 only.

- [ ] **Step 3: Add cleanup**

Delete expired history rows opportunistically after a successful replace and
with a small `cleanupExpired(now)` method tested directly. No worker dependency
is required for v1.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-secret.service.spec.ts
pnpm --filter @roamlog/api typecheck
```

Expected: PASS.

---

### Task 6: Implement provider CRUD, policy, ordering, and audit

**Files:**

- Create: `apps/api/src/modules/providers/provider-config.service.ts`
- Create: `apps/api/src/modules/providers/provider-config.service.spec.ts`

**Interfaces:**

```ts
class ProviderConfigService {
  getGroup(group: ProviderGroup): Promise<ProviderGroupResponse>;
  patchPolicy(
    actor: AuthenticatedActor,
    group: ProviderGroup,
    input: {
      routingMode: ProviderRoutingMode;
      maxAttempts: number;
      cooldownSeconds: number;
      expectedVersion: number;
    },
  ): Promise<ProviderGroupResponse>;
  create(actor: AuthenticatedActor, input: CreateProviderInput): Promise<ProviderConnection>;
  update(
    actor: AuthenticatedActor,
    id: string,
    input: UpdateProviderInput,
  ): Promise<ProviderConnection>;
  remove(actor: AuthenticatedActor, id: string): Promise<{ message: string }>;
  reorder(
    actor: AuthenticatedActor,
    group: ProviderGroup,
    ids: readonly string[],
    expectedGroupVersion: number,
  ): Promise<ProviderGroupResponse>;
}
```

- [ ] **Step 1: Write failing service tests**

Use a Prisma double or the existing repository-test style. Cover:
create/update/soft-delete; policy default AI `priority`, places `merge`, mail/
storage `single`; priority normalization to `10,20,30`; version mismatch → 409;
mail/storage second active → `PROVIDER_ACTIVE_CONFLICT`; deleting the last
provider leaves an empty group; every mutation writes the expected audit
action. Cover create-with-secret: `CreateProviderInput.secrets` is written by
`ProviderSecretService` in the same transaction as the provider; a secret
failure rolls back the provider; the response exposes only `hasValue/last4`.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-config.service.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement transactional writes**

Use `prisma.client.$transaction`. For reorder, update every row only when the
group version still matches; normalize priorities in the same transaction.
`update` must reject attempts to clear a secret via config JSON and must bump
only the provider version for config changes. `create` must accept optional
initial `secrets`, persist them through `ProviderSecretService` inside the same
transaction, and roll back the ProviderConnection if any secret write fails.
`PATCH` must reject a `secrets` field; secret changes use the dedicated PUT.
Provider deletion is soft.

- [ ] **Step 3: Wire audit**

Use `AuditService.record` with actions:

```text
admin.provider.created
admin.provider.updated
admin.provider.deleted
admin.provider.reordered
admin.provider.secret_replaced
admin.provider.probed
admin.provider.models_refreshed
```

- [ ] **Step 4: Verify**

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-config.service.spec.ts
pnpm --filter @roamlog/api typecheck
```

Expected: PASS.

---

### Task 7: Add guarded Provider controllers and stable errors

**Files:**

- Create: `apps/api/src/modules/providers/provider-catalog.controller.ts`
- Create: `apps/api/src/modules/providers/provider-groups.controller.ts`
- Create: `apps/api/src/modules/providers/providers.controller.ts`
- Create: `apps/api/src/modules/providers/providers.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/providers/provider-controller.spec.ts`

**Interfaces:** Every controller route in Task 2. Use:

```ts
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
@RequireAdminAction("admin:settings:read") // GET
@RequireAdminAction("admin:settings:write") // all mutations/probe/reveal
```

`ProvidersModule` imports `PrismaModule`, `RedisModule`, `AuditModule`, and
`AccessControlModule`; provide `AdminGuard` and `PlatformTwoFactorGuard` locally
if importing `AdminModule` would create a cycle. Export
`ProviderRuntimeService`, `ProviderConfigService`, and
`ProviderSecretService` for AI/Places/Mail/Storage consumers.

- [ ] **Step 1: Write failing HTTP tests**

Use `createTestApp`/supertest or the existing guarded-controller pattern. Cover
401, missing 2FA, analyst/support 403, 422 field errors, 404, 409 version
conflict, no plaintext secret in responses, and a successful create/list path.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-controller.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement controllers and module**

Register `ProvidersModule` in `AppModule` before `AiModule` and `PlacesModule`.
Do not duplicate routes in `AdminModule`.

- [ ] **Step 3: Verify route table and guards**

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-controller.spec.ts
pnpm --filter @roamlog/api typecheck
```

Expected: PASS, and no endpoint returns `secretCipher`, `apiKey`, or plaintext.

---

### Task 8: Implement server-side provider model discovery and SSRF protection

**Files:**

- Create: `apps/api/src/modules/providers/provider-egress.ts`
- Create: `apps/api/src/modules/providers/provider-model-discovery.service.ts`
- Create: `apps/api/src/modules/providers/provider-model-discovery.service.spec.ts`
- Reference only: `apps/api/src/modules/ai/ai-model-discovery.service.ts` (WIP)

**Interfaces:**

```ts
export class ProviderEgressGuard {
  assertAllowed(url: URL, options?: { allowPrivate?: boolean }): Promise<void>;
}

export class ProviderModelDiscoveryService {
  discoverDraft(
    actor: AuthenticatedActor,
    input: DiscoverProviderModelsInput,
  ): Promise<ProviderModelDiscoveryResponse>;
  refreshSaved(
    actor: AuthenticatedActor,
    providerId: string,
  ): Promise<ProviderModelDiscoveryResponse>;
}
```

Discovery contract:

- OpenAI-compatible/Responses: `GET {baseUrl}/models`, bearer auth.
- Anthropic: `GET {baseUrl}/models`, `x-api-key` and
  `anthropic-version: 2023-06-01`.
- Gemini preset uses the official OpenAI-compatible endpoint; if its catalog
  is unavailable, return `PROVIDER_MODELS_DISCOVERY_UNSUPPORTED` with
  `manualModelAllowed: true`.
- 10s timeout, 1 MiB declared/streamed cap, 200 models max, `redirect: "error"`,
  no query/hash in configured base URL, and no credentials in URL.
- Egress guard rejects localhost, loopback, RFC1918, link-local, IPv6 ULA/
  loopback, cloud metadata, DNS results that resolve to those ranges, and
  redirects. Allow private endpoints only through an explicit non-production
  `PROVIDER_EGRESS_ALLOW_PRIVATE=true` flag.
- Do not return upstream bodies, headers, or full URLs in errors.

- [ ] **Step 1: Write failing discovery/SSRF tests**

Cover OpenAI shape, Anthropic headers, empty catalog, 401/404/429/500,
timeout, oversized body, metadata/private/redirect rejection, saved-secret use,
draft key use, and manual-model fallback.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-model-discovery.service.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the parser and guard**

Extract a pure `parseProviderCatalog(payload, adapter)` function. Keep the WIP
parser's size cap, dedupe, and display-name fallback, but change the input to a
ProviderConnection and persist returned models in `ProviderModel` for saved
providers. Never persist draft credentials.

- [ ] **Step 3: Add refresh semantics**

On saved refresh, replace only models returned by the provider; preserve old
catalog on failure and set `lastCheckedAt/lastErrorCode`. Enforce at most one
`isDefault=true` model per provider. Never auto-select the first discovered
model. If the old default disappeared, keep it as `not-seen`/unverified and
return a `PROVIDER_MODEL_DEFAULT_REQUIRED` field error; a draft may be saved
without a default but cannot be enabled as an active runtime candidate until
an operator explicitly chooses one.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-model-discovery.service.spec.ts
pnpm --filter @roamlog/api typecheck
```

Expected: PASS.

---

### Task 9: Implement the runtime resolver and cache invalidation

**Files:**

- Create: `apps/api/src/modules/providers/provider-runtime.service.ts`
- Create: `apps/api/src/modules/providers/provider-runtime.service.spec.ts`
- Modify: `apps/api/src/modules/providers/providers.module.ts`

**Interfaces:**

```ts
export interface ProviderRuntime {
  readonly id: string;
  readonly group: ProviderGroup;
  readonly adapter: ProviderAdapter;
  readonly preset: string | null;
  readonly label: string;
  readonly priority: number;
  readonly config: Readonly<Record<string, unknown>>;
  readonly secrets: Readonly<Record<string, string>>;
  readonly health: ProviderHealth;
}

export class ProviderRuntimeService {
  resolveGroup(group: ProviderGroup): Promise<{
    policy: ProviderGroupPolicy;
    providers: readonly ProviderRuntime[];
  }>;
  invalidate(group: ProviderGroup, version?: number): Promise<void>;
}
```

- [ ] **Step 1: Write failing runtime tests**

Cover enabled/deleted filtering, priority sort, stable tie-break by createdAt/
id, per-provider secrets, policy defaults, cooldown filtering, and invalidation
from another process. A missing keyring must not crash group reads without
secrets; secret-bearing groups return the stable unavailable error.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-runtime.service.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement snapshot caching**

Use a 5s process cache. Redis stores only a group generation/version and
invalidation messages; never ciphertext or plaintext. On write, bump version,
clear local cache, and publish `providers.invalidated` with `{ group, version }`.
Subscribe once in `onModuleInit` and disconnect in `onModuleDestroy`.

- [ ] **Step 3: Add legacy fallback**

When `PROVIDER_CONFIG_MODE=legacy` (default during cutover), return the existing
AI/Places settings source as a one-provider compatibility snapshot. When
`shadow`, resolve both and log a redacted diff. When `v2`, use DB providers.
Document the flag in `.env.example`/operations docs without secrets.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-runtime.service.spec.ts
pnpm --filter @roamlog/api typecheck
```

Expected: PASS.

---

### Task 10: Route AI chat and non-stream requests through priority failover

**Files:**

- Create: `apps/api/src/modules/ai/ai-provider-router.service.ts`
- Create: `apps/api/src/modules/ai/ai-provider-router.service.spec.ts`
- Modify: `apps/api/src/modules/ai/ai.module.ts`
- Modify: `apps/api/src/modules/ai/ai-plan.service.ts`
- Modify: `apps/api/src/modules/ai/ai.controller.ts`

**Interfaces:**

```ts
export interface AiProviderCandidate {
  readonly runtime: ProviderRuntime;
  readonly settings: AiSettings; // one per candidate, with its own baseUrl/key/model
  readonly model: ProviderModel;
}

export class AiProviderRouter {
  candidates(model?: string): Promise<readonly AiProviderCandidate[]>;
  isRetryable(error: unknown): boolean;
}
```

Routing rules:

- `priority` only; lower priority first; stable id tie-break.
- Explicit request model: choose enabled ProviderModel rows for that id;
  unknown model → `400 AI_MODEL_NOT_ALLOWED`.
- Default model: first enabled provider's default model; missing default →
  `503 AI_PROVIDERS_UNAVAILABLE` with a safe message.
- Retry only network/timeout/408/429/5xx; never 400/401/403/404/422 unless the
  provider explicitly opts in later.
- No retry after a request body has been accepted by a provider if retrying
  could duplicate a tool side effect; non-idempotent AI tools require a
  separate guard.

- [ ] **Step 1: Write failing router tests**

Cover model selection, provider ordering, default model, disabled provider,
one failing provider followed by a healthy provider, 401 not retried, 429
retried with `Retry-After` bound, and no secret in logs.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/ai/ai-provider-router.service.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement candidate settings**

Construct an `AiSettings` snapshot per candidate with `protocol = adapter`,
`baseUrl`, `apiKey`, `model`, `allowedModels` from ProviderModel rows,
`timeoutMs`, `maxOutputTokens`, and capabilities. Keep the existing
`AI_SETTINGS_SOURCE` as the legacy path until `v2`; this task must not
silently mix provider rows with legacy secrets.

- [ ] **Step 3: Wire non-stream chat/execute**

Replace the single `resolveAdapter()` call in `chat`/`execute` with a loop over
candidates. Record `providerId`, `adapter`, `preset`, `model`, `attempt`, and
`failoverReason` in the existing AI run/audit metadata. Keep the final
response’s model identity accurate.

- [ ] **Step 4: Update model list**

`AiController.models()` must return the union of enabled models across v2
providers (priority order, deduped by model id), plus the resolved default.
Never expose provider secrets.

- [ ] **Step 5: Verify**

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/ai/ai-provider-router.service.spec.ts
pnpm --filter @roamlog/api exec vitest run src/modules/ai/ai-plan.service.spec.ts
pnpm --filter @roamlog/api typecheck
```

Expected: PASS.

---

### Task 11: Add pre-first-token streaming failover

**Files:**

- Modify: `apps/api/src/modules/ai/ai-provider-router.service.ts`
- Modify: `apps/api/src/modules/ai/ai-plan.service.ts`
- Test: `apps/api/src/modules/ai/ai-provider-router.service.spec.ts`

**Interfaces:** Add a `streamWithFailover(candidates, request, sink)` helper
that buffers upstream SSE until the first data event:

```ts
async function streamWithFailover(
  candidates: readonly AiProviderCandidate[],
  attempt: (candidate: AiProviderCandidate) => Promise<ReadableStream<Uint8Array>>,
  commit: (first: Uint8Array) => void,
): Promise<void>;
```

- [ ] **Step 1: Write failing stream tests**

Cases:

1. First provider returns a network error before any SSE data → second provider
   is used.
2. First provider emits a heartbeat/comment only, then fails → second provider
   may be used before user-visible content.
3. First provider emits a data token → no failover; emit one safe terminal
   error event.
4. Abort signal cancels both the provider and queued failover.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/ai/ai-provider-router.service.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the buffer/commit boundary**

Do not send downstream SSE headers or any user-visible delta until the first
provider data event is available. Keep the existing SSE heartbeat behavior
after commit. Once committed, the only allowed failure signal is a single
`AI_PROVIDER_STREAM_FAILED` event; never replay the user message.

- [ ] **Step 3: Verify**

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/ai/ai-provider-router.service.spec.ts
pnpm --filter @roamlog/api exec vitest run src/modules/ai/stream.e2e-spec.ts
pnpm --filter @roamlog/api typecheck
```

Expected: PASS, existing stream tests remain green.

---

### Task 12: Route Places through the provider registry

**Files:**

- Create: `apps/api/src/modules/places/places-provider-runtime.service.ts`
- Create: `apps/api/src/modules/places/places-provider-runtime.service.spec.ts`
- Modify: `apps/api/src/modules/places/places.service.ts`
- Modify: `apps/api/src/modules/places/places.module.ts`
- Modify: `apps/api/src/modules/places/tencent.client.ts`
- Modify: `apps/api/src/modules/places/geoapify.client.ts`
- Modify: `apps/api/src/modules/places/photon.client.ts`

**Interfaces:**

```ts
export interface PlacesRuntimeProvider {
  readonly id: string;
  readonly adapter: "tencent" | "geoapify" | "photon";
  readonly priority: number;
  readonly regions: readonly ("cn" | "global")[];
  readonly settings: PlacesSettings;
}

class PlacesProviderRuntimeService {
  resolve(
    query: { q: string; country?: string },
    policyMode: PlacesRoutingMode,
  ): Promise<readonly PlacesRuntimeProvider[]>;
}
```

- [ ] **Step 1: Write failing tests**

Cover:

- Tencent and Geoapify both enabled/routed.
- `merge` returns combined results and uses priority as tie-break/order.
- `priority_failover` stops after enough results and does not query later
  providers.
- A failing provider does not block another in merge mode.
- `cn`/`global` region eligibility.
- Cache key changes when group version changes.
- A stale/legacy source order does not override DB order.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/places/places-provider-runtime.service.spec.ts src/modules/places/places.service.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement provider-specific settings**

Build one `PlacesSettings` view per provider from its config/secrets without
mutating the legacy `PLACES_SETTINGS` singleton. Add an optional explicit
settings argument to each client method so existing tests can keep using the
legacy source.

- [ ] **Step 3: Implement both routing modes**

`merge`: parallel recall with per-provider timeouts, merge/rank, deterministic
priority tie-break. `priority_failover`: sequential recall until
`minResults`/enough results; no request to later providers after success.
Record `providerId`, `adapter`, `priority`, and failover reason in logs
without query text.

- [ ] **Step 4: Invalidate Places cache**

Include group version and eligible provider ids in the cache key. On provider
write/order/policy change, invalidate the current group generation; do not wait
for the 15-minute TTL.

- [ ] **Step 5: Verify**

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/places/places-provider-runtime.service.spec.ts src/modules/places/places.service.spec.ts src/modules/places/places.controller.spec.ts
pnpm --filter @roamlog/api typecheck
```

Expected: PASS.

---

### Task 13: Make Mail and Storage single-active provider consumers

**Files:**

- Modify: `apps/api/src/modules/settings/mail-settings.consumer.ts`
- Modify: `apps/api/src/modules/settings/storage-settings.consumer.ts`
- Modify: `apps/api/src/modules/settings/settings.module.ts`
- Test: `apps/api/src/modules/settings/mail-settings.consumer.spec.ts`
- Test: `apps/api/src/modules/settings/storage-settings.consumer.spec.ts`

**Interfaces:** `MailRuntime` and `ResolvedStorageConfig` keep their external
shapes. Internally, read the active ProviderConnection for the group when
`PROVIDER_CONFIG_MODE=v2`; otherwise preserve the current scalar resolver.

- [ ] **Step 1: Write failing single-active tests**

Cases:

- exactly one active mail/storage provider is selected;
- a second enabled provider returns `PROVIDER_ACTIVE_CONFLICT` on enable;
- disabled second provider is retained for display;
- legacy mode still resolves the current settings;
- missing secret gives the existing not-configured error, not a fake success.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/settings/mail-settings.consumer.spec.ts src/modules/settings/storage-settings.consumer.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the v2 branch**

Use `ProviderRuntimeService` only for the active provider. Do not implement
mail retry/failover or multi-bucket object routing in this task.

- [ ] **Step 3: Verify**

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/settings/mail-settings.consumer.spec.ts src/modules/settings/storage-settings.consumer.spec.ts
pnpm --filter @roamlog/api typecheck
```

Expected: PASS.

---

### Task 14: Add legacy/shadow/v2 configuration mode and cutover guards

**Files:**

- Modify: `apps/api/src/config/environment.ts`
- Create: `apps/api/src/modules/providers/provider-config-mode.ts`
- Create: `apps/api/src/modules/providers/provider-config-mode.spec.ts`
- Modify: `apps/api/src/modules/providers/provider-runtime.service.ts`
- Modify: `docker/production.env.example` and `.env.example` (names/defaults
  only; no secrets)

**Interfaces:**

```ts
export type ProviderConfigMode = "legacy" | "shadow" | "v2";
export const DEFAULT_PROVIDER_CONFIG_MODE: ProviderConfigMode = "legacy";
```

- [ ] **Step 1: Write failing mode tests**

Unknown mode boots with a clear validation error; production requires explicit
mode; legacy never reads provider rows; shadow never returns v2 providers to
runtime; v2 never silently combines legacy secrets.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-config-mode.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the mode**

Read `PROVIDER_CONFIG_MODE` through AppConfigService; fail fast on invalid
values. The default stays `legacy` so an image can be deployed without
changing behavior. `shadow` logs only redacted provider counts/diffs.

- [ ] **Step 3: Verify**

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/provider-config-mode.spec.ts
pnpm --filter @roamlog/api typecheck
pnpm check:env
```

Expected: PASS; env preflight has no secret output.

---

### Task 15: Add the secure key import CLI

**Files:**

- Create: `apps/api/scripts/import-provider.ts`
- Modify: `package.json` (add `providers:import` only if the script cannot be
  run through `pnpm --filter @roamlog/api exec tsx`)
- Test: `apps/api/src/modules/providers/__tests__/provider-import.e2e.spec.ts`

**Interfaces:**

```text
pnpm providers:import \
  --group=places --adapter=tencent --preset=tencent \
  --label="腾讯地图" --priority=10 --api-key-stdin

pnpm providers:import \
  --group=places --adapter=geoapify --preset=geoapify \
  --label="Geoapify" --priority=20 --api-key-stdin
```

Rules:

- Read the key from stdin only; never accept `--api-key <value>`.
- Require the current keyring; fail closed if absent.
- Idempotent on `(group, adapter, label)`.
- Default does not replace an existing secret; `--replace-secret` does.
- Print only `providerId`, `adapter`, `preset`, `last4`, `created|updated`.
- Write audit `admin.provider.secret_imported`.
- Do not print the key in dry-run either.

- [ ] **Step 1: Write failing CLI/integration tests**

Use a temporary test DB and a mocked stdin. Test create, idempotent re-run,
secret replacement opt-in, missing keyring, malformed base64 key, and the
absence of plaintext in stdout/stderr/audit.

Run:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/__tests__/provider-import.e2e.spec.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the importer**

Reuse `ProviderConfigService`, `ProviderSecretService`, and the catalog. If a
Nest context is too heavy, create a narrow importer service and inject it; do
not duplicate encryption or audit logic.

- [ ] **Step 3: Verify the local secret path without printing values**

```bash
node -e "const fs=require('fs');for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){if(/^(TENCENT_MAPS_KEY|GEOAPIFY_API_KEY)=/.test(line)){const [k,v]=line.split('=',2);console.log(k,'len='+v.length)}}"
```

Expected: two names and lengths; no values. Then run the CLI with the keys
piped from the same file only in the deployment task, not during local unit
tests.

- [ ] **Step 4: Run the importer against a disposable test schema**

```bash
ROAMLOG_TEST_DATABASE_URL='postgresql://roamlog:roamlog@localhost:5432/roamlog?schema=provider_import_test' \
pnpm --filter @roamlog/api exec tsx scripts/import-provider.ts --group=places --adapter=tencent --preset=tencent --label='腾讯地图' --priority=10 --api-key-stdin < /dev/null
```

Expected: missing stdin fails safely and prints no key. Then run the same
command with a test-only fake key from a protected temporary file; assert
`hasValue=true` and last4 only.

---

### Task 16: Prove the end-to-end backend contract

**Files:**

- Create: `apps/api/src/modules/providers/__tests__/provider-runtime.e2e.spec.ts`
- Modify: tests only as required by earlier tasks

**Interfaces:** Real `createTestApp` (or real API process), PostgreSQL test
schema, real Redis, real guards, and a stub upstream that records requests.

- [ ] **Step 1: Test the full lifecycle**

1. Create two AI providers with priority 10/20.
2. Discover models through a local stub `/models`; save default models.
3. Patch provider 10 base URL to fail with 500; verify non-stream Chat uses
   provider 20.
4. Verify an auth 401 on provider 10 is surfaced, not silently failed over.
5. Verify a stream that emits one token then fails does not replay.
6. Create Tencent + Geoapify, import fake keys, assert both have
   `hasValue=true` and distinct last4.
7. Verify map `merge` and `priority_failover` with a stub response.
8. Verify ordering survives a fresh app instance and an API reload.
9. Verify audit rows contain provider ids and no plaintext.

- [ ] **Step 2: Run the real HTTP evidence**

Start the API with a test DB/Redis and execute the E2E script; record:

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/providers/__tests__/provider-runtime.e2e.spec.ts
```

Expected: PASS with the real database and Redis; attach the command output and
the request/response/DB assertions to the delivery report.

---

### Task 17: Full backend gate and handoff

**Files:**

- Create: `.audit/settings-provider/backend-report.md`
- No product file changes in this task except fixes required by failures.

- [ ] **Step 0: Reconcile and remove the old single-provider path**

After the new Provider API and runtime tests are green, remove or explicitly
deprecate the old single-provider backend path:

- remove `apps/api/src/modules/ai/ai-model-discovery.service.ts`,
  `ai-admin-settings.controller.ts`, and their test if the new
  `ProviderModelDiscoveryService`/controller replaces them;
- remove the old `AiModelDiscovery*` contract exports and the
  `ai.defaultProvider` protocol experiment from the registry only after all
  consumers have moved;
- confirm `ai-model-discovery` and `discoverAiModels` have no live route or
  import. If a compatibility route must remain for one release, document it as
  deprecated and make it delegate to the new provider path.

- [ ] **Step 1: Regenerate contracts and run checks**

```bash
pnpm --filter @roamlog/contracts contracts:generate
pnpm --filter @roamlog/api-client api-client:generate
pnpm contracts:check
pnpm --filter @roamlog/api typecheck
pnpm --filter @roamlog/api test
pnpm --filter @roamlog/api build
pnpm lint
pnpm staging:validate
```

Expected: every command exits 0; report exact counts.

- [ ] **Step 2: Run migration checks**

```bash
pnpm --filter @roamlog/db prisma validate
pnpm --filter @roamlog/db test
```

Expected: schema valid; migration tests pass on empty/current schema.

- [ ] **Step 3: Run security and secret scans**

```bash
pnpm security:check
git diff --check
rg -n "TENCENT_MAPS_KEY=|GEOAPIFY_API_KEY=|sk-[A-Za-z0-9]" \
  .audit/settings-provider docs/superpowers/specs/2026-11-22-admin-settings-provider-architecture.md
```

Expected: no secret values; `rg` exits 1 for no matches.

- [ ] **Step 4: Write handoff**

Create `.audit/settings-provider/backend-report.md` with:

```text
状态: DONE | BLOCKED
任务 ID: PLAN-PROVIDER-BACKEND
变更文件:
实现摘要:
验证命令与结果:
数据库迁移证据:
密钥导入证据（只有 id/last4）:
CodeGraph 证据:
移植来源:
已知风险:
未覆盖项:
建议的下一步:
```

Do not claim UI acceptance; the Admin UI plan owns that. Do not deploy.

---

## Dependency and parallelism rules

- Follow the cross-plan execution table in
  `2026-11-22-admin-settings-provider-ui.md`; it is the single coordination
  source for the shared contracts/schema/settings/CI files.
- Tasks 1–3 are Wave 0 and must be serialized against the theme plan's shared
  contract/schema edits.
- Tasks 4–9 can run once the contracts and tables are present.
- Tasks 10–12 are independently testable after Task 9. AI and Places may run in
  parallel, but both must use the same `ProviderRuntimeService` contract.
- Task 13 can run after Task 9; it must not touch AI/Places implementation files.
- Tasks 14–16 require all runtime paths present.
- Task 17 is the root acceptance gate after all implementation tasks.

## Requirement traceability

| Requirement                                | Tasks              |
| ------------------------------------------ | ------------------ |
| Provider instance CRUD and ordering        | 1, 2, 3, 6, 7      |
| Encrypted DB credentials and rotation      | 3, 5, 15           |
| AI multi-vendor presets and discovery      | 4, 8, 10, 11       |
| Map multi-provider priority/merge          | 4, 9, 12           |
| Mail/storage unified UI with single active | 4, 6, 13           |
| Legacy rollout/rollback                    | 14, 16             |
| Audit/2FA/RBAC/version conflicts           | 6, 7, 8, 16        |
| Real DB/Redis/HTTP evidence                | 3, 8, 12, 16, 17   |
| No deployment before acceptance            | 17 and root review |
