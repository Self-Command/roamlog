# 后台 Provider 设置 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four service settings forms with a catalog-driven Admin Provider workbench for AI, places, mail, and storage, while keeping system settings scalar groups and the fixed-dark Admin shell.

**Architecture:** The Admin app consumes the frozen Provider API from `docs/superpowers/specs/2026-11-22-admin-settings-provider-architecture.md`. A generic catalog hook renders adapter/preset-specific fields, a sortable provider list owns priority, a detail dialog owns draft editing, and secret replacement uses a dedicated write-only endpoint. Scalar system groups move into one tab shell that fetches their settings once. Theme/font appearance defaults are supplied by the separate theme plan; this plan leaves the theme tab as the existing scalar group until that plan replaces its panel.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Radix Dialog/Switch/Tabs, `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-admin-settings-rebuild-requirements.md` and `docs/superpowers/specs/2026-11-22-admin-settings-provider-ui.md`.

## Global Constraints

- Provider vocabulary is exactly `group / adapter / preset / label`. UI primary copy uses `preset`; `adapter` appears only in advanced diagnostics.
- Provider groups are `ai`, `places`, `mail`, `storage`. `media` remains a scalar settings page.
- Every provider/group write is super-admin-only and remains protected by the Admin session, TOTP, and origin checks. Non-super-admin roles are read-only.
- Secrets are never prefilled, never stored in client state after save, and never echoed in HTML, URLs, logs, toasts, test snapshots, or screenshots. Existing values show only `hasValue` and `last4`.
- Replacing a secret calls `PUT /v1/admin/providers/:id/secrets/:field` with `expectedVersion`; a normal provider `PATCH` never contains a secret.
- Optimistic writes use `expectedVersion`; 409 responses preserve all drafts and show conflict recovery.
- AI v1 routing is priority failover only. Places defaults to `merge`; `priority_failover` is an explicit mode. Mail/storage are single-active in v1 and a second enable returns `409 PROVIDER_ACTIVE_CONFLICT`.
- Admin stays fixed dark. Do not edit theme tokens, fonts, Web appearance, or public share styles in this plan.
- Use CodeGraph before code exploration: `codegraph status` then `codegraph explore "<symbols>"`.
- Do not create a git commit or branch. AGENTS forbids opportunistic commits; the root handles the release commit after acceptance.
- Task order matters. Tasks 1-2 and the backend contract freeze must complete before Tasks 3-17. Theme-plan work may run only after the `SettingsConsole` shell task is accepted.

## Frozen UI-facing interfaces

The canonical wire types are generated from
`packages/contracts/src/api/providers.ts` into `@roamlog/api-client`.
`apps/admin/lib/provider-settings-api.ts` must import those generated types and
must not redeclare independent wire interfaces. This plan uses the following
names only as documented aliases:

```ts
import type {
  ProviderCatalogResponse,
  ProviderConnection,
  ProviderGroupResponse,
} from "@roamlog/api-client";

// Local view model only: modelCount/defaultModel are joined from the model
// endpoint for list presentation and are not fields of ProviderConnection.
export type AdminProviderSummary = ProviderConnection & {
  modelCount?: number;
  defaultModel?: string | null;
};
```

Use generated `ProviderConnection`, `ProviderGroupResponse`, `ProviderHealth`,
`ProviderSecretState`, and catalog descriptor types directly. The flat group
shape is `{ group, label, routingMode, maxAttempts, cooldownSeconds, version,
providers }`. `preset` is nullable; health has no `disabled` value (disabled is
represented by `enabled: false`); secret state includes `version`.

## File Structure

**Create**

- `apps/admin/lib/provider-settings-api.ts`
- `apps/admin/lib/provider-settings.ts`
- `apps/admin/lib/provider-settings-api.test.ts`
- `apps/admin/lib/provider-settings.test.ts`
- `apps/admin/lib/cached-admin-settings-api.ts`
- `apps/admin/lib/cached-admin-settings-api.test.ts`
- `apps/admin/components/settings/use-provider-settings.ts`
- `apps/admin/components/settings/provider-group-page.tsx`
- `apps/admin/components/settings/provider-policy-card.tsx`
- `apps/admin/components/settings/provider-list.tsx`
- `apps/admin/components/settings/provider-row.tsx`
- `apps/admin/components/settings/provider-order-controls.tsx`
- `apps/admin/components/settings/provider-editor.tsx`
- `apps/admin/components/settings/provider-catalog-field.tsx`
- `apps/admin/components/settings/provider-secret-field.tsx`
- `apps/admin/components/settings/provider-probe-panel.tsx`
- `apps/admin/components/settings/provider-model-picker.tsx`
- `apps/admin/components/settings/provider-conflict-dialog.tsx`
- `apps/admin/components/settings/provider-empty-state.tsx`
- `apps/admin/components/settings/settings-tabs.tsx`
- `apps/admin/components/admin-shell/unsaved-changes.tsx`
- `apps/admin/components/settings/*.test.tsx` for each new behaviour unit
- `e2e/support/provider-stub.ts`
- `e2e/admin/smoke/admin-providers.spec.ts`

