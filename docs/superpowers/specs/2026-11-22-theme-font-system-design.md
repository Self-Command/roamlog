# Roamlog theme, font, and appearance system

Date: 2026-11-22
Status: APPROVED — design frozen for planning; implementation follows the
accepted plan.
Related requirements:
`docs/superpowers/specs/2026-11-22-admin-settings-rebuild-requirements.md`
Research:
`.audit/theme-research/trends-fonts.md`

## 1. Goal

Give Roamlog a first-class appearance system:

- multiple curated skins with honest light and dark palettes;
- multiple locally bundled font pairings covering Latin and Simplified Chinese;
- light, dark, and system modes, with system as the product default;
- a user-facing picker on Web with persisted overrides;
- Admin defaults for skin, mode, and font pairing, plus a platform switch that
  allows or disallows user overrides;
- a fixed, high-contrast operational dark shell for Admin itself; per-admin
  appearance overrides are not part of v1;
- no flash of the wrong appearance and no external font/CDN dependency.

## 1.1 Frozen decisions

- Catalog size: six skins and six font pairings ship in the catalog. Each skin
  has a complete light and dark palette. No skin may exist in only one mode.
- Default skin: `editorial-noir`; default mode: `system`; default font:
  `editorial-classic`; user overrides: enabled by default.
- Admin console: fixed dark operational shell. Admin exposes appearance
  defaults and renders Web-like previews, but an Admin operator cannot apply a
  user skin/font to the console.
- Web, public share pages, and the journal editor consume the platform defaults
  and the signed-in user's overrides.
- Every skin must have a traceable upstream palette and license. Palette values
  are ported, not invented; Roamlog-specific semantic naming and component
  mapping are the adaptation layer.
- Legacy `theme.accent` is read-only compatibility. It maps deterministically
  to a skin only when no stored `theme.defaultSkin` row exists.

## 2. Non-goals

- A free-form theme builder or arbitrary CSS injection.
- Per-workspace themes in this release. Admin defaults and per-user overrides
  are the complete model.
- Per-admin console themes or fonts. The Admin console stays fixed dark; Admin
  can only preview and set the Web defaults.
- Theming transactional email templates.
- Shipping custom brand fonts that do not have a redistribution-compatible
  license.
- Redesigning maps or the journal editor beyond making their chrome/colors
  token-driven and correct in both modes.

## 3. Current-state audit

| Area              | Current state                                                                                                                             | Gap                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Contract          | `THEME_MODES = ["dark", "system"]` in `packages/contracts/src/api/admin-settings.ts:59`.                                                  | No real `light`; system is a lie while only dark tokens exist.                           |
| Web resolver      | `apps/web/lib/settings.ts:247` declares `ThemeMode = "dark" \| "system"` and `resolveThemePresentation()` emits dark data.                | No user override, no cookie, no font selection, no skin.                                 |
| Token layer       | `packages/ui/src/styles/tokens.css:1` sets `color-scheme: dark` and only dark `--canvas`/`--surface`/`--ink` values.                      | No light semantic token set; a global accent swap cannot create a skin.                  |
| Typography        | `packages/ui/src/styles/fonts.ts:1` exposes fixed serif/sans/mono variables; both apps import five Fontsource packages at the root.       | Fonts are local, but there is no catalog, picker, Admin default, or user persistence.    |
| Admin app         | `apps/admin/app/layout.tsx:24` emits `<html lang="zh-CN">` with no theme attributes or font settings.                                     | Admin has no appearance source of truth.                                                 |
| Theme settings    | `theme.accent` and `theme.defaultMode` exist in `packages/db/src/settings-defaults.ts:33`; theme registry has no skin/font/override keys. | Too little configuration for the requested product; one accent is not a skin.            |
| Hard-coded colors | 26 app/UI files contain raw hex/rgb values, including maps, charts, trip covers, journal editor CSS, uploaders, and share pages.          | Light mode will break unless every visible color is tokenized.                           |
| Tests             | Existing tests assert that `light` is rejected and that system renders dark.                                                              | Tests encode the missing feature; they must be replaced with real light/system coverage. |

## 4. Approaches

### A. CSS variables + typed catalogs + data attributes — recommended

- Store stable skin/font IDs in shared contracts.
- Define semantic CSS variables per `[data-skin][data-mode]`.
- Emit `data-mode`, `data-skin`, `data-font` on `<html>` during SSR.
- Provide a small client controller to update attributes and persist the choice.

