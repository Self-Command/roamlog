import { describe, expect, it, vi } from "vitest";

import { SanitizeService } from "../src/common/services/sanitize.service.js";
import { PermissionService } from "../src/common/services/permission.service.js";
import { EntriesService } from "../src/modules/entries/entries.service.js";
import { makeActor } from "./identity-fixtures.js";
import { USER_EDITOR_ID } from "./identity-fixtures.js";
import {
  ENTRY_ID,
  REVISION_ID,
  TRIP_A_ID,
  entryRecord,
  fakeActivities,
  fakeTransaction,
  membership,
  revisionRecord,
  tripRecord,
} from "./content-fixtures.js";

const MALICIOUS_HTML = [
  '<h2>Notes</h2>',
  '<p><strong>Bold</strong> and <a href="https://example.com">safe</a></p>',
  '<img src="x" onerror="alert(1)">',
  "<script>alert('script')</script>",
  '<a href="javascript:alert(1)">bad link</a>',
  '<iframe src="https://evil.example"></iframe>',
  "<style>body{display:none}</style>",
].join("");

function setupEntries() {
  const repository = {
    transaction: vi.fn(),
    listEntries: vi.fn(),
    findEntry: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    setFavorite: vi.fn(),
    softDeleteEntry: vi.fn(),
    createRevision: vi.fn(),
    listRevisions: vi.fn(),
    findRevision: vi.fn(),
    trimRevisions: vi.fn().mockResolvedValue(0),
  };
  const trips = { findTrip: vi.fn() };
  const activities = fakeActivities();
  const sanitizer = new SanitizeService();
  const service = new EntriesService(
    repository as never,
    trips as never,
    new PermissionService(),
    activities as never,
    sanitizer,
  );
  return { repository, trips, activities, sanitizer, service };
}

describe("SanitizeService", () => {
  it("removes executable markup while preserving safe Tiptap formatting", () => {
    const sanitizer = new SanitizeService();
    const output = sanitizer.sanitizeHtml(MALICIOUS_HTML);

    expect(output).toContain("<h2>Notes</h2>");
    expect(output).toContain("<strong>Bold</strong>");
    expect(output).toContain('href="https://example.com"');
    expect(output).toContain('rel="noopener noreferrer"');
    expect(output).not.toMatch(/<img|onerror|script|javascript:|iframe|<style/i);
    expect(output).not.toContain("display:none");
  });

  it("drops unsafe URL schemes and all event/style attributes", () => {
    const sanitizer = new SanitizeService();
    const output = sanitizer.sanitizeHtml(
      '<a href="javascript:alert(1)" onclick="alert(2)" style="color:red">x</a>' +
        '<p onmouseover="alert(3)">body</p>',
    );

    expect(output).not.toMatch(/javascript:|onclick|onmouseover|style=/i);
    expect(output).toContain(">x</a>");
    expect(output).toContain("<p>body</p>");
  });
});

describe("EntriesService XSS persistence paths", () => {
  it("sanitizes contentHtml before create persists it, while leaving contentJson untouched", async () => {
    const { repository, trips, service } = setupEntries();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.createEntry.mockImplementation(
      async (_tx: unknown, data: { contentHtml: string }) =>
        entryRecord({ contentHtml: data.contentHtml }),
    );
    repository.createRevision.mockResolvedValue(revisionRecord());
    const contentJson = { type: "doc", malicious: "<script>alert(1)</script>" };

    const created = await service.create(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      TRIP_A_ID,
      {
        title: "Sanitized entry",
        date: "2026-11-10",
        location: "Seoul",
        contentJson,
        contentHtml: MALICIOUS_HTML,
      },
    );

    expect(created.contentHtml).not.toMatch(/<img|onerror|script|javascript:|iframe|<style/i);
    expect(created.contentHtml).toContain("<strong>Bold</strong>");
    expect(repository.createEntry).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        contentHtml: expect.not.stringMatching(/<img|onerror|script|javascript:|iframe|<style/i),
        contentJson,
      }),
    );
    expect(repository.createRevision).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        contentHtml: expect.not.stringMatching(/<img|onerror|script|javascript:|iframe|<style/i),
      }),
    );
  });

  it("sanitizes contentHtml before update and returns sanitized HTML", async () => {
    const { repository, trips, service } = setupEntries();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.findEntry
      .mockResolvedValueOnce(entryRecord({ version: 1 }))
      .mockResolvedValueOnce(entryRecord({ version: 2, contentHtml: MALICIOUS_HTML }));
    repository.updateEntry.mockResolvedValue(1);
    repository.createRevision.mockResolvedValue(revisionRecord({ version: 2 }));

    const updated = await service.update(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
      {
        version: 1,
        contentHtml: MALICIOUS_HTML,
      },
    );

    expect(updated.contentHtml).not.toMatch(/<img|onerror|script|javascript:|iframe|<style/i);
    expect(repository.updateEntry).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        data: expect.objectContaining({
          contentHtml: expect.not.stringMatching(/<img|onerror|script|javascript:|iframe|<style/i),
        }),
      }),
    );
  });

  it("sanitizes legacy revision HTML before restore persists it", async () => {
    const { repository, trips, service } = setupEntries();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.findEntry
      .mockResolvedValueOnce(entryRecord({ version: 3 }))
      .mockResolvedValueOnce(entryRecord({ version: 4, contentHtml: MALICIOUS_HTML }));
    repository.findRevision.mockResolvedValue(
      revisionRecord({ version: 1, contentHtml: MALICIOUS_HTML }),
    );
    repository.updateEntry.mockResolvedValue(1);
    repository.createRevision.mockResolvedValue(revisionRecord({ version: 4 }));

    const restored = await service.restore(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
      REVISION_ID,
    );

    expect(restored.contentHtml).not.toMatch(/<img|onerror|script|javascript:|iframe|<style/i);
    expect(repository.updateEntry).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        data: expect.objectContaining({
          contentHtml: expect.not.stringMatching(/<img|onerror|script|javascript:|iframe|<style/i),
        }),
      }),
    );
  });

  it("sanitizes entry responses even when a legacy row still contains unsafe HTML", async () => {
    const { repository, trips, service } = setupEntries();
    repository.findEntry.mockResolvedValue(entryRecord({ contentHtml: MALICIOUS_HTML }));
    trips.findTrip.mockResolvedValue(tripRecord());

    const entry = await service.get(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
    );

    expect(entry.contentHtml).not.toMatch(/<img|onerror|script|javascript:|iframe|<style/i);
    expect(entry.contentHtml).toContain("<p><strong>Bold</strong>");
  });
});
