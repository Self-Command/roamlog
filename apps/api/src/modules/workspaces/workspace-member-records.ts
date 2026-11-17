import { ForbiddenException } from "@nestjs/common";

export const memberWithUserSelect = {
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

export function forbidden(code: string, message: string): ForbiddenException {
  return new ForbiddenException({ code, message });
}

type MemberOrderBy = {
  joinedAt?: "asc" | "desc";
  user?: { name: "asc" | "desc" };
  id?: "asc" | "desc";
};

export function parseMemberSort(sort: string | undefined): MemberOrderBy[] {
  if (!sort) {
    return [{ joinedAt: "asc" }, { id: "asc" }];
  }
  const [field, direction] = sort.split(":") as [string, "asc" | "desc"];
  if (field === "name") {
    return [{ user: { name: direction } }, { id: "asc" }];
  }
  return [{ joinedAt: direction }, { id: "asc" }];
}
