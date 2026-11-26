# Trendy Enterprise Theme Catalog

Date: 2026-11-26
Status: Implemented (real dashboard preview pending stack)
Scope: 4 new Web/Admin themes, light + dark, theme-token only

## Decision

Add four new skin IDs:

- `mist` — cool slate + indigo, Linear-like calm; recommended new default.
- `geist` — monochrome product UI with a blue focus ring.
- `iris` — Radix iris/mauve violet, soft and low-contrast.
- `sandstone` — warm sand/paper neutral, restrained amber-brown accent.

`porcelain` remains a legal legacy skin. The platform default moves from
`porcelain` to `mist`, but only when the stored default is still `porcelain`.
No user appearance row is rewritten.

This catalog changes color, radius, shadow, glass, and hairline tokens only.
It does not change layout, spacing, font sizes, line heights, component trees,
page structure, or navigation.

## Source and license audit

All source repositories were inspected locally under
`.audit/theme-research/sources/`.

| Theme                     | Source                                          | Commit                                     | File / lines                                                                          | License    | Allowed |
| ------------------------- | ----------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- | ---------- | ------- |
| `mist`                    | `tweakcn` preset `clean-slate`                  | `a3b47b37cba97dd637de517aab52c45ec0f83456` | `utils/theme-presets.ts:2262-2421`                                                    | Apache-2.0 | Yes     |
| `geist`                   | `tweakcn` preset `modern-minimal`               | `a3b47b37cba97dd637de517aab52c45ec0f83456` | `utils/theme-presets.ts:4-82`                                                         | Apache-2.0 | Yes     |
| `iris`                    | Radix Colors `iris` + `mauve`                   | `dbdb85470547c7d34b9001f48fddb08ded335979` | `src/light.ts:61-74,841-854`; `src/dark.ts:61-74,841-854`                             | MIT        | Yes     |
| `sandstone`               | `tweakcn` preset `vintage-paper`                | `a3b47b37cba97dd637de517aab52c45ec0f83456` | `utils/theme-presets.ts:2829-2912`                                                    | Apache-2.0 | Yes     |
| status roles (all themes) | Radix Colors `red` / `blue` / `green` / `amber` | `dbdb85470547c7d34b9001f48fddb08ded335979` | `src/light.ts:421-434,961-974,1201-1214,1741-1754`; dark equivalents in `src/dark.ts` | MIT        | Yes     |

`tweakcn` is Apache-2.0, not MIT. Apache-2.0 is compatible with this project.
No AGPL, SSPL, Commons Clause, Business Source License, or community-license
code was used.

### `geist` naming note

Vercel's current Geist design-system tokens are not published as a complete,
permissively licensed palette. The product label `geist` is therefore backed by
the Apache-2.0 `tweakcn` `modern-minimal` palette, with one documented
adaptation: the primary token uses the source foreground (`#333333` light /
`#e5e5e5` dark) so the result is genuinely monochrome. No Vercel proprietary
code or asset is copied.

## Token mapping rules

Radix Colors uses a 12-step scale:

| Step | Intended use          |
| ---- | --------------------- |
| 1    | app background        |
| 2    | subtle background     |
| 3    | component background  |
| 4    | hover                 |
| 5    | active                |
| 6    | subtle border         |
| 7    | border                |
| 8    | strong border / focus |
| 9    | solid accent          |
| 10   | hover solid           |
| 11   | low-contrast text     |
| 12   | high-contrast text    |

The mapping used below:

- `canvas` = step 1
- `surface1` = step 2 or the preset card
- `surface2` = step 3
- `surfaceDeep` = step 4
- `overlay` = card/popover at 86–90% opacity for glass
- `ink` = step 12
- `body`/`muted` = step 11 or the preset foreground
- `ash`/`stone` = step 9/10
- `accentPrimary`/`accentWarm` = accent step 9
- `accentBlue`/`accentGreen`/`accentRed`/`accentYellow` = corresponding
  Radix scale step 11 (text-safe)
- `focusRing` = accent step 8/9
- `success/warning/danger/info` = Radix green/amber/red/blue step 11
- `hairline` = ink at 8–10% opacity; `hairlineStrong` at 14–16%
- `radiusCard`/`radiusControl` = the source preset's radius token scaled for
  Roamlog's larger surfaces. This is the only geometric adaptation; it does
  not affect layout.

