import { ForbiddenException } from "@nestjs/common";

export const invitationSelect = {
  id: true,
  workspaceId: true,
  email: true,
  role: true,
  invitedById: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

export const invitationMemberSelect = {
  id: true,
  workspaceId: true,
  userId: true,
  role: true,
  status: true,
  joinedAt: true,
  invitedById: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      emailVerified: true,
      name: true,
      image: true,
      platformRole: true,
      status: true,
      locale: true,
      timezone: true,
      lastActiveAt: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  },
} as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function forbidden(code: string, message: string): ForbiddenException {
  return new ForbiddenException({ code, message });
}