Pros: no FOUC, works with Next.js SSR, no runtime CSS-in-JS, easy visual
regression, easy to add skins, no external assets.

### B. Separate compiled stylesheet per skin

Load a stylesheet dynamically when a skin changes.

Pros: smaller initial CSS. Cons: extra request/flash risk, harder SSR and
preview rendering, duplicated token maintenance. Not recommended for six small
token sets.

### C. CSS-in-JS theme provider

Pros: colocated values. Cons: adds a runtime/style boundary and hydration risk
to an existing RSC-heavy application, and complicates Tailwind token
generation. Rejected.

**Decision:** A. Keep all skin token blocks in the shared UI token stylesheet;
use typed catalogs only for IDs, labels, previews, and resolution.

## 5. Domain model

### 5.1 Shared contracts

Add a shared appearance module in `packages/contracts`:

```ts
const APPEARANCE_MODES = ["system", "light", "dark"] as const;

const SKIN_IDS = [
  "editorial-noir",
  "catppuccin",
  "tokyo-night",
  "rose-pine",
  "kanagawa",
  "everforest",
] as const;

const FONT_PAIRING_IDS = [
  "editorial-classic",
  "literary-warm",
  "modern-editorial",
  "expressive-serif",
  "cjk-editorial",
  "swiss-modern",
] as const;

interface AppearancePreference {
  mode: (typeof APPEARANCE_MODES)[number];
  skin: (typeof SKIN_IDS)[number];
  fontPairing: (typeof FONT_PAIRING_IDS)[number];
}
```

The same module exports labels, descriptions, preview tokens, font-family
stacks, license metadata, and Zod schemas. The API and Admin UI must not
hard-code separate lists.

The six stable IDs above are the only valid `theme.defaultSkin` and user
`skin` values in v1. Product labels may be localized, but persisted values and
API payloads always use these IDs.

### 5.2 Platform defaults

Replace the current two-key theme group with:

| Key                       | Type                             | Default             | Public | Meaning                               |
| ------------------------- | -------------------------------- | ------------------- | ------ | ------------------------------------- |
| `theme.defaultSkin`       | enum                             | `editorial-noir`    | yes    | Platform skin.                        |
| `theme.defaultMode`       | enum (`system`, `light`, `dark`) | `system`            | yes    | Platform mode.                        |
| `theme.defaultFont`       | enum                             | `editorial-classic` | yes    | Platform font pairing.                |
| `theme.allowUserOverride` | boolean                          | `true`              | yes    | Whether signed-in users may override. |

Legacy `theme.accent` remains readable for one release as a compatibility
alias. On read, it maps to the closest skin only when no stored
`theme.defaultSkin` row exists (the code default does not count as a stored
choice). New writes come from the skin picker, not a standalone accent field.
Legacy `theme.defaultMode="light"` becomes valid again after the light palette
lands; no data rewrite is required.

The compatibility mapping is frozen:

| Legacy `theme.accent` | Resolved skin    |
| --------------------- | ---------------- |
| `white`               | `editorial-noir` |
| `amber`               | `catppuccin`     |
| `blue`                | `tokyo-night`    |
| `emerald`             | `everforest`     |
| `rose`                | `rose-pine`      |

`kanagawa` has no legacy accent mapping; it is selectable only after the new
skin field exists. A missing or unknown legacy accent resolves to
`editorial-noir`. The mapping is applied only when `theme.defaultSkin` has no
stored value; it never overrides an explicit skin.

### 5.3 User preference

Add a one-to-one `UserAppearancePreference` table:

```text
userId       uuid primary key, FK User.id, cascade delete
mode         varchar(16) nullable
skin         varchar(40) nullable
fontPairing  varchar(40) nullable
createdAt    timestamptz not null default now()
updatedAt    timestamptz not null default now()
```

`null` means "inherit the platform default"; it is not the same as an explicit
choice. A row may exist with only one field overridden.

### 5.4 API

```text
GET    /v1/me/appearance
PUT    /v1/me/appearance       body: { mode?, skin?, fontPairing? }
DELETE /v1/me/appearance       reset all overrides
```

`GET` returns the resolved preference plus the platform defaults and
`canOverride`, never a secret. `PUT` validates IDs against the catalog,
performs an upsert, writes an audit row (`user.appearance.updated`), and
returns the new resolved preference. `DELETE` removes the row and restores
defaults.

