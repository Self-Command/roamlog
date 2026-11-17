# @roamlog/emails

Transactional React Email templates for Roamlog Wave 0:

- `workspace-invite`
- `verify-email`
- `reset-password`
- `mention`
- `trip-reminder`

Each template has a rendered plain-text fallback through
`renderEmailTemplate()`. Templates are intentionally static and never inject
user-provided HTML. The production provider is Resend; local verification uses
Mailpit's HTTP send API from the email smoke command.

```bash
docker compose -f docker/compose.yml up -d mailpit
pnpm --filter @roamlog/emails email:smoke
```

Mailpit is available at `http://localhost:8025`; its liveness endpoint is
`http://localhost:8025/livez`.

```ts
import { renderEmailTemplate } from "@roamlog/emails";

const { subject, html, text } = await renderEmailTemplate("workspace-invite", {
  workspaceName: "North Star Studio",
  inviterName: "Mei",
  role: "editor",
  inviteUrl: "https://app.roamlog.app/invite/example",
  expiresInDays: 7,
});
```