**Modify**

- `apps/admin/package.json` for dnd-kit dependencies
- `apps/admin/components/settings/settings-console.tsx`
- `apps/admin/components/settings/settings-group-form.tsx`
- `apps/admin/components/settings/service-settings-page.tsx`
- `apps/admin/components/settings/settings-page-client.tsx`
- `apps/admin/components/settings/settings-ia.test.tsx`
- `apps/admin/components/admin-shell/admin-shell.tsx`
- `apps/admin/components/admin-shell/admin-sidebar.tsx`
- Do **not** modify `apps/admin/lib/admin-settings.ts`: the theme plan owns it.
  Provider UI must import existing helpers or keep provider-only helpers in
  `apps/admin/lib/provider-settings.ts`.

**Remove after replacement**

- `apps/admin/components/settings/ai-model-discovery.tsx` (the narrow single-provider WIP, replaced by `provider-model-picker.tsx`)
- `apps/admin/lib/admin-settings-api.ts`'s `discoverAiModels()` only if the backend removes the old single-provider endpoint. Do not remove it before the replacement endpoint is green.

## Cross-plan execution order

The root coordinator must execute these waves in order; the plans are not all
independent:

1. **Wave 0A**: Provider backend Task 0 (WIP backup) → Provider backend Task 1
   (`providers.ts` + `api/index.ts`) → Theme Task 1 (`appearance.ts` +
   `admin-settings.ts`) → Provider backend Task 2 (OpenAPI/client generation) →
   Provider backend Task 3 (Prisma 0016) → Theme Task 2 (Prisma 0017) → Theme
   Task 3 (settings registry/defaults). Each listed file has one writer per
   step; never run the two schema or settings edits concurrently.
2. **Wave 1**: Provider backend Tasks 4–9 and this plan's Tasks 1–2 may run in
   parallel once the generated Provider types exist. This plan never edits
   `apps/admin/lib/admin-settings.ts`; Theme owns it.
3. **Wave 2**: Provider backend Tasks 10–15, this plan's Tasks 3–15, and Theme
   Tasks 4–7 run in their file-disjoint areas. Theme Task 8 (Admin appearance
   tab) waits for this plan's Task 2 settings shell.
4. **Wave 3**: Theme Tasks 8–14, then Theme Task 15 and this plan's Task 16.
   Task 16 is the sole owner of `.github/workflows/ci.yml` and adds both E2E
   steps after both spec files exist. Task 17s perform cleanup; root runs the
   final acceptance gate.

Shared-file owners: Provider backend owns `providers.ts`, 0016, and Provider
services; Theme owns appearance contracts, 0017, `admin-settings.ts`, and
setting-defaults; this plan owns Provider Admin components and CI; root owns
the final release commit.

## Task 1: Provider settings API client

**Files:**

- Create: `apps/admin/lib/provider-settings-api.ts`
- Test: `apps/admin/lib/provider-settings-api.test.ts`
- Modify: `apps/admin/lib/admin-settings-api.ts` only to export the shared error helper

**Interfaces:**

- Consumes: backend Provider endpoints from the architecture spec.
- Produces: `ProviderSettingsApi`, `createProviderSettingsApi(fetchImpl)`.

```ts
export interface ProviderSettingsApi {
  catalog(): Promise<ProviderCatalogResponse>;
  group(group: ProviderGroupKey): Promise<ProviderGroupResponse>;
  updatePolicy(
    group: ProviderGroupKey,
    input: ProviderPolicyUpdate,
  ): Promise<ProviderGroupResponse>;
  reorder(
    group: ProviderGroupKey,
    ids: string[],
    expectedGroupVersion: number,
  ): Promise<ProviderGroupResponse>;
  create(input: ProviderCreateInput): Promise<AdminProviderSummary>;
  update(id: string, input: ProviderUpdateInput): Promise<AdminProviderSummary>;
  remove(id: string, expectedVersion: number): Promise<void>;
  probe(id: string, expectedVersion: number): Promise<ProviderProbeResponse>;
  probeDraft(input: ProviderDraftProbeInput): Promise<ProviderProbeResponse>;
  discoverModels(input: ProviderModelDiscoveryRequest): Promise<ProviderModelDiscoveryResponse>;
  refreshModels(id: string, expectedVersion: number): Promise<ProviderModelDiscoveryResponse>;
  replaceSecret(
    id: string,
    field: string,
    input: ReplaceProviderSecretRequest,
  ): Promise<ReplaceProviderSecretResponse>;
  revealSecret(id: string, field: string, confirm: true): Promise<ProviderSecretRevealResponse>;
}

export interface ProviderCreateInput {
  group: ProviderGroupKey;
  adapter: string;
  preset: string | null;
  label: string;
  enabled: boolean;
  priority?: number;
  config: Record<string, unknown>;
  // Initial credentials are written atomically with the provider. They are
  // accepted only on POST; PATCH rejects secrets.
  secrets?: Record<string, string>;
  expectedGroupVersion?: number;
}

export interface ProviderUpdateInput {
  adapter?: string;
  preset?: string | null;
  label?: string;
  enabled?: boolean;
  priority?: number;
  config?: Record<string, unknown>;
  expectedVersion: number;
}
```

