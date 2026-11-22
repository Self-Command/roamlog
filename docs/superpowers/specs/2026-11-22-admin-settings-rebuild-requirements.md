# Admin settings rebuild — requirements freeze

Date: 2026-11-22
Status: APPROVED — decisions frozen by the root review. Implementation follows
the accepted plan and may not start until that plan is written and checked.

## Outcome

Replace the current one-value settings surface with a provider-oriented settings
system. Operators must be able to configure several AI and map providers, store
their credentials in the database, discover selectable AI models after entering
an endpoint and key, and choose an explicit priority/fallback order. The Admin
UI and its API/runtime consumers must change together.

No new deployment is approved until every requirement below has automated,
real-stack acceptance evidence.

## Required product behavior

### Provider configuration

- AI and map settings are collections of provider instances, not one global
  provider plus one key.
- A provider instance has a stable id, provider type, display label, enabled
  state, priority, non-secret configuration, encrypted secret references,
  capabilities, health/test state, and timestamps.
- Multiple instances of the same provider type are allowed.
- Priority is explicit and editable. Runtime resolution walks enabled instances
  in priority order and fails over only after an eligible failure.
- Disable and delete are distinct. Deleting a provider requires confirmation;
  keys are never echoed back after save.
- Existing environment-based settings remain a safe bootstrap/fallback source,
  but operator-saved database settings take precedence unless a key is
  explicitly environment-locked.

### AI providers

- Operators can add an AI provider with a provider type, API base URL, API key,
  optional display label, enabled state, and priority.
- Entering a base URL and key automatically discovers the provider's available
  models. The UI shows loading, empty, unauthorized, timeout, and retry states.
- Discovered models appear in a searchable select; a saved model remains
  selected when it is still present. Operators can test the provider and choose
  the default model.
- OpenAI-compatible endpoints are required. Any additional vendor adapters must
  use that vendor's documented model-list API and must not invent a protocol.
- AI runtime consumers use the ordered provider list and fail over predictably.
- Secret values are write-only from the UI: responses expose only `hasValue` and
  a short last-four marker.

### Map providers

- Operators can configure Tencent Maps, Geoapify, and the existing non-key
  providers as independent entries, with multiple entries allowed.
- Each entry has an endpoint/key where applicable, enabled state, priority,
  quota/limit settings, timeout, and test/health result.
- The existing Tencent Maps and Geoapify keys in local `.env.local` must be
  imported into the production database through the new encrypted secret path.
  Keys must never be printed in logs, reports, screenshots, or chat.
- Place search, reverse geocoding, and autocomplete resolve providers using the
  configured priority and fail over without blocking healthy providers.
- Existing `PLACES_SOURCES` / `PLACES_SOURCE_ORDER` and current `places.*`
  settings must be migrated or mapped explicitly; two competing ordering
  sources are not acceptable.

### Settings, secrets, and administration

- Saving must work in production with `CONFIG_ENCRYPTION_KEY` provisioned and
  must preserve existing encrypted values across key rotation.
- Secret storage failures surface as an actionable operator error, not a silent
  partial save.
- Saves are transactional and auditable. The audit includes changed keys,
  provider ids, actor, and result, never plaintext secrets.
- Only a super administrator with verified TOTP may change providers, reveal a
  secret, reorder fallback priority, or test a provider that sends requests.
- Settings caches invalidate immediately after save so search/AI/media/mail
  consumers observe the new provider order on the next eligible request.
- Settings groups outside AI and maps must be audited for the same one-value,
  validation, secret, save, and fallback gaps. They are not declared complete
  merely because they were not mentioned in the original complaint.

### Admin UI and interaction

- The settings surface is one coherent provider-management pattern rather than
  bespoke disconnected forms.
- Provider collection view supports add, edit, enable/disable, test, delete,
  drag-to-reorder, and keyboard-accessible move-up/move-down.
- The detail pane preserves unsaved drafts, warns on navigation, and reports
  partial/field errors without discarding input.
