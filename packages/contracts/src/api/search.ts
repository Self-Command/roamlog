import { z } from "zod";

import { UuidV7Schema } from "../common/ids";

export const SearchTypeSchema = z.enum(["all", "trip", "entry", "comment"]);
export type SearchType = z.infer<typeof SearchTypeSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  type: SearchTypeSchema.default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResultTypeSchema = z.enum(["trip", "entry", "comment", "person"]);
export type SearchResultType = z.infer<typeof SearchResultTypeSchema>;

export const SearchResultItemSchema = z
  .object({
    id: UuidV7Schema,
    type: SearchResultTypeSchema,
    title: z.string().min(1).max(200),
    snippet: z.string().max(1000),
    tripId: UuidV7Schema.nullable(),
    highlight: z.string().max(1000).nullable(),
  })
  .strict();
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;

export const SearchPersonSchema = z
  .object({
    id: UuidV7Schema,
    name: z.string().min(1).max(120),
    image: z.url().nullable(),
  })
  .strict();
export type SearchPerson = z.infer<typeof SearchPersonSchema>;

export const SearchResponseSchema = z
  .object({
    query: z.string().min(1).max(200),
    trips: z.array(SearchResultItemSchema),
    entries: z.array(SearchResultItemSchema),
    comments: z.array(SearchResultItemSchema),
    people: z.array(SearchPersonSchema),
  })
  .strict();
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
