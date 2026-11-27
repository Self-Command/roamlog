"use client";

import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => undefined;
}

function getSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
