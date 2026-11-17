import { CREATED_AT, UPDATED_AT, USER_ID, WORKSPACE_ID } from "./fixture-ids";

export const tripDefaults = {
  workspaceId: WORKSPACE_ID,
  coverMediaId: null,
  visibility: "workspace" as const,
  favorite: false,
  version: 1,
  createdById: USER_ID,
  updatedById: USER_ID,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  deletedAt: null,
};

export const itineraryDefaults = {
  workspaceId: WORKSPACE_ID,
  startTime: null,
  endTime: null,
  notes: "",
  done: false,
  assigneeId: null,
  version: 1,
  createdById: USER_ID,
  updatedById: USER_ID,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  deletedAt: null,
};
