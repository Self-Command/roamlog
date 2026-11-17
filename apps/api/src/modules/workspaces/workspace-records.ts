import { ForbiddenException } from "@nestjs/common";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";

export const workspaceSelect = {
  id: true,
  name: true,
  slug: true,
  logoMediaId: true,
  ownerId: true,
  plan: true,
  status: true,
  defaultCurrency: true,
  timezone: true,
  weekStartsOn: true,
  settings: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function assertVerifiedEmail(actor: AuthenticatedActor): void {
  if (!actor.user.emailVerified) {
    throw new ForbiddenException({
      code: "EMAIL_VERIFICATION_REQUIRED",
      message: "Verify your email address before continuing.",
    });
  }
}