If `theme.allowUserOverride` is false, `GET` reports `canOverride: false` and
the platform defaults, `PUT` returns `403 APPEARANCE_OVERRIDE_DISABLED`, and
`DELETE` remains allowed so a user can clear an old override.

Public settings include the four platform values above so anonymous pages can
render the correct skin/mode/font before authentication.

### 5.5 Cookie and first paint

Cookie name: `roamlog_appearance`.

- Value: URL-safe JSON
  `{v:1, mode?, skin?, fontPairing?, uid?, updatedAt?}`. Every appearance field
  is optional so field-by-field inheritance is representable. `uid` and
  `updatedAt` are present only for a signed-in user's validated cache; they are
  absent for a guest.
- Attributes: `Path=/`, `SameSite=Lax`, `Max-Age=31536000`, `Secure` on HTTPS,
  `HttpOnly=false` (it contains no secret and is also written by the client).
- After a successful user save, the API response also sets the cookie.
- A signed-in user on a device with no cookie gets the DB preference through
  the session/bootstrap response, which sets the cookie before the app shell
  paints.
- Guest choice is cookie-only.
- The database row is authoritative for a signed-in user. A cookie is an
  optimistic first-paint cache and must carry the same `uid` and `updatedAt` as
  the DB row. If the cookie is missing, belongs to a different user, or has an
  older `updatedAt`, the server uses the DB value and rewrites the cookie. If
  the DB preference read fails, the validated cookie for the same `uid` may be
  used as a degraded fallback.
- A user changing appearance on another device gets the DB value on the next
  server render; a stale device cookie must not pin that device forever.
- When `theme.allowUserOverride` is false, both DB and cookie user choices are
  ignored for rendering; the row/cookie may be retained so a later re-enable
  restores the previous choice.

Resolution order for the first paint:

1. validated cookie matching the current authenticated `uid` and DB
   `updatedAt`;
2. authenticated DB preference (canonical; also used when the cookie is
   absent/stale);
3. validated guest cookie when there is no authenticated user;
4. platform defaults from `/v1/public/settings`;
5. code defaults.

`null` on a user preference field means "inherit the platform default"; an
explicit value is an override. Clearing one field must not clear the others.

## 6. Rendering and no-flash rules

- The server writes `data-mode`, `data-skin`, and `data-font` on `<html>`.
- `data-mode="system"` uses `prefers-color-scheme`; explicit `light`/`dark`
  modes ignore the media query.
- `color-scheme` must be `light`, `dark`, or `light dark` to match the resolved
  mode so native controls, date inputs, scrollbars, and form autofill follow.
- `themeColor` metadata uses media-specific values for system mode; explicit
  modes use one value.
- The client updates the attributes synchronously before persisting a change,
  then writes the cookie, then calls the API. Failed server persistence must
  not revert the visual choice; show a retry message.
- No blocking inline theme script is allowed to fetch remote assets. A small
  same-origin script may repair stale cookies after hydration if necessary.
- Hydration must not produce a mode/skin/font warning; both server and client
  use the same resolver and catalog.

## 7. Token architecture

Three layers:

1. **Palette primitives**: neutral, brand, success, warning, danger, info
   scales (12 steps where useful).
2. **Semantic roles**: `canvas`, `surface-1`, `surface-2`, `surface-deep`,
   `surface-overlay`, `ink`, `body`, `muted`, `stone`, `hairline`,
   `hairline-strong`, `divider`, `accent-solid`, `accent-soft`, `accent-glow`,
   `focus-ring`, `success`, `warning`, `danger`, `info`, `chart-1…6`,
   `map-route`, `map-marker`, `selection`.
3. **Component aliases**: only when a component needs a stable public name
   (for example `--editor-quote-border`).

Rules:

- Components consume semantic tokens or `@theme inline` Tailwind colors; they
  never use raw hex values.
- Every skin must define every semantic token for both modes. A build/test
  fails if a token is missing.
- Contrast pairs are part of the catalog: canvas/ink, surface/body,
  accent-solid/accent-contrast, focus/canvas, danger/canvas,
  success/canvas, warning/canvas.
- Decorative glare/glow is allowed at low alpha; never use a glow token as a
  text color.
- Borders and focus rings must remain visible in light mode; current
  `rgba(255,255,255,…)` hairlines must be replaced by semantic aliases.

## 8. Skins

