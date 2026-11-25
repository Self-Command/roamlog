# Porcelain Theme Implementation

日期: 2026-11-25
状态: Implemented
范围: Appearance skin, platform default, database migration, Web/Admin verification

## Decision

Porcelain is the user-approved internal Roamlog skin. It replaces Fluent as the
platform default while keeping every previously stored skin ID legal.

This change is **theme-only**. It does not introduce a new layout, navigation,
page structure, component tree, grid, spacing, font size or line height.

## Surface and material contract

- Light canvas: `#f6f5f2`
- Dark canvas: `#141416`
- Light surface ladder: `#fcfbf9` / `#f2f0ec` / `#ece9e4`
- Dark surface ladder: `#1c1b1f` / `#19181c` / `#0d0e10`
- Single action color: near-ink light `#1f2022`, near-white dark `#f2f1ee`
- Card radius: `12px`; control radius: `8px`
- Hairline: intentional low-contrast alpha; lightweight inset highlight
- Glass material: header/sidebar/surface-card/dialog/composer/mobile tab bar
  only, via runtime `backdrop-filter`; list and detail remain readable surfaces

The values and material rules are implemented in:

- `packages/ui/src/styles/theme-catalog.ts`
- `packages/ui/src/styles/tokens.css`

## Compatibility

- Active skin list: `porcelain`, `fluent`, `carbon`, `carbon-soft`
- Default skin: `porcelain`
- Default font: unchanged `fluent-native`
- Legacy skin IDs remain valid and continue to normalize through the shared
  contract resolver.
- Migration `0025_porcelain_default_theme` adds `porcelain` to the preference
  check constraint and rewrites only the old code-owned default `fluent`.
  It does not delete or rewrite user appearance rows.
- Admin remains a fixed Carbon operations shell; only Web/product appearance
  defaults and the picker are affected.

## Verification

- Contracts, UI tokens, DB migration tests, Web tests, Admin tests, API tests,
  Web build, Admin build and API build pass.
- Real Chromium theme foundation: default Porcelain, 4 enterprise skins,
  light/dark/system, 1440/390.
- Real browser appearance persistence: Porcelain saves, survives reload,
  guest legacy cookie remains compatible and reset restores platform defaults.
- Production-page layout fingerprint against Fluent: header/sidebar/main/card
  rectangle delta is `0px`.
