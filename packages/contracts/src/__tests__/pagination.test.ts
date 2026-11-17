import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ProblemDetailsSchema, problemDetails } from "../common/problem-details";
import {
  CursorPageSchema,
  CursorQuerySchema,
  createSortSchema,
  decodeCursor,
  encodeCursor,
} from "../common/pagination";

describe("cursor pagination", () => {
  it("round-trips UUID ids through base64url cursors", () => {
    const cursor = encodeCursor({
      id: "0192f4c5-6a7b-7c8d-9e0f-123456789abc",
      createdAt: new Date("2026-11-17T08:00:00.000Z"),
    });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain("=");
    expect(decodeCursor(cursor)).toEqual({
      id: "0192f4c5-6a7b-7c8d-9e0f-123456789abc",
    });
  });

  it("rejects malformed cursors instead of silently returning a page from the start", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow();
    expect(() => decodeCursor(Buffer.from("{\"id\":\"\"}").toString("base64url"))).toThrow();
    expect(() => decodeCursor("abc=")).toThrow();
  });

  it("applies safe pagination defaults and bounds", () => {
    expect(CursorQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(CursorQuerySchema.parse({ limit: "100" })).toEqual({ limit: 100 });
    expect(CursorQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(CursorQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(CursorQuerySchema.safeParse({ limit: 1.5 }).success).toBe(false);
  });

  it("whitelists sort fields and directions", () => {
    const sort = createSortSchema(["updatedAt", "createdAt", "title"]);
    expect(sort.parse("updatedAt:desc")).toBe("updatedAt:desc");
    expect(sort.parse("title:asc")).toBe("title:asc");
    expect(sort.safeParse("contentHtml:desc").success).toBe(false);
    expect(sort.safeParse("title:sideways").success).toBe(false);
  });

  it("builds typed cursor pages", () => {
    const page = CursorPageSchema(z.object({ id: z.number() }));
    expect(page.parse({ items: [{ id: 1 }], nextCursor: null, hasMore: false })).toEqual({
      items: [{ id: 1 }],
      nextCursor: null,
      hasMore: false,
    });
    expect(page.safeParse({ items: [], nextCursor: 12, hasMore: false }).success).toBe(false);
  });
});

describe("problem details", () => {
  it("accepts RFC 7807 responses and creates consistent helpers", () => {
    const parsed = ProblemDetailsSchema.parse({
      type: "https://roamlog.app/errors/forbidden",
      title: "Forbidden",
      status: 403,
      code: "WORKSPACE_ROLE_FORBIDDEN",
    });

    expect(parsed.errors).toEqual([]);
    expect(
      problemDetails({
        status: 409,
        code: "VERSION_CONFLICT",
        title: "Conflict",
        detail: "The trip changed.",
        instance: "/v1/trips/0192f4c5-6a7b-7c8d-9e0f-123456789abc",
      }),
    ).toMatchObject({
      type: "https://roamlog.app/errors/version-conflict",
      status: 409,
      code: "VERSION_CONFLICT",
      errors: [],
    });
  });

  it("rejects malformed status and error codes", () => {
    expect(
      ProblemDetailsSchema.safeParse({
        type: "https://roamlog.app/errors/forbidden",
        title: "Forbidden",
        status: 99,
        code: "lowercase",
      }).success,
    ).toBe(false);
  });
});