All skins ship both modes. Each row below is a **port**, not a new palette:
Roamlog maps the upstream named colors into its semantic token roles. Product
labels may be localized, but the upstream names and license notices remain in
the source matrix. The implementation plan must contrast-check the final token
pairs and may adjust only mapped roles, not invent replacement palettes.

| Skin             | Light source variant                 | Dark source variant                                               | Upstream source (commit + file/lines)                                                                                                                                                          | Product label |
| ---------------- | ------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `editorial-noir` | Radix Colors `sand` + `orange` light | Current approved Roamlog dark tokens + Radix dark `sand`/`orange` | `radix-ui/colors@dbdb85470547c7d34b9001f48fddb08ded335979`: `src/light.ts:301-314,1801-1814`, `src/dark.ts:301-314,1801-1814`; current baseline `packages/ui/src/styles/tokens.css:3-53`. MIT. | 编辑黑        |
| `catppuccin`     | Catppuccin Latte                     | Catppuccin Mocha                                                  | `catppuccin/palette@07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd`: `palette.json:3,261-270,303-312,492-505` (Latte), `2727,2985-2994,3027-3036,3216-3229` (Mocha). MIT.                            | 猫咖          |
| `tokyo-night`    | Tokyo Night Day                      | Tokyo Night Storm                                                 | `folke/tokyonight.nvim@cdc07ac78467a233fd62c493de29a17e0cf2b2b6`: `lua/tokyonight/colors/day.lua:1-16`, `storm.lua:1-38`, inversion `lua/tokyonight/util.lua:54-71`. Apache-2.0.               | 东京夜        |
| `rose-pine`      | Rosé Pine Dawn                       | Rosé Pine Moon                                                    | `rose-pine/neovim@ff483051a47e27d84bdef47703538df1ed9f4a47`: `lua/rose-pine/palette.lua:23-42` (moon), `43-62` (dawn). MIT.                                                                    | 玫瑰松        |
| `kanagawa`       | Kanagawa Lotus                       | Kanagawa Wave                                                     | `rebelot/kanagawa.nvim@bb85e4bfc8d89b0e62c8fa53ccdd13d12e2f77b3`: `lua/kanagawa/colors.lua:5-11,33-58,88-127`; `lua/kanagawa/themes.lua:90-160` (wave), `301-397` (lotus). MIT.                | 神奈川        |
| `everforest`     | Everforest Light, medium             | Everforest Dark, medium                                           | `sainnhe/everforest@85a86eb62409e3ec88713bff3d1b9d7374e112e4`: `palette.md:21-42` (dark), `46-69` (light). MIT.                                                                                | 常青林        |

Source mapping rules:

- `editorial-noir` is the only skin allowed to combine the existing approved
  Roamlog baseline with a licensed palette. Its role mapping is the adaptation
  layer: current dark canvas/ink/accent semantics are retained, while the light
  variant maps Radix `sand`/`orange` steps into the same semantic roles.
- Catppuccin uses Latte for light and Mocha for dark. `base`, `surface0/1`,
  `overlay`, `text`, `subtext`, `blue`, `peach`, `green`, `red`, and `mauve`
  map to semantic roles; no additional colors are invented.
- Tokyo Night uses Day and Storm. Day is produced by the upstream inversion
  algorithm in `day.lua`/`util.lua`; the implementation must reuse that
  algorithm rather than hand-picking substituted colors.
- Rosé Pine uses Dawn and Moon. `base`, `surface`, `overlay`, `muted`, `subtle`,
  `text`, `love`, `gold`, `rose`, `pine`, `foam`, and `iris` map to roles.
- Kanagawa uses Lotus and Wave. `sumiInk*`, `fujiWhite`, `oldWhite`,
  `waveBlue*`, `autumn*`, `spring*`, `sakuraPink`, `surimiOrange`, and `lotus*`
  map to roles from the cited theme mappings.
- Everforest uses the medium-contrast light/dark palettes from `palette.md`;
  `bg0…bg4`, `fg`, and the accent/grey families map to roles.

Required page coverage: login, dashboard, trip list, trip workspace, map
chrome, journal editor, photo gallery/lightbox, settings, errors/empty states,
dialogs, public share page, and the fixed-dark Admin console. Admin previews
must render Web surfaces, not restyle the console itself.

## 9. Font catalog

Fonts are bundled through Fontsource packages (or vendored woff2 files under
`packages/ui` if a package disappears). No Google Fonts, CDN, or runtime
download is allowed.

