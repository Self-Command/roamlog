import type { AuthenticatedActor } from "../src/common/guards/actor-context.js";

function uuidV7(suffix: number): string {
  const tail = suffix.toString(16).padStart(12, "0");
  return `01942f30-1200-7000-8000-${tail}`;
}

export const USER_OWNER_ID = uuidV7(1);
export const USER_ADMIN_ID = uuidV7(2);
export const USER_EDITOR_ID = uuidV7(3);
export const USER_VIEWER_ID = uuidV7(4);
export const USER_OUTSIDER_ID = uuidV7(5);
export const WORKSPACE_A_ID = uuidV7(101);
export const WORKSPACE_B_ID = uuidV7(102);
export const MEMBER_OWNER_ID = uuidV7(201);
export const MEMBER_ADMIN_ID = uuidV7(202);
export const MEMBER_EDITOR_ID = uuidV7(203);
export const MEMBER_VIEWER_ID = uuidV7(204);
export const INVITATION_ID = uuidV7(301);
export const NOW = new Date("2026-11-17T08:00:00.000Z");
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;

export function makeActor(
  userId = USER_OWNER_ID,
  overrides: Partial<AuthenticatedActor["user"]> = {},
): AuthenticatedActor {
  return {
    ip: "127.0.0.1",
    userAgent: "vitest",
    user: {
      id: userId,
      email: `user-${userId.slice(-4)}@roamlog.test`,
      emailVerified: true,
      name: "Test User",
      image: null,
      platformRole: "user",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      lastActiveAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      deletedAt: null,
      ...overrides,
    },
  };
}

export function makeUserRecord(
  userId = USER_OWNER_ID,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const actor = makeActor(userId);
  return {
    ...actor.user,
    lastActiveAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
