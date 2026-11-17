import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  SearchQuerySchema,
  SearchResponseSchema,
  type SearchResponse,
  type SearchResultItem,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { SearchRepository } from "./search.repository.js";

@Injectable()
export class SearchService {
  constructor(
    @Inject(SearchRepository) private readonly repository: SearchRepository,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  async search(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawQuery: unknown,
  ): Promise<SearchResponse> {
    this.permissions.assertCan(membership.role, "search:read", "search");
    const query = parseRequest(SearchQuerySchema, rawQuery);
    const q = query.q.trim();
    if (!q) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Search query cannot be blank.",
      });
    }
    const args = {
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      canSeePrivate: membership.role === "owner" || membership.role === "admin",
      q,
      limit: query.limit,
    };

    const [trips, entries, comments, people] = await Promise.all([
      query.type === "all" || query.type === "trip"
        ? this.repository.searchTrips(args)
        : Promise.resolve([]),
      query.type === "all" || query.type === "entry"
        ? this.repository.searchEntries(args)
        : Promise.resolve([]),
      query.type === "all" || query.type === "comment"
        ? this.repository.searchComments(args)
        : Promise.resolve([]),
      query.type === "all" ? this.repository.searchPeople(args) : Promise.resolve([]),
    ]);

    return SearchResponseSchema.parse({
      query: q,
      trips: trips.map((trip) =>
        resultItem(
          trip.id,
          "trip",
          trip.title,
          [trip.summary, ...trip.destinations, ...trip.tags, ...trip.guestNames].join(" "),
          null,
          q,
        ),
      ),
      entries: entries.map((entry) =>
        resultItem(
          entry.id,
          "entry",
          entry.title,
          `${entry.location} ${entry.excerpt} ${plainText(entry.contentHtml)}`,
          entry.tripId,
          q,
        ),
      ),
      comments: comments.map((comment) =>
        resultItem(
          comment.id,
          "comment",
          `Comment on ${comment.trip.title}`,
          plainText(comment.body),
          comment.tripId,
          q,
        ),
      ),
      people: people.map((person) => ({
        id: person.id,
        name: person.name,
        image: person.image,
      })),
    });
  }
}

function resultItem(
  id: string,
  type: "trip" | "entry" | "comment",
  title: string,
  source: string,
  tripId: string | null,
  query: string,
): SearchResultItem {
  const text = source.replace(/\s+/g, " ").trim();
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index < 0 ? 0 : index - 70);
  const snippet = text.slice(start, start + 240);
  return {
    id,
    type,
    title: title || type,
    snippet: `${start > 0 ? "…" : ""}${snippet}${start + 240 < text.length ? "…" : ""}`,
    tripId,
    highlight: index < 0 ? null : query,
  };
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
