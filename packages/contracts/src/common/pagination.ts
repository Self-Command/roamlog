import { z } from "zod";

export type CursorPayload = {
  id: string;
  createdAt?: Date | string;
};

export class CursorDecodeError extends Error {
  readonly code = "INVALID_CURSOR";

  constructor(message = "Cursor must be a canonical base64url-encoded JSON object with an id.") {
    super(message);
    this.name = "CursorDecodeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function encodeCursor(input: CursorPayload): string {
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new CursorDecodeError("Cursor id must be a non-empty string.");
  }

  const payload: Record<string, string> = { id: input.id };
  if (input.createdAt !== undefined) {
    payload.createdAt =
      input.createdAt instanceof Date ? input.createdAt.toISOString() : input.createdAt;
  }

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { id: string } {
  if (
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    cursor.length > 2048 ||
    !/^[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    throw new CursorDecodeError();
  }

  try {
    const canonical = Buffer.from(cursor, "base64url").toString("base64url");
    if (canonical !== cursor) {
      throw new CursorDecodeError();
    }

    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!isRecord(parsed) || typeof parsed.id !== "string" || parsed.id.trim().length === 0) {
      throw new CursorDecodeError();
    }

    return { id: parsed.id };
  } catch (error) {
    if (error instanceof CursorDecodeError) {
      throw error;
    }
    throw new CursorDecodeError();
  }
}

export const CursorQuerySchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CursorQuery = z.infer<typeof CursorQuerySchema>;
export const PaginationQuerySchema = CursorQuerySchema;

export function createSortSchema<const T extends readonly [string, ...string[]]>(fields: T) {
  if (fields.length === 0) {
    throw new Error("createSortSchema requires at least one sortable field.");
  }
  const escaped = fields.map((field) => field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return z
    .string()
    .regex(new RegExp(`^(?:${escaped.join("|")}):(?:asc|desc)$`))
    .describe(`Whitelisted sort expression: ${fields.join("|")}:asc|desc.`);
}

export const SortExpressionSchema = createSortSchema(["createdAt", "updatedAt"]);

export function CursorPageSchema<T extends z.ZodType>(itemSchema: T) {
  return z
    .object({
      items: z.array(itemSchema),
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    })
    .strict();
}

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};