## Theme: `mist`

Light source: `clean-slate` `background/card/secondary/muted/foreground/primary`.
Dark source: the same preset's `dark` block.

| Token             | Light                                                                                              | Dark                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| canvas            | `#f8fafc`                                                                                          | `#0f172a`                                                                                     |
| surface1          | `#ffffff`                                                                                          | `#1e293b`                                                                                     |
| surface2          | `#f3f4f6`                                                                                          | `#152032`                                                                                     |
| surfaceDeep       | `#e5e7eb`                                                                                          | `#0b1220`                                                                                     |
| overlay           | `rgba(255,255,255,0.86)`                                                                           | `rgba(30,41,59,0.86)`                                                                         |
| ink               | `#1e293b`                                                                                          | `#e2e8f0`                                                                                     |
| body              | `#374151`                                                                                          | `#cbd5e1`                                                                                     |
| muted             | `#6b7280`                                                                                          | `#94a3b8`                                                                                     |
| ash               | `#9ca3af`                                                                                          | `#64748b`                                                                                     |
| stone             | `#6b7280`                                                                                          | `#94a3b8`                                                                                     |
| accentPrimary     | `#5b5bd6`                                                                                          | `#818cf8`                                                                                     |
| accentWarm        | `#5b5bd6`                                                                                          | `#818cf8`                                                                                     |
| accentBlue        | `#4f46e5`                                                                                          | `#70b8ff`                                                                                     |
| accentGreen       | `#218358`                                                                                          | `#3dd68c`                                                                                     |
| accentRed         | `#ce2c31`                                                                                          | `#ff9592`                                                                                     |
| accentYellow      | `#ab6400`                                                                                          | `#ffca16`                                                                                     |
| accentSlate       | `#6b7280`                                                                                          | `#94a3b8`                                                                                     |
| accentContrast    | `#ffffff`                                                                                          | `#0f172a`                                                                                     |
| focusRing / Outer | `#6366f1`                                                                                          | `#818cf8`                                                                                     |
| focusRingInner    | `#ffffff`                                                                                          | `rgba(15,23,42,0.65)`                                                                         |
| success           | `#218358`                                                                                          | `#3dd68c`                                                                                     |
| warning           | `#ab6400`                                                                                          | `#ffca16`                                                                                     |
| danger            | `#ce2c31`                                                                                          | `#ff9592`                                                                                     |
| info              | `#0d74ce`                                                                                          | `#70b8ff`                                                                                     |
| hairline          | `rgba(30,41,59,0.08)`                                                                              | `rgba(226,232,240,0.10)`                                                                      |
| hairlineStrong    | `rgba(30,41,59,0.14)`                                                                              | `rgba(226,232,240,0.16)`                                                                      |
| radiusCard        | `20px`                                                                                             | `20px`                                                                                        |
| radiusControl     | `12px`                                                                                             | `12px`                                                                                        |
| shadowCard        | `0 1px 2px rgba(15,23,42,.04), 0 8px 24px rgba(15,23,42,.06), inset 0 1px 0 rgba(255,255,255,.72)` | `0 1px 2px rgba(0,0,0,.24), 0 12px 32px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06)` |
| shadowOverlay     | `0 24px 64px rgba(15,23,42,.16), 0 8px 20px rgba(15,23,42,.08)`                                    | `0 28px 72px rgba(0,0,0,.55)`                                                                 |

## Theme: `geist`

Light source: `modern-minimal` `background/card/secondary/muted/foreground/ring`.
Dark source: the same preset's `dark` block. Primary is the source foreground
to preserve the monochrome Geist intent.

