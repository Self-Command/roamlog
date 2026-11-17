import { expect, test } from "@playwright/test";

import {
  STAGING_API_URL,
  STAGING_FIXTURE_FILE,
  STAGING_ORIGIN,
  STAGING_SHARE_PASSWORD,
  type StagingFixture,
  type StagingShare,
} from "./env";
import {
  expireShareLink,
  prepareStagingAdminOperations,
  readStagingFixture,
  runStagingFixtureScript,
  writeStagingFixture,
} from "./request";

interface ShareLinkCreated extends StagingShare {
  workspaceId: string;
  tripId: string;
  createdById: string;
  revokedAt: string | null;
  allowIndex: boolean;
  showBudget: boolean;
  lastAccessedAt: string | null;
  accessCount: number;
  createdAt: string;
}

test("provision isolated staging accounts, trip, entry, and share variants", async ({
  request,
}) => {
  const output = runStagingFixtureScript();
  expect(output).toContain('"webUserId"');

  const fixture = readStagingFixture();
  const authHeaders = {
    cookie: fixture.web.sessionCookie,
    origin: STAGING_ORIGIN,
  };

  const tripResponse = await request.post(
    `${STAGING_API_URL}/v1/workspaces/${fixture.web.workspace.id}/trips`,
    {
      headers: authHeaders,
      data: {
        title: `Staging Security Journey ${fixture.runId}`,
        summary: "Created by the staging API/security suite.",
        status: "active",
        startDate: "2027-04-03",
        endDate: "2027-04-09",
        origin: "Shanghai",
        destinations: ["Kyoto", "Osaka"],
        countryCodes: ["JP"],
        tags: ["staging", "security"],
        visibility: "public_link",
      },
    },
  );
  expect(tripResponse.status(), await tripResponse.text()).toBe(201);
  const trip = (await tripResponse.json()) as { id: string; title: string };

  const entryResponse = await request.post(`${STAGING_API_URL}/v1/trips/${trip.id}/entries`, {
    headers: authHeaders,
    data: {
      title: `Staging public journal ${fixture.runId}`,
      date: "2027-04-05",
      location: "Kyoto",
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Public staging journal content." }],
          },
        ],
      },
      contentHtml: "<p>Public staging journal content.</p>",
      excerpt: "Public staging journal content.",
      tags: ["public"],
    },
  });
  expect(entryResponse.status(), await entryResponse.text()).toBe(201);
  const entry = (await entryResponse.json()) as { id: string; title: string };

  async function createShare(input: Record<string, unknown>): Promise<ShareLinkCreated> {
    const response = await request.post(`${STAGING_API_URL}/v1/trips/${trip.id}/share-links`, {
      headers: authHeaders,
      data: input,
    });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as ShareLinkCreated;
  }

  const publicShare = await createShare({ showBudget: true, allowIndex: false });
  const passwordShare = await createShare({
    password: STAGING_SHARE_PASSWORD,
    showBudget: false,
  });
  const expiredShare = await createShare({
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
  });
  expireShareLink(expiredShare.id);

  const revokedShare = await createShare({});
  const revokeResponse = await request.delete(
    `${STAGING_API_URL}/v1/share-links/${revokedShare.id}`,
    { headers: authHeaders },
  );
  expect(revokeResponse.status(), await revokeResponse.text()).toBe(200);

  const completed: StagingFixture = {
    ...fixture,
    admin: {
      ...fixture.admin,
      platformRole: "admin",
    },
    journey: {
      tripId: trip.id,
      tripTitle: trip.title,
      entryId: entry.id,
      entryTitle: entry.title,
    },
    shares: {
      public: publicShare,
      password: passwordShare,
      expired: expiredShare,
      revoked: revokedShare,
    },
  };
  writeStagingFixture(completed);
  prepareStagingAdminOperations();
  expect(completed.journey.tripTitle).toContain("Staging Security Journey");
  expect(STAGING_FIXTURE_FILE).toContain(".e2e-live");
});
