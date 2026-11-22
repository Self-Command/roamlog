# Theme, Font, and Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six licensed, fully local light/dark skins and six locally bundled font pairings; let signed-in Web users choose mode/skin/font, let super admins set platform defaults, render SSR without a wrong-theme flash, and keep the Admin console fixed dark.

**Architecture:** Keep scalar platform defaults in `SystemSetting`; add a one-to-one `UserAppearancePreference`; port six upstream palettes into semantic CSS variables under `[data-skin][data-mode]`; resolve cookies/DB/platform defaults on the server and emit `data-mode`, `data-skin`, `data-font` plus `color-scheme` on `<html>`. Fonts remain Fontsource/OFL packages bundled by the app; no runtime CDN requests.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, NestJS, Prisma/PostgreSQL, Zod + OpenAPI + Orval, Fontsource, Playwright, Vitest.

**Spec:**

- `docs/superpowers/specs/2026-11-22-theme-font-system-design.md`
- `docs/superpowers/specs/2026-11-22-admin-settings-rebuild-requirements.md`
- `docs/superpowers/specs/2026-11-22-admin-settings-provider-ui.md`

## Global Constraints

- Six skins only: `editorial-noir`, `catppuccin`, `tokyo-night`, `rose-pine`, `kanagawa`, `everforest`; every skin has complete light and dark palettes.
- Six font pairings only: `editorial-classic`, `literary-warm`, `modern-editorial`, `expressive-serif`, `cjk-editorial`, `swiss-modern`; all local and OFL-1.1.
- Web/share/editor default mode is `system`; Admin console is fixed dark and never follows platform/user appearance.
- Signed-in DB preference is canonical; a matching `uid + updatedAt` cookie is only first-paint cache; guests are cookie-only.
- No Google Fonts, CDN, remote CSS, user-supplied URLs, or runtime font downloads.
- Raw colors are allowed only in the six shipped palette blocks, documented QR black/white modules, and third-party render surfaces that cannot consume CSS variables.
- Shared-file sequencing:
  - `packages/contracts/src/api/admin-settings.ts`: this plan's Task 1 is serialized before provider plan edits.
  - `packages/db/prisma/schema.prisma` and migrations: provider plan owns `0016`; this plan owns `0017`.
  - `apps/admin/components/settings/settings-console.tsx` and `settings-page-client.tsx`: provider UI shell lands first; this plan adds the appearance tab after it.
  - `packages/ui/src/styles/tokens.css`: this theme plan owns it; provider UI may consume tokens but must not edit this file concurrently.
- No git commits are made by task implementers. This repo's AGENTS.md forbids autonomous commits; use checkbox/checkpoint reports.
- Use CodeGraph before locating or changing code; report `codegraph status` and the query used.
- No deployment until root acceptance and all gates below pass.

---

## File Structure

**Create**

- `packages/contracts/src/api/appearance.ts` — mode/skin/font enums, catalog labels/descriptions/stacks, cookie schema, user preference and resolved appearance schemas.
- `packages/db/prisma/migrations/0017_user_appearance_preference/migration.sql` — one-to-one preference table and FK/cascade.
- `apps/api/src/modules/users/appearance.service.ts` — platform/default resolution, upsert/reset, audit.
- `apps/api/src/modules/users/appearance.controller.ts` — `GET/PUT/DELETE /v1/me/appearance`.
- `apps/api/src/modules/users/__tests__/appearance.service.spec.ts` — resolution/audit/validation tests.
- `apps/api/test/user-appearance.e2e-spec.ts` — real PostgreSQL auth/persistence/2FA/permission path.
- `apps/web/lib/appearance.ts` — cookie codec, legacy mapping, SSR resolver, client cookie writer.
- `apps/web/lib/appearance.test.ts` — precedence and invalid-cookie tests.
- `apps/web/components/appearance/appearance-picker.tsx` — shared mode/skin/font form and accessible preview.
- `apps/web/components/appearance/appearance-preview.tsx` — Web journal/card/share preview.
- `apps/web/components/appearance/appearance-picker.test.tsx` — loading/error/keyboard/persistence UI tests.
- `apps/web/app/(app)/w/[workspaceSlug]/settings/appearance/page.tsx` — user-facing appearance route.
- `apps/web/lib/api/appearance.ts` — generated client wrapper or thin same-origin adapter for `/v1/me/appearance`.
- `apps/admin/components/settings/appearance-defaults.tsx` — platform defaults + Web-only preview.
- `apps/admin/components/settings/appearance-defaults.test.tsx` — role/2FA/validation/preview tests.
- `packages/ui/src/styles/theme-catalog.ts` — typed skin/font IDs, token-role expectations and contrast pairs used by tests; no runtime color decisions.
- `packages/ui/src/styles/tokens.test.ts` — parses `tokens.css`, asserts every skin/mode has complete roles and contrast.
- `packages/ui/src/styles/font-licenses/*.txt` — copied upstream OFL texts.
- `THIRD_PARTY_NOTICES.md` or repository-approved notice file — palette/font attributions.
- `e2e/web/appearance.spec.ts` — light/dark/system, 6 skins, 6 fonts, reload, reset, no external fonts.
- `e2e/admin/settings-appearance.spec.ts` — fixed dark console + default save + preview + 403/permission.
- `.audit/theme-font/**` — screenshots and JSON evidence (not product code).