| Token             | Light                                                                                        | Dark                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| canvas            | `#ffffff`                                                                                    | `#171717`                                                                                     |
| surface1          | `#ffffff`                                                                                    | `#262626`                                                                                     |
| surface2          | `#f3f4f6`                                                                                    | `#1f1f1f`                                                                                     |
| surfaceDeep       | `#e5e7eb`                                                                                    | `#0f0f0f`                                                                                     |
| overlay           | `rgba(255,255,255,0.88)`                                                                     | `rgba(38,38,38,0.90)`                                                                         |
| ink               | `#333333`                                                                                    | `#e5e5e5`                                                                                     |
| body              | `#4b5563`                                                                                    | `#d4d4d4`                                                                                     |
| muted             | `#6b7280`                                                                                    | `#a3a3a3`                                                                                     |
| ash               | `#9ca3af`                                                                                    | `#737373`                                                                                     |
| stone             | `#6b7280`                                                                                    | `#a3a3a3`                                                                                     |
| accentPrimary     | `#333333`                                                                                    | `#e5e5e5`                                                                                     |
| accentWarm        | `#333333`                                                                                    | `#e5e5e5`                                                                                     |
| accentBlue        | `#0d74ce`                                                                                    | `#70b8ff`                                                                                     |
| accentGreen       | `#218358`                                                                                    | `#3dd68c`                                                                                     |
| accentRed         | `#ce2c31`                                                                                    | `#ff9592`                                                                                     |
| accentYellow      | `#ab6400`                                                                                    | `#ffca16`                                                                                     |
| accentSlate       | `#6b7280`                                                                                    | `#a3a3a3`                                                                                     |
| accentContrast    | `#ffffff`                                                                                    | `#171717`                                                                                     |
| focusRing / Outer | `#3b82f6`                                                                                    | `#3b82f6`                                                                                     |
| focusRingInner    | `#ffffff`                                                                                    | `rgba(23,23,23,0.65)`                                                                         |
| success           | `#218358`                                                                                    | `#3dd68c`                                                                                     |
| warning           | `#ab6400`                                                                                    | `#ffca16`                                                                                     |
| danger            | `#ce2c31`                                                                                    | `#ff9592`                                                                                     |
| info              | `#0d74ce`                                                                                    | `#70b8ff`                                                                                     |
| hairline          | `rgba(51,51,51,0.08)`                                                                        | `rgba(229,229,229,0.10)`                                                                      |
| hairlineStrong    | `rgba(51,51,51,0.14)`                                                                        | `rgba(229,229,229,0.16)`                                                                      |
| radiusCard        | `16px`                                                                                       | `16px`                                                                                        |
| radiusControl     | `10px`                                                                                       | `10px`                                                                                        |
| shadowCard        | `0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.05), inset 0 1px 0 rgba(255,255,255,.70)` | `0 1px 2px rgba(0,0,0,.28), 0 10px 28px rgba(0,0,0,.30), inset 0 1px 0 rgba(255,255,255,.06)` |
| shadowOverlay     | `0 20px 56px rgba(0,0,0,.14)`                                                                | `0 24px 64px rgba(0,0,0,.55)`                                                                 |

## Theme: `iris`

Light source: Radix `mauve` neutral steps + `iris` accent steps. Dark source:
the corresponding Radix dark scales. Status colors are Radix step 11.