| Pairing             | Display + CJK fallback          | Body + CJK fallback   | Mono           | Notes                      |
| ------------------- | ------------------------------- | --------------------- | -------------- | -------------------------- |
| `editorial-classic` | Instrument Serif, Noto Serif SC | Geist, Noto Sans SC   | Geist Mono     | Current default            |
| `literary-warm`     | Newsreader, Noto Serif SC       | Manrope, Noto Sans SC | JetBrains Mono | Long-form/travel           |
| `modern-editorial`  | Instrument Serif, Noto Serif SC | Inter, Noto Sans SC   | Geist Mono     | Dense product UI           |
| `expressive-serif`  | Fraunces, Noto Serif SC         | Inter, Noto Sans SC   | JetBrains Mono | Highest editorial contrast |
| `cjk-editorial`     | Noto Serif SC                   | Noto Sans SC          | Geist Mono     | Chinese-first              |
| `swiss-modern`      | Geist, Noto Serif SC            | Geist, Noto Sans SC   | JetBrains Mono | Maximum clarity            |

Implementation rules:

- Use variable packages where available: Geist, Geist Mono, Noto Sans SC,
  Noto Serif SC, Fraunces, Inter, JetBrains Mono, Newsreader, Manrope.
- Keep `font-display: swap` and unicode-range subsetting from Fontsource.
- Preload only the Latin display/body files needed for the selected pairing;
  CJK files must be requested by unicode-range only when the page contains
  those glyphs.
- Never preload all six pairings. CSS may define their faces, but a browser must
  download only the selected pairing's used faces; the font-picker previews load
  their faces lazily when the card enters the viewport.
- Initial same-origin font transfer budget for the selected Latin
  display/body/mono set: **≤ 400 KiB compressed**. A text-heavy Chinese page may
  load additional CJK unicode-range chunks on demand, with a **≤ 4 MiB
  compressed** page budget. No single font request may exceed 1.5 MiB.
- The default pairing must not block first paint: preload at most the selected
  display and body Latin faces; font failure falls back to the documented
  system stack without invisible text.
- Preserve a minimum CJK body size of 15 px and a line-height of at least 1.65
  for long-form content; use `text-wrap: pretty` where supported.
- Add a `THIRD_PARTY_NOTICES.md` and copied OFL texts under
  `packages/ui/src/styles/font-licenses/` before shipping.
- The font picker must show both Chinese and English specimens and a mono
  metadata sample, not just the family name.
- Do not add LXGW WenKai in the first release: its 53.3 MB package is too large
  for the global font path. It can return later as an opt-in subsetted asset.

Font license matrix (verified 2026-11-22; all OFL-1.1):

| Family             | Fontsource package                                              | Version | License evidence                                                   |
| ------------------ | --------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| Geist / Geist Mono | `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` | 5.3.0   | `https://github.com/vercel/geist-font/blob/main/LICENSE.txt`       |
| Instrument Serif   | `@fontsource/instrument-serif`                                  | 5.3.0   | `https://github.com/Instrument/instrument-serif/blob/main/OFL.txt` |
| Noto Sans SC       | `@fontsource-variable/noto-sans-sc`                             | 5.3.1   | `https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE`     |
| Noto Serif SC      | `@fontsource-variable/noto-serif-sc`                            | 5.3.1   | `https://github.com/notofonts/noto-cjk/blob/main/Serif/LICENSE`    |
| Fraunces           | `@fontsource-variable/fraunces`                                 | 5.3.0   | `https://github.com/undercasetype/Fraunces/blob/master/OFL.txt`    |
| Inter              | `@fontsource-variable/inter`                                    | 5.3.0   | `https://github.com/rsms/inter`                                    |
| JetBrains Mono     | `@fontsource-variable/jetbrains-mono`                           | 5.3.0   | `https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt`   |
| Newsreader         | `@fontsource-variable/newsreader`                               | 5.3.0   | Fontsource package OFL metadata + upstream OFL text                |
| Manrope            | `@fontsource-variable/manrope`                                  | 5.3.0   | Fontsource package OFL metadata + upstream OFL text                |

The implementation must copy the actual upstream OFL text into
`packages/ui/src/styles/font-licenses/`, not just link to it. `Fontsource` is a
packaging layer; the family license remains the source of truth.

## 10. UI and interaction

### User-facing appearance picker

Add an "外观" section to the user's settings/account menu:

- mode segmented control: 跟随系统 / 浅色 / 深色;
- skin grid with miniature live previews in both modes;
- font pairing cards with Chinese/English/mono specimens;
- a live preview panel showing a journal card, body text, and metadata;
- "保存" and "恢复默认"; if overrides are disabled, show a read-only note
  naming the platform default.

The picker must be a real form, not a menu of unlabeled swatches. It must be
keyboard operable, announce loading/saving/errors, and not lose unsaved
changes on accidental navigation.

### Admin defaults

The Admin `主题` group becomes "外观默认值":

- default skin preview grid for all six bundled skin IDs;
- default mode (system/light/dark);
- default font pairing for all six bundled pairings;
- allow user override switch;
- a live preview using the exact same preview component as the user picker.

Admin's own console is a fixed dark operational shell. It does not follow the
platform skin, mode, or font, and per-admin appearance overrides are not part
of v1. This keeps operational screens consistent across operators and prevents
an end-user theme choice from making destructive controls or audit tables less
legible. The Admin appearance page previews Web surfaces only; it never mutates
the console's own tokens.

### Loading, empty, and error states

- Catalogs are static; if a stored ID is unknown, resolve the default and log
  a warning without breaking the page.
- If the user preference API fails, keep the current visual state and show
  "外观已应用，但未能同步到账号" with retry.
- If Fontsource CSS fails to load, the fallback stack must render without
  layout breakage; no invisible text.
- If a skin token block is missing, the build fails; runtime does not silently
  fall back to a partially broken skin.

## 11. Component migration

The audit found 37 files containing raw color syntax; removing tests, seed
fixtures, API-generated email HTML, and non-visual scripts leaves **26 UI
files**. Every row must be migrated and visually checked in both modes. This
table is the implementation checklist; a file with an unlisted raw color is a
review failure.

| #   | File                                                            | Required migration                                                                             | Exception / proof                                                   |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | `apps/admin/app/globals.css`                                    | Admin fixed shell surfaces, hairlines, focus, overlays                                         | Admin always dark; no skin attributes                               |
| 2   | `apps/admin/components/login/two-factor-enrollment.tsx`         | Surrounding surfaces/toasts tokenized                                                          | QR module black/white may be fixed for scan reliability; documented |
| 3   | `apps/admin/components/media/media-view.tsx`                    | Replace preview gradients with tokenized media fallback/status                                 | Media thumbnail itself is content, not a theme token                |
| 4   | `apps/web/app/(app)/w/[workspaceSlug]/journal/journal-live.tsx` | Editor chrome, selection, live states                                                          | —                                                                   |
| 5   | `apps/web/app/globals.css`                                      | Atmosphere, covers, grid, page surfaces                                                        | Glow alpha must remain decorative-only                              |
| 6   | `apps/web/app/layout.tsx`                                       | `data-mode/data-skin/data-font`, meta theme-color, SSR resolver                                | No blocking inline remote script                                    |
| 7   | `apps/web/components/ai/shimmer.tsx`                            | Shimmer gradient from surface/accent roles                                                     | Reduced motion disables animation                                   |
| 8   | `apps/web/components/app-shell/notification-bell.tsx`           | Unread badge/status colors                                                                     | —                                                                   |
| 9   | `apps/web/components/auth/totp-qr.tsx`                          | Card, copy, errors tokenized                                                                   | QR module fixed-contrast exception                                  |
| 10  | `apps/web/components/charts/chart-container.tsx`                | Chart series, grid, tooltip, legend roles                                                      | Map chart colors must not use hard-coded brand hex                  |
| 11  | `apps/web/components/journal/journal-layout.css`                | Quotes, lists, code, tables, marks, selection, highlights                                      | CJK line-height/contrast verified per skin                          |
| 12  | `apps/web/components/map/cluster-points-source.tsx`             | Cluster fill/stroke/label tokens                                                               | Map style itself may remain third-party                             |
| 13  | `apps/web/components/map/globe-view.tsx`                        | Globe chrome/route/marker surfaces                                                             | Third-party style URL is not a theme token                          |
| 14  | `apps/web/components/map/map-canvas.tsx`                        | Canvas chrome, route, marker, popup tokens                                                     | —                                                                   |
| 15  | `apps/web/components/map/map-fallback.tsx`                      | Fallback/error/empty surfaces                                                                  | —                                                                   |
| 16  | `apps/web/components/map/world-map.tsx`                         | Country/route/selection tokens                                                                 | —                                                                   |
| 17  | `apps/web/components/media/photo-lightbox.css`                  | Overlay, caption, controls, focus                                                              | Content image colors exempt                                         |
| 18  | `apps/web/components/media/photo-uploader.css`                  | Dropzone, progress, error, disabled states                                                     | —                                                                   |
| 19  | `apps/web/components/settings/workspace-settings-page.tsx`      | Form/status surfaces                                                                           | —                                                                   |
| 20  | `apps/web/components/share/share-article.tsx`                   | Public share body, captions, share chrome                                                      | Must render platform/cookie appearance without auth                 |
| 21  | `apps/web/lib/demo-format.ts`                                   | Replace demo cover color literals with catalog roles                                           | Demo content may keep illustrative hue ids, not raw CSS             |
| 22  | `apps/web/lib/editor/ai-highlight.ts`                           | Editor highlight decoration from semantic roles                                                | Must re-resolve on theme change                                     |
| 23  | `apps/web/lib/settings.ts`                                      | Remove legacy accent token map; add appearance resolver                                        | Legacy accent read mapping only                                     |
| 24  | `packages/ui/src/primitives/button.tsx`                         | Primary/outline/ghost/danger focus/disabled states                                             | —                                                                   |
| 25  | `packages/ui/src/styles/tokens.css`                             | All six skins × light/dark semantic token blocks; focus, selection, scrollbar, native controls | Palette values only                                                 |
| 26  | `packages/ui/src/styles/tokens.ts`                              | Typed token/catalog exports; no runtime color decisions                                        | —                                                                   |

