# Moderation and reports

Status: implemented for API + Admin console. Members can report four content
kinds; platform admins work a queue and record one decision per report. The
model separates **author deletion** (`deletedAt`) from **admin takedown**
(`moderatedAt`) and only reverses the latter.

Related files:

- `packages/contracts/src/api/reports.ts` — target types, reasons, statuses,
  moderation actions and error codes
- `apps/api/src/modules/reports/reports.service.ts` — member report endpoint
- `apps/api/src/modules/reports/admin-reports.service.ts` — queue, detail, resolve
- `apps/api/src/modules/reports/report-targets.ts` — snapshots, visibility,
  `applyModerationToTarget`
- `packages/db/prisma/schema.prisma` — `Report`, `ModerationAction`

## 1. What can be reported

`ReportTargetType` is one of:

| `targetType` | Reported row | Visible to a reporter when |
| --- | --- | --- |
| `trip` | `Trip` | same workspace, not `deletedAt`, not `moderatedAt`, and not somebody else's `private` trip |
| `entry` | `JournalEntry` | same workspace and its trip is visible under the rule above |
| `comment` | `Comment` | same workspace and its trip is visible under the rule above |
| `media` | `Media` | same workspace, `deletedAt = null`, `moderatedAt = null` |

Reasons: `spam`, `harassment`, `private_info`, `illegal`, `other`; an optional
`detail` (1–1000 chars). A missing **and** a forbidden target both answer 404
`REPORT_TARGET_NOT_FOUND`, so the endpoint cannot be used to probe for private
content.

## 2. Member endpoint

```http
POST /v1/workspaces/:workspaceId/reports
{ "targetType": "entry", "targetId": "<uuid>", "reason": "spam", "detail": "..." }
```

- `201 { id, status: "open", createdAt }`.
- Duplicate report by the same user for the same target → `409 REPORT_DUPLICATE`.
- `POST /v1/admin/reports/:id/resolve` is the only place a decision is made.

**Report rate limit.** At most **10 reports per user per rolling hour**
(`REPORT_HOURLY_LIMIT`), computed as `report.count({ reporterId, createdAt >= now-1h })`
*then* `report.create`. This is a **DB read-then-write, not atomic**: parallel
requests from one user can overshoot the cap by a few rows. It is abuse
friction, not a security boundary; the duplicate check has the same race, so a
unique constraint (not present today) is the only hard guarantee.

## 3. Admin queue and decisions

- `GET /v1/admin/reports` — cursor page; filters by `status`, `targetType`,
  `workspaceId`; each item carries a target snapshot (`title`, author,
  workspace, `deletedAt`, `moderatedAt`), the **number of reports for the
  target** and `lastReportedAt`.
- `GET /v1/admin/reports/:id` — the report, every sibling report for the same
  target, and the `ModerationAction` history for this report.
- A target that was hard-deleted later keeps its queue entry: the snapshot is
  replaced by `内容已删除` / unknown author, `reportCount` still counts.
- Audit metadata deliberately excludes the reported content; only ids and the
  action are recorded (`admin.report.resolved`).

`POST /v1/admin/reports/:id/resolve`

```json
{ "action": "remove" | "restore" | "warn" | "dismiss", "note": "optional, ≤ 500" }
```

| Action | Target effect | Report status |
| --- | --- | --- |
| `dismiss` | none | `dismissed` |
| `warn` | **none** — records the decision only (no message is sent to the author yet) | `resolved` |
| `remove` | `deletedAt = now`, `moderatedAt = now`, `moderatedById = actor` | `resolved` |
| `restore` | `deletedAt = null`, `moderatedAt = null`, `moderatedById = null` — **only where `moderatedAt` is not null** | `resolved` |

- Re-resolving a `resolved`/`dismissed` report → `409 REPORT_ALREADY_RESOLVED`.
- Capability mapping: `restore` requires `admin:content:restore`; `remove`,
  `warn` and `dismiss` require `admin:content:delete` (the action set predates
  moderation and has no separate “warn” verb).
