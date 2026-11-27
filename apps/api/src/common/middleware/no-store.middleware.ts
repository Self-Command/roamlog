import type { RequestHandler } from "express";

/**
 * API payloads are tenant-scoped and mutable. Browser HTTP caches must never
 * reuse an authenticated or public API response after a write; refetches would
 * otherwise return the old body even though the server has newer data.
 */
export function noStoreMiddleware(): RequestHandler {
  return (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  };
}
