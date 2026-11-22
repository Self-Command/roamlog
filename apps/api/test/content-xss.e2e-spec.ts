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
  "<h2>Notes</h2>",
  '<p><strong>Bold</strong> and <a href="https://example.com" target="_blank" rel="opener">safe</a></p>',
  '<a href="https://example.com/self" target="_self">same window</a>',
  '<img src="x" onerror="alert(1)">',
  "<script>alert('script')</script>",
  '<a href="javascript:alert(1)">bad link</a>',
  '<iframe src="https://evil.example"></iframe>',
  "<style>body{display:none}</style>",
].join("");

const LAYOUT_MEDIA_ID = "01942f30-1200-7000-8000-000000000701";
const LAYOUT_MEDIA_ID_TWO = "01942f30-1200-7000-8000-000000000702";

function contentJsonWithLink(href: string, target = "_blank") {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "linked text",
            marks: [
              {
                type: "link",
                attrs: { href, target, rel: "opener", class: "external" },
              },
            ],
          },
        ],
      },
    ],
  };
}

function expectSafeContentJson(contentJson: unknown): void {
  const serialized = JSON.stringify(contentJson);
  expect(serialized).toContain("linked text");
  expect(serialized).not.toMatch(
    /javascript:|data:text|vbscript:|\/\/evil|\/\\\\|https:\/\/example\.com\/\\n/i,
  );
  expect(serialized).not.toContain('"class"');
  expect(serialized).not.toContain('"opener"');
}

const MALICIOUS_LAYOUT_HTML = [
  '<figure data-type="image" data-align="right" data-evil="figure" class="photo" ',
  'style="width:99999px" onclick="alert(1)">',
  '<img src="https://media.example.test/hero.jpg" alt="Hero" ',
  `data-media-id="${LAYOUT_MEDIA_ID}" data-extra="img" class="photo" `,
  'style="width:99999px" onerror="alert(2)" srcdoc="<script>alert(3)</script>">',
  '<figcaption class="caption" style="color:red">Hero caption</figcaption>',
  "<script>alert(4)</script>",
  "</figure>",
  '<div data-type="gallery" data-columns="2" data-evil="gallery" class="gallery" ',
  'style="display:none" onmouseover="alert(5)">',
  '<figure data-type="gallery-item" data-evil="item" class="item" ',
  'style="border:1px solid red" onclick="alert(6)">',
  '<img src="https://media.example.test/gallery-one.jpg" alt="One" ',
  `data-media-id="${LAYOUT_MEDIA_ID}" data-extra="gallery-img" class="photo" `,
  'style="width:99999px" onerror="alert(7)" srcdoc="<script>alert(8)</script>">',
  '<figcaption class="caption" style="color:red">One</figcaption>',
  "</figure>",
  '<figure data-type="gallery-item" data-evil="item-two">',
  '<img src="https://media.example.test/gallery-two.jpg" alt="Two" ',
  `data-media-id="${LAYOUT_MEDIA_ID_TWO}" data-extra="gallery-img-two">`,
  "<figcaption>Two</figcaption>",
  "</figure>",
  "<script>alert(9)</script>",
  "</div>",
  '<div data-type="columns" data-columns="2" data-evil="columns" class="columns" ',
  'style="display:none" onclick="alert(10)">',
  '<div data-type="column" data-column-index="0" data-evil="column" class="column" ',
  'style="color:red" onfocus="alert(11)">',
  "<p>Left column</p>",
  "<script>alert(12)</script>",
  "</div>",
  '<div data-type="column" data-column-index="1"><p>Right column</p></div>',
  "</div>",
  '<img src="javascript:alert(13)" onerror="alert(14)">',
  '<img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" onerror="alert(15)">',
  '<figure data-type="image"><img src="https://media.example.test/kept.jpg" ',
  'data-media-id="not-a-uuid"><figcaption>Kept</figcaption></figure>',
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
    expect(output).toContain('target="_blank"');
    expect(output).not.toMatch(/target="_self"|rel="opener"/i);
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
    expect(output).toContain("<span>x</span>");
    expect(output).not.toContain("</a>");
    expect(output).toContain("<p>body</p>");
  });

  it("normalizes layout values before persistence and sharing", () => {
    const sanitizer = new SanitizeService();
    const output = sanitizer.sanitizeHtml(
      '<div data-type="gallery" data-columns="99"><figure data-type="gallery-item"><img src="https://media.example.test/a.jpg"></figure></div>' +
        '<div data-type="columns" data-columns="99"><div data-type="column" data-column-index="99"><p>left</p></div></div>' +
        '<figure data-type="image" data-align="wide"><img src="https://media.example.test/b.jpg"></figure>',
    );

    expect(output).toContain('data-columns="3"');
    expect(output).toContain('data-columns="2"');
    expect(output).toContain('data-column-index="0"');
    expect(output).not.toContain('data-align="wide"');
  });
});

