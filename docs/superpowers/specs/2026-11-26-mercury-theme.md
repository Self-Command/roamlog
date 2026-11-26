# Mercury Enterprise Theme

Date: 2026-11-26
Status: Approved; implementation in progress
Scope: one additional enterprise skin, light + dark, theme tokens only

## Decision

The product owner reviewed three real-page token previews (Mercury, Linear and
Apple) on the existing Roamlog dashboard and selected Mercury:

> A

Mercury becomes the platform default. The change must not modify layout,
spacing, information architecture, component trees, page structure, font
loading, or responsive behavior. Only color, material, radius and shadow tokens
may change.

The existing skins remain valid:

- `porcelain`
- `mist`
- `geist`
- `iris`
- `sandstone`
- `fluent`
- `carbon`
- `carbon-soft`
- every legacy skin ID already accepted by stored preferences

No user's explicit non-default skin choice is rewritten.

## Source and license

| Item | Value |
| --- | --- |
| Source repository | `VoltAgent/awesome-design-md` |
| Commit | `fcc70284932276d085f01ef9f83edde90b1258cb` |
| Source file | `design-md/mercury/DESIGN.md` |
| Local archival copy | `docs/design/mercury/DESIGN.md` |
| License | MIT |
| License copy | `docs/design/mercury/LICENSE-awesome-design-md-MIT.txt` |
| Allowed use | analysis, modification, redistribution and derivative work |

Relevant upstream sections:

- colors: `DESIGN.md:6-18`
- radius scale: `DESIGN.md:90-98`
- primary button and translucent pills: `DESIGN.md:128-171`
- feature cards and modal surface: `DESIGN.md:193-203`, `DESIGN.md:296-303`
- two-surface product language: `DESIGN.md:321-336`
- color roles: `DESIGN.md:337-360`
- typography guidance: `DESIGN.md:361-390`
- tonal elevation: `DESIGN.md:428-437`
- shape scale: `DESIGN.md:441-456`
- component states: `DESIGN.md:459-501`
- do/don't constraints: `DESIGN.md:552-567`

Mercury uses proprietary `arcadia` / `arcadiaDisplay` fonts. No font file,
logo, photography, illustration or other proprietary brand asset is copied.
The existing Roamlog font-pairing system remains unchanged, so this theme does
not introduce an external font request.

## Native visual intent

Mercury is a quiet fintech product language:

- two surface worlds: pale near-white product pages and ink-violet night pages;
- one saturated action color: Mercury Indigo `#5266eb`;
- periwinkle `#9cb4e8` as the dark-mode action and secondary highlight;
- deep ink-violet text instead of neutral black;
- lavender-tinted secondary surfaces rather than hard gray panels;
- tonal elevation: low-opacity, layered shadows instead of heavy drop shadows;
- softly rounded large cards and capsule controls;
- restrained translucency and backdrop blur on persistent product chrome.

The result should feel native and premium rather than decorative, colorful or
template-like.

## Token mapping

The source file does not expose every application role needed by Roamlog. The
adaptation below maps documented Mercury roles onto existing Roamlog roles.
Derived intermediate surfaces are explicit adaptation values, not a second
design language.

| Roamlog role | Light | Dark | Mapping |
| --- | --- | --- | --- |
| `canvas` | `#fbfcfd` | `#171721` | Mercury `canvas` / `night` |
| `surface-1` | `#ffffff` | `#1e1e2a` | Mercury `surface` / `night-raised` |
| `surface-2` | `#f7f6fd` | `#232333` | derived step between `surface-tint`/`lavender` and raised night |
| `surface-deep` | `#f0eff9` | `#111119` | derived recessed lavender / recessed night |
| `surface-overlay` | `rgba(255,255,255,0.92)` | `rgba(30,30,42,0.92)` | glass adaptation of `surface` / `night-raised` |
| `ink` | `#28253b` | `#ededf3` | Mercury `ink` / `on-dark` |
| `body` | `#554e7b` | `#c3c3cc` | Mercury `ink-secondary` / `fog` |
| `muted` | `#70707d` | `#9c9cab` | Mercury `slate`, lifted for dark-mode legibility |
| `ash` | `#8b8b99` | `#7f7f91` | accessible low-emphasis adaptation |
| `stone` | `#70707d` | `#b0b0c0` | Mercury `slate` / `fog` adaptation |
| `hairline` | `rgba(40,37,59,0.08)` | `rgba(255,255,255,0.08)` | Mercury ink/fog rules at UI scale |
| `hairline-strong` | `rgba(40,37,59,0.14)` | `rgba(255,255,255,0.14)` | strong Mercury rule |
| `divider` | `rgba(40,37,59,0.06)` | `rgba(255,255,255,0.06)` | quiet row rule |
| `accent-primary` | `#5266eb` | `#9cb4e8` | Mercury `primary` / `periwinkle` |
| `accent-contrast` | `#ffffff` | `#171721` | Mercury `on-primary` / `night` |
| `focus-ring` | `#5266eb` | `#9cb4e8` | action color |
| `radius-card` | `16px` | `16px` | Mercury `rounded.lg` for large product panels |
| `radius-control` | `12px` | `12px` | Mercury `rounded.md` for controls |