Raw color literals are allowed only in the six ported palette definitions,
third-party rendering that cannot consume CSS variables, and the two documented
QR contrast exceptions. Every exception must be marked in code and covered by
the theme lint/test gate.

## 12. Accessibility

- Body text ≥ 4.5:1; large text ≥ 3:1; UI borders/focus ≥ 3:1 against adjacent
  surfaces.
- Focus ring: 2 px solid semantic focus token, 2 px offset; never rely on color
  alone.
- System mode respects `prefers-reduced-motion` and `prefers-color-scheme`.
- Use `aria-pressed`/radio-group semantics for mode and skin selection; labels
  are not color-only.
- Theme preview cards must not be the only accessible description; include
  text labels and description.
- Test at 1440 px and 390 px; no horizontal scroll or clipped text at 200%
  zoom.
- All dialogs and sticky save bars remain readable in light mode.

## 13. Security and privacy

- Appearance values are non-secret, but the cookie is validated against the
  catalog to avoid CSS injection/arbitrary values.
- No user-supplied CSS/font URLs are accepted.
- No third-party font requests; a Playwright test asserts no font request
  leaves the app origin.
- Admin default changes are audited with actor and changed keys.
- Font license files and checksums are included in the release artifact.

## 14. Test plan

### Unit

- Every catalog skin has complete light/dark tokens.
- Every font pairing has display/body/mono stacks and a license reference.
- Cookie parsing rejects unknown values field-by-field and validates `uid` /
  `updatedAt` cache identity.
- Resolver: matching authenticated cookie → DB row → guest cookie → platform →
  code default. A stale/mismatched cookie never beats a signed-in DB row.
- Legacy accent mapping is exhaustive and deterministic; an explicit stored
  `theme.defaultSkin` always beats legacy accent.
- Contrast checker for all semantic text/surface pairs.
- Every skin source mapping points to an allowlisted upstream license and every
  font pairing has a copied OFL license reference.
- Admin shell resolves to the fixed dark console regardless of platform/user
  skin/font settings.

### Web / API integration

- `GET/PUT/DELETE /v1/me/appearance` with authenticated, unauthenticated,
  2FA-required, invalid-ID, and persistence cases.
- Admin settings save/reload for all four appearance keys.
- Per-user override disabled: user PUT is rejected or coerced per accepted
  policy; public pages stay on platform default.
- Existing public share pages render the platform default/skin cookie without
  authentication.
- Cookie/DB conflict: a stale device cookie is overwritten by the account row
  and the next render is correct.
- SSR emits no wrong `data-mode`, `data-skin`, or `data-font` for a signed-in
  user; a cookie-backed first paint contains the resolved attributes.

### Playwright

- Choose each mode (system/light/dark) and assert `data-mode`, `color-scheme`,
  computed canvas/ink, reload persistence.
- Choose each skin and each font pairing; assert font-family and visible
  sample; screenshot at 1440/390.
