import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

const MotionParamsSchema = c.WorkspaceParamsSchema.extend({ mediaId: c.UuidV7Schema });

export function registerMediaPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/media/presign",
    operationId: "presignMediaUpload",
    tag: "Media",
    summary: "Create a presigned media upload",
    params: c.WorkspaceParamsSchema,
    body: c.MediaPresignRequestSchema,
    response: c.MediaPresignResponseSchema,
    idempotent: true,
  });
  // Live Photo: a still and its paired motion clip share one Media row, so the
  // motion endpoints hang off the media id rather than being a second upload.
  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/media/{mediaId}/motion/presign",
    operationId: "presignMediaMotion",
    tag: "Media",
    summary: "Presign an upload for the motion clip of a Live Photo",
    params: MotionParamsSchema,
    body: c.MediaMotionPresignRequestSchema,
    status: 200,
    response: c.MediaMotionPresignResponseSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/media/{mediaId}/motion",
    operationId: "completeMediaMotionUpload",
    tag: "Media",
    summary: "Attach the uploaded motion clip to its Live Photo",
    params: MotionParamsSchema,
    body: c.CompleteMediaMotionRequestSchema,
    status: 200,
    response: c.MediaSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/media/{mediaId}/complete",
    operationId: "completeMediaUpload",
    tag: "Media",
    summary: "Complete a media upload",
    params: c.MediaParamsSchema,
    body: c.CompleteMediaRequestSchema,
    status: 200,
    response: c.MediaSchema,
    idempotent: true,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/media",
    operationId: "listWorkspaceMedia",
    tag: "Media",
    summary: "List Workspace media",
    params: c.WorkspaceParamsSchema,
    query: c.TripMediaListQuerySchema,
    response: c.MediaPageSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/media",
    operationId: "listTripMedia",
    tag: "Media",
    summary: "List trip media",
    params: c.TripParamsSchema,
    query: c.MediaListQuerySchema,
    response: c.MediaPageSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/media/{mediaId}",
    operationId: "getMedia",
    tag: "Media",
    summary: "Get one media asset with signed display URLs",
    params: c.MediaParamsSchema,
    response: c.GetMediaResponseSchema,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/media/{mediaId}",
    operationId: "deleteMedia",
    tag: "Media",
    summary: "Soft-delete media",
    params: c.MediaParamsSchema,
    status: 200,
    response: c.DeleteMediaResponseSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/media/{mediaId}",
    operationId: "updateMedia",
    tag: "Media",
    summary: "Update media caption, date, location, or trip",
    params: c.MediaParamsSchema,
    body: c.UpdateMediaRequestSchema,
    response: c.MediaSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/cover",
    operationId: "setTripCover",
    tag: "Media",
    summary: "Set a trip cover image",
    params: c.TripParamsSchema,
    body: c.SetTripCoverRequestSchema,
    status: 200,
    response: c.SetTripCoverResponseSchema,
  });
}
