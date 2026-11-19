import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../src/common/services/permission.service.js";
import { SearchService } from "../src/modules/search/search.service.js";
import {
  USER_EDITOR_ID,
  USER_OWNER_ID,
  WORKSPACE_A_ID,
  WORKSPACE_B_ID,
  makeActor,
} from "./identity-fixtures.js";
import { ENTRY_ID, TRIP_A_ID, membership } from "./content-fixtures.js";

describe("SearchService", () => {
  function setup() {
    const repository = {
      searchTrips: vi.fn().mockResolvedValue([]),
      searchEntries: vi.fn().mockResolvedValue([]),
      searchComments: vi.fn().mockResolvedValue([]),
      searchPeople: vi.fn().mockResolvedValue([]),
    };
    const service = new SearchService(repository as never, new PermissionService());
    return { repository, service };
  }

  it("forces Workspace scope and asks the shared visibility rule for Editors", async () => {
    const { repository, service } = setup();

    await service.search(makeActor(USER_EDITOR_ID), membership("editor"), {
      q: "seoul",
      type: "all",
      limit: 10,
    });

    for (const fn of [
      repository.searchTrips,
      repository.searchEntries,
      repository.searchComments,
      repository.searchPeople,
    ]) {
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE_A_ID,
          userId: USER_EDITOR_ID,
          // Search no longer derives its own `canSeePrivate` switch (the
          // owner/admin bypass); it hands the shared rule the platform role.
          platformRole: "user",
        }),
      );
    }
  });

  it("gives a Workspace owner no private-trip bypass of its own", async () => {
    const { repository, service } = setup();

    await service.search(makeActor(USER_OWNER_ID), membership("owner"), {
      q: "seoul",
      type: "trip",
      limit: 10,
    });

    // Byte-identical actor args to the Editor case: the Workspace role is not a
    // visibility input any more, so search agrees with the detail read. The old
    // bypass flag must not reappear under any name.
    expect(repository.searchTrips).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_A_ID,
        userId: USER_OWNER_ID,
        platformRole: "user",
      }),
    );
    expect(repository.searchTrips.mock.calls[0]?.[0]).not.toHaveProperty("canSeePrivate");
  });

  it("returns plain-text snippets with safe highlights, never stored HTML", async () => {
    const { repository, service } = setup();
    repository.searchEntries.mockResolvedValue([
      {
        id: ENTRY_ID,
        tripId: TRIP_A_ID,
        title: "Seoul notes",
        contentHtml: "<p>Rain on the <strong>Seoul</strong> rooftops.</p>",
        excerpt: "Rain on the Seoul rooftops.",
      },
    ]);

    const result = await service.search(makeActor(), membership("owner"), {
      q: "Seoul",
      type: "entry",
      limit: 10,
    });

    expect(result.entries[0]).toMatchObject({
      type: "entry",
      title: "Seoul notes",
      highlight: "Seoul",
    });
    expect(result.entries[0]?.snippet).toContain("Seoul");
    expect(result.entries[0]?.snippet).not.toMatch(/<[^>]+>/);
  });

  it("returns person records without email addresses", async () => {
    const { repository, service } = setup();
    repository.searchPeople.mockResolvedValue([
      {
        id: "01942f30-1200-7000-8000-000000000001",
        name: "Owner",
        image: null,
        email: "owner@roamlog.test",
      },
    ]);

    const result = await service.search(makeActor(), membership("owner"), {
      q: "owner",
      type: "all",
      limit: 10,
    });

    expect(result.people[0]).toEqual({
      id: "01942f30-1200-7000-8000-000000000001",
      name: "Owner",
      image: null,
    });
    expect(JSON.stringify(result)).not.toContain("owner@roamlog.test");
    expect(WORKSPACE_B_ID).not.toBe(WORKSPACE_A_ID);
  });
});
