import { describe, expect, it } from "vitest";

import {
  AdminMediaSchema,
  CommentSchema,
  JournalEntrySchema,
  TripSchema,
} from "@roamlog/contracts";
import { makeEntry, makeMedia, makeTrip } from "@roamlog/db/factories";

import { presentComment, presentMedia as presentAdminMedia } from "../../admin/admin.presenters.js";
import { presentEntry, presentTrip } from "../../trips/content-presenters.js";

/**
 * Regression guard for the shared-table column problem that produced a 500 on
 * `GET /v1/trips/{id}`: presenters used to spread the whole Prisma row into a
 * `.strict()` contract, so any operator-only column (`moderatedAt`, and every
 * future column) failed validation. Presenters must now construct output
 * explicitly and ignore columns the contract does not declare.
 */
describe("presenters ignore undeclared database columns", () => {
  it("trip: keeps moderatedAt, drops an unknown future column", () => {
    const record = {
      ...makeTrip(),
      moderatedAt: new Date("2026-11-19T08:00:00.000Z"),
      moderatedById: "01942f30-1200-7000-8000-000000000999",
      someFutureColumn: "x",
    };

    const presented = presentTrip(record as never);

    expect(() => TripSchema.parse(presented)).not.toThrow();
    expect(presented.moderatedAt).toBe("2026-11-19T08:00:00.000Z");
    expect(presented).not.toHaveProperty("someFutureColumn");
  });

  it("entry: keeps moderatedAt and ignores unknown columns", () => {
    const record = {
      ...makeEntry(),
      moderatedAt: new Date("2026-11-19T08:00:00.000Z"),
      someFutureColumn: "x",
    };

    const presented = presentEntry(record as never);

    expect(() => JournalEntrySchema.parse(presented)).not.toThrow();
    expect(presented.moderatedAt).toBe("2026-11-19T08:00:00.000Z");
    expect(presented).not.toHaveProperty("someFutureColumn");
  });

  it("comment: keeps moderation state for the admin queue", () => {
    const record = {
      id: "01942f30-1200-7000-8000-000000000911",
      workspaceId: "01942f30-1200-7000-8000-000000000912",
      tripId: "01942f30-1200-7000-8000-000000000913",
      targetType: "journal_entry",
      targetId: "01942f30-1200-7000-8000-000000000913",
      parentId: null,
      authorId: "01942f30-1200-7000-8000-000000000914",
      body: "hello",
      resolvedAt: null,
      resolvedById: null,
      createdAt: new Date("2026-11-19T08:00:00.000Z"),
      updatedAt: new Date("2026-11-19T08:00:00.000Z"),
      deletedAt: null,
      moderatedAt: new Date("2026-11-19T08:00:00.000Z"),
      moderatedById: "01942f30-1200-7000-8000-000000000999",
      someFutureColumn: "x",
    };

    const presented = presentComment(record as never);

    expect(() => CommentSchema.parse(presented)).not.toThrow();
    expect(presented.moderatedAt).toBe("2026-11-19T08:00:00.000Z");
    expect(presented).not.toHaveProperty("someFutureColumn");
  });

  it("media: keeps moderation state and ignores unknown columns", () => {
    const record = {
      ...makeMedia(),
      moderatedAt: new Date("2026-11-19T08:00:00.000Z"),
      someFutureColumn: "x",
    };

    const presented = presentAdminMedia(record as never, {
      thumb: {
        key: "workspace/entry/thumb.webp",
        url: "https://media.spacedo.org/roamlog/workspace/entry/thumb.webp?X-Amz-Signature=test",
        expiresAt: "2026-11-19T08:15:00.000Z",
      },
    });

    expect(() => AdminMediaSchema.parse(presented)).not.toThrow();
    expect(presented.moderatedAt).toBe("2026-11-19T08:00:00.000Z");
    expect(presented.originalFileName).toBe(record.originalFileName);
    expect(presented).not.toHaveProperty("someFutureColumn");
    expect(presented.variants.thumb).toMatchObject({
      url: "https://media.spacedo.org/roamlog/workspace/entry/thumb.webp?X-Amz-Signature=test",
    });
  });
});
