import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../src/common/services/permission.service.js";
import type {
  EntryCreateData,
  EntryUpdateData,
  RevisionCreateData,
} from "../src/modules/entries/entries.repository.js";
import { EntriesService } from "../src/modules/entries/entries.service.js";
import { makeActor } from "./identity-fixtures.js";
import {
  USER_EDITOR_ID,
  USER_VIEWER_ID,
  WORKSPACE_A_ID,
} from "./identity-fixtures.js";
import {
  ENTRY_ID,
  MEDIA_ID,
  REVISION_ID,
  TRIP_A_ID,
  fakeActivities,
  fakeTransaction,
  entryRecord,
  membership,
  revisionRecord,
  tripRecord,
} from "./content-fixtures.js";

const SECOND_MEDIA_ID = "01942f30-1200-7000-8000-000000000702";
const SECOND_REVISION_ID = "01942f30-1200-7000-8000-000000000506";

const LAYOUT_HTML = [
  '<figure data-type="image" data-align="right">',
  '<a href="https://example.com/album" target="_blank" rel="opener">',
  '<img src="https://media.example.test/hero.jpg" alt="Hero" width="1200" height="800" ',
  `data-media-id="${MEDIA_ID}">`,
  "</a>",
  "<figcaption>Morning light</figcaption>",
  "</figure>",
  '<div data-type="gallery" data-columns="2">',
  '<figure data-type="gallery-item">',
  '<img src="https://media.example.test/gallery-one.jpg" alt="Gallery one" ',
  `data-media-id="${MEDIA_ID}">`,
  "<figcaption>First frame</figcaption>",
  "</figure>",
  '<figure data-type="gallery-item">',
  '<img src="https://media.example.test/gallery-two.jpg" alt="Gallery two" ',
  `data-media-id="${SECOND_MEDIA_ID}">`,
  "<figcaption>Second frame</figcaption>",
  "</figure>",
  "</div>",
  '<div data-type="columns" data-columns="2">',
  '<div data-type="column" data-column-index="0"><p>Left column</p></div>',
  '<div data-type="column" data-column-index="1"><p>Right column</p></div>',
  "</div>",
].join("");

const UPDATED_LAYOUT_HTML = LAYOUT_HTML.replace("First frame", "Updated frame");

const LEGACY_HTML = [
  "<p>Old trip note</p>",
  '<img src="https://legacy.example.test/old-photo.jpg" alt="Old photo">',
  "<table><thead><tr><th>Stop</th></tr></thead><tbody><tr><td>Seoul</td></tr></tbody></table>",
].join("");