| Token             | Light                                                                                               | Dark                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| canvas            | `#fdfcfd`                                                                                           | `#121113`                                                                                     |
| surface1          | `#faf9fb`                                                                                           | `#1a191b`                                                                                     |
| surface2          | `#f2eff3`                                                                                           | `#232225`                                                                                     |
| surfaceDeep       | `#eae7ec`                                                                                           | `#0e0d0f`                                                                                     |
| overlay           | `rgba(250,249,251,0.86)`                                                                            | `rgba(26,25,27,0.90)`                                                                         |
| ink               | `#211f26`                                                                                           | `#eeeef0`                                                                                     |
| body              | `#65636d`                                                                                           | `#c9c7cf`                                                                                     |
| muted             | `#65636d`                                                                                           | `#b5b2bc`                                                                                     |
| ash               | `#8e8c99`                                                                                           | `#8e8c99`                                                                                     |
| stone             | `#65636d`                                                                                           | `#b5b2bc`                                                                                     |
| accentPrimary     | `#5b5bd6`                                                                                           | `#7c78ff`                                                                                     |
| accentWarm        | `#5b5bd6`                                                                                           | `#7c78ff`                                                                                     |
| accentBlue        | `#5753c6`                                                                                           | `#b1a9ff`                                                                                     |
| accentGreen       | `#218358`                                                                                           | `#3dd68c`                                                                                     |
| accentRed         | `#ce2c31`                                                                                           | `#ff9592`                                                                                     |
| accentYellow      | `#ab6400`                                                                                           | `#ffca16`                                                                                     |
| accentSlate       | `#65636d`                                                                                           | `#b5b2bc`                                                                                     |
| accentContrast    | `#ffffff`                                                                                           | `#13131e`                                                                                     |
| focusRing / Outer | `#5b5bd6`                                                                                           | `#b1a9ff`                                                                                     |
| focusRingInner    | `#ffffff`                                                                                           | `rgba(18,17,19,0.65)`                                                                         |
| success           | `#218358`                                                                                           | `#3dd68c`                                                                                     |
| warning           | `#ab6400`                                                                                           | `#ffca16`                                                                                     |
| danger            | `#ce2c31`                                                                                           | `#ff9592`                                                                                     |
| info              | `#0d74ce`                                                                                           | `#70b8ff`                                                                                     |
| hairline          | `rgba(33,31,38,0.08)`                                                                               | `rgba(238,238,240,0.10)`                                                                      |
| hairlineStrong    | `rgba(33,31,38,0.14)`                                                                               | `rgba(238,238,240,0.16)`                                                                      |
| radiusCard        | `22px`                                                                                              | `22px`                                                                                        |
| radiusControl     | `14px`                                                                                              | `14px`                                                                                        |
| shadowCard        | `0 2px 4px rgba(33,31,38,.04), 0 12px 32px rgba(33,31,38,.07), inset 0 1px 0 rgba(255,255,255,.72)` | `0 2px 4px rgba(0,0,0,.24), 0 14px 36px rgba(0,0,0,.30), inset 0 1px 0 rgba(255,255,255,.06)` |
| shadowOverlay     | `0 28px 72px rgba(33,31,38,.18)`                                                                    | `0 30px 80px rgba(0,0,0,.58)`                                                                 |

## Theme: `sandstone`

Light source: `vintage-paper` `background/card/secondary/muted/foreground/primary`.
Dark source: the same preset's `dark` block. Status colors are Radix step 11.

| Token             | Light                                                                                               | Dark                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| canvas            | `#f5f1e6`                                                                                           | `#2d2621`                                                                                     |
| surface1          | `#fffcf5`                                                                                           | `#3a322c`                                                                                     |
| surface2          | `#ece5d8`                                                                                           | `#312b26`                                                                                     |
| surfaceDeep       | `#e2d8c3`                                                                                           | `#1f1a16`                                                                                     |
| overlay           | `rgba(255,252,245,0.88)`                                                                            | `rgba(58,50,44,0.90)`                                                                         |
| ink               | `#4a3f35`                                                                                           | `#ece5d8`                                                                                     |
| body              | `#5c4d3f`                                                                                           | `#d8cfc2`                                                                                     |
| muted             | `#7d6b56`                                                                                           | `#c5bcac`                                                                                     |
| ash               | `#a67c52`                                                                                           | `#a67c52`                                                                                     |
| stone             | `#7d6b56`                                                                                           | `#c5bcac`                                                                                     |
| accentPrimary     | `#8d6e4c`                                                                                           | `#c0a080`                                                                                     |
| accentWarm        | `#8d6e4c`                                                                                           | `#c0a080`                                                                                     |
| accentBlue        | `#8d6e4c`                                                                                           | `#b3906f`                                                                                     |
| accentGreen       | `#218358`                                                                                           | `#3dd68c`                                                                                     |
| accentRed         | `#ce2c31`                                                                                           | `#ff9592`                                                                                     |
| accentYellow      | `#ab6400`                                                                                           | `#ffca16`                                                                                     |
| accentSlate       | `#7d6b56`                                                                                           | `#c5bcac`                                                                                     |
| accentContrast    | `#ffffff`                                                                                           | `#2d2621`                                                                                     |
| focusRing / Outer | `#a67c52`                                                                                           | `#c0a080`                                                                                     |
| focusRingInner    | `#ffffff`                                                                                           | `rgba(45,38,33,0.65)`                                                                         |
| success           | `#218358`                                                                                           | `#3dd68c`                                                                                     |
| warning           | `#ab6400`                                                                                           | `#ffca16`                                                                                     |
| danger            | `#ce2c31`                                                                                           | `#ff9592`                                                                                     |
| info              | `#0d74ce`                                                                                           | `#70b8ff`                                                                                     |
| hairline          | `rgba(74,63,53,0.10)`                                                                               | `rgba(236,229,216,0.10)`                                                                      |
| hairlineStrong    | `rgba(74,63,53,0.16)`                                                                               | `rgba(236,229,216,0.16)`                                                                      |
| radiusCard        | `20px`                                                                                              | `20px`                                                                                        |
| radiusControl     | `12px`                                                                                              | `12px`                                                                                        |
| shadowCard        | `0 2px 4px rgba(74,63,53,.05), 0 10px 28px rgba(74,63,53,.07), inset 0 1px 0 rgba(255,255,255,.65)` | `0 2px 4px rgba(0,0,0,.26), 0 12px 30px rgba(0,0,0,.30), inset 0 1px 0 rgba(255,255,255,.05)` |
| shadowOverlay     | `0 24px 64px rgba(74,63,53,.16)`                                                                    | `0 28px 72px rgba(0,0,0,.58)`                                                                 |

