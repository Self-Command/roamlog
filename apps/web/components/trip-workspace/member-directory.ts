"use client";

import { useMemo } from "react";

import { useMembersQuery } from "@/lib/query";

import { useTripWorkspace } from "./workspace-context";

export interface MemberEntry {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface MemberDirectory {
  members: MemberEntry[];
  byId: Map<string, MemberEntry>;
  /** Real name when the member is in the workspace, otherwise a stable short id. */
  nameOf(userId: string): string;
}

/**
 * Workspace members for this trip's workspace, used to turn `userId` foreign
 * keys (payers, participants, activity actors) into names. No name is invented:
 * an unknown user id falls back to a short id, never to a fake person.
 */
export function useMemberDirectory(): MemberDirectory {
  const { workspace } = useTripWorkspace();
  const query = useMembersQuery(workspace.id);

  return useMemo(() => {
    const members: MemberEntry[] =
      query.data?.items.map((member) => ({
        id: member.user.id,
        name: member.user.name || member.user.email,
        email: member.user.email,
        role: member.role,
      })) ?? [];

    const byId = new Map(members.map((member) => [member.id, member]));

    return {
      members,
      byId,
      nameOf: (userId: string) => byId.get(userId)?.name ?? `成员 ${userId.slice(0, 8)}`,
    };
  }, [query.data]);
}