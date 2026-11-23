# AI Complete Port Implementation Plan

**Goal:** Finish the Roamlog AI experience as a complete, user-visible port of
`vercel/chatbot` instead of accepting partial adapters or patch-only behavior.

**Architecture:** Keep Roamlog's Better Auth, workspace authorization, Postgres
persistence, media pipeline, plan/execute safety model and provider registry.
Port the remaining upstream chat surfaces as whole components and connect them
to Roamlog contracts and data. Every behavior change must name the pinned
upstream file and lines; invented replacements are not acceptable.

**Upstream:** `vercel/chatbot` at
`a8989b522fa3672a2ae52f053105e40993b36ca1` (Apache-2.0). Local snapshot:
`.audit/upstream/chatbot`.

**Tech stack:** Next.js App Router, React 19, assistant-ui, NestJS, Prisma,
PostgreSQL, Playwright, Zod/OpenAPI.

**Specs and audits:**

- `.audit/ai-port/feature-matrix.md`
- `.audit/ai-port/port-plan.md`
- `.audit/ai-port/wave2-chat-acceptance.md`
- `.audit/ai-port/wave2-stream-recovery-report.md`
- `.audit/editor-ai/REPORT.md`

## Current baseline

Already landed in `848e0ea` and must be preserved:

- persisted conversations, date groups, pagination, rename/delete/delete-all;
- message copy/edit/regenerate/vote persistence;
- Streamdown/Shiki/Math/Mermaid rendering and reasoning display;
- image upload queue, preview, paste, drag/drop, slash commands, suggestions;
- model search/grouping/capabilities and reasoning-depth control;
- SSE streaming, refresh resume, cross-instance cancel and Stop;
- artifact persistence, versions, diff and text/code/sheet/image editors;
- journal AI rewrite (Novel port) and admin multi-provider AI settings.

Still missing or not accepted:

1. Conversation `private/public` visibility, sidebar Share submenu and header
   selector (`visibility-selector.tsx`, `sidebar-history-item.tsx`,
   `chat-header.tsx`).
2. Public conversation read path and page that actually honors the selected
   visibility.
3. Artifact end-to-end interaction: execution result must open the created
   artifact without a manual hunt, and create/update/suggest/restore must have
   real browser coverage.
4. Full browser acceptance for message edit/vote, composer, model switching,
   resume and mobile/desktop layouts. Existing unit tests are not acceptance.
5. Release Gate lint failure caused by two stale ESLint disable directives.

## Global constraints

- Upstream license must remain Apache-2.0; modified files keep the source,
  commit, line range and adaptation note.
- Do not replace Better Auth, Prisma, workspace permissions, media storage or
  the plan/execute confirmation model.
- Do not invent a new chat protocol, model selector, attachment UI or share
  behavior. Port upstream structure first, then adapt tokens, auth and data.
- One writer per file. Shared files are assigned below.
- Root validates screenshots and source correspondence; agent self-reports are
  not acceptance.

## Task 1: Conversation visibility and share

**Files:**

- Create: `apps/web/components/ai/visibility-selector.tsx`
- Create: `apps/web/components/ai/chat-header.tsx`
- Create: `apps/web/app/share/chat/[token]/page.tsx`
- Create: `apps/web/components/ai/public-chat.tsx`
- Modify: `apps/web/components/ai/ai-chat.tsx`
- Modify: `apps/web/components/ai/thread.tsx`
- Modify: `apps/web/components/ai/thread-list.tsx`
- Modify: `apps/web/components/ai/thread-list-adapter.ts`
- Modify: `apps/web/lib/api/ai-conversations.ts`
- Modify: `packages/contracts/src/api/ai.ts`
- Modify: `packages/contracts/scripts/openapi/paths-ai.ts`
- Modify: `apps/api/src/modules/ai/ai-conversation.{controller,service}.ts`
- Modify: `apps/api/src/modules/ai/ai.module.ts`
- Create: `packages/db/prisma/migrations/0021_ai_conversation_visibility/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`
- Create/modify: focused unit and Playwright tests, plus report
  `.audit/ai-port/visibility-share-report.md`

**Upstream sources:**

- `components/chat/visibility-selector.tsx:1-145`
- `hooks/use-chat-visibility.ts:1-54`
- `components/chat/sidebar-history-item.tsx:1-132`
- `components/chat/chat-header.tsx:1-80`
- `lib/db/schema.ts:28-45`
- `app/(chat)/actions.ts:38-58`
- `app/(chat)/api/messages/route.ts:14-45`

**Required behavior:**

- A conversation can be `private` or `public`; default is `private`.
- The header and the sidebar item both expose the same Share menu with current
  selection state, not a second invented permission model.
- Public sharing produces a real unguessable URL. Roamlog already has
  `ShareLink` token hashing and revocation; adapt the conversation share to
  that service instead of exposing a raw conversation UUID.
- Unknown/private/revoked tokens return 404; public read returns only messages,
  votes aggregate and artifacts that are safe to show. Never expose user email,
  device/session data, system prompts, provider secrets or internal run ids.
- Authenticated workspace behavior remains owner-scoped and unchanged.
- The mobile drawer/header and desktop header show the same visibility state.

