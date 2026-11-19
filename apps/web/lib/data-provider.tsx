"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { getDataAdapter, type DataAdapter } from "@/lib/api";

interface DataProviderValue {
  adapter: DataAdapter;
}

const DataAdapterContext = createContext<DataProviderValue>({
  adapter: getDataAdapter(),
});

export function DataProvider({ children }: { children: ReactNode }) {
  const value = useMemo<DataProviderValue>(() => ({ adapter: getDataAdapter() }), []);

  return <DataAdapterContext.Provider value={value}>{children}</DataAdapterContext.Provider>;
}

export function useDataAdapter(): DataAdapter {
  return useContext(DataAdapterContext).adapter;
}