- [ ] **Step 1: Write the failing test**

```ts
it("keeps secrets out of provider PATCH and uses the dedicated secret PUT", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse(providerFixture()))
    .mockResolvedValueOnce(jsonResponse(secretStateFixture()));
  const api = createProviderSettingsApi(fetchMock);

  await api.update("provider-1", {
    label: "DeepSeek",
    config: { baseUrl: "https://api.deepseek.com/v1" },
    expectedVersion: 3,
  });
  await api.replaceSecret("provider-1", "apiKey", {
    value: "new-secret",
    expectedVersion: 4,
  });

  expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/admin/providers/provider-1");
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty("secrets");
  expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/admin/providers/provider-1/secrets/apiKey");
});

it("sends a new provider secret in the POST body and never in PATCH", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse(providerFixture({ secrets: [] })))
    .mockResolvedValueOnce(jsonResponse(providerFixture()));
  const api = createProviderSettingsApi(fetchMock);

  await api.create({
    group: "ai",
    adapter: "openai-chat",
    preset: "deepseek",
    label: "DeepSeek",
    enabled: true,
    config: { baseUrl: "https://api.deepseek.com/v1" },
    secrets: { apiKey: "new-secret" },
  });

  expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/admin/providers");
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
    secrets: { apiKey: "new-secret" },
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @roamlog/admin exec vitest run lib/provider-settings-api.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the client**

Use the existing `requestJson` + `AdminSettingsError` patterns from `admin-settings-api.ts`. Preserve field errors from 422/409 responses. Send `credentials: "same-origin"`, JSON content type only when a body exists, and never log payloads.

- [ ] **Step 4: Run and verify**

Run: `pnpm --filter @roamlog/admin exec vitest run lib/provider-settings-api.test.ts`

Expected: PASS, including path, version, secret separation, 409, and malformed-response cases.

- [ ] **Step 5: Checkpoint**

Run `git diff --check`. Do not commit.

## Task 2: Cached settings shell and tabs

**Files:**

- Create: `apps/admin/lib/cached-admin-settings-api.ts`
- Test: `apps/admin/lib/cached-admin-settings-api.test.ts`
- Create: `apps/admin/components/settings/settings-tabs.tsx`
- Create: `apps/admin/components/settings/settings-group-panel.tsx`
- Modify: `apps/admin/components/settings/settings-console.tsx`
- Modify: `apps/admin/components/settings/settings-group-form.tsx` to accept `onDirtyChange?: (dirty: boolean) => void`

**Interfaces:**

- Consumes: `AdminSettingsApi.list/update/reveal`.
- Produces: one shared settings snapshot per `/admin/settings` mount and tab state.

The scalar groups are mounted once and hidden with the `hidden` attribute, so switching tabs does not discard drafts. The wrapper API caches `list()` and replaces a group after a successful save:

```ts
function replaceGroups(
  response: AdminSettingsResponse,
  freshGroups: AdminSettingsResponse["groups"],
): AdminSettingsResponse {
  const byGroup = new Map(freshGroups.map((group) => [group.group, group]));
  return {
    ...response,
    groups: response.groups.map((group) => byGroup.get(group.group) ?? group),
  };
}

