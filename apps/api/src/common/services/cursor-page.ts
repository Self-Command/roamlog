import { BadRequestException } from "@nestjs/common";
import { decodeCursor, encodeCursor } from "@roamlog/contracts";

export function cursorId(cursor: string | undefined): string | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    return decodeCursor(cursor).id;
  } catch {
    throw new BadRequestException({
      code: "INVALID_CURSOR",
      message: "The cursor is invalid.",
    });
  }
}

export function toCursorPage<T extends { id: string; createdAt: Date | string }>(
  rows: T[],
  limit: number,
  map: (row: T) => unknown,
) {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map(map),
    nextCursor: hasMore && last ? encodeCursor({ id: last.id, createdAt: last.createdAt }) : null,
    hasMore,
  };
}
