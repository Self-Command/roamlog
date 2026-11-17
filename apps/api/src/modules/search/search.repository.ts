import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

export interface SearchQueryArgs {
  workspaceId: string;
  userId: string;
  canSeePrivate: boolean;
  q: string;
  limit: number;
}

export interface SearchTripRecord {
  id: string;
  title: string;
  summary: string;
  destinations: string[];
  tags: string[];
  guestNames: string[];
}

export interface SearchEntryRecord {
  id: string;
  tripId: string;
  title: string;
  location: string;
  excerpt: string;
  contentHtml: string;
}

export interface SearchCommentRecord {
  id: string;
  tripId: string;
  body: string;
  trip: {
    title: string;
  };
}

export interface SearchPersonRecord {
  id: string;
  name: string;
  image: string | null;
  email: string;
}

@Injectable()
export class SearchRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async searchTrips(args: SearchQueryArgs): Promise<SearchTripRecord[]> {
    const visibility = this.tripVisibility(args);
    return this.prisma.client.trip.findMany({
      where: {
        workspaceId: args.workspaceId,
        deletedAt: null,
        ...(Object.keys(visibility).length > 0 ? { AND: [visibility] } : {}),
        OR: [
          { title: { contains: args.q, mode: "insensitive" } },
          { summary: { contains: args.q, mode: "insensitive" } },
          { destinations: { has: args.q } },
          { tags: { has: args.q } },
          { guestNames: { has: args.q } },
        ],
      },
      select: {
        id: true,
        title: true,
        summary: true,
        destinations: true,
        tags: true,
        guestNames: true,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: args.limit,
    });
  }

  async searchEntries(args: SearchQueryArgs): Promise<SearchEntryRecord[]> {
    return this.prisma.client.journalEntry.findMany({
      where: {
        workspaceId: args.workspaceId,
        deletedAt: null,
        trip: {
          deletedAt: null,
          ...this.tripVisibility(args),
        },
        OR: [
          { title: { contains: args.q, mode: "insensitive" } },
          { location: { contains: args.q, mode: "insensitive" } },
          { excerpt: { contains: args.q, mode: "insensitive" } },
          { contentHtml: { contains: args.q, mode: "insensitive" } },
          { tags: { has: args.q } },
        ],
      },
      select: {
        id: true,
        tripId: true,
        title: true,
        location: true,
        excerpt: true,
        contentHtml: true,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: args.limit,
    });
  }

  async searchComments(args: SearchQueryArgs): Promise<SearchCommentRecord[]> {
    return this.prisma.client.comment.findMany({
      where: {
        workspaceId: args.workspaceId,
        deletedAt: null,
        body: { contains: args.q, mode: "insensitive" },
        trip: {
          deletedAt: null,
          ...this.tripVisibility(args),
        },
      },
      select: {
        id: true,
        tripId: true,
        body: true,
        trip: { select: { title: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: args.limit,
    });
  }

  async searchPeople(args: SearchQueryArgs): Promise<SearchPersonRecord[]> {
    const members = await this.prisma.client.workspaceMember.findMany({
      where: {
        workspaceId: args.workspaceId,
        status: "active",
        workspace: { status: "active", deletedAt: null },
        user: {
          deletedAt: null,
          status: "active",
          OR: [
            { name: { contains: args.q, mode: "insensitive" } },
            { email: { contains: args.q, mode: "insensitive" } },
          ],
        },
      },
      select: {
        user: {
          select: { id: true, name: true, image: true, email: true },
        },
      },
      take: args.limit,
    });
    return members.map((member) => member.user);
  }

  private tripVisibility(args: SearchQueryArgs): Record<string, unknown> {
    return args.canSeePrivate
      ? {}
      : {
          OR: [
            { visibility: { in: ["workspace", "public_link"] } },
            { createdById: args.userId },
          ],
        };
  }
}