export function createCachedAdminSettingsApi(inner: AdminSettingsApi): AdminSettingsApi {
  let snapshot: AdminSettingsResponse | null = null;
  let pending: Promise<AdminSettingsResponse> | null = null;
  return {
    ...inner,
    list() {
      if (snapshot) return Promise.resolve(snapshot);
      pending ??= inner
        .list()
        .then((value) => {
          snapshot = value;
          return value;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    async update(updates) {
      const result = await inner.update(updates);
      if (snapshot) snapshot = replaceGroups(snapshot, result.groups);
      return result;
    },
    reveal: (...args) => inner.reveal(...args),
  };
}
```

- [ ] **Step 1: Write the failing shell test**

```tsx
it("fetches scalar settings once and preserves drafts when switching tabs", async () => {
  const api = fakeAdminSettingsApi();
  render(<SettingsConsole role="super_admin" api={api} />);

  await user.click(screen.getByRole("tab", { name: "通用" }));
  await user.type(screen.getByLabelText("站点标题"), "未保存标题");
  await user.click(screen.getByRole("tab", { name: "SEO" }));
  await user.click(screen.getByRole("tab", { name: "通用" }));

  expect(screen.getByLabelText("站点标题")).toHaveValue("未保存标题");
  expect(api.list).toHaveBeenCalledTimes(1);
});

it("clears a rejected in-flight load so retry can recover", async () => {
  const inner = fakeAdminSettingsApi();
  inner.list.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(settingsFixture());
  const api = createCachedAdminSettingsApi(inner);

  await expect(api.list()).rejects.toThrow("network");
  await expect(api.list()).resolves.toMatchObject({ groups: expect.any(Array) });
  expect(inner.list).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @roamlog/admin exec vitest run components/settings/settings-console.test.tsx`

Expected: FAIL; current console has stacked forms and no tabs.

- [ ] **Step 3: Implement tabs and caching**

Tabs are `role="tablist"`, support Arrow/Home/End, and update `?tab=` through `history.replaceState` without a server round trip. Mount `general`, `seo`, `theme`, and `limits` panels in the DOM; hide inactive panels. The theme tab continues to render the existing scalar theme group until the theme plan replaces that panel. Report each panel’s dirty state upward.

- [ ] **Step 4: Run and verify**

Run: `pnpm --filter @roamlog/admin exec vitest run components/settings/settings-console.test.tsx components/settings/settings-ia.test.tsx lib/cached-admin-settings-api.test.ts`

Expected: PASS. Update the old "four stacked sections" assertion to tab semantics.

- [ ] **Step 5: Checkpoint**

Run `pnpm --filter @roamlog/admin typecheck`. Do not commit.

## Task 3: Provider group page shell

**Files:**

- Create: `apps/admin/components/settings/use-provider-settings.ts`
- Create: `apps/admin/components/settings/provider-group-page.tsx`
- Create: `apps/admin/components/settings/provider-empty-state.tsx`
- Modify: `apps/admin/components/settings/service-settings-page.tsx`
- Test: `apps/admin/components/settings/provider-group-page.test.tsx`

**Interfaces:**

- Consumes: `ProviderSettingsApi.catalog()`, `.group(group)`.
- Produces: `ProviderGroupPage({ group, role, api })`.

Render a page header with group label, enabled/healthy counts, `添加服务商` CTA, routing policy card, and provider list. `ai`, `places`, `mail`, and `storage` service pages use this component; `media` stays on `SettingsGroupForm`.

- [ ] **Step 1: Write the failing tests**

Test loading, empty, error, read-only, and successful render. Assert no provider editor is opened until the CTA is pressed.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @roamlog/admin exec vitest run components/settings/provider-group-page.test.tsx`

- [ ] **Step 3: Implement the shell**

Do not hardcode provider names. Preset labels come from `catalog.groups[].adapters[].presets[]`. Use `ProviderEmptyState` for zero rows and `AdminPageHeader` for the page title.

- [ ] **Step 4: Run and verify**

Run: `pnpm --filter @roamlog/admin exec vitest run components/settings/provider-group-page.test.tsx`

- [ ] **Step 5: Checkpoint**

Run `pnpm --filter @roamlog/admin typecheck`.

## Task 4: Responsive provider list and status

**Files:**

- Create: `apps/admin/components/settings/provider-list.tsx`
- Create: `apps/admin/components/settings/provider-row.tsx`
- Test: `apps/admin/components/settings/provider-list.test.tsx`

**Interfaces:**

- Consumes: `readonly AdminProviderSummary[]`, catalog labels, role.
- Produces: `ProviderList({ providers, catalog, role, onEdit, onProbe, onToggle, onDelete })`.

Desktop uses a semantic table; mobile uses a `ul/li` card layout. Both expose the same accessible names and actions. Health status includes text and icon, not color alone. Secrets render `••••{last4}` or `未设置`.

- [ ] **Step 1: Write failing tests** for status text, secret last4, disabled actions for non-super-admin, and row edit without triggering the enable switch.
- [ ] **Step 2: Run and verify failure** with the Task 4 command.
- [ ] **Step 3: Implement the list and row**.
- [ ] **Step 4: Run:** `pnpm --filter @roamlog/admin exec vitest run components/settings/provider-list.test.tsx`.
- [ ] **Step 5: Checkpoint** with `pnpm --filter @roamlog/admin typecheck`.

## Task 5: Priority ordering and conflict recovery

**Files:**

- Modify: `apps/admin/package.json`
- Create: `apps/admin/components/settings/provider-order-controls.tsx`
- Create: `apps/admin/components/settings/provider-conflict-dialog.tsx`
- Test: `apps/admin/components/settings/provider-order-controls.test.tsx`

Add `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2` to the Admin app dependencies.
Before adding them, check `pnpm-lock.yaml` and `pnpm security:check`; confirm the
packages are MIT-licensed and not already present. Drag is never the only
ordering mechanism; keyboard move-up/move-down must work without dnd-kit.

**Interfaces:**

- Produces: local ordered draft, `saveOrder()`, `moveUp(id)`, `moveDown(id)`, conflict callback.

- [ ] **Step 1: Write failing tests**

```tsx
it("saves normalized order and keeps local order on a 409", async () => {
  const onConflict = vi.fn();
  const api = fakeProviderApi({
    reorder: vi.fn().mockRejectedValue(providerConflict()),
  });
  render(<Harness api={api} onConflict={onConflict} />);
  await user.click(screen.getByRole("button", { name: "腾讯地图下移" }));
  await user.click(screen.getByRole("button", { name: "保存顺序" }));
  expect(onConflict).toHaveBeenCalledWith(
    expect.objectContaining({ code: "PROVIDER_ORDER_CONFLICT" }),
  );
  expect(screen.getByRole("button", { name: "腾讯地图上移" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify failure**.
- [ ] **Step 3: Implement dnd-kit sortable rows plus keyboard move buttons and `aria-live` announcements. Normalize the saved priority to 10/20/30.**
- [ ] **Step 4: Run:** `pnpm --filter @roamlog/admin exec vitest run components/settings/provider-order-controls.test.tsx`.
- [ ] **Step 5: Checkpoint** with typecheck. Do not test pointer drag in jsdom; Playwright covers it.

## Task 6: Catalog-driven provider editor

**Files:**

- Create: `apps/admin/components/settings/provider-editor.tsx`
- Create: `apps/admin/components/settings/provider-catalog-field.tsx`
- Test: `apps/admin/components/settings/provider-editor.test.tsx`

**Interfaces:**

- Consumes: `ProviderAdapterDescriptor`, existing provider or empty draft, `onSave`, `onProbeDraft`.
- Produces: draft state with `label`, `enabled`, `preset`, `adapter`, `config`, `secretDrafts`, `expectedVersion`.

The editor renders fields from `configFields`; it does not switch on `provider === "tencent"` or any vendor string. Preset changes may reset only fields declared by the new adapter.

- [ ] **Step 1: Write failing tests** for required fields, select options,
      integer bounds, dirty close confirmation, draft preservation after 422, and
      the create flow: `secretDrafts` are sent only as
      `ProviderCreateInput.secrets` on POST; an edit sends no secret in PATCH and
      uses the dedicated replacement endpoint only when the operator types a new
      key. A failed create must leave the editor open with the secret draft intact
      and must not leave a provider row behind.
- [ ] **Step 2: Run and verify failure**.
- [ ] **Step 3: Implement the dialog/sheet.** On create, submit the initial
      `secretDrafts` through `ProviderCreateInput.secrets`; do not create a
      provider first and then leave it keyless. On edit, omit secrets from PATCH and
      use `replaceSecret` only for fields with a non-empty draft.
- [ ] **Step 4: Run:** `pnpm --filter @roamlog/admin exec vitest run components/settings/provider-editor.test.tsx`.
- [ ] **Step 5: Checkpoint** with typecheck.

## Task 7: Secret replacement and audited reveal

**Files:**

- Create: `apps/admin/components/settings/provider-secret-field.tsx`
- Test: `apps/admin/components/settings/provider-secret-field.test.tsx`

**Interfaces:**

- Consumes: `ProviderSecretState`, `replaceSecret`, `revealSecret`.
- Produces: write-only secret draft and masked state.

- [ ] **Step 1: Write failing tests** that `••••last4` is shown, a blank input never sends a secret, typing a new key calls only the secret endpoint, reveal requires confirmation, and the revealed value clears after ten seconds.
- [ ] **Step 2: Run and verify failure**.
- [ ] **Step 3: Implement the field and confirmation dialog.** Clear the draft from React state immediately after a successful save. Never include the value in accessible descriptions after save.
- [ ] **Step 4: Run:** `pnpm --filter @roamlog/admin exec vitest run components/settings/provider-secret-field.test.tsx`.
- [ ] **Step 5: Checkpoint**.

## Task 8: Provider probe and health panel

**Files:**

- Create: `apps/admin/components/settings/provider-probe-panel.tsx`
- Test: `apps/admin/components/settings/provider-probe-panel.test.tsx`

**Interfaces:**

- Consumes: saved `probe(id)` and draft `probeDraft(input)`.
- Produces: loading, latency, result count, safe error, and retry UI.

- [ ] **Step 1: Write failing tests** for draft vs saved endpoint selection, loading lock, safe error copy, and no form reset on failure.
- [ ] **Step 2: Run and verify failure**.
- [ ] **Step 3: Implement the panel** with `role="status"` for success/loading and `role="alert"` for failure.
- [ ] **Step 4: Run:** `pnpm --filter @roamlog/admin exec vitest run components/settings/provider-probe-panel.test.tsx`.
- [ ] **Step 5: Checkpoint**.

## Task 9: Migration-safe provider API aliases and helpers

**Files:**

- Create: `apps/admin/lib/provider-settings.ts`
- Test: `apps/admin/lib/provider-settings.test.ts`

**Interfaces:**

- Produces: `providerPresetLabel`, `providerAdapterLabel`, `providerStatusLabel`, `providerSecretLabel`, `providerOrderIds`, `providerDraftPayload`, `providerMutationErrorMessage`.

These helpers are pure. `providerDraftPayload` must omit secret fields and preserve `expectedVersion`. `providerMutationErrorMessage` maps stable backend codes to actionable copy, including `SETTINGS_ENCRYPTION_UNAVAILABLE`, `PROVIDER_SECRETS_UNAVAILABLE`, `PROVIDER_VERSION_CONFLICT`, `PROVIDER_ORDER_CONFLICT`, and `PROVIDER_ACTIVE_CONFLICT`.

- [ ] **Step 1: Write failing tests** for preset labels, unknown values, normalized priorities, secret omission, and the keyring/secret-service error copy.
- [ ] **Step 2: Run and verify failure**.
- [ ] **Step 3: Implement the helpers**.
- [ ] **Step 4: Run:** `pnpm --filter @roamlog/admin exec vitest run lib/provider-settings.test.ts`.
- [ ] **Step 5: Checkpoint**.

## Task 10: AI model discovery and model picker

**Files:**

- Create: `apps/admin/components/settings/provider-model-picker.tsx`
- Test: `apps/admin/components/settings/provider-model-picker.test.tsx`
- Replace: `apps/admin/components/settings/ai-model-discovery.tsx` only after this task passes

**Interfaces:**

- Consumes: `ProviderSettingsApi.discoverModels()` and `refreshModels()`.
- Produces: model list, selected default model, capability toggles, and manual-model fallback.

- [ ] **Step 1: Write failing tests** for 700 ms debounce, canceled prior request, loading, 401, timeout, empty catalog, no auto-selection of the first model, saved model preservation, and manual fallback.
- [ ] **Step 2: Run and verify failure**.
- [ ] **Step 3: Implement `useProviderModelDiscovery` with `AbortController` and `requestId` guards.** Status is `idle | loading | ready | empty | error`; never auto-select.
- [ ] **Step 4: Run:** `pnpm --filter @roamlog/admin exec vitest run components/settings/provider-model-picker.test.tsx`.
- [ ] **Step 5: Checkpoint** with typecheck.

## Task 11: AI provider page integration

**Files:**

- Modify: `apps/admin/components/settings/provider-group-page.tsx`
- Create: `apps/admin/components/settings/provider-policy-card.tsx`
- Test: `apps/admin/components/settings/ai-provider-page.test.tsx`

**Interfaces:**

- Consumes: AI catalog presets and model picker.
- Produces: AI-specific editor section driven by `adapter`/`preset`, not a vendor conditional.

- [ ] **Step 1: Write failing tests** for the nine frozen presets, default model selection, capability toggles, priority copy, and failover explanation.
- [ ] **Step 2: Run and verify failure**.
- [ ] **Step 3: Implement the AI section.** Show `preset` in the main select; show `adapter` only under "高级诊断". Do not invent native Gemini/OpenRouter adapters.
- [ ] **Step 4: Run:** `pnpm --filter @roamlog/admin exec vitest run components/settings/ai-provider-page.test.tsx`.
- [ ] **Step 5: Checkpoint**.

## Task 12: Places provider page integration

**Files:**

- Modify: `apps/admin/components/settings/provider-policy-card.tsx`
- Modify: `apps/admin/components/settings/provider-group-page.tsx`
- Test: `apps/admin/components/settings/places-provider-page.test.tsx`

**Interfaces:**

- Consumes: `routingMode` from the group response, map catalog fields.
- Produces: merge/priority_failover switch, region multi-select, quota and timeout fields, Tencent/Geoapify secret states.

- [ ] **Step 1: Write failing tests** for both routing modes, region fields, two simultaneous providers, and the confirmation copy when switching to strict failover.
- [ ] **Step 2: Run and verify failure**.
- [ ] **Step 3: Implement the policy card and map-specific catalog section.** No hardcoded Tencent/Geoapify field lists.
- [ ] **Step 4: Run:** `pnpm --filter @roamlog/admin exec vitest run components/settings/places-provider-page.test.tsx`.
- [ ] **Step 5: Checkpoint**.

## Task 13: Mail and storage single-active behaviour

**Files:**

- Modify: `apps/admin/components/settings/provider-list.tsx`
- Modify: `apps/admin/components/settings/provider-editor.tsx`
- Modify: `apps/admin/components/settings/provider-group-page.tsx`
- Test: `apps/admin/components/settings/single-active-provider.test.tsx`

**Interfaces:**

- Consumes: `ProviderGroupKey` and `group` response.
- Produces: conditional fields for Resend vs SMTP and S3, single-active conflict messaging.

- [ ] **Step 1: Write failing tests** for conditional mail fields, S3 fields, second-instance disabled notice, and `409 PROVIDER_ACTIVE_CONFLICT` mapping to an actionable dialog.
- [ ] **Step 2: Run and verify failure**.
- [ ] **Step 3: Implement single-active UI.** Do not auto-disable another provider without explicit confirmation.
- [ ] **Step 4: Run:** `pnpm --filter @roamlog/admin exec vitest run components/settings/single-active-provider.test.tsx`.
- [ ] **Step 5: Checkpoint**.

## Task 14: Settings dirty-navigation guard

**Files:**

- Create: `apps/admin/components/admin-shell/unsaved-changes.tsx`
- Modify: `apps/admin/components/admin-shell/admin-shell.tsx`
- Modify: `apps/admin/components/admin-shell/admin-sidebar.tsx`
- Modify: `apps/admin/components/settings/settings-group-form.tsx`
- Test: `apps/admin/components/admin-shell/unsaved-changes.test.tsx`

**Interfaces:**

- Produces: `UnsavedChangesProvider`, `useUnsavedChanges()`, `registerDirtySource(id, dirty)`.

The sidebar intercepts navigation when any registered draft is dirty. The form registers dirty state from `dirtyKeys.length`; the provider also installs `beforeunload`. The confirmation copy must name the page, not show a generic browser prompt.

- [ ] **Step 1: Write failing tests** for registering/clearing dirty state, sidebar click cancel, sidebar click confirm, and `beforeunload`.
- [ ] **Step 2: Run and verify failure**.
- [ ] **Step 3: Implement the provider and sidebar integration.**
- [ ] **Step 4: Run:** `pnpm --filter @roamlog/admin exec vitest run components/admin-shell/unsaved-changes.test.tsx components/settings/settings-console.test.tsx`.
- [ ] **Step 5: Checkpoint**.

## Task 15: Responsive and accessibility acceptance

**Files:**

- Modify: provider list/editor/secret/model/policy components
- Test: add `apps/admin/components/settings/provider-a11y.test.tsx`
- Evidence: `.audit/settings-provider-e2e/`

- [ ] **Step 1: Write tests** for tab Arrow/Home/End, dialog focus trap and Esc, switch labels, status live regions, model combobox keys, secret last4 as text, and no color-only health.
- [ ] **Step 2: Run and verify failure**.
- [ ] **Step 3: Fix focus order, labels, `aria-live`, 44px touch targets, and sticky mobile save actions.**
- [ ] **Step 4: Run** the focused tests and `pnpm --filter @roamlog/admin typecheck`.
- [ ] **Step 5: Checkpoint**.

## Task 16: Real browser Provider journeys

**Files:**

- Create: `e2e/support/provider-stub.ts`
- Create: `e2e/admin/smoke/admin-providers.spec.ts`
- Modify: `.github/workflows/ci.yml` — this plan is the sole owner of the CI
  file for this release; it adds both Provider and Appearance E2E steps after
  the theme plan's specs exist.

The stub is a local HTTP server used only for third-party AI/map upstream calls. It must be named in the report. Real Admin API, Postgres, Redis, session, TOTP, and provider DB rows are used.

- [ ] **Step 1: Write the failing Playwright tests**

```ts
test("adds two AI providers, discovers models, saves and reorders", async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto(`${ADMIN_URL}/admin/services/ai`);
  await page.getByRole("button", { name: "添加服务商" }).click();
  await page.getByLabel("名称").fill("Stub OpenAI");
  await page.getByLabel("Base URL").fill(`${stub.baseUrl}/v1`);
  await page.getByLabel("API Key").fill("stub-key");
  await expect(page.getByText("已获取 2 个模型")).toBeVisible();
  await page.getByLabel("默认模型").click();
  await page.getByRole("option", { name: /stub-model-1/ }).click();
  await page.getByRole("button", { name: "保存 Provider" }).click();
  await page.reload();
  await expect(page.getByText("Stub OpenAI")).toBeVisible();
  await expect(page.getByText(/••••/)).toBeVisible();
  await page.getByRole("button", { name: "测试 Provider" }).click();
  await expect(page.getByText(/连接成功|healthy/i)).toBeVisible();
});
```

Also cover:

- `401`, timeout, empty catalog, and manual model fallback.
- two map providers, both key states, priority reorder, and `priority_failover` mode.
- disabled second mail/storage provider and `409 PROVIDER_ACTIVE_CONFLICT`.
- secret replacement and reveal confirmation; assert masked text and no plaintext in `page.content()`.
- `503 SETTINGS_ENCRYPTION_UNAVAILABLE` and `503 PROVIDER_SECRETS_UNAVAILABLE` render a blocking, actionable banner and preserve all input.
- version conflict with two browser contexts.
- read-only role and direct forbidden API call.
- 1440×1000 and 390×844 screenshots for list/editor/error/empty states.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
E2E_SKIP_WEB_SERVER=1 E2E_START_API=1 PROVIDER_EGRESS_ALLOW_PRIVATE=1 \
  pnpm exec playwright test e2e/admin/smoke/admin-providers.spec.ts --project=admin --reporter=line
```

If the local machine has no Postgres/Redis, run the same command through the CI
quality job. Do not use an in-memory API or mocked DB as acceptance.

Expected: FAIL before implementation.

- [ ] **Step 3: Implement the stub and journeys** against the real local stack. Record the exact stub responses in the test file/report.
- [ ] **Step 3a: Wire both E2E suites into CI** after the theme plan's
      `e2e/web/appearance.spec.ts` exists. Add two explicit workflow steps:
  - `E2E admin provider settings`:
    `AUTH_RATE_LIMIT_MAX=100 E2E_SKIP_WEB_SERVER=1 E2E_START_API=1 PROVIDER_EGRESS_ALLOW_PRIVATE=1 pnpm exec playwright test e2e/admin/smoke/admin-providers.spec.ts --project=admin`
    (the Admin webServer is not skipped; the API starts from the real Postgres/
    Redis/MinIO services already in the quality job). `AUTH_RATE_LIMIT_MAX=100`
    is a CI-only shared-runner IP budget; production remains at its configured
    limit.
  - `E2E appearance`:
    `AUTH_RATE_LIMIT_MAX=100 E2E_START_API=1 pnpm exec playwright test e2e/web/appearance.spec.ts e2e/admin/settings-appearance.spec.ts`
    (do not skip Web or Admin servers; this limit is test-only).
  - Add a dedicated `Upload settings E2E evidence` step with `if: always()`,
    `actions/upload-artifact@v4`, artifact name
    `settings-e2e-evidence-${{ github.run_attempt }}`, and paths
    `.audit/settings-provider-e2e/**` plus `.audit/theme-font/**` with
    `if-no-files-found: ignore` and 7-day retention. Keep the existing
    failure-only Playwright upload unchanged. Do not add a third CI owner in
    the theme plan.
- [ ] **Step 4: Run and verify**

Run the same command. Expected: all Provider journeys pass, screenshots are written to `.audit/settings-provider-e2e/`, and no secret appears in page HTML or screenshots.

- [ ] **Step 5: Checkpoint**.

## Task 17: Cleanup and full Admin gate

**Files:**

- Remove: `apps/admin/components/settings/ai-model-discovery.tsx` after `provider-model-picker` is green
- Remove: old `discoverAiModels` method from `apps/admin/lib/admin-settings-api.ts`
  and any import of the narrow `AiModelDiscovery*` contract types after the
  backend plan removes/deprecates the old route.
- Update: `apps/admin/components/settings/settings-ia.test.tsx` for tabs and provider pages

- [ ] **Step 1: Remove the narrow WIP** and any unused imports/symbols. Search
      for `ai-model-discovery`, `discoverAiModels`, `ai.defaultProvider`,
      `round_robin`, and `providerType`. The old single-provider panel must not
      remain as a second live settings path.
- [ ] **Step 2: Run unit tests**

Run: `pnpm --filter @roamlog/admin test`

Expected: PASS with the new Provider tests included.

- [ ] **Step 3: Run typecheck, lint, build, and contract freshness**

```bash
pnpm --filter @roamlog/admin typecheck
pnpm --filter @roamlog/admin lint
pnpm --filter @roamlog/admin build
pnpm contracts:check
```

Expected: all exit 0.

- [ ] **Step 4: Run formatting and diff hygiene**

```bash
pnpm exec prettier --check apps/admin
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Report evidence**

Include changed files, test counts, screenshot paths, any stub details, and CodeGraph queries. Do not claim deployment or production acceptance; the root owns the release gate.

## Self-review checklist

- Every provider field is rendered from catalog descriptors, not a vendor conditional.
- Every mutation sends `expectedVersion`; every 409 preserves drafts.
- Secret plaintext exists only in a focused password input until the dedicated secret request succeeds.
- No theme/font token edits are included here.
- `media` remains scalar; AI/places/mail/storage use the Provider page.
- Admin remains fixed dark.
- Unit tests cover loading, empty, 401, timeout, 409, 422, disabled, and read-only states.
- Real Playwright covers model discovery, secret masking, ordering, two map providers, single-active conflict, 1440/390, and no plaintext.
- No commit was created by this plan.