- Desktop (1440 px) and mobile (390 px), keyboard, focus, contrast, reduced
  motion, screen-reader names, empty states, and error states are acceptance
  criteria.
- AI model discovery and provider health are visible, debounced, cancellable,
  and never block typing.

### Theme, font, and appearance

- The product ships multiple curated visual themes ("skins") with complete
  light and dark palettes. Dark-only and "follow system but still render dark"
  are not acceptable.
- The product ships multiple locally bundled font families/pairings for Latin
  and CJK text. Fonts and licenses live in the repository or image and are
  served by the application; no Google Fonts, CDN, or other runtime network
  dependency is allowed.
- Appearance preference is three-way: light, dark, or system. The product
  default is system. The choice must survive reload and work without a flash of
  the wrong theme.
- A signed-in user can choose a theme and font from the front-end. The platform
  super administrator can set the default theme, default font, default
  appearance mode, and allow/deny user overrides.
- User selection overrides the platform default; reset-to-default is explicit.
  Guests follow the platform appearance mode and system preference.
- Theme/font catalogs expose stable ids, labels, preview swatches/sample text,
  and accessible descriptions. Only bundled, licensed assets are selectable.
- Theme tokens cover surfaces, text hierarchy, borders, accents, focus rings,
  charts/maps, status colors, editor content, share pages, errors, empty states,
  and dialogs. Components must not hard-code colors that break the light theme.
- Both themes and every bundled font must meet contrast/readability checks on
  desktop and mobile; reduced-motion, focus visibility, CJK line height, and
  code/mono alignment are acceptance criteria.
- Trending visual directions must be researched from current, citable sources
  before choosing which skins/font pairings to port. The selected assets must
  have redistribution-compatible licenses and include their license texts.

## Existing defects included in the release gate

- Admin media library must show real signed thumbnails, not only gradient
  placeholders; loading failures fall back to an honest status state.
- Existing journal Grid/image/text layout behavior must remain green.
- The current appearance setting claims "follow system" while no light palette
  exists; this release must make the control truthful.
- `by9700@qq.com` is a verified, TOTP-enabled `super_admin`; this must remain
  true after any migration.

## Non-goals

- No CRDT or real-time collaborative editing changes.
- No new provider protocol invented for convenience.
- No public exposure of storage keys or provider secrets.
- No automatic load balancing across providers unless the accepted spec
  explicitly defines it; the required behavior is priority-ordered fallback.
- No deployment, tag move, or production image rollout during the audit/spec
  phase.

## Acceptance gates

1. Backend and UI specs include source references and are reviewed by the root
   agent before implementation.
2. Database migration works on an empty database and on the current production
   schema, and has a tested rollback.
3. Real API + Postgres + Redis + object storage and the real Admin UI prove each
   AI/map provider flow; third-party model/map gateways may be stubbed only when
   the report names the stub.
4. Desktop 1440 px and mobile 390 px screenshots show real data and working
   states for success, empty, loading, error, and permission denial.
5. Tencent and Geoapify keys are present in the database via encrypted secret
   storage, with only last-four markers visible.
6. Settings save survives reload; priority order survives reload; failover is
   demonstrated with the first provider unavailable.
7. `SETTINGS_ENCRYPTION_UNAVAILABLE` is gone and a production save returns a
   success response with an audit row.
8. Media thumbnails and the originally delivered journal layout E2E remain
   green.
9. Light, dark, and system appearance work on Web, public share pages, and the
   journal editor; the Admin console stays fixed dark and remains legible.
   Every bundled font loads from the app origin and no external font/network
   request is observable.
10. User theme/font overrides persist across reload; the admin defaults apply
    to new users and to users with no override; reset-to-default restores them.
11. All bundled theme/font license files are present and the attribution
    requirements are documented.
12. `pnpm contracts:check`, typechecks, builds, unit tests, and the relevant
    Playwright suites pass on the exact release commit.
13. No deployment occurs until the root review records ACCEPT for all gates.

## Evidence and open inputs

- Keys already available locally: `TENCENT_MAPS_KEY` and `GEOAPIFY_API_KEY` in
  `.env.local`; values must be read by an importer and never copied into this
  document.