Status roles (`success`, `warning`, `danger`, `info`) and chart roles retain
Roamlog's accessible semantic palette. Mercury's source does not define those
roles; importing unrelated status colors would be a second visual language.
Their values may be tuned only when required to pass contrast tests.

## Material mapping

The existing enterprise glass layer is extended to Mercury without changing
layout properties:

| Surface | Treatment |
| --- | --- |
| page background | canvas plus one very low-opacity indigo atmosphere and tonal lavender wash |
| `header` | 78% `surface-1`, hairline bottom rule, `blur(18px) saturate(135%)` |
| `aside` | 72% `surface-deep`, hairline edge, `blur(22px) saturate(135%)` |
| `.surface-card` | 86% `surface-1`, hairline, tonal shadow, `blur(14px) saturate(125%)` |
| dialog | 88% `surface-overlay`, strong hairline, overlay shadow, `blur(24px) saturate(145%)` |
| AI composer | 86% `surface-1`, hairline, `blur(20px) saturate(130%)` |
| mobile primary nav | 84% `surface-1`, hairline, `blur(22px) saturate(135%)` |

These selectors must include `[data-skin="mercury"]` exactly like the existing
enterprise skins. No padding, dimensions, grid, flex, position, font-size,
line-height or spacing declarations may be added by this theme.

## Product behavior

- Skin ID: `mercury`
- Display label: `Mercury 墨紫`
- Default skin: `mercury`
- Default mode: `system`
- User can select `system`, `light` or `dark`.
- Web and Admin both expose quick appearance switching.
- A user override is stored in the existing appearance preference and survives
  refresh and re-login.
- An unknown or unavailable skin continues to normalize to the platform
  default.

## Database migration

Migration: `0028_mercury_theme_default`

The migration:

1. replaces `UserAppearancePreference_skin_check` with a constraint that accepts
   `mercury` and every previously stored skin;
2. rewrites the platform default only when its stored value is still `mist`;
3. rewrites `by9700@qq.com` from `mist` to `mercury` only when that exact
   account exists and still has the old explicit mist value;
4. never creates an account;
5. never rewrites a user who already chose another skin.

The migration is intentionally forward-only. Rolling back the application must
not delete the migration row or narrow the check constraint while `mercury`
values may already exist.

## Contract and generated artifacts

The contract source of truth is:

- `packages/contracts/src/api/appearance.ts`

The following must be regenerated from the contract and never hand-edited:

- `packages/contracts/openapi.json`
- `packages/api-client/src/generated/**`

The generated skin enum must include `mercury`, and
`DEFAULT_SKIN_ID` must equal `mercury`.

## Acceptance criteria

### Functional

- Web and Admin appearance pickers list Mercury without a hard-coded count.
- Selecting Mercury updates the document skin immediately.
- Refresh preserves Mercury.
- Re-login preserves Mercury.
- Admin default appearance can be saved as Mercury and applies to users without
  an override.
- `system` mode follows the operating-system color scheme and updates live.

### Visual

- Real product screenshots are required at 1440x1000 and 390x844.
- Light and dark are both required.
- Pages: login, dashboard, journal detail, AI workspace, Admin appearance
  settings, and Admin quick appearance switch.
- Header, aside, cards, dialog and composer use the documented glass material.
- No harsh neon colors, strong gradients, sharp right angles or heavy shadows.
- Text and controls pass the repository's existing contrast checks.

### Layout invariance

Mercury and Mist are compared with a geometry fingerprint after a production
build, with fonts loaded, animations disabled and carets hidden.

For every tracked node, including `header`, `aside`, `main`, mobile navigation,
cards, dialogs, headings and the AI composer:

```text
delta x = 0px
delta y = 0px
delta width = 0px
delta height = 0px
```

Any nonzero delta fails acceptance. Pixel color differences are expected and
must not be used as evidence of layout change.

### Engineering

- `pnpm contracts:check`
- `pnpm --filter @roamlog/contracts test`
- `pnpm --filter @roamlog/db test`
- `pnpm --filter @roamlog/ui test`
- `pnpm --filter @roamlog/web typecheck`
- `pnpm --filter @roamlog/admin typecheck`
- `pnpm test`
- `pnpm build`
- targeted appearance E2E suites
- `git diff --check`

## Non-goals

- Editing page layout or component structure.
- Adding Mercury's proprietary fonts.
- Copying Mercury logos, photography or illustrations.
- Redesigning the theme picker.
- Removing old skins.
- Changing unrelated appearance or AI behavior.

## Implementation status

At the time of this specification:

- contract and database default changes are implemented and tested;
- migration `0028_mercury_theme_default` is implemented and transaction-tested;
- UI token implementation, default-related unit-test updates, E2E updates,
  geometry fingerprint and real browser screenshots are still being completed;
- nothing in this document claims that the theme has already been deployed.
