import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

const PublicTripParamsSchema = z.object({ token: c.PublicShareTokenSchema });

export function registerSharingPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/share-links",
    operationId: "createShareLink",
    tag: "Share Links",
    summary: "Create a public share link",
    params: c.TripParamsSchema,
    body: c.CreateShareLinkRequestSchema,
    response: c.ShareLinkCreateResponseSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/share-links",
    operationId: "listShareLinks",
    tag: "Share Links",
    summary: "List share links for a trip",
    params: c.TripParamsSchema,
    response: c.ShareLinkListResponseSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/share-links/{shareLinkId}",
    operationId: "revokeShareLink",
    tag: "Share Links",
    summary: "Revoke a share link",
    params: c.ShareLinkParamsSchema,
    status: 200,
    response: c.DeleteShareLinkResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/public/trips/{token}",
    operationId: "getPublicTrip",
    tag: "Share Links",
    summary: "Read a shared trip by token",
    description:
      "Read-only public projection. Comments, member emails, private media, and budget data are omitted unless explicitly allowed by the link.",
    params: PublicTripParamsSchema,
    query: c.PublicShareQuerySchema,
    response: c.PublicTripResponseSchema,
    public: true,
    errors: [400, 404, 429, 500, 503],
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/exports",
    operationId: "createExport",
    tag: "Exports",
    summary: "Queue a trip, Workspace, or account export",
    body: c.CreateExportRequestSchema,
    status: 202,
    response: c.ExportSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/exports",
    operationId: "listExports",
    tag: "Exports",
    summary: "List current user or Workspace exports",
    query: c.ExportListQuerySchema,
    response: c.ExportPageSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/exports/{exportId}",
    operationId: "getExport",
    tag: "Exports",
    summary: "Get export status and a short-lived download URL",
    params: c.ExportParamsSchema,
    response: c.ExportDetailSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/exports/{exportId}",
    operationId: "deleteExport",
    tag: "Exports",
    summary: "Delete an export record and object",
    params: c.ExportParamsSchema,
    status: 200,
    response: c.DeleteExportResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/search",
    operationId: "searchWorkspace",
    tag: "Search",
    summary: "Search trips, entries, comments, and people",
    params: c.WorkspaceParamsSchema,
    query: c.SearchQuerySchema,
    response: c.SearchResponseSchema,
  });
}
