import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import type { ContentTransaction } from "../trips/content-transaction.js";

export interface ShareLinkRecord {
  id: string;
  workspaceId: string;
  tripId: string;
  tokenHash: string;
  createdById: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  passwordHash: string | null;
  allowIndex: boolean;
  showBudget: boolean;
  lastAccessedAt: Date | null;
  accessCount: number;
  createdAt: Date;
}

export interface PublicTripBundle {
  trip: Record<string, unknown>;
  stops: Array<Record<string, unknown>>;
  entries: Array<Record<string, unknown> & { media?: Array<Record<string, unknown>> }>;
  media: Array<Record<string, unknown>>;
  /**
   * The media row referenced by `trip.coverMediaId` when that row is *not* part
   * of {@link PublicTripBundle.media}.
   *
   * A Workspace-level photo (`media.tripId = null`) picked as a trip cover is
   * exactly this case: the public gallery mirrors the authenticated trip gallery
   * (trip-attached media only), so the cover row travels separately. It is loaded
   * by the same Workspace-scoped media query as `media`, hence it can never come
   * from another Workspace. `null` when the trip has no cover, or when the cover
   * is already in `media`.
   */
  coverMedia: Record<string, unknown> | null;
  budget: Record<string, unknown> | null;
}

@Injectable()
export class ShareLinksRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: ContentTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(callback);
  }

  async findTrip(workspaceId: string, tripId: string): Promise<Record<string, unknown> | null> {
    return this.prisma.client.trip.findFirst({
      where: { id: tripId, workspaceId, deletedAt: null },
    });
  }

  async createShareLink(
    tx: ContentTransaction,
    data: {
      workspaceId: string;
      tripId: string;
      tokenHash: string;
      createdById: string;
      expiresAt: Date | null;
      passwordHash: string | null;
      allowIndex: boolean;
      showBudget: boolean;
    },
  ): Promise<ShareLinkRecord> {
    return (await tx.shareLink.create({ data })) as ShareLinkRecord;
  }

  async listShareLinks(workspaceId: string, tripId: string): Promise<ShareLinkRecord[]> {
    return (await this.prisma.client.shareLink.findMany({
      where: { workspaceId, tripId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    })) as ShareLinkRecord[];
  }

  async findShareLink(
    workspaceId: string,
    tripId: string,
    shareLinkId: string,
  ): Promise<ShareLinkRecord | null> {
    return (await this.prisma.client.shareLink.findFirst({
      where: { id: shareLinkId, workspaceId, tripId },
    })) as ShareLinkRecord | null;
  }

  async findShareLinkById(shareLinkId: string): Promise<ShareLinkRecord | null> {
    return (await this.prisma.client.shareLink.findFirst({
      where: { id: shareLinkId },
    })) as ShareLinkRecord | null;
  }

  async findShareLinkByHash(tokenHash: string): Promise<ShareLinkRecord | null> {
    return (await this.prisma.client.shareLink.findUnique({
      where: { tokenHash },
    })) as ShareLinkRecord | null;
  }

  async revokeShareLink(
    tx: ContentTransaction,
    args: { workspaceId: string; shareLinkId: string },
  ): Promise<number> {
    const result = await tx.shareLink.updateMany({
      where: {
        id: args.shareLinkId,
        workspaceId: args.workspaceId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async recordAccess(shareLinkId: string, accessedAt: Date): Promise<boolean> {
    const result = await this.prisma.client.shareLink.updateMany({
      where: { id: shareLinkId, revokedAt: null },
      data: {
        lastAccessedAt: accessedAt,
        accessCount: { increment: 1 },
      },
    });
    return result.count > 0;
  }

  async loadPublicTrip(shareLink: ShareLinkRecord): Promise<PublicTripBundle | null> {
    const trip = await this.prisma.client.trip.findFirst({
      where: {
        id: shareLink.tripId,
        workspaceId: shareLink.workspaceId,
        deletedAt: null,
      },
    });
    if (!trip) {
      return null;
    }

    const coverMediaId = trip.coverMediaId ?? null;

    const [stops, entries, mediaRows] = await Promise.all([
      this.prisma.client.stop.findMany({
        where: { tripId: trip.id, workspaceId: shareLink.workspaceId, deletedAt: null },
        orderBy: [{ startDate: "asc" }, { order: "asc" }, { id: "asc" }],
      }),
      this.prisma.client.journalEntry.findMany({
        where: { tripId: trip.id, workspaceId: shareLink.workspaceId, deletedAt: null },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
      // One query for the gallery *and* the cover. The cover arm is an `OR` on
      // `id` instead of a follow-up lookup, so a public read still issues a single
      // media query. `workspaceId`, `status` and `deletedAt` stay at the top level
      // and therefore constrain both arms: a cover owned by another Workspace, a
      // cover that is not `ready`, and a soft-deleted cover are never even loaded.
      this.prisma.client.media.findMany({
        where: {
          workspaceId: shareLink.workspaceId,
          status: "ready",
          deletedAt: null,
          ...(coverMediaId === null
            ? { tripId: trip.id }
            : { OR: [{ tripId: trip.id }, { id: coverMediaId }] }),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);

    // `media` keeps its previous meaning exactly: media attached to this trip.
    const directMedia = mediaRows.filter((media) => media.tripId === trip.id);
    // A Workspace-level cover (`tripId = null`) or a cover attached to another trip
    // is reported separately, so the public gallery does not grow a row the
    // authenticated trip gallery would not list. The projector decides whether it
    // is an acceptable cover; loading it grants nothing on its own.
    const coverMedia =
      coverMediaId === null
        ? null
        : (mediaRows.find(
            (media) => media.id === coverMediaId && media.tripId !== trip.id,
          ) ?? null);

    const entryMedia = await this.prisma.client.entryMedia.findMany({
      where: {
        workspaceId: shareLink.workspaceId,
        entryId: { in: entries.map((entry) => entry.id) },
        media: { status: "ready", deletedAt: null },
      },
      include: { media: true },
      orderBy: [{ order: "asc" }],
    });
    const mediaByEntry = new Map<string, Array<Record<string, unknown>>>();
    for (const row of entryMedia) {
      const list = mediaByEntry.get(row.entryId) ?? [];
      list.push(row.media as unknown as Record<string, unknown>);
      mediaByEntry.set(row.entryId, list);
    }
    const mediaById = new Map(
      directMedia.map((media) => [media.id, media as unknown as Record<string, unknown>]),
    );
    for (const mediaList of mediaByEntry.values()) {
      for (const media of mediaList) {
        mediaById.set(String(media.id), media);
      }
    }

    return {
      trip: trip as unknown as Record<string, unknown>,
      stops: stops as unknown as Array<Record<string, unknown>>,
      entries: entries.map((entry) => ({
        ...(entry as unknown as Record<string, unknown>),
        media: mediaByEntry.get(entry.id) ?? [],
      })),
      media: [...mediaById.values()],
      coverMedia: coverMedia as unknown as Record<string, unknown> | null,
      budget: shareLink.showBudget
        ? await this.loadBudget(trip, shareLink.workspaceId)
        : null,
    };
  }

  private async loadBudget(
    trip: Record<string, unknown>,
    workspaceId: string,
  ): Promise<Record<string, unknown>> {
    const tripId = String(trip.id);
    const displayCurrency =
      typeof trip.budgetCurrency === "string" ? trip.budgetCurrency : "USD";
    const expenses = await this.prisma.client.expense.findMany({
      where: { tripId, workspaceId, deletedAt: null },
      select: { category: true, amountMinor: true, currency: true },
    });
    const originalTotals = new Map<string, number>();
    const categories = new Map<string, Map<string, number>>();
    for (const expense of expenses) {
      originalTotals.set(
        expense.currency,
        (originalTotals.get(expense.currency) ?? 0) + expense.amountMinor,
      );
      const category = categories.get(expense.category) ?? new Map<string, number>();
      category.set(
        expense.currency,
        (category.get(expense.currency) ?? 0) + expense.amountMinor,
      );
      categories.set(expense.category, category);
    }

    const converted = expenses.reduce(
      (sum, expense) =>
        sum + Math.round(expense.amountMinor * approximateRate(expense.currency, displayCurrency)),
      0,
    );
    const budgetMinor =
      typeof trip.budgetAmountMinor === "number" ? trip.budgetAmountMinor : null;
    return {
      tripId,
      displayCurrency,
      originalTotals: [...originalTotals].map(([currency, amountMinor]) => ({
        currency,
        amountMinor,
      })),
      displayTotal: {
        currency: displayCurrency,
        amountMinor: converted,
        approx: true,
      },
      categories: [...categories].map(([category, totals]) => ({
        category,
        totals: [...totals].map(([currency, amountMinor]) => ({ currency, amountMinor })),
      })),
      expenseCount: expenses.length,
      overBudget: budgetMinor === null ? false : converted > budgetMinor,
    };
  }
}

const USD_RATES: Record<string, number> = {
  USD: 1,
  EUR: 1.05,
  GBP: 1.27,
  CNY: 0.14,
  JPY: 0.0067,
  KRW: 0.00072,
  THB: 0.029,
  CAD: 0.73,
  AUD: 0.66,
};

function approximateRate(from: string, to: string): number {
  const fromRate = USD_RATES[from] ?? 1;
  const toRate = USD_RATES[to] ?? 1;
  return fromRate / toRate;
}