## Material rules

- Glass is limited to header, sidebar, surface cards, dialogs/popovers, the AI
  composer, and the mobile tab bar. Text-heavy journal bodies and data tables
  remain opaque.
- Header: `blur(18px) saturate(135%)`.
- Sidebar: `blur(22px) saturate(135%)`.
- Surface card: `blur(14px) saturate(125%)`.
- Dialog/popover: `blur(24px) saturate(145%)`.
- Composer: `blur(20px) saturate(130%)`.
- No theme may add a new layout rule or change spacing/typography.

## Integration checklist

1. Add `mist`, `geist`, `iris`, `sandstone` to the contracts skin union,
   `THEME_SKINS`, `EnterpriseThemeSkinId`, `SKIN_LABELS`, and `SKIN_SOURCES`.
2. Add `BASE_SKIN_PALETTES` and `ENTERPRISE_EXTENDED_TOKENS` entries for both
   modes. Keep the static `tokens.css` blocks byte-for-byte consistent with the
   catalog.
3. Set `DEFAULT_SKIN_ID` and `DEFAULT_SETTINGS["theme.defaultSkin"]` to `mist`.
4. Add migration `0027_trendy_theme_catalog` (`0026` is reserved by the
   AI-message parent backfill in the same release):
   - extend the `UserAppearancePreference_skin_check` constraint;
   - update `SystemSetting.theme.defaultSkin` from `porcelain` to `mist` only;
   - never rewrite a user preference.
5. Regenerate OpenAPI and the API client.
6. Update the Web/Admin appearance pickers and the quick appearance control to
   read the active catalog dynamically.
7. Add contrast tests for every `THEME_CONTRAST_PAIRS` pair in both modes.
8. Add real-browser visual acceptance at 1440 and 390, light/dark/system, and a
   layout fingerprint delta of `0px` against Fluent.

## Preview status

Local Web/API/PostgreSQL/Redis/MinIO ports (`3000, 4000, 5432, 6379, 9000`) are
all unavailable in this environment. Therefore the real application screenshots
could not be captured in this pass.

The deliverable includes a static token contact sheet at
`.audit/theme-research/previews/contact-sheet.html` and its screenshot. It is
explicitly labeled **static token preview, not the real application**. Real
page previews must be captured when the local stack or CI stack is available;
they are a release gate, not an optional extra.

## Risks

- The status roles are shared from Radix, while the neutral/accent palettes
  come from tweakcn/Radix; contrast must still be machine-checked against the
  actual text/surface pairs.
- Three accent solids were contrast-adapted by one source step: Mist light
  `#6366f1 → #5b5bd6`, Iris dark `#6e6ade → #7c78ff`, Sandstone light
  `#a67c52 → #8d6e4c`. This is required by the existing WCAG AA test for
  `accent-solid ↔ accent-contrast`; it is the only intentional deviation from
  the upstream values.
- Roamlog's `geist` label is backed by `modern-minimal`, not Vercel's
  proprietary current design system. The report must keep that distinction
  visible.
- The radius values are scaled from smaller upstream controls to Roamlog's
  larger cards. This is a documented adaptation, not a pixel copy.
- The local preview deficit must be closed before release.