**Modify**

- `packages/contracts/src/api/admin-settings.ts` — `light` mode, four appearance setting keys, public projection.
- `packages/contracts/src/index.ts` — export appearance schemas.
- `packages/contracts/scripts/openapi/paths-settings.ts` and paths/users file — user appearance endpoints.
- `packages/api-client/**` generated outputs — run generator, do not hand-edit generated files.
- `packages/db/prisma/schema.prisma` — add `UserAppearancePreference` relation and unique user FK.
- `packages/db/src/settings-defaults.ts` — add `theme.defaultSkin`, `theme.defaultFont`, `theme.allowUserOverride`; keep `theme.defaultMode` default `system`.
- `apps/api/src/modules/settings/settings.registry.ts` — add four appearance definitions; update `theme.defaultMode` schema; retain legacy `theme.accent` as read-only compatibility.
- `apps/api/src/modules/settings/settings.service.ts` — remove `light → system` normalization; add legacy accent mapping only when `theme.defaultSkin` has no stored row.
- `apps/api/src/modules/users/users.module.ts` — register controller/service.
- `apps/api/src/modules/users/users.controller.ts` — no appearance logic here; route lives in new controller.
- `apps/web/lib/settings.ts` — remove old fixed dark-only theme presentation; keep public settings readers and consume new defaults through appearance resolver.
- `apps/web/app/layout.tsx` — SSR attributes, `color-scheme`, theme-color, font imports.
- `apps/admin/app/layout.tsx` — fixed dark `data-mode/data-skin/data-font`; no platform/user lookup.
- `apps/web/components/settings/settings-nav.tsx` — add “外观” nav item.
- `apps/web/components/settings/*` and page files when the provider UI shell changes — only integrate the appearance tab/nav; do not redesign provider pages.
- `apps/admin/components/settings/settings-console.tsx`, `settings-page-client.tsx`, `apps/admin/lib/admin-settings.ts` — add appearance defaults tab after provider UI shell is present.
- `packages/ui/src/styles/tokens.css` — six skins × light/dark semantic roles, font pairing selectors, focus/selection/scrollbar/native control colors.
- `packages/ui/src/styles/tokens.ts` and `fonts.ts` — typed catalogs/stack exports.
- `packages/ui/src/primitives/button.tsx` — light/dark token states.
- `apps/web/app/globals.css` — atmosphere/covers/hairline grid tokenization.
- `apps/admin/app/globals.css` — fixed-dark Admin shell tokenization; no light mode.
- The 26 migration files listed in Theme spec §11.
- `apps/web/package.json`, `apps/admin/package.json`, `pnpm-lock.yaml` — add missing local Fontsource packages.

**Shared-file order**

1. Task 1 contracts (blocking provider plans that touch admin-settings).
2. Task 2 DB migration (after provider migration `0016`; never concurrently edit schema.prisma).
3. Task 3 settings keys/defaults/registry (after provider plan’s settings-registry task).
4. Provider UI shell task must land before Task 8 (`SettingsConsole` integration).
5. Task 4/5 token/font work may proceed independently after Task 1.

---

### Task 1: Appearance contracts and catalog

**Files:**

- Create: `packages/contracts/src/api/appearance.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/api/admin-settings.ts`
- Test: `packages/contracts/src/__tests__/appearance.test.ts`
- Test: `packages/contracts/src/__tests__/admin-settings.test.ts`

**Interfaces:**

- Produces:
  - `APPEARANCE_MODES = ["system","light","dark"] as const`
  - `SKIN_IDS` and `FONT_PAIRING_IDS` exactly as in the spec
  - `AppearancePreferenceSchema` with nullable `mode`, `skin`, `fontPairing`
  - `ResolvedAppearanceSchema` with resolved values, `source`, `canOverride`, `updatedAt`
  - `AppearanceCookieSchema` with optional fields plus optional `uid`, `updatedAt`
  - `SKIN_CATALOG` and `FONT_PAIRING_CATALOG` with labels, descriptions, preview values, CSS stacks, license ids

- [ ] **Step 1: Write failing catalog/contract tests**

```ts
import {
  APPEARANCE_MODES,
  FONT_PAIRING_IDS,
  SKIN_IDS,
  AppearanceCookieSchema,
} from "../api/appearance";

it("freezes exactly six skins and six font pairings", () => {
  expect(SKIN_IDS).toEqual([
    "editorial-noir",
    "catppuccin",
    "tokyo-night",
    "rose-pine",
    "kanagawa",
    "everforest",
  ]);
  expect(FONT_PAIRING_IDS).toEqual([
    "editorial-classic",
    "literary-warm",
    "modern-editorial",
    "expressive-serif",
    "cjk-editorial",
    "swiss-modern",
  ]);
  expect(APPEARANCE_MODES).toEqual(["system", "light", "dark"]);
});

it("rejects an unknown cookie value without rejecting valid siblings", () => {
  const parsed = AppearanceCookieSchema.safeParse({
    v: 1,
    mode: "light",
    skin: "not-a-skin",
    fontPairing: "editorial-classic",
  });
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data.mode).toBe("light");
    expect(parsed.data.skin).toBeUndefined();
    expect(parsed.data.fontPairing).toBe("editorial-classic");
  }
});
```

