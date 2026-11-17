import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../src/common/services/permission.service.js";
import { SanitizeService } from "../src/common/services/sanitize.service.js";
import {
  hashShareToken,
  hashSharePassword,
  ShareLinksService,
} from "../src/modules/share-links/share-links.service.js";
import {
  USER_EDITOR_ID,
  USER_OWNER_ID,
  NOW,
  WORKSPACE_A_ID,
  WORKSPACE_B_ID,
  makeActor,
} from "./identity-fixtures.js";
import {
  ENTRY_ID,
  TRIP_A_ID,
  fakeTransaction,
  membership,
  stopRecord,
  tripRecord,
} from "./content-fixtures.js";

const SHARE_LINK_ID = "01942f30-1200-7000-8000-000000000a01";
const MEDIA_ID = "01942f30-1200-7000-8000-000000000a02";

function shareLinkRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: SHARE_LINK_ID,
    workspaceId: WORKSPACE_A_ID,
    tripId: TRIP_A_ID,
    tokenHash: "stored-hash",
    createdById: USER_OWNER_ID,
    expiresAt: null,
    revokedAt: null,
    passwordHash: null,
    allowIndex: false,
    showBudget: false,
    lastAccessedAt: null,
    accessCount: 0,
    createdAt: NOW,
    ...overrides,
  };
}

function setup() {
  const repository = {
    transaction: vi.fn(),
    createShareLink: vi.fn(),
    listShareLinks: vi.fn(),
    findTrip: vi.fn(),
    findShareLink: vi.fn(),
    findShareLinkById: vi.fn(),
    findShareLinkByHash: vi.fn(),
    revokeShareLink: vi.fn(),
    recordAccess: vi.fn(),
    loadPublicTrip: vi.fn(),
  };
  const activities = { record: vi.fn().mockResolvedValue({ id: SHARE_LINK_ID }) };
  const config = { appUrl: "http://localhost:3000" };
  const service = new ShareLinksService(
    repository as never,
    new PermissionService(),
    activities as never,
    new SanitizeService(),
    config as never,
  );
  return { repository, activities, service };
}

describe("ShareLinksService", () => {
  it("stores only a token hash and returns the plaintext token once", async () => {
    const { repository, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    repository.findTrip.mockResolvedValue(tripRecord());
    repository.createShareLink.mockImplementation(
      async (_tx: unknown, data: Record<string, unknown>) =>
        shareLinkRecord({
          ...data,
          id: SHARE_LINK_ID,
          createdAt: NOW,
        }),
    );

    const created = await service.create(makeActor(USER_OWNER_ID), membership("owner"), TRIP_A_ID, {
      allowIndex: false,
      showBudget: false,
      password: "correct horse battery",
    });

    const stored = repository.createShareLink.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(stored.tokenHash).not.toBe(created.token);
    expect(stored.tokenHash).toBe(hashShareToken(created.token));
    expect(stored.passwordHash).not.toContain("correct horse battery");
    expect(created.token.length).toBeGreaterThanOrEqual(32);
    expect(created).not.toHaveProperty("tokenHash");
    expect(created).not.toHaveProperty("passwordHash");
    expect(repository.createShareLink).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        workspaceId: WORKSPACE_A_ID,
        tripId: TRIP_A_ID,
        createdById: USER_OWNER_ID,
      }),
    );
  });

  it("denies expired, revoked, and password-protected links without incrementing access", async () => {
    const { repository, service } = setup();
    const token = "t".repeat(43);

    repository.findShareLinkByHash.mockResolvedValue(
      shareLinkRecord({ revokedAt: NOW }),
    );
    await expect(service.readPublic(token, {})).rejects.toBeInstanceOf(NotFoundException);

    repository.findShareLinkByHash.mockResolvedValue(
      shareLinkRecord({ expiresAt: new Date("2020-01-01T00:00:00.000Z") }),
    );
    await expect(service.readPublic(token, {})).rejects.toBeInstanceOf(NotFoundException);

    repository.findShareLinkByHash.mockResolvedValue(
      shareLinkRecord({ passwordHash: hashSharePassword("secret password") }),
    );
    await expect(service.readPublic(token, {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      service.readPublic(token, { password: "wrong password" }),
    ).rejects.toMatchObject({ status: 401, response: { code: "SHARE_PASSWORD_INVALID" } });
    expect(repository.recordAccess).not.toHaveBeenCalled();
  });

  it("returns a sanitized public read model with no private fields or comments", async () => {
    const { repository, service } = setup();
    const token = "t".repeat(43);
    repository.findShareLinkByHash.mockResolvedValue(shareLinkRecord());
    repository.loadPublicTrip.mockResolvedValue({
      trip: tripRecord({ origin: "" }),
      stops: [stopRecord()],
      entries: [
        {
          id: ENTRY_ID,
          title: "Safe entry",
          date: new Date("2026-11-10T00:00:00.000Z"),
          location: "Seoul",
          lat: 37.5,
          lng: 127,
          mood: "happy",
          weather: "rain",
          contentHtml: "<p>Safe</p><script>alert(1)</script>",
          excerpt: "Safe",
          tags: [],
          media: [
            {
              id: MEDIA_ID,
              width: 1200,
              height: 800,
              blurhash: null,
              variants: {},
              caption: null,
              date: null,
              location: null,
            },
          ],
        },
      ],
      media: [
        {
          id: MEDIA_ID,
          width: 1200,
          height: 800,
          blurhash: null,
          variants: {},
          caption: null,
          date: null,
          location: null,
        },
      ],
      budget: null,
    });
    repository.recordAccess.mockResolvedValue(true);

    const payload = await service.readPublic(token, {});

    expect(payload.entries[0]?.contentHtml).toContain("<p>Safe</p>");
    expect(payload.entries[0]?.contentHtml).not.toMatch(/script|alert/i);
    expect(payload.trip.origin).toBe("未填写");
    expect(JSON.stringify(payload)).not.toMatch(
      /tokenHash|passwordHash|email|comments|createdBy|workspaceId/i,
    );
    expect(repository.recordAccess).toHaveBeenCalledWith(SHARE_LINK_ID, expect.any(Date));
  });

  it("prevents revoking a share link from another Workspace", async () => {
    const { repository, service } = setup();
    repository.findShareLinkById.mockResolvedValue(
      shareLinkRecord({ workspaceId: WORKSPACE_B_ID }),
    );

    await expect(
      service.revoke(makeActor(USER_EDITOR_ID), membership("editor"), SHARE_LINK_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