**Acceptance:**

- Set private -> public -> private; refresh each time and assert persistence.
- Open the public URL in an unauthenticated browser context and read the chat.
- Revoke the link and assert 404; private chat still 404 with the public URL.
- Desktop 1440 and mobile 390 screenshots under `.audit/ai-port/visibility/`.
- Unit tests for token hashing/revocation, authorization and DTO parsing.

## Task 2: Artifact end-to-end completion

**Files:**

- Modify: `apps/web/components/ai/plan-card.tsx`
- Modify: `apps/web/components/ai/artifacts/**`
- Modify: `apps/api/src/modules/ai/ai-artifact.{controller,service}.ts`
- Modify: `apps/web/lib/api/ai-artifacts.ts`
- Modify only if required: `packages/contracts/src/api/ai.ts` and generated
  client/OpenAPI artifacts
- Create: artifact unit/API tests and Playwright spec
- Create report: `.audit/ai-port/artifact-complete-report.md`

**Upstream sources:**

- `components/chat/artifact.tsx:32-471`
- `components/chat/artifact-actions.tsx`
- `components/chat/artifact-close-button.tsx`
- `components/chat/document.tsx`
- `artifacts/text|code|sheet|image/client.tsx`
- `components/chat/create-artifact.tsx`
- `lib/ai/tools/create-document.ts`, `update-document.ts`,
  `edit-document.ts`, `request-suggestions.ts`
- `app/(chat)/api/document/route.ts`

**Required behavior:**

- Successful `artifacts.create` / `artifacts.update` execution opens the
  created/updated artifact panel automatically, matching upstream's
  `setArtifact` flow. A second artifact must replace the current one cleanly.
- Text/code/sheet save, version navigation, restore, diff and suggestions work
  against the real DB; image artifacts resolve the real media URL.
- Invalid version, stale edit, deleted artifact and model failure show
  actionable errors and leave the previous content visible.
- The artifact panel is usable on desktop and as a full-screen mobile panel.

**Acceptance:**

- Real browser: ask for a travel document, confirm execution, assert the panel
  opens, edit, wait for autosave, reload, assert content and version remain.
- Restore an older version and assert the new version is created.
- Trigger a suggestion and apply it; assert resolved state.
- At least one negative path (stale version or deleted artifact).
- Desktop 1440 + mobile 390 screenshots from the current code.

## Task 3: Chat UI parity audit and acceptance

**Files:**

- Create: `e2e/web/ai-chat-complete-parity.spec.ts`
- Create: `.audit/ai-port/chat-parity-report.md`
- Modify only: `apps/web/components/ai/multimodal-input.tsx`,
  `message-actions.tsx`, `message-editor.tsx`, `message.tsx`,
  `model-selector.tsx`, `use-auto-resume.ts`
- Do not modify `ai-chat.tsx`, `thread.tsx`, `thread-list.tsx`,
  `plan-card.tsx`, `artifacts/**`, or conversation/artifact API files owned by
  Tasks 1 and 2.

**Upstream sources:**

- `components/chat/multimodal-input.tsx:73-960`
- `components/chat/message-actions.tsx:14-199`
- `components/chat/message-editor.tsx:1-30`
- `components/chat/messages.tsx:27-155`
- `hooks/use-auto-resume.ts:15-43`
- `components/ai-elements/model-selector.tsx:21-213`
- `components/chat/suggested-actions.tsx:1-104`

**Required coverage:**

- Empty/loading/error/ready states.
- Suggested action, slash command, attachment add/preview/remove, stop.
- Message copy/edit (tail truncation + regenerate), vote persistence, reload.
- Model search/grouping/selection persistence and reasoning control.
- Refresh during a live run resumes without duplicate text.
- Keyboard focus and mobile composer behavior.

**Acceptance:**

- Tests use real web + API + database + login state, no mock data as acceptance.
- Desktop 1440 + mobile 390 evidence, stored under `.audit/ai-port/chat-parity/`.
- Any production bug found is fixed in this task only if it belongs to the
  allowed files; otherwise report it to the root with a reproduction.

## Task 4: Root integration gate

- Compare each delivery to the pinned upstream source and reject missing
  functionality.
- Run:
  - `pnpm --filter @roamlog/web lint`
  - `pnpm --filter @roamlog/web typecheck`
  - `pnpm --filter @roamlog/api typecheck`
  - `pnpm --filter @roamlog/contracts test`
  - `pnpm contracts:check`
  - focused Vitest suites
  - Playwright AI specs on staging/real stack
- Run `codegraph sync && codegraph status` after all edits.
- Review screenshots and one or two upstream line ranges manually.
- Commit only after acceptance. Do not deploy production without a fresh
  release gate and the user's explicit go-ahead.

## Definition of done

No item is DONE based on unit tests alone. DONE means:

- upstream source mapping is present;
- real UI interaction and persistence are visible in a browser;
- error, empty, loading, permission and refresh states are covered;
- no secrets or private data leak through public shares;
- TypeScript, lint, contracts, builds and Release Gate are green;
- root has personally checked the evidence.