- [ ] **Step 2: Run contracts tests and confirm failure**

Run: `pnpm --filter @roamlog/contracts test -- src/__tests__/appearance.test.ts`
Expected: FAIL because `appearance.ts` and exports do not exist.

- [ ] **Step 3: Implement the contract catalog**

Use exact IDs from the spec. Each skin entry must include:

```ts
{
  id: "catppuccin",
  label: "猫咖",
  description: "Latte / Mocha port",
  lightPreview: { canvas: "...", ink: "...", accent: "..." },
  darkPreview: { canvas: "...", ink: "...", accent: "..." },
  sourceId: "catppuccin",
}
```

Each font entry must include display/body/mono stacks built from CSS variables and a stable license reference. Do not store arbitrary CSS URLs.

- [ ] **Step 4: Update admin-settings theme contracts**

Change `THEME_MODES` to the new three-way enum and define the four appearance keys; keep `theme.accent` readable for one release.

- [ ] **Step 5: Run contracts tests and generator**

Run:

```bash
pnpm --filter @roamlog/contracts test
pnpm --filter @roamlog/contracts typecheck
pnpm contracts:generate
pnpm contracts:check
```

Expected: all commands exit 0; generated API client includes appearance schemas and only expected diffs.

- [ ] **Step 6: Checkpoint**

Report files, test output, and the exact `codegraph explore` query used. Do not commit.

---

### Task 2: User appearance persistence migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (`User` relation + model)
- Create: `packages/db/prisma/migrations/0017_user_appearance_preference/migration.sql`
- Test: `packages/db/src/__tests__/user-appearance-migration.spec.ts` (or existing migration harness)

**Interfaces:**

- Model `UserAppearancePreference`:

```prisma
model UserAppearancePreference {
  userId      String   @id @db.Uuid
  mode        String?  @db.VarChar(16)
  skin        String?  @db.VarChar(40)
  fontPairing String?  @db.VarChar(40)
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("UserAppearancePreference")
}
```

- [ ] **Step 1: Write the failing migration/invariant test**

Assert that:

- a preference row cascades on user delete;
- one user cannot have two rows;
- nullable fields remain nullable and are not defaulted to a concrete skin/mode.

- [ ] **Step 2: Run migration test on an isolated schema**

Run the repository’s existing PostgreSQL test harness after setting
`ROAMLOG_TEST_DATABASE_URL`. Expected: FAIL before the migration exists.

- [ ] **Step 3: Add the model, relation, and hand-written SQL migration**

Use `ON DELETE CASCADE`, primary key `userId`, and no backfill rows. Existing users inherit defaults through `null`.

- [ ] **Step 4: Verify empty and existing-schema migration**

Run:

```bash
pnpm db:migrate
pnpm --filter @roamlog/db test
```

Expected: clean deployment on an empty DB and no destructive diff on the current schema.

- [ ] **Step 5: Checkpoint**

Report SQL diff, test output, and migration rollback instructions. Do not commit.

---

### Task 3: Appearance settings keys, defaults, and legacy mapping

**Files:**

- Modify: `packages/db/src/settings-defaults.ts`
- Modify: `apps/api/src/modules/settings/settings.registry.ts`
- Modify: `apps/api/src/modules/settings/settings.service.ts`
- Modify: `apps/web/lib/settings.ts`
- Test: `apps/api/src/modules/settings/__tests__/settings.registry.spec.ts`
- Test: `apps/web/lib/settings.test.ts`

**Interfaces:**

- New keys: `theme.defaultSkin`, `theme.defaultMode`, `theme.defaultFont`, `theme.allowUserOverride`.
- Legacy mapping: `white→editorial-noir`, `amber→catppuccin`, `blue→tokyo-night`, `emerald→everforest`, `rose→rose-pine`.
- `theme.defaultSkin` stored value beats legacy accent; missing value falls back through legacy accent then `editorial-noir`.

- [ ] **Step 1: Write failing tests**

```ts
it("maps legacy accents only when no stored skin exists", () => {
  expect(resolveDefaultSkin({ storedSkin: null, legacyAccent: "rose" })).toBe("rose-pine");
  expect(resolveDefaultSkin({ storedSkin: "kanagawa", legacyAccent: "rose" })).toBe("kanagawa");
});

it("accepts light after the palette ships", () => {
  expect(resolveThemeMode("light")).toBe("light");
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @roamlog/api test -- settings.registry.spec.ts` and
`pnpm --filter @roamlog/web test -- settings.test.ts`.

- [ ] **Step 3: Add defaults and registry entries**

Use public, non-secret entries:

```ts
theme.defaultSkin: "editorial-noir"
theme.defaultMode: "system"
theme.defaultFont: "editorial-classic"
theme.allowUserOverride: true
```

Keep `theme.accent` for read compatibility but do not expose it in the new appearance UI.