function expectLayoutHtml(html: string): void {
  expect(html).toContain('<figure data-type="image"');
  expect(html).toContain('data-align="right"');
  expect(html).toContain('data-type="gallery"');
  expect(html).toContain('data-columns="2"');
  expect(html).toContain('data-type="gallery-item"');
  expect(html.match(/data-type="gallery-item"/g)).toHaveLength(2);
  expect(html).toContain("<figcaption>Morning light</figcaption>");
  expect(html).toContain('href="https://example.com/album"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).not.toContain('rel="opener"');
  expect(html).toContain('data-type="columns"');
  expect(html).toContain('data-type="column"');
  expect(html).toContain('data-column-index="0"');
  expect(html).toContain('data-column-index="1"');
  expect(html).toContain("Left column");
  expect(html).toContain("Right column");
  expect(html).toContain(`data-media-id="${MEDIA_ID}"`);
  expect(html).toContain(`data-media-id="${SECOND_MEDIA_ID}"`);
  expect(html).not.toContain("&lt;figure");
}

function setupRoundtrip() {
  const tx = {};
  let currentVersion = 1;
  let revisionNumber = 0;
  let stored = entryRecord({ contentHtml: "" });
  const revisions: Array<ReturnType<typeof revisionRecord>> = [];
  const repository = {
    transaction: vi.fn(async (callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    listEntries: vi.fn(),
    findEntry: vi.fn(async () => stored),
    createEntry: vi.fn(async (_tx: unknown, data: EntryCreateData) => {
      currentVersion = 1;
      stored = entryRecord({ ...data, id: ENTRY_ID, version: currentVersion });
      return stored;
    }),
    updateEntry: vi.fn(
      async (
        _tx: unknown,
        args: { workspaceId: string; entryId: string; version: number; data: EntryUpdateData },
      ) => {
        if (args.version !== currentVersion) return 0;
        currentVersion += 1;
        stored = entryRecord({ ...stored, ...args.data, version: currentVersion });
        return 1;
      },
    ),
    setFavorite: vi.fn(),
    softDeleteEntry: vi.fn(),
    createRevision: vi.fn(async (_tx: unknown, data: RevisionCreateData) => {
      revisionNumber += 1;
      const revision = revisionRecord({
        ...data,
        id: revisionNumber === 1 ? REVISION_ID : SECOND_REVISION_ID,
      });
      revisions.unshift(revision);
      return revision;
    }),
    listRevisions: vi.fn(async () => revisions),
    findRevision: vi.fn(
      async (_workspaceId: string, _entryId: string, revisionId: string) =>
        revisions.find((revision) => revision.id === revisionId) ?? null,
    ),
    trimRevisions: vi.fn(async () => 0),
  };
  const trips = { findTrip: vi.fn().mockResolvedValue(tripRecord()) };
  const activities = fakeActivities();
  const service = new EntriesService(
    repository as never,
    trips as never,
    new PermissionService(),
    activities as never,
  );
  return { repository, trips, service, revisions };
}

function setup() {
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
    trimRevisions: vi.fn(),
  };
  const trips = {
    findTrip: vi.fn(),
  };
  const activities = fakeActivities();
  const service = new EntriesService(
    repository as never,
    trips as never,
    new PermissionService(),
    activities as never,
  );
  return { repository, trips, activities, service };
}

describe("EntriesService", () => {
  it("creates an initial revision and activity in the entry transaction", async () => {
    const { repository, trips, activities, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.createEntry.mockResolvedValue(entryRecord({ version: 1 }));
    repository.createRevision.mockResolvedValue(revisionRecord());

    const created = await service.create(makeActor(USER_EDITOR_ID), membership("editor"), TRIP_A_ID, {
      title: "First night in Euljiro",
      date: "2026-11-10",
      location: "Euljiro, Seoul",
      contentJson: { type: "doc", content: [] },
      contentHtml: "<p>Soju and warm noodles.</p>",
    });

    expect(created).toMatchObject({ id: ENTRY_ID, version: 1 });
    expect(repository.createRevision).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ entryId: ENTRY_ID, version: 1, editedById: USER_EDITOR_ID }),
    );
    expect(activities.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ verb: "entry.created", entityId: ENTRY_ID }),
    );
  });

  it("round-trips image, gallery and columns through create, read, update and read", async () => {
    const { service, revisions } = setupRoundtrip();

    const created = await service.create(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      TRIP_A_ID,
      {
        title: "Layout roundtrip",
        date: "2026-11-10",
        location: "Seoul",
        contentJson: { type: "doc", content: [] },
        contentHtml: LAYOUT_HTML,
      },
    );

    expectLayoutHtml(created.contentHtml);
    expect(created.contentHtml).not.toContain("&lt;div");

    const readAfterCreate = await service.get(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
    );
    expect(readAfterCreate.contentHtml).toBe(created.contentHtml);
    expectLayoutHtml(readAfterCreate.contentHtml);

    const updated = await service.update(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
      {
        version: created.version,
        contentHtml: UPDATED_LAYOUT_HTML,
      },
    );

    expect(updated.version).toBe(2);
    expect(updated.contentHtml).toContain("Updated frame");
    expect(updated.contentHtml).not.toContain("First frame");
    expectLayoutHtml(updated.contentHtml);

    const readAfterUpdate = await service.get(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
    );
    expect(readAfterUpdate.contentHtml).toBe(updated.contentHtml);
    expectLayoutHtml(readAfterUpdate.contentHtml);
    expect(revisions).toHaveLength(2);
    expect(revisions.every((revision) => revision.contentHtml.includes("<figure"))).toBe(true);
  });

  it("keeps layout when listing and restoring a revision", async () => {
    const { service, revisions } = setupRoundtrip();

    await service.create(makeActor(USER_EDITOR_ID), membership("editor"), TRIP_A_ID, {
      title: "Revision layout",
      date: "2026-11-10",
      location: "Seoul",
      contentJson: { type: "doc", content: [] },
      contentHtml: LAYOUT_HTML,
    });
    await service.update(makeActor(USER_EDITOR_ID), membership("editor"), ENTRY_ID, {
      version: 1,
      contentHtml: UPDATED_LAYOUT_HTML,
    });

    const listed = await service.listRevisions(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
    );
    expect(listed).toHaveLength(2);
    expect(listed.map((revision) => revision.version).sort()).toEqual([1, 2]);
    for (const revision of listed) {
      expectLayoutHtml(revision.contentHtml);
    }

    const original = revisions.find((revision) => revision.version === 1);
    expect(original).toBeDefined();
    const restored = await service.restore(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
      original!.id,
    );

    expect(restored.version).toBe(3);
    expect(restored.contentHtml).toContain("First frame");
    expect(restored.contentHtml).not.toContain("Updated frame");
    expectLayoutHtml(restored.contentHtml);
  });

  it("keeps legacy images, paragraphs and tables through create", async () => {
    const { service } = setupRoundtrip();

    const created = await service.create(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      TRIP_A_ID,
      {
        title: "Legacy content",
        date: "2026-11-10",
        location: "Seoul",
        contentJson: { type: "doc", content: [] },
        contentHtml: LEGACY_HTML,
      },
    );

    expect(created.contentHtml).toContain("<p>Old trip note</p>");
    expect(created.contentHtml).toContain(
      'src="https://legacy.example.test/old-photo.jpg"',
    );
    expect(created.contentHtml).toContain("<table>");
    expect(created.contentHtml).toContain("<thead>");
    expect(created.contentHtml).toContain("<td>Seoul</td>");
  });

  it("rejects entries outside the trip date range", async () => {
    const { repository, trips, service } = setup();
    trips.findTrip.mockResolvedValue(tripRecord());

    await expect(
      service.create(makeActor(), membership("editor"), TRIP_A_ID, {
        title: "Too late",
        date: "2026-12-01",
        location: "Seoul",
        contentJson: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it("returns 409 with the current entry for a stale save", async () => {
    const { repository, trips, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.findEntry
      .mockResolvedValueOnce(entryRecord({ version: 1 }))
      .mockResolvedValueOnce(entryRecord({ version: 2, title: "Newer draft" }));
    repository.updateEntry.mockResolvedValue(0);

    await expect(
      service.update(makeActor(), membership("editor"), ENTRY_ID, {
        version: 1,
        title: "Stale draft",
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: "VERSION_CONFLICT",
        current: expect.objectContaining({ id: ENTRY_ID, version: 2 }),
      },
    });
  });

  it("creates a revision after every successful save and trims to the latest 50", async () => {
    const { repository, trips, activities, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.findEntry
      .mockResolvedValueOnce(entryRecord({ version: 1 }))
      .mockResolvedValueOnce(entryRecord({ version: 2, title: "Better title" }));
    repository.updateEntry.mockResolvedValue(1);
    repository.createRevision.mockResolvedValue(revisionRecord({ version: 2 }));
    repository.trimRevisions.mockResolvedValue(2);

    const saved = await service.update(makeActor(USER_EDITOR_ID), membership("editor"), ENTRY_ID, {
      version: 1,
      title: "Better title",
    });

    expect(saved).toMatchObject({ id: ENTRY_ID, version: 2 });
    expect(repository.createRevision).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        entryId: ENTRY_ID,
        workspaceId: WORKSPACE_A_ID,
        version: 2,
        editedById: USER_EDITOR_ID,
      }),
    );
    expect(repository.trimRevisions).toHaveBeenCalledWith(tx, ENTRY_ID, WORKSPACE_A_ID, 50);
    expect(activities.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ verb: "entry.updated", entityId: ENTRY_ID }),
    );
  });

  it("restores a revision as a new version without reusing its version number", async () => {
    const { repository, trips, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.findEntry.mockResolvedValue(entryRecord({ version: 4 }));
    repository.findRevision.mockResolvedValue(revisionRecord({ version: 2 }));
    repository.updateEntry.mockResolvedValue(1);
    repository.findEntry
      .mockResolvedValueOnce(entryRecord({ version: 4 }))
      .mockResolvedValueOnce(entryRecord({ version: 5, title: "First night in Euljiro" }));
    repository.createRevision.mockResolvedValue(revisionRecord({ version: 5 }));

    const restored = await service.restore(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
      REVISION_ID,
    );

    expect(restored).toMatchObject({ id: ENTRY_ID, version: 5 });
    expect(repository.updateEntry).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        version: 4,
        data: expect.objectContaining({
          title: "First night in Euljiro",
          contentHtml: "<p>Old copy.</p>",
        }),
      }),
    );
    expect(repository.createRevision).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ version: 5, title: "First night in Euljiro" }),
    );
  });

  it("allows a Viewer to read an entry but rejects favorite mutation", async () => {
    const { repository, service } = setup();
    repository.findEntry.mockResolvedValue(entryRecord());

    await expect(
      service.favorite(
        makeActor(USER_VIEWER_ID),
        membership("viewer"),
        ENTRY_ID,
        { favorite: true },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(repository.setFavorite).not.toHaveBeenCalled();
  });

  it("returns 404 when a valid entry UUID belongs to another Workspace", async () => {
    const { repository, service } = setup();
    repository.findEntry.mockResolvedValue(null);

    await expect(
      service.get(makeActor(), membership("owner"), ENTRY_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findEntry).toHaveBeenCalledWith(WORKSPACE_A_ID, ENTRY_ID);
  });

  it("publishes activity as part of a favorite transaction", async () => {
    const { repository, trips, activities, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    repository.findEntry.mockResolvedValue(entryRecord());
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.setFavorite.mockResolvedValue(entryRecord({ favorite: true, version: 2 }));

    const result = await service.favorite(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
      { favorite: true },
    );

    expect(result.favorite).toBe(true);
    expect(activities.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        verb: "entry.favorited",
        entityId: ENTRY_ID,
        metadata: expect.objectContaining({ favorite: true }),
      }),
    );
  });
});