describe("EntriesService XSS persistence paths", () => {
  it("sanitizes contentHtml before create persists it, while preserving non-link contentJson", async () => {
    const { repository, trips, service } = setupEntries();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.createEntry.mockImplementation(async (_tx: unknown, data: { contentHtml: string }) =>
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

  it("normalizes link marks in contentJson on create and in the first revision", async () => {
    const { repository, trips, service } = setupEntries();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.createEntry.mockImplementation(
      async (_tx: unknown, data: { contentHtml: string; contentJson: Record<string, unknown> }) =>
        entryRecord({ contentHtml: data.contentHtml, contentJson: data.contentJson }),
    );
    repository.createRevision.mockResolvedValue(revisionRecord());

    const created = await service.create(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      TRIP_A_ID,
      {
        title: "Link sanitization",
        date: "2026-11-10",
        location: "Seoul",
        contentJson: {
          type: "doc",
          content: [
            contentJsonWithLink("javascript:alert(1)").content[0],
            contentJsonWithLink("https://example.com/album").content[0],
          ],
        },
        contentHtml: "<p>linked text</p>",
      },
    );

    const persisted = repository.createEntry.mock.calls[0]?.[1] as {
      contentJson: unknown;
    };
    expectSafeContentJson(persisted.contentJson);
    expect(JSON.stringify(persisted.contentJson)).toContain("https://example.com/album");
    expect(JSON.stringify(persisted.contentJson)).toContain('"target":"_blank"');
    expect(JSON.stringify(persisted.contentJson)).toContain('"rel":"noopener noreferrer"');
    expectSafeContentJson(created.contentJson);

    const revision = repository.createRevision.mock.calls[0]?.[1] as {
      contentJson: unknown;
    };
    expectSafeContentJson(revision.contentJson);
  });

  it("normalizes link marks in contentJson on update and on the saved revision", async () => {
    const { repository, trips, service } = setupEntries();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.findEntry.mockResolvedValueOnce(entryRecord({ version: 1 })).mockResolvedValueOnce(
      entryRecord({
        version: 2,
        contentJson: contentJsonWithLink("javascript:updated"),
      }),
    );
    repository.updateEntry.mockResolvedValue(1);
    repository.createRevision.mockResolvedValue(revisionRecord({ version: 2 }));

    const updated = await service.update(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
      {
        version: 1,
        contentJson: contentJsonWithLink("javascript:alert(2)"),
      },
    );

    const update = repository.updateEntry.mock.calls[0]?.[1] as {
      data: { contentJson: unknown };
    };
    expectSafeContentJson(update.data.contentJson);
    expectSafeContentJson(updated.contentJson);

    const revision = repository.createRevision.mock.calls[0]?.[1] as {
      contentJson: unknown;
    };
    expectSafeContentJson(revision.contentJson);
  });

  it("normalizes link marks when restoring a legacy revision", async () => {
    const { repository, trips, service } = setupEntries();
    const tx = {};
    let storedContentJson: Record<string, unknown> | undefined;
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.findEntry
      .mockResolvedValueOnce(entryRecord({ version: 3 }))
      .mockImplementationOnce(async () =>
        entryRecord({ version: 4, contentJson: storedContentJson }),
      );
    repository.findRevision.mockResolvedValue(
      revisionRecord({
        version: 1,
        contentJson: contentJsonWithLink("javascript:legacy"),
      }),
    );
    repository.updateEntry.mockImplementation(
      async (_tx: unknown, args: { data: { contentJson?: Record<string, unknown> } }) => {
        storedContentJson = args.data.contentJson;
        return 1;
      },
    );
    repository.createRevision.mockResolvedValue(revisionRecord({ version: 4 }));

    const restored = await service.restore(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
      REVISION_ID,
    );

    const update = repository.updateEntry.mock.calls[0]?.[1] as {
      data: { contentJson: unknown };
    };
    expectSafeContentJson(update.data.contentJson);
    expect(restored).toMatchObject({ id: ENTRY_ID, version: 4 });

    const revision = repository.createRevision.mock.calls[0]?.[1] as {
      contentJson: unknown;
    };
    expectSafeContentJson(revision.contentJson);
  });

  it("normalizes unsafe legacy link marks when reading an entry or revision", async () => {
    const { repository, trips, service } = setupEntries();
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.findEntry.mockResolvedValue(
      entryRecord({ contentJson: contentJsonWithLink("javascript:read") }),
    );
    repository.listRevisions.mockResolvedValue([
      revisionRecord({ contentJson: contentJsonWithLink("javascript:revision") }),
    ]);

    const entry = await service.get(makeActor(USER_EDITOR_ID), membership("editor"), ENTRY_ID);
    expectSafeContentJson(entry.contentJson);

    const revisions = await service.listRevisions(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      ENTRY_ID,
    );
    expectSafeContentJson(revisions[0]?.contentJson);
    expect(repository.updateEntry).not.toHaveBeenCalled();
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

    const entry = await service.get(makeActor(USER_EDITOR_ID), membership("editor"), ENTRY_ID);

    expect(entry.contentHtml).not.toMatch(/<img|onerror|script|javascript:|iframe|<style/i);
    expect(entry.contentHtml).toContain("<p><strong>Bold</strong>");
  });

  it("keeps legitimate layout nodes while stripping injected layout XSS", async () => {
    const { repository, trips, service } = setupEntries();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.createEntry.mockImplementation(async (_tx: unknown, data: { contentHtml: string }) =>
      entryRecord({ contentHtml: data.contentHtml }),
    );
    repository.createRevision.mockResolvedValue(revisionRecord());

    const created = await service.create(
      makeActor(USER_EDITOR_ID),
      membership("editor"),
      TRIP_A_ID,
      {
        title: "Layout XSS",
        date: "2026-11-10",
        location: "Seoul",
        contentJson: { type: "doc", content: [] },
        contentHtml: MALICIOUS_LAYOUT_HTML,
      },
    );

    expect(created.contentHtml).toContain('<figure data-type="image"');
    expect(created.contentHtml).toContain('data-align="right"');
    expect(created.contentHtml).toContain('data-type="gallery"');
    expect(created.contentHtml).toContain('data-columns="2"');
    expect(created.contentHtml).toContain('data-type="gallery-item"');
    expect(created.contentHtml).toContain('data-type="columns"');
    expect(created.contentHtml).toContain('data-type="column"');
    expect(created.contentHtml).toContain('data-column-index="0"');
    expect(created.contentHtml).toContain('data-column-index="1"');
    expect(created.contentHtml).toContain('src="https://media.example.test/hero.jpg"');
    expect(created.contentHtml).toContain('src="https://media.example.test/gallery-one.jpg"');
    expect(created.contentHtml).toContain('src="https://media.example.test/gallery-two.jpg"');
    expect(created.contentHtml).toContain('src="https://media.example.test/kept.jpg"');
    expect(created.contentHtml).toContain(`data-media-id="${LAYOUT_MEDIA_ID}"`);
    expect(created.contentHtml).toContain(`data-media-id="${LAYOUT_MEDIA_ID_TWO}"`);
    expect(created.contentHtml).toContain("<figcaption>Hero caption</figcaption>");
    expect(created.contentHtml).toContain("<figcaption>One</figcaption>");
    expect(created.contentHtml).toContain("<figcaption>Two</figcaption>");
    expect(created.contentHtml).toContain("<p>Left column</p>");
    expect(created.contentHtml).toContain("<p>Right column</p>");
    expect(created.contentHtml).not.toMatch(
      /onerror|onclick|onmouseover|onfocus|style=|class=|data-evil|data-extra|srcdoc|<script|javascript:|data:image|not-a-uuid|alert\(/i,
    );
  });
});
