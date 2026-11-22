import { describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "../../scripts/generate-openapi";

type Doc = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, Record<string, unknown>>;
    securitySchemes: Record<string, Record<string, unknown>>;
  };
  security?: Array<Record<string, string[]>>;
};

function document(): Doc {
  return buildOpenApiDocument() as unknown as Doc;
}

describe("OpenAPI document", () => {
  it("emits OpenAPI 3.1 with cookie authentication", () => {
    const doc = document();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Roamlog API");
    expect(doc.components.securitySchemes.cookieAuth).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "better-auth.session_token",
    });
    expect(doc.security).toEqual([{ cookieAuth: [] }]);
  });

  it("covers the expected application surface", () => {
    const doc = document();
    const paths = Object.keys(doc.paths);

    // Exact assertions for the endpoints anchoring each product area. A route
    // disappearing from the contract fails here instead of surfacing only as a
    // changed total, which is why these stay curated rather than generated.
    for (const required of [
      "/v1/auth/{path}",
      "/v1/me",
      "/v1/me/sessions",
      "/v1/me/notifications",
      "/v1/workspaces",
      "/v1/workspaces/{workspaceId}/members",
      "/v1/workspaces/{workspaceId}/invitations",
      "/v1/invitations/{token}/accept",
      "/v1/workspaces/{workspaceId}/audit",
      "/v1/workspaces/{workspaceId}/trips",
      "/v1/trips/{tripId}",
      "/v1/trips/{tripId}/participants",
      "/v1/trips/{tripId}/stops",
      "/v1/trips/{tripId}/itinerary",
      "/v1/workspaces/{workspaceId}/entries",
      "/v1/entries/{entryId}/revisions",
      "/v1/comments",
      "/v1/workspaces/{workspaceId}/media",
      "/v1/media/{mediaId}",
      "/v1/trips/{tripId}/cover",
      "/v1/places/search",
      "/v1/trips/{tripId}/expenses",
      "/v1/trips/{tripId}/budget/summary",
      "/v1/workspaces/{workspaceId}/insights",
      "/v1/workspaces/{workspaceId}/insights/expenses.csv",
      "/v1/trips/{tripId}/packing",
      "/v1/trips/{tripId}/share-links",
      "/v1/public/trips/{token}",
      "/v1/exports",
      "/v1/workspaces/{workspaceId}/search",
      "/v1/admin/metrics",
      "/v1/admin/users/export",
      "/v1/admin/workspaces/export",
      "/v1/admin/audit/export",
      "/v1/admin/flags",
      "/v1/admin/flags/{key}",
      "/v1/admin/jobs",
      "/v1/admin/system",
      "/v1/admin/settings",
      "/v1/admin/settings/{key}",
      "/v1/admin/settings/{key}/reveal",
      "/v1/public/settings",
      "/v1/health",
      "/v1/ready",
      "/v1/ws",
    ]) {
      expect(paths, `missing OpenAPI path: ${required}`).toContain(required);
    }

    // AI streaming + conversation persistence (Wave 0.2) adds 12 operations,
    // but OpenAPI path items are per URL template, so the 11 §2.5 endpoints
    // collapse into 7 path items (GET/POST share `/conversations`, GET/PATCH/
    // DELETE share `/{conversationId}`, GET/DELETE share `/{messages}`) and the
    // stream endpoint adds 1 more: 105 + 8 = 113 unique paths, 144 + 12 = 156
    // operations. Insights adds 2 unique paths and 2 operations.
    expect(paths.length).toBe(115);

    const operations = Object.values(doc.paths).reduce(
      (count, pathItem) =>
        count +
        Object.keys(pathItem).filter((method) =>
          ["get", "post", "patch", "put", "delete"].includes(method),
        ).length,
      0,
    );
    expect(operations).toBeGreaterThanOrEqual(120);
    expect(doc.paths["/v1/trips/{tripId}"]).toHaveProperty("get");
    expect(doc.paths["/v1/trips/{tripId}"]).toHaveProperty("patch");
    expect(doc.paths["/v1/places/search"]).toHaveProperty("get");
    expect(doc.paths["/v1/media/{mediaId}"]).toHaveProperty("get");
    expect(doc.paths["/v1/workspaces/{workspaceId}/members"]).toHaveProperty("get");
    expect(doc.paths["/v1/entries/{entryId}/revisions"]).toHaveProperty("get");
    expect(doc.paths["/v1/admin/system"]).toHaveProperty("get");
    expect(doc.paths["/v1/admin/audit/export"]).toHaveProperty("get");
    expect(doc.paths["/v1/admin/users/export"]).toHaveProperty("get");
    expect(doc.paths["/v1/admin/workspaces/export"]).toHaveProperty("get");
    expect(doc.paths["/v1/admin/flags"]).toHaveProperty("get");
    expect(doc.paths["/v1/admin/flags/{key}"]).toHaveProperty("patch");
    expect(doc.paths["/v1/trips/{tripId}/cover"]).toHaveProperty("post");
    expect(doc.paths["/v1/admin/jobs/{queue}/pause"]).toHaveProperty("post");
    expect(doc.paths["/v1/admin/jobs/{queue}/resume"]).toHaveProperty("post");
    expect(doc.paths["/v1/admin/jobs/{queue}/clear"]).toHaveProperty("post");
    expect(doc.paths["/v1/health"]).toHaveProperty("get");
    expect(doc.paths["/v1/ready"]).toHaveProperty("get");
  });

  it("publishes RFC 7807 responses and no import endpoints", () => {
    const doc = document();
    expect(doc.components.schemas.ProblemDetails).toBeDefined();
    expect(Object.keys(doc.paths).filter((path) => path.toLowerCase().includes("import"))).toEqual(
      [],
    );
    const patchTrip = doc.paths["/v1/trips/{tripId}"]?.patch as {
      responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
    };
    expect(patchTrip.responses?.["409"]).toBeDefined();
  });

  it("keeps public routes public and share-link secrets out of schemas", () => {
    const doc = document();
    const publicTrip = doc.paths["/v1/public/trips/{token}"]?.get as {
      security?: unknown[];
    };
    expect(publicTrip.security).toEqual([]);
    const shareLink = doc.components.schemas.ShareLink;
    expect(shareLink).toBeDefined();
    expect(shareLink).not.toHaveProperty("properties.tokenHash");
    expect(shareLink).not.toHaveProperty("properties.passwordHash");
  });

  it("publishes cover and public media URLs without storage secrets", () => {
    const doc = document();
    const tripCover = doc.components.schemas.TripCover;
    const getMedia = doc.components.schemas.GetMediaResponse;
    const publicMedia = doc.components.schemas.PublicMedia;

    expect(tripCover).toMatchObject({
      type: "object",
      properties: {
        mediaId: { type: "string", format: "uuid" },
        url: { type: ["string", "null"], format: "uri" },
        thumbUrl: { type: ["string", "null"], format: "uri" },
      },
    });
    expect(tripCover).not.toHaveProperty("properties.bucket");
    expect(tripCover).not.toHaveProperty("properties.key");
    expect(getMedia).not.toHaveProperty("properties.bucket");
    expect(getMedia).not.toHaveProperty("properties.key");
    expect(getMedia).not.toHaveProperty("properties.variants");
    expect(publicMedia).toMatchObject({
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        thumbUrl: { type: ["string", "null"], format: "uri" },
        expiresAt: { type: "string", format: "date-time" },
      },
    });
    expect(publicMedia).not.toHaveProperty("properties.bucket");
    expect(publicMedia).not.toHaveProperty("properties.key");
    expect(publicMedia).not.toHaveProperty("properties.variants");

    const publicTrip = doc.components.schemas.PublicTrip;
    expect(publicTrip).toMatchObject({
      type: "object",
      properties: {
        cover: {
          type: ["object", "null"],
        },
        durationDays: { type: "integer", exclusiveMinimum: 0 },
      },
    });
    expect(publicTrip).not.toHaveProperty("properties.cover.properties.bucket");
    expect(publicTrip).not.toHaveProperty("properties.cover.properties.key");
  });

  it("keeps cover writes off the partial trip PATCH contract", () => {
    const doc = document();
    const updateTrip = doc.components.schemas.UpdateTripRequest as {
      properties?: Record<string, { type?: string }>;
    };
    expect(updateTrip.properties?.coverMediaId).toMatchObject({ type: "null" });
  });

  it("keeps settings secrets masked and the public projection anonymous", () => {
    const doc = document();
    const publicSettings = doc.paths["/v1/public/settings"]?.get as { security?: unknown[] };
    expect(publicSettings.security).toEqual([]);

    const item = doc.components.schemas.AdminSettingItem as {
      properties?: Record<string, unknown>;
    };
    expect(item.properties).toHaveProperty("secret");
    expect(item.properties).toHaveProperty("value");
    expect(doc.components.schemas.RevealAdminSettingRequest).toBeDefined();
    expect(doc.components.schemas.AdminSettingsResponse).toBeDefined();
  });

  it("publishes the audit CSV contract as a text/csv attachment", () => {
    const doc = document();
    const operation = doc.paths["/v1/admin/audit/export"]?.get as {
      responses?: Record<
        string,
        { content?: Record<string, { schema?: Record<string, unknown> }> }
      >;
    };

    expect(operation.responses?.["200"]?.content).toHaveProperty("text/csv");
    expect(operation.responses?.["200"]?.content?.["text/csv"]?.schema).toMatchObject({
      $ref: "#/components/schemas/AdminAuditCsvResponse",
    });
    expect(doc.components.schemas.AdminAuditCsvResponse).toMatchObject({ type: "string" });
  });

  it("publishes the insights aggregate and expense CSV contracts", () => {
    const doc = document();
    const insights = doc.paths["/v1/workspaces/{workspaceId}/insights"]?.get as {
      parameters?: Array<{ name: string; in: string; required?: boolean }>;
      responses?: Record<
        string,
        { content?: Record<string, { schema?: Record<string, unknown> }> }
      >;
    };
    const csv = doc.paths["/v1/workspaces/{workspaceId}/insights/expenses.csv"]?.get as {
      parameters?: Array<{ name: string; in: string; required?: boolean }>;
      responses?: Record<
        string,
        { content?: Record<string, { schema?: Record<string, unknown> }> }
      >;
    };

    expect(insights).toBeDefined();
    expect(insights.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "workspaceId", in: "path" }),
        expect.objectContaining({ name: "month", in: "query" }),
      ]),
    );
    expect(insights.parameters?.find((parameter) => parameter.name === "month")?.required).not.toBe(
      true,
    );
    expect(insights.responses?.["200"]?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/WorkspaceInsights",
    });
    expect(doc.components.schemas.InsightsQuery).toBeDefined();

    expect(csv).toBeDefined();
    expect(csv.parameters).toHaveLength(1);
    expect(csv.parameters?.[0]).toMatchObject({ name: "workspaceId", in: "path" });
    expect(csv.responses?.["200"]?.content).toHaveProperty("text/csv");
    expect(csv.responses?.["200"]?.content?.["text/csv"]?.schema).toEqual({ type: "string" });

    for (const code of ["400", "401", "403", "404", "429", "500"]) {
      expect(insights.responses?.[code], `insights error ${code}`).toBeDefined();
      expect(csv.responses?.[code], `CSV error ${code}`).toBeDefined();
    }
  });

  it("declares every path parameter and keeps operation ids unique", () => {
    const doc = document();
    const operationIds: string[] = [];

    for (const [path, item] of Object.entries(doc.paths)) {
      const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
      for (const [method, operation] of Object.entries(item)) {
        if (!["get", "post", "patch", "put", "delete"].includes(method)) continue;
        const op = operation as {
          operationId?: string;
          parameters?: Array<{ name: string; in: string }>;
        };
        operationIds.push(op.operationId ?? `${method}:${path}`);
        for (const placeholder of placeholders) {
          expect(op.parameters, `${method.toUpperCase()} ${path}`).toEqual(
            expect.arrayContaining([expect.objectContaining({ name: placeholder, in: "path" })]),
          );
        }
      }
    }

    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it("is deterministic across builds", () => {
    expect(JSON.stringify(document())).toBe(JSON.stringify(document()));
  });
});
