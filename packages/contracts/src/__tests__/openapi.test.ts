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
    expect(Object.keys(doc.paths)).toHaveLength(91);
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
    expect(doc.paths["/v1/workspaces/{workspaceId}/members"]).toHaveProperty("get");
    expect(doc.paths["/v1/entries/{entryId}/revisions"]).toHaveProperty("get");
    expect(doc.paths["/v1/admin/system"]).toHaveProperty("get");
    expect(doc.paths["/v1/admin/audit/export"]).toHaveProperty("get");
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
