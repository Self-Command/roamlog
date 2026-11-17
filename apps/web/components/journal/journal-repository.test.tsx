import { demoEntries, demoUser } from "@roamlog/api-mocks/fixtures";
import type { JournalEntry } from "@roamlog/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createMockJournalRepository,
  mergeMockJournalEntries,
  resetMockJournalOverrides,
} from "./journal-repository";

const baseEntry = demoEntries[0] as JournalEntry;

function repository() {
  return createMockJournalRepository({
    resolveEntry: (entryId) => (entryId === baseEntry.id ? baseEntry : undefined),
    currentUserId: demoUser.id,
    workspaceId: baseEntry.workspaceId,
    tripId: baseEntry.tripId,
    location: baseEntry.location,
  });
}

beforeEach(() => {
  resetMockJournalOverrides();
});

describe("mock journal repository", () => {
  it("creates a schema-valid entry visible through the override merge", async () => {
    const created = await repository().createEntry(baseEntry.tripId, {
      title: "本地演示新日志",
      date: "2026-11-17",
      location: "京都 · 演示路",
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      contentHtml: "<p></p>",
      excerpt: "",
    });

    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(created.version).toBe(1);
    expect(mergeMockJournalEntries([baseEntry]).map((entry) => entry.id)).toContain(created.id);
  });

  it("increments versions, records revisions, rejects stale saves, and restores snapshots", async () => {
    const repo = repository();
    const saved = await repo.saveEntry(
      baseEntry.id,
      {
        title: "更新后的标题",
        date: baseEntry.date,
        location: baseEntry.location,
        contentJson: { type: "doc", content: [{ type: "paragraph" }] },
        contentHtml: "<p>更新后的正文</p>",
        excerpt: "更新后的正文",
      },
      baseEntry.version,
    );

    expect(saved.version).toBe(baseEntry.version + 1);
    const revisions = await repo.listRevisions(baseEntry.id);
    expect(revisions[0]?.version).toBe(saved.version);

    await expect(
      repo.saveEntry(
        baseEntry.id,
        {
          title: "过期保存",
          date: baseEntry.date,
          location: baseEntry.location,
          contentJson: { type: "doc", content: [{ type: "paragraph" }] },
          contentHtml: "<p>过期保存</p>",
          excerpt: "过期保存",
        },
        baseEntry.version,
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    const restored = await repo.restoreRevision(baseEntry.id, revisions[0]!.id);
    expect(restored.version).toBe(saved.version + 1);
    expect(restored.title).toBe("更新后的标题");
  });
});
