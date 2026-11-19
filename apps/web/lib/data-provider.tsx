"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { getDataAdapter, type DataAdapter, type DataMode } from "@/lib/api";

interface DataProviderValue {
  mode: DataMode;
  adapter: DataAdapter;
}

/**
 * The web app only has a live data source.
 *
 * TODO(b-stage): drop the unused `mode` discriminator once the remaining
 * consumers stop branching on it.
 */
const LIVE_MODE: DataMode = "api";

const DataModeContext = createContext<DataProviderValue>({
  mode: LIVE_MODE,
  adapter: getDataAdapter(),
});

export function DataProvider({ children }: { children: ReactNode }) {
  const value = useMemo<DataProviderValue>(
    () => ({ mode: LIVE_MODE, adapter: getDataAdapter() }),
    [],
  );

  return <DataModeContext.Provider value={value}>{children}</DataModeContext.Provider>;
}

export function useDataMode(): DataMode {
  return useContext(DataModeContext).mode;
}

export function useDataAdapter(): DataAdapter {
  return useContext(DataModeContext).adapter;
}