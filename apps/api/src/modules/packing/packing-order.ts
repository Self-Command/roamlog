import { BadRequestException } from "@nestjs/common";

export interface ReorderInput {
  id: string;
  order: number;
}

/**
 * Rejects duplicate ids and returns a deterministic sequence starting at zero,
 * preserving the caller's relative order while keeping the list easy to drag.
 */
export function normalizeReorder(items: readonly ReorderInput[]): ReorderInput[] {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException({
      code: "PACKING_DUPLICATE_ITEM",
      message: "A packing reorder request cannot contain duplicate item ids.",
    });
  }
  return [...items]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((item, index) => ({ id: item.id, order: index }));
}

export function nextPackingOrder(currentMax: number | null | undefined): number {
  return Number.isFinite(currentMax) ? Math.max(0, Math.trunc(currentMax ?? -1)) + 1 : 0;
}