- Every resolve writes a `ModerationAction` row and an audit entry in the same
  transaction as the target update.

## 4. `moderatedAt` vs `deletedAt`

- `deletedAt` is the **author's own soft delete** (and the shared visibility
  filter used by every read path).
- `moderatedAt` / `moderatedById` is the **admin takedown marker**. It lets the
  queue and the content screens say “removed by moderation” instead of “author
  deleted it”, and lets `restore` act only on moderated rows.

Consequences:

- A takedown still hides content through `deletedAt`, so all existing queries
  keep working.
- `restore` on author-deleted content is a no-op by construction
  (`moderatedAt` is null), and is reported as a successful resolve with an
  unchanged target.

## 5. Known limitation: `restore` cannot distinguish “author had already deleted”

`remove` overwrites `deletedAt` with the moderation timestamp, and there is no
second field storing the previous `deletedAt`. If an author deletes a row after
it was moderated (or the row was already author-deleted when an admin still
removes it), `restore` unconditionally clears `deletedAt` and the content
becomes visible again. The queue does not surface “author deleted this before
moderation”.

Operational rule: before pressing `restore`, check the target's own history /
activity feed for an author deletion, and prefer leaving the row hidden when in
doubt. Fixing this properly needs a `deletedBeforeModeration` flag or an audit
lookup; it is not implemented.

## 6. Verify it works

```bash
# 1. as a member, report an entry
curl -s -X POST "$API/v1/workspaces/$WS/reports" -H "authorization: Bearer $MEMBER" \
  -H 'content-type: application/json' \
  -d '{"targetType":"entry","targetId":"'$ENTRY'","reason":"spam"}'

# 2. as super_admin, list and inspect
curl -s "$API/v1/admin/reports?status=open" -H "authorization: Bearer $ADMIN"
curl -s "$API/v1/admin/reports/$REPORT" -H "authorization: Bearer $ADMIN"

# 3. remove, then confirm the entry disappeared from member reads
curl -s -X POST "$API/v1/admin/reports/$REPORT/resolve" -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"action":"remove","note":"policy"}'
curl -s -o /dev/null -w '%{http_code}\n' "$API/v1/workspaces/$WS/entries/$ENTRY" \
  -H "authorization: Bearer $MEMBER"        # expect 404

# 4. restore, then confirm it is back
curl -s -X POST "$API/v1/admin/reports/$REPORT/resolve" ... -d '{"action":"restore"}'
```

`psql`: `select id, "deletedAt", "moderatedAt", "moderatedById" from "Media"
where id='...'` (or `Trip`/`JournalEntry`/`Comment`) shows the two markers.

## 7. Troubleshooting

| Symptom | Check |
| --- | --- |
| Member gets 404 when reporting | target not in the same workspace, `private` trip not owned by them, already author-deleted or moderated |
| `409 REPORT_DUPLICATE` | same user already reported this exact target (any status) |
| `429 RATE_LIMITED` | more than 10 reports in the last hour by that user |
| Report missing from the queue | filter by `status`/`targetType`; page cursor; hard-deleted target still appears with a placeholder |
| `restore` “succeeded” but content stays hidden | target was author-deleted (`moderatedAt` null); this is intentional |
| `restore` brought back content unexpectedly | the limitation in §5; check for a prior author delete |
| Admin gets 403 | expired session, missing platform role, or the action-specific capability (`admin:content:read` / `delete` / `restore`) |

## 8. Known limits

- `warn` sends no email/in-app message; it is only a recorded decision.
- One decision per report; a target with several reports needs one decision per
  report (the others stay open until resolved).
- No bulk actions, no appeals workflow, no reporter notification.
- Rate limiting is the non-atomic DB count described in §2.
- The queue snapshot is read at request time; it can lag a concurrent delete.