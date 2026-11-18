import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

export function registerPlacePaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "get",
    path: "/v1/places/search",
    operationId: "searchPlaces",
    tag: "Places",
    summary: "Search normalized places for trip origins and stops",
    description:
      "Authenticated place search with a bounded query and result set. A successful degraded response returns the local fallback list with `degraded=true`.",
    query: c.PlaceSearchQuerySchema,
    response: c.PlaceSearchResponseSchema,
    errors: [400, 401, 429, 500, 503],
  });
}
