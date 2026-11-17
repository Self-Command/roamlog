import { DATA_MODE, type DataMode } from "@/lib/data-mode";

import {
  ApiError,
  isApiError,
  isForbidden,
  isUnauthorized,
  isVersionConflict,
} from "./errors";
import { mockAdapterInstance } from "./mock";
import { realAdapterInstance } from "./real";
import type { DataAdapter } from "./types";

const adapters: Record<DataMode, DataAdapter> = {
  mock: mockAdapterInstance,
  api: realAdapterInstance,
};

export function getDataAdapter(mode: DataMode = DATA_MODE): DataAdapter {
  return adapters[mode];
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