- [ ] **Step 4: Remove the `light → system` normalization**

Only invalid/unknown values normalize to `system`. A stored `light` is valid now.

- [ ] **Step 5: Run API/Web tests and typechecks**

```bash
pnpm --filter @roamlog/api test
pnpm --filter @roamlog/web test
pnpm --filter @roamlog/api typecheck
pnpm --filter @roamlog/web typecheck
```

Expected: pass, including old accent compatibility tests.

- [ ] **Step 6: Checkpoint**

Report exact save/read behavior for legacy accent and new default. Do not commit.

---

### Task 4: Skin token system and contrast gate

**Files:**

- Modify: `packages/ui/src/styles/tokens.css`
- Create: `packages/ui/src/styles/theme-catalog.ts`
- Create: `packages/ui/src/styles/tokens.test.ts`
- Modify: `packages/ui/src/styles/tokens.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**

- Selectors: `[data-mode="dark"][data-skin="<id>"]`, `[data-mode="light"][data-skin="<id>"]`, and system-mode media fallback.
- Required roles include all spec §7 roles and the `--roamlog-font-*` stack overrides.

- [ ] **Step 1: Write failing token/contrast tests**

Parse `tokens.css` and assert:

- six skins × two explicit modes have every role;
- system mode resolves light via `prefers-color-scheme: light`;
- all contrast pairs in `theme-catalog.ts` meet WCAG AA;
- no old dark-only `:root` values remain as the sole source.

- [ ] **Step 2: Run test and confirm failure**

Run: `pnpm --filter @roamlog/ui test -- src/styles/tokens.test.ts`.

- [ ] **Step 3: Port the six palettes**

Copy the exact upstream values and semantic role mapping from Theme spec §8. Do not invent replacement hues. Keep the existing approved `editorial-noir` dark values; add its Radix light roles.

Required token families:

```css
--canvas, --surface-1, --surface-2, --surface-deep, --surface-overlay,
--ink, --body, --muted, --ash, --stone,
--hairline, --hairline-strong, --divider,
--accent-solid, --accent-soft, --accent-glow, --focus-ring,
--success, --warning, --danger, --info,
--chart-1 ... --chart-6, --map-route, --map-marker, --selection
```

- [ ] **Step 4: Add system-mode fallback**

```css
[data-mode="system"][data-skin="catppuccin"] {
  /* dark defaults */
}
@media (prefers-color-scheme: light) {
  [data-mode="system"][data-skin="catppuccin"] {
    /* light overrides */
  }
}
```

Repeat for all six skins without duplicating component selectors.

- [ ] **Step 5: Run token tests and UI typecheck**

```bash
pnpm --filter @roamlog/ui test
pnpm --filter @roamlog/ui typecheck
```

Expected: all 12 explicit palette blocks complete; contrast gate passes.

- [ ] **Step 6: Checkpoint**

Report token counts and contrast failures, if any. Do not commit.

---

### Task 5: Local font packages, stacks, and license files

**Files:**

- Modify: `apps/web/package.json`, `apps/admin/package.json`, `pnpm-lock.yaml`
- Create: `packages/ui/src/styles/font-licenses/*.txt`
- Create: `THIRD_PARTY_NOTICES.md` (or repository-approved notice file)
- Modify: `packages/ui/src/styles/fonts.ts`
- Modify: `packages/ui/src/styles/tokens.css` (`[data-font]` selectors)
- Modify: `apps/web/app/layout.tsx`, `apps/admin/app/layout.tsx` imports
- Test: `packages/ui/src/styles/fonts.test.ts`

**Interfaces:**

- Six pairing IDs map to display/body/mono stacks; `editorial-classic` remains default.
- Font packages: Newsreader, Manrope, Inter, Fraunces, JetBrains Mono; existing Geist/Geist Mono/Instrument Serif/Noto packages stay.

- [ ] **Step 1: Write failing font catalog/license test**

Assert every pairing has display/body/mono, CJK fallback, license id, and a copied OFL text path. Assert no URL or `http` value exists in catalog stacks.

- [ ] **Step 2: Install missing local Fontsource packages**

```bash
pnpm add --filter @roamlog/web @fontsource-variable/newsreader@5.3.0 @fontsource-variable/manrope@5.3.0 @fontsource-variable/inter@5.3.0 @fontsource-variable/fraunces@5.3.0 @fontsource-variable/jetbrains-mono@5.3.0
pnpm add --filter @roamlog/admin @fontsource-variable/newsreader@5.3.0 @fontsource-variable/manrope@5.3.0 @fontsource-variable/inter@5.3.0 @fontsource-variable/fraunces@5.3.0 @fontsource-variable/jetbrains-mono@5.3.0
```

Expected: lockfile changes only; no remote font runtime.

- [ ] **Step 3: Add imports and `[data-font]` stack mappings**

Only the selected pairing's critical display/body CSS is imported by the app shell; default `editorial-classic` is the initial pairing. All other pairings are loaded through a lazy client chunk or route segment when the picker/editor opens, never as static imports in the root layout. Add a network assertion that an initial page load does not request non-selected pairing files.

- [ ] **Step 4: Copy license texts**

Copy the OFL files from the installed packages/upstream repositories. Record family, package version, license, upstream URL, and notice path.

- [ ] **Step 5: Run tests and build a font request audit**

```bash
pnpm --filter @roamlog/ui test
pnpm --filter @roamlog/web build
pnpm --filter @roamlog/admin build
```

Expected: no external font URL in build output; CSS chunks contain only local Fontsource URLs.

- [ ] **Step 6: Checkpoint**

Report package versions, license files, and bundle budget. Do not commit.

---

### Task 6: Appearance resolver, cookie, and SSR first paint

**Files:**

- Create: `apps/web/lib/appearance.ts`
- Create: `apps/web/lib/appearance.test.ts`
- Modify: `apps/web/lib/settings.ts`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/admin/app/layout.tsx`

**Interfaces:**

- `APPEARANCE_COOKIE = "roamlog_appearance"`
- `resolveAppearanceForRequest(input) -> ResolvedAppearance`
- `encodeAppearanceCookie(value) / parseAppearanceCookie(raw)`
- `resolveLegacyAccentSkin(accent)`
- Admin layout always emits `data-mode="dark" data-skin="editorial-noir" data-font="editorial-classic"`.

- [ ] **Step 1: Write failing resolver tests**

```ts
it("never lets a stale cookie beat the signed-in DB preference", () => {
  expect(
    resolveAppearanceForRequest({
      db: {
        mode: "light",
        skin: "everforest",
        fontPairing: "literary-warm",
        updatedAt: "2026-11-22T12:00:00.000Z",
      },
      cookie: { uid: "u1", updatedAt: "2026-11-21T12:00:00.000Z", mode: "dark" },
      platform: { mode: "system", skin: "editorial-noir", fontPairing: "editorial-classic" },
      canOverride: true,
    }),
  ).toMatchObject({ mode: "light", skin: "everforest", source: "database" });
});

it("falls field-by-field to platform defaults", () => {
  expect(
    resolveAppearanceForRequest({
      db: null,
      cookie: { mode: "dark", skin: "not-a-skin" },
      platform: { mode: "system", skin: "catppuccin", fontPairing: "swiss-modern" },
      canOverride: true,
    }),
  ).toMatchObject({ mode: "dark", skin: "catppuccin", fontPairing: "swiss-modern" });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run: `pnpm --filter @roamlog/web test -- lib/appearance.test.ts`.

- [ ] **Step 3: Implement cookie codec and resolver**

Validate every field independently. Reject unknown values; do not accept arbitrary CSS. Cookie is `Path=/; SameSite=Lax; Max-Age=31536000; Secure` on HTTPS and non-HttpOnly.

- [ ] **Step 4: Implement first-paint lookup**

In `apps/web/app/layout.tsx`, fetch platform settings and use the incoming Cookie header to call the same-origin `/v1/me/appearance` endpoint on the server. If unauthenticated/unavailable, fall back to the guest cookie and platform defaults. Emit:

```tsx
<html
  data-mode={resolved.mode}
  data-skin={resolved.skin}
  data-font={resolved.fontPairing}
  style={{ colorScheme: resolved.colorScheme }}
>
```

Set `themeColor` media values for system mode.

- [ ] **Step 5: Fix Admin layout**

Change `apps/admin/app/layout.tsx` to fixed dark attributes and keep Admin font imports independent of Web defaults.

- [ ] **Step 6: Run tests/typecheck**

```bash
pnpm --filter @roamlog/web test
pnpm --filter @roamlog/web typecheck
pnpm --filter @roamlog/admin typecheck
```

Expected: pass; snapshot tests assert Admin fixed dark and Web system resolves correctly.

- [ ] **Step 7: Checkpoint**

Report SSR attribute evidence and no-flash strategy. Do not commit.

---

### Task 7: User appearance API

**Files:**

- Create: `apps/api/src/modules/users/appearance.service.ts`
- Create: `apps/api/src/modules/users/appearance.controller.ts`
- Create: `apps/api/src/modules/users/__tests__/appearance.service.spec.ts`
- Create: `apps/api/test/user-appearance.e2e-spec.ts`
- Modify: `apps/api/src/modules/users/users.module.ts`
- Modify: `packages/contracts/scripts/openapi/paths-users.ts` or existing me paths file

**Interfaces:**

- `GET /v1/me/appearance` → `ResolvedAppearance`
- `PUT /v1/me/appearance` → upsert nullable mode/skin/fontPairing
- `DELETE /v1/me/appearance` → reset
- Guards: `SessionGuard`, `VerifiedEmailGuard`.
- Audit action: `user.appearance.updated`, target `user`.

- [ ] **Step 1: Write failing service tests**

Cover:

- null field inherits, explicit field overrides;
- invalid ID → 422;
- override disabled → 403 `APPEARANCE_OVERRIDE_DISABLED`;
- reset removes row and returns platform defaults;
- audit metadata includes changed field names only.

- [ ] **Step 2: Write failing HTTP/e2e tests**

Use the real auth session fixture. Assert persistence after PUT/reload and a 401 for unauthenticated calls. Assert no other user’s preference can be read or changed.

- [ ] **Step 3: Implement service/controller**

Read platform defaults through `SettingsService`; use a single transaction for upsert + audit. Never expose any other user’s row.

- [ ] **Step 4: Set cookie on successful PUT/DELETE**

Use the same cookie serialization contract; include current `uid` and exact DB `updatedAt`. Do not return arbitrary values.

- [ ] **Step 5: Run tests and generator**

```bash
pnpm --filter @roamlog/api test
pnpm --filter @roamlog/api test:e2e -- user-appearance.e2e-spec.ts
pnpm contracts:generate
pnpm contracts:check
```

Expected: all pass; generated client has appearance endpoints.

- [ ] **Step 6: Checkpoint**

Report API status codes, DB row, audit row, and generated contract diff. Do not commit.

---

### Task 8: Admin appearance defaults and fixed-dark verification

**Files:**

- Create: `apps/admin/components/settings/appearance-defaults.tsx`
- Create: `apps/admin/components/settings/appearance-defaults.test.tsx`
- Modify: `apps/admin/components/settings/settings-console.tsx`
- Modify: `apps/admin/components/settings/settings-page-client.tsx`
- Modify: `apps/admin/lib/admin-settings.ts`
- Modify: `apps/admin/components/settings/settings-console.test.tsx` / IA tests

**Interfaces:**

- Appearance tab reads the four settings keys, saves only changed keys, requires super_admin + TOTP.
- Preview uses the shared Web preview component; Admin shell itself remains dark.

**Dependency:** provider UI shell task must already exist. If the shell changes names, update only the appearance tab integration, not provider pages.

- [ ] **Step 1: Write failing component tests**

Assert:

- tab label “外观与字体”;
- four controls load from settings;
- save with 422 keeps drafts;
- analyst/read-only cannot save;
- Admin `<html>` remains fixed dark after platform defaults change.

- [ ] **Step 2: Implement the appearance defaults form**

Display light/dark/system, six skins, six font pairings, allow-override switch, preview. Hide legacy `theme.accent`.

- [ ] **Step 3: Implement the live Web preview**

Use `AppearancePreview` from the shared Web component with sample journal, card, share, and error/empty states. Do not use the Admin shell as the preview canvas.

- [ ] **Step 4: Run Admin tests/build**

```bash
pnpm --filter @roamlog/admin test
pnpm --filter @roamlog/admin typecheck
pnpm --filter @roamlog/admin build
```

Expected: pass; Admin fixed-dark assertion green.

- [ ] **Step 5: Checkpoint**

Report saved keys, reload proof, role denial, and preview screenshots. Do not commit.

---

### Task 9: Web API client, query keys, and appearance page

**Files:**

- Create: `apps/web/lib/api/appearance.ts`
- Modify: `apps/web/lib/query.ts`
- Create: `apps/web/app/(app)/w/[workspaceSlug]/settings/appearance/page.tsx`
- Modify: `apps/web/components/settings/settings-nav.tsx`
- Create: `apps/web/components/appearance/appearance-picker.tsx`
- Create: `apps/web/components/appearance/appearance-preview.tsx`
- Test: `apps/web/components/appearance/appearance-picker.test.tsx`

**Interfaces:**

- `appearanceQueryKey = ["v1","me","appearance"]`
- `fetchAppearance()`, `saveAppearance(patch)`, `resetAppearance()`
- Page route `/w/<slug>/settings/appearance`.

- [ ] **Step 1: Write failing client/component tests**

Cover:

- no flash when SSR attributes already match;
- invalid cookie ignored;
- mode change updates attributes and cookie before API;
- API failure retains visual choice and shows retry;
- reset returns platform defaults;
- keyboard radio/group traversal and live-region announcements.

- [ ] **Step 2: Implement client adapter and query hooks**

Keep API errors typed; invalidate appearance query after save/reset. Do not write preferences into localStorage as the source of truth.

- [ ] **Step 3: Implement the user picker page**

Use segmented mode control, skin cards, font pairing cards, live preview, save, reset. Show read-only note when `canOverride` is false.

- [ ] **Step 4: Add nav item and metadata**

Add “外观” with a palette icon; keep the nav's active state and mobile horizontal behavior.

- [ ] **Step 5: Run tests/typecheck**

```bash
pnpm --filter @roamlog/web test
pnpm --filter @roamlog/web typecheck
```

Expected: pass; route renders 200.

- [ ] **Step 6: Checkpoint**

Report interaction state machine and screenshots at 1440/390. Do not commit.

---

### Task 10: Shared appearance preview and theme pickers

**Files:**

- Complete `apps/web/components/appearance/appearance-preview.tsx`
- Complete `apps/web/components/appearance/appearance-picker.tsx`
- Test: `apps/web/components/appearance/appearance-picker.test.tsx`

**Interfaces:**

- Preview props: `{ mode, skin, fontPairing, surface: "web" | "share" | "journal" }`.
- Picker emits change drafts; page owns persistence.

- [ ] **Step 1: Add failing snapshot/interaction tests**

Assert all six skins and six fonts appear with text labels, not only swatches; selected state is `aria-pressed`; previews use safe token classes.

- [ ] **Step 2: Implement preview**

Use `data-mode`, `data-skin`, `data-font` scoped to a preview container. Include journal card, body text, metadata, error/empty states, and share shell. Avoid loading all font files in the preview at once.

- [ ] **Step 3: Implement mobile layout**

390 px: cards stack, sticky save bar inside the page safe area, touch targets ≥44 px, no horizontal scroll.

- [ ] **Step 4: Verify computed attributes/fonts**

Use Playwright or component DOM assertions for `data-mode`, `data-skin`, `data-font`, and computed `font-family`.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @roamlog/web test -- components/appearance
pnpm --filter @roamlog/web typecheck
```

- [ ] **Step 6: Checkpoint**

Report preview screenshots and a11y checks. Do not commit.

---

### Task 11: Skin/font primitives and shared global styles

**Files:**

- Modify: `packages/ui/src/styles/tokens.css`
- Modify: `packages/ui/src/styles/tokens.ts`
- Modify: `packages/ui/src/primitives/button.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/admin/app/globals.css`
- Test: `packages/ui/src/primitives/button.test.tsx` (or existing)

- [ ] **Step 1: Write failing token-regression tests**

Assert button variants and focus rings use semantic tokens; no raw light-mode-breaking hex in the changed source.

- [ ] **Step 2: Replace raw colors with semantic roles**

Convert covers, atmospheres, hairline grid, focus, selection, scrollbar, native control colors, and disabled states. Keep decorative glows alpha-only.

- [ ] **Step 3: Verify Admin fixed dark**

Admin CSS must select fixed dark roles even if a parent Web preview sets light attributes. Use a shell-scoped attribute/class so previews cannot leak.

- [ ] **Step 4: Run tests/build**

```bash
pnpm --filter @roamlog/ui test
pnpm --filter @roamlog/web test
pnpm --filter @roamlog/admin test
pnpm --filter @roamlog/web build
pnpm --filter @roamlog/admin build
```

- [ ] **Step 5: Checkpoint**

Report raw-color scan and fixed-dark proof. Do not commit.

---

### Task 12: Journal, editor, and share surfaces

**Files (from Theme spec §11):**

- `apps/web/app/(app)/w/[workspaceSlug]/journal/journal-live.tsx`
- `apps/web/components/journal/journal-layout.css`
- `apps/web/components/share/share-article.tsx`
- `apps/web/lib/editor/ai-highlight.ts`
- `apps/web/components/settings/workspace-settings-page.tsx`
- `apps/web/lib/demo-format.ts`

- [ ] **Step 1: Write failing visual-token tests**

Assert journal body text, quotes, tables, code, selection and AI highlight use semantic variables; assert editor highlight re-resolves when `data-skin`/`data-mode` changes.

- [ ] **Step 2: Tokenize journal editor CSS**

Replace dark-only raw colors. Preserve CJK line-height ≥1.65 for long-form content and `text-wrap: pretty` where supported.

- [ ] **Step 3: Tokenize share page and workspace settings**

Ensure public share pages render the platform/cookie appearance without auth. Keep body opaque; no glass behind long-form text.

- [ ] **Step 4: Verify both modes in real pages**

Run local Web + API. Capture 1440/390 screenshots for journal editor and share page in light/dark.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @roamlog/web test -- journal share settings
pnpm --filter @roamlog/web typecheck
```

- [ ] **Step 6: Checkpoint**

Report screenshots and contrast checks. Do not commit.

---

### Task 13: Map and chart surfaces

**Files (from Theme spec §11):**

- `apps/web/components/map/cluster-points-source.tsx`
- `apps/web/components/map/globe-view.tsx`
- `apps/web/components/map/map-canvas.tsx`
- `apps/web/components/map/map-fallback.tsx`
- `apps/web/components/map/world-map.tsx`
- `apps/web/components/charts/chart-container.tsx`
- `apps/web/components/ai/shimmer.tsx`

- [ ] **Step 1: Write failing theme-token tests**

Assert map route/marker/cluster/chart series resolve from variables; no hard-coded brand hex in changed files.

- [ ] **Step 2: Tokenize map chrome and chart series**

Map style JSON may remain third-party, but Roamlog overlays and UI chrome use semantic roles. Tooltip/legend/grid must be readable in both modes.

- [ ] **Step 3: Verify reduced motion**

Shimmer and map overlay animations disable under reduced-motion.

- [ ] **Step 4: Capture map/chart screenshots**

1440/390, light/dark, at least one route + one chart with real data.

- [ ] **Step 5: Run tests/build**

```bash
pnpm --filter @roamlog/web test -- map chart
pnpm --filter @roamlog/web build
```

- [ ] **Step 6: Checkpoint**

Report screenshots and raw-color scan. Do not commit.

---

### Task 14: Media, auth, Admin, and remaining token migrations

**Files (from Theme spec §11):**

- `apps/admin/components/login/two-factor-enrollment.tsx`
- `apps/admin/components/media/media-view.tsx`
- `apps/web/components/media/photo-lightbox.css`
- `apps/web/components/media/photo-uploader.css`
- `apps/web/components/auth/totp-qr.tsx`
- `apps/web/components/app-shell/notification-bell.tsx`

- [ ] **Step 1: Write failing token/exception tests**

Assert the two QR black/white module exceptions are documented and no other raw color remains; media fallback uses theme tokens.

- [ ] **Step 2: Migrate media surfaces**

Photo lightbox overlays, captions, controls, uploader dropzone/progress/error/disabled states use semantic tokens. Keep image content colors untouched.

- [ ] **Step 3: Migrate auth/Admin surfaces**

QR card/copy/errors tokenized; Admin media fallback tokenized but Admin stays fixed dark.

- [ ] **Step 4: Verify exceptions**

Document the QR exceptions in code comments and the plan report. Do not let them bypass the raw-color test globally.

- [ ] **Step 5: Run tests/build**

```bash
pnpm --filter @roamlog/web test
pnpm --filter @roamlog/admin test
pnpm --filter @roamlog/web typecheck
pnpm --filter @roamlog/admin typecheck
```

- [ ] **Step 6: Checkpoint**

Report remaining raw colors and exceptions. Do not commit.

---

### Task 15: Theme/font E2E and system verification

**Files:**

- Create: `e2e/web/appearance.spec.ts`
- Create: `e2e/admin/settings-appearance.spec.ts`
- Create: `.audit/theme-font/*` evidence
- Modify: `playwright.config.ts` only if a new project/route is required
- Do not edit `.github/workflows/ci.yml`: the Provider UI plan Task 16 owns the
  single CI integration step and will add this appearance spec after it exists.

- [ ] **Step 1: Write failing Playwright tests**

Cover:

- default system and OS-light/dark emulation;
- all six skins and six fonts selectable; reload persists;
- DB preference beats a stale cookie; guest cookie works;
- reset restores platform defaults;
- Admin console fixed dark after Web default/user changes;
- no external font/CDN requests;
- font budgets: selected-pairing critical Latin ≤400 KiB compressed, Chinese page total ≤4 MiB;
- 1440/390 screenshots for Web/share/editor/map/gallery/dialog and Admin fixed dark.

- [ ] **Step 2: Run E2E against real API + Postgres + Redis + Web/Admin**

Use the real stack; stub only external map/tiles if needed, and name the stub in the report.

```bash
AUTH_RATE_LIMIT_MAX=100 E2E_START_API=1 pnpm exec playwright test e2e/web/appearance.spec.ts e2e/admin/settings-appearance.spec.ts
```

`AUTH_RATE_LIMIT_MAX=100` is a CI/local real-stack test budget for shared
runner IPs; it does not change the production limit. Expected: all pass;
screenshots saved under `.audit/theme-font/`. If the CI workflow runs this
spec, it must use the always-upload evidence step from Provider UI Task 16.

- [ ] **Step 3: Run accessibility and contrast checks**

```bash
pnpm e2e:a11y:axe
pnpm --filter @roamlog/ui test -- src/styles/tokens.test.ts
```

Expected: no serious/critical axe findings; contrast pairs pass.

- [ ] **Step 4: Review screenshots**

Root manually checks all 6 skins × light/dark on at least Web journal and share page; no raw broken contrast, no horizontal scroll at 390.

- [ ] **Step 5: Checkpoint**

Report exact test counts, screenshot paths, and any deferred minor. Do not deploy.

---

### Task 16: Final contracts/build/regression gate

**Files:**

- No planned product edits; fix only findings from this gate.

- [ ] **Step 1: Run the full gate**

```bash
pnpm contracts:check
pnpm typecheck
pnpm test
pnpm --filter @roamlog/web build
pnpm --filter @roamlog/admin build
pnpm staging:validate
pnpm lint
git diff --check
```

Expected: every command exits 0. If a failure is unrelated, report it separately and do not claim the gate passed.

- [ ] **Step 2: Prove no external font/CSS requests**

Inspect the Playwright network log and grep build output for `fonts.googleapis`, `fonts.gstatic`, and remote CSS URLs. Expected: zero matches.

- [ ] **Step 3: Prove Admin fixed dark**

Open `/admin/settings` and `/admin/services/*` after changing Web defaults; `data-mode` stays `dark`, computed canvas/ink unchanged.

- [ ] **Step 4: Final root review**

Check:

- six skins and six fonts present;
- DB canonical precedence;
- legacy accent mapping;
- public share appearance without auth;
- 26/26 files migrated or documented exceptions;
- licenses complete;
- screenshots from current code.

- [ ] **Step 5: Completion report**

Write a short report to `.audit/theme-font/final-report.md` with commands, counts, screenshot links, residual risks, and a `移植来源:` section listing each palette/font source. Do not deploy.

---

## Self-Review

- Spec coverage: catalog, DB, platform defaults, user preference, SSR/cookie, no-flash, six skins, six fonts, 26 files, Admin fixed dark, accessibility, budgets and E2E all have tasks.
- No new visual palette is invented; every skin maps to the pinned upstream source in the Theme spec.
- Shared files are explicitly ordered: contracts → migration/settings → provider UI shell → appearance tab.
- Raw colors are constrained to palette definitions and documented QR exceptions.
- No task requires a remote font or user-supplied CSS URL.
- No deployment or git commit is implied by a task checkpoint.
