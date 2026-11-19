import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

export function registerTripPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/trips",
    operationId: "listTrips",
    tag: "Trips",
    summary: "List trips in a Workspace",
    params: c.WorkspaceParamsSchema,
    query: c.TripListQuerySchema,
    response: c.TripPageSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/trips",
    operationId: "createTrip",
    tag: "Trips",
    summary: "Create a trip",
    params: c.WorkspaceParamsSchema,
    body: c.CreateTripRequestSchema,
    response: c.TripSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}",
    operationId: "getTrip",
    tag: "Trips",
    summary: "Get a trip",
    params: c.TripParamsSchema,
    response: c.TripSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/trips/{tripId}",
    operationId: "updateTrip",
    tag: "Trips",
    summary: "Update a trip with optimistic concurrency",
    params: c.TripParamsSchema,
    body: c.UpdateTripRequestSchema,
    response: c.TripSchema,
    versioned: true,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/trips/{tripId}",
    operationId: "deleteTrip",
    tag: "Trips",
    summary: "Soft-delete a trip",
    params: c.TripParamsSchema,
    status: 200,
    response: c.DeleteTripResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/duplicate",
    operationId: "duplicateTrip",
    tag: "Trips",
    summary: "Duplicate a trip",
    params: c.TripParamsSchema,
    body: c.DuplicateTripRequestSchema,
    response: c.TripSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/participants",
    operationId: "listTripParticipants",
    tag: "Participants",
    summary: "List trip participants",
    params: c.TripParamsSchema,
    response: c.TripParticipantListResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/participants",
    operationId: "addTripParticipant",
    tag: "Participants",
    summary: "Add a Workspace member to a trip",
    params: c.TripParamsSchema,
    body: c.AddTripParticipantRequestSchema,
    response: c.TripParticipantSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/trips/{tripId}/participants/{userId}",
    operationId: "removeTripParticipant",
    tag: "Participants",
    summary: "Remove a participant from a trip",
    params: c.TripParticipantParamsSchema,
    status: 200,
    response: c.RemoveTripParticipantResponseSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/trips/{tripId}/participants/{userId}",
    operationId: "updateTripParticipant",
    tag: "Participants",
    summary: "Change a participant's role or invitation status",
    params: c.TripParticipantParamsSchema,
    body: c.UpdateParticipantRequestSchema,
    response: c.TripParticipantSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/access-grants",
    operationId: "listTripAccessGrants",
    tag: "Trips",
    summary: "List a trip's explicit access grants",
    params: c.TripParamsSchema,
    response: c.TripAccessGrantsResponseSchema,
  });
  registerOperation(registry, {
    method: "put",
    path: "/v1/trips/{tripId}/access-grants",
    operationId: "setTripAccessGrants",
    tag: "Trips",
    summary: "Replace a trip's explicit access grants",
    params: c.TripParamsSchema,
    body: c.SetTripAccessGrantsRequestSchema,
    response: c.TripAccessGrantsResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/activity",
    operationId: "listTripActivity",
    tag: "Trips",
    summary: "List a trip's activity feed",
    params: c.TripParamsSchema,
    query: c.TripActivityQuerySchema,
    response: c.TripActivityPageSchema,
  });
}
