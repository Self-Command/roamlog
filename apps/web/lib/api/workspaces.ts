import {
  deleteWorkspace as deleteWorkspaceRequest,
  getExport as getExportRequest,
  listExports as listExportsRequest,
  transferWorkspaceOwnership as transferWorkspaceOwnershipRequest,
  type ListExportsParams,
} from "@roamlog/api-client";
import {
  CreateExportRequestSchema,
  ExportDetailSchema,
  ExportPageSchema,
  ExportSchema,
  WorkspaceSchema,
  type CreateExportRequest,
  type Export,
  type ExportDetail,
  type ExportPage,
  type TransferOwnershipRequest,
  type Workspace,
} from "@roamlog/contracts";

import { unwrap, unwrapMessage } from "./shared";

/**
 * Workspace danger-zone endpoints.
 *
 * The generated client already owns `DELETE /v1/workspaces/{id}`,
 * `POST /v1/workspaces/{id}/transfer-ownership` and the export reads. The queue
 * call is the one endpoint the generated client cannot express: `POST /v1/exports`
 * takes `?workspaceId=` so the artifact belongs to the Workspace being edited
 * (`apps/api/src/modules/exports/exports.service.ts:332-338` reads it; omitting
 * it would fall back to the caller's *first* membership). This module therefore
 * restates that one request while every response still goes through the shared
 * contract schemas.
 */

export type { Export, ExportDetail, ExportPage };

export async function deleteWorkspace(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<void> {
  unwrapMessage(
    await deleteWorkspaceRequest(workspaceId, { signal }),
    `/v1/workspaces/${workspaceId}`,
  );
}

export async function transferWorkspaceOwnership(
  workspaceId: string,
  input: TransferOwnershipRequest,
  signal?: AbortSignal,
): Promise<Workspace> {
  return unwrap(
    await transferWorkspaceOwnershipRequest(workspaceId, input, { signal }),
    WorkspaceSchema,
    `/v1/workspaces/${workspaceId}/transfer-ownership`,
  );
}

/**
 * Queues a Workspace export and returns the queued record (`202`).
 *
 * `CreateExportRequestSchema.parse` runs first so an unsupported combination is
 * rejected in the browser instead of round-tripping to a `422`.
 */
export async function createWorkspaceExport(
  workspaceId: string,
  input: CreateExportRequest,
  signal?: AbortSignal,
): Promise<Export> {
  const body = CreateExportRequestSchema.parse(input);
  const path = `/v1/exports?workspaceId=${encodeURIComponent(workspaceId)}`;
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return unwrap({ data: payload, status: response.status }, ExportSchema, path);
}

export async function listWorkspaceExports(
  params?: ListExportsParams,
  signal?: AbortSignal,
): Promise<ExportPage> {
  return unwrap(await listExportsRequest(params, { signal }), ExportPageSchema, "/v1/exports");
}

/**
 * Reads one export plus its short-lived signed download URL.
 *
 * `downloadUrl` is `null` until the archive is `ready`; polling this endpoint is
 * how the page learns the job finished (`packages/contracts/src/api/exports.ts:47-50`).
 */
export async function getWorkspaceExport(
  exportId: string,
  signal?: AbortSignal,
): Promise<ExportDetail> {
  return unwrap(
    await getExportRequest(exportId, { signal }),
    ExportDetailSchema,
    `/v1/exports/${exportId}`,
  );
}