- Production database currently has zero `SystemSetting` rows. The
  `CONFIG_ENCRYPTION_KEY` is configured and a real encrypted save has returned
  HTTP 200; do not generate a second key. The earlier
  `SETTINGS_ENCRYPTION_UNAVAILABLE` failure was caused by a missing keyring.
- Backend architecture: `docs/superpowers/specs/2026-11-22-admin-settings-provider-architecture.md`
  (final spec revision complete).
- UI architecture: `docs/superpowers/specs/2026-11-22-admin-settings-provider-ui.md`
  (final spec revision complete).
- Theme/font design: `docs/superpowers/specs/2026-11-22-theme-font-system-design.md`
  (final spec revision complete).

## Frozen decisions

These are the root-agent decisions that close the audit's open questions. They
apply unless the user replaces them before implementation starts.

| ID  | Decision                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Admin console is a fixed dark operational shell. It does not follow platform or user skin/font. Admin sets Web defaults and shows a Web preview.                                             |
| D2  | First release ships 6 skins and 6 font pairings. Every skin has a complete light and dark palette.                                                                                           |
| D3  | Skins are legally ported: `editorial-noir` (current baseline + Radix Colors), `catppuccin`, `tokyo-night`, `rose-pine`, `kanagawa`, `everforest`.                                            |
| D4  | Font pairings are `editorial-classic`, `literary-warm`, `modern-editorial`, `expressive-serif`, `cjk-editorial`, `swiss-modern`; all local, OFL-1.1, no LXGW WenKai.                         |
| D5  | Web/share/editor default mode is `system`; users can select light, dark, system, skin, and font when the platform allows overrides.                                                          |
| D6  | AI v1 presets: OpenAI, DeepSeek, OpenRouter, Groq, Together, Gemini OpenAI-compatible, Anthropic, OpenAI Responses, Custom OpenAI-compatible.                                                |
| D7  | Provider vocabulary is `group / adapter / preset / label`; AI v1 uses priority failover only, with no round-robin load balancing.                                                            |
| D8  | Secret v1 uses one active credential per provider field. Replacing it is an atomic, audited `PUT .../secrets/:field`; the previous ciphertext is kept in history for 24h and never returned. |
| D9  | Map place search defaults to `merge`; priority determines source order and tie-breaks. Operators can switch to strict `priority_failover`.                                                   |
| D10 | All service pages use the unified Provider UI. Mail and storage runtime remain single-active in v1; a second active instance returns `409 PROVIDER_ACTIVE_CONFLICT`.                         |
| D11 | v1 is platform-scoped; no workspace-level provider overrides.                                                                                                                                |
| D12 | Tencent and Geoapify keys are imported by a secure server-side stdin/secret-manager command using the current keyring. No plaintext key enters Git, reports, screenshots, chat, or audit.    |
| D13 | Production already has a working keyring. Do not generate a second key; preserve and back up the current key id.                                                                             |
| D14 | AI model discovery is server-side. OpenAI-compatible and Anthropic catalogs are required; unsupported catalogs may produce a clearly labeled manual model ID.                                |
| D15 | Per-model capabilities (vision/reasoning/tools) are explicit; provider catalog metadata cannot silently enable vision.                                                                       |
| D16 | Workspace/tenancy, Mail failover, Storage object routing, and multi-active credentials are explicitly deferred to later projects.                                                            |
| D17 | No production image deployment occurs until every acceptance gate below has fresh evidence and the root review records ACCEPT.                                                               |

Legacy compatibility additions:

- `theme.defaultSkin` wins over legacy `theme.accent`.
- Accent mapping: `white → editorial-noir`, `amber → catppuccin`,
  `blue → tokyo-night`, `emerald → everforest`, `rose → rose-pine`;
  `kanagawa` has no legacy accent.
- Existing uncommitted media-thumbnail work stays as an independently reviewed
  fix. The narrow single-provider AI model-discovery WIP is reference material,
  not the approved provider architecture.
