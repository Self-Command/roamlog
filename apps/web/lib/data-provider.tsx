"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { getDataAdapter, type DataAdapter } from "@/lib/api";
import { DATA_MODE, type DataMode } from "@/lib/data-mode";

interface DataProviderValue {
  mode: DataMode;
  adapter: DataAdapter;
}

const DataModeContext = createContext<DataProviderValue>({
  mode: DATA_MODE,
  adapter: getDataAdapter(DATA_MODE),
});

export function DataProvider({ children }: { children: ReactNode }) {
  const value = useMemo<DataProviderValue>(
    () => ({ mode: DATA_MODE, adapter: getDataAdapter(DATA_MODE) }),
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