- New user with no override gets platform default; reset restores default.
- Admin changes default; a new user sees it.
- No external font requests; only same-origin `.woff2` allowed.
- Assert the first paint budgets: selected-pairing critical Latin faces
  ≤ 400 KiB compressed; no all-pairing preload; total Chinese page font transfer
  ≤ 4 MiB compressed.
- Admin console remains fixed dark after changing Web defaults/user overrides.
- Light and dark snapshots for Web, public share, journal editor, map, photo
  gallery, dialogs, and both the fixed-dark Admin shell and its Web preview.
- Axe contrast/focus smoke plus keyboard traversal of the appearance form.
- Reduced-motion emulation.

## 15. Rollout and rollback

1. Add contracts/catalog and DB table; ship dark/light tokens behind the
   existing `theme.defaultMode` key.
2. Add platform settings and Admin UI; keep legacy accent mapping.
3. Add user preference API/cookie and Web picker.
4. Migrate the 26 listed component files; do not enable `light` in the UI until
   all listed surfaces pass the visual/contrast gate.
5. Enable default system and publish the six skins/font pairings.

Rollback: previous images ignore the new table and the extra public settings.
Do not drop the table during a fast rollback; remove it only in a later
versioned migration after the rollback window. The legacy `theme.accent` and
`dark/system` values remain readable throughout the transition.

## 16. Acceptance criteria

- Light and dark work on every listed surface; system mode follows the OS.
- Six skins and six font pairings are selectable; all assets resolve locally.
- User choice persists across reload and account preference; admin default
  applies when no user override exists.
- No external font/CDN request appears in the network log.
- No wrong-theme flash on first paint for a user with a matching cookie or a
  signed-in DB preference.
- Admin defaults and reset-to-default are audited and role/2FA-protected.
- The Admin console itself stays fixed dark; changing a user/platform theme
  cannot alter its operational contrast.
- All skin/mode/pairing combinations pass automated contrast and are visually
  inspected at 1440 and 390.
- Dark-only language and tests are removed or migrated; no fake `system` mode
  remains.

## 17. Sources

Primary product/design sources are in `.audit/theme-research/trends-fonts.md`.
Primary palette sources are pinned below; all repositories were cloned at the
listed commit and their license files were checked on 2026-11-22.

| Use                                   | Repository / commit                                              | License                | Files used                                                                              |
| ------------------------------------- | ---------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| Editorial Noir light/dark role source | `radix-ui/colors@dbdb85470547c7d34b9001f48fddb08ded335979`       | MIT (`LICENSE`)        | `src/light.ts:301-314,1801-1814`; `src/dark.ts:301-314,1801-1814`                       |
| Catppuccin Latte/Mocha                | `catppuccin/palette@07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd`    | MIT (`LICENSE`)        | `palette.json:3,261-270,303-312,492-505,2727,2985-2994,3027-3036,3216-3229`             |
| Tokyo Night Day/Storm                 | `folke/tokyonight.nvim@cdc07ac78467a233fd62c493de29a17e0cf2b2b6` | Apache-2.0 (`LICENSE`) | `lua/tokyonight/colors/day.lua:1-16`; `storm.lua:1-38`; `lua/tokyonight/util.lua:54-71` |
| Rosé Pine Dawn/Moon                   | `rose-pine/neovim@ff483051a47e27d84bdef47703538df1ed9f4a47`      | MIT (`LICENSE`)        | `lua/rose-pine/palette.lua:23-42,43-62`                                                 |
| Kanagawa Lotus/Wave                   | `rebelot/kanagawa.nvim@bb85e4bfc8d89b0e62c8fa53ccdd13d12e2f77b3` | MIT (`LICENSE`)        | `lua/kanagawa/colors.lua:5-11,33-58,88-127`; `lua/kanagawa/themes.lua:90-160,301-397`   |
| Everforest Light/Dark                 | `sainnhe/everforest@85a86eb62409e3ec88713bff3d1b9d7374e112e4`    | MIT (`LICENSE`)        | `palette.md:21-42,46-69`                                                                |
| Font packaging                        | Fontsource packages listed in §9                                 | OFL-1.1 per family     | Family OFL texts copied into `packages/ui/src/styles/font-licenses/`                    |

Additional design-process references (not code sources): Material 3
Expressive, Apple’s 2025 design announcement, Fluent 2 Color, Radix Colors
scale documentation, Tailwind dark-mode guidance, MDN
`prefers-color-scheme`, and web.dev color-scheme guidance, all accessed
2026-11-22.
