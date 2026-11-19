import {
  ApiError,
  isApiError,
  isForbidden,
  isUnauthorized,
  isVersionConflict,
} from "./errors";
import { realAdapterInstance } from "./real";
import type { DataAdapter } from "./types";

/** The web app has exactly one data source: the real API. */
export function getDataAdapter(): DataAdapter {
  return realAdapterInstance;
}

export {
  ApiError,
  isApiError,
  isForbidden,
  isUnauthorized,
  isVersionConflict,
  type DataAdapter,
};
export * from "./types";