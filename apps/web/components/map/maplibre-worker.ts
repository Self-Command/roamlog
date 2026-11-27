"use client";

import { getVersion, setWorkerUrl } from "maplibre-gl";

export const MAPLIBRE_WORKER_FILE = "maplibre-gl-worker.mjs";

let installed = false;

/**
 * MapLibre's default worker URL resolves next to its own module, which points
 * at the third-party CDN copy in this app. Serve the worker from the same
 * origin instead so the production `worker-src 'self' blob:` CSP accepts it.
 *
 * The copy step runs before dev/build and uses the installed package version.
 */
export function installMapLibreWorker(): void {
  if (installed || typeof window === "undefined") return;

  const workerUrl = new URL(`/${MAPLIBRE_WORKER_FILE}`, window.location.origin);
  workerUrl.searchParams.set("v", getVersion());
  setWorkerUrl(workerUrl.href);
  installed = true;
}
