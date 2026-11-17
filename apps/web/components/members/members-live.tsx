"use client";

import type { WorkspaceRole } from "@roamlog/contracts";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from "@roamlog/ui";
import { Crown, Mail, PenLine, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { isForbidden } from "@/lib/api";
import { shortDate } from "@/lib/demo-format";
import {
  useInvitationsQuery,
  useInviteMemberMutation,
  useMeQuery,
  useMembersQuery,
  useRemoveMemberMutation,
  useRevokeInvitationMutation,
  useUpdateMemberMutation,
  useWorkspaceBySlug,
} from "@/lib/query";

const roleLabels: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export function MembersLive({ workspaceSlug }: { workspaceSlug: string }) {
  const meQuery = useMeQuery();
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const membersQuery = useMembersQuery(workspace?.id);
  const invitationsQuery = useInvitationsQuery(workspace?.id);
  const updateMember = useUpdateMemberMutation();
  const removeMember = useRemoveMemberMutation();
  const inviteMember = useInviteMemberMutation();
  const revokeInvitation = useRevokeInvitationMutation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = workspace?.role === "owner" || workspace?.role === "admin";
  const members = membersQuery.data?.items ?? [];
  const invitations = useMemo(
    () =>
      (invitationsQuery.data?.items ?? []).filter(
        (invitation) => !invitation.acceptedAt && !invitation.revokedAt,
      ),
    [invitationsQuery.data?.items],
  );

  if (workspacesQuery.isLoading || membersQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-12 w-56" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <ErrorState
        title="Workspace 不可用"
        description="当前账号无法载入这个 Workspace 的成员列表。"
      />
    );
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    setError(null);
    try {
      await inviteMember.mutateAsync({
        workspaceId: workspace.id,
        input: { email: email.trim(), role, ...(message.trim() ? { message: message.trim() } : {}) },
      });
      setNotice(`已向 ${email.trim()} 发送 ${roleLabels[role]} 邀请。`);
      setEmail("");
      setMessage("");
      setDialogOpen(false);
    } catch (cause) {
      setError(isForbidden(cause) ? "你的角色不能邀请成员。" : "邀请没有发送成功，请稍后重试。");
    }
  }

  async function changeRole(memberId: string, nextRole: WorkspaceRole) {
    const member = members.find((candidate) => candidate.id === memberId);
    if (!workspace || !member) return;
    setError(null);
    try {
      await updateMember.mutateAsync({
        workspaceId: workspace.id,
        member,
        input: { role: nextRole },
      });
      setNotice(`${member.user.name} 的角色已更新为 ${roleLabels[nextRole]}。`);
    } catch (cause) {
      setError(isForbidden(cause) ? "你的角色不能修改成员角色。" : "角色更新失败。");
    }
  }

  async function remove(memberId: string) {
    const member = members.find((candidate) => candidate.id === memberId);
    if (!workspace || !member) return;
    if (!window.confirm(`确认移除 ${member.user.name}？`)) return;
    setError(null);
    try {
      await removeMember.mutateAsync({ workspaceId: workspace.id, memberId });
      setNotice(`${member.user.name} 已被移出 Workspace。`);
    } catch (cause) {
      setError(isForbidden(cause) ? "你的角色不能移除成员。" : "成员移除失败。");
    }
  }

  async function revoke(invitationId: string) {
    if (!workspace) return;
    setError(null);
    try {
      await revokeInvitation.mutateAsync({ workspaceId: workspace.id, invitationId });
      setNotice("待接受邀请已撤销。");
    } catch (cause) {
      setError(isForbidden(cause) ? "你的角色不能撤销邀请。" : "撤销邀请失败。");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`TOGETHER / ${String(members.length).padStart(2, "0")} MEMBERS`}
        title="成员与邀请"
        description="Owner 与 Admin 管理成员；Viewer 可以阅读工作区内容并发表评论。"
        actions={
          canManage ? (
            <Button type="button" variant="primary" onClick={() => setDialogOpen(true)}>
              <UserPlus aria-hidden="true" />
              邀请成员
            </Button>
          ) : null
        }
      />

      {notice ? (
        <p
          role="status"
          className="rounded-control border border-accent-blue/20 bg-accent-blue/5 px-3 py-2 text-xs text-accent-blue"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs text-accent-red"
        >
          {error}
        </p>
      ) : null}

      <section
        aria-label="成员统计"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline-strong bg-hairline lg:grid-cols-4"
      >
        {[
          { label: "成员总数", value: members.length, hint: "Owner 与同行者", icon: Users },
          {
            label: "可编辑",
            value: members.filter((member) =>
              ["owner", "admin", "editor"].includes(member.role),
            ).length,
            hint: "Owner + Admin + Editor",
            icon: PenLine,
          },
          { label: "待接受邀请", value: invitations.length, hint: "7 天后自动失效", icon: Mail },
          {
            label: "你的角色",
            value: roleLabels[workspace.role],
            hint: canManage ? "可以管理成员" : "只读管理权限",
            icon: Shield,
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-1 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="type-eyebrow">{stat.label}</p>
              <stat.icon aria-hidden="true" className="size-3.5 text-muted" />
            </div>
            <p className="mt-3 font-mono text-3xl tracking-[-0.04em] text-ink">
              {typeof stat.value === "number" ? String(stat.value).padStart(2, "0") : stat.value}
            </p>
            <p className="mt-1.5 text-[10px] text-muted">{stat.hint}</p>
          </div>
        ))}
      </section>

      <section className="surface-card overflow-hidden" aria-label="工作区成员列表">
        <div className="flex items-center justify-between gap-4 border-b border-hairline p-5">
          <div>
            <p className="type-eyebrow">WORKSPACE PEOPLE</p>
            <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.02em] text-ink">
              一起旅行的人
            </h2>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
            live API
          </span>
        </div>

        <div className="hidden grid-cols-[minmax(0,1fr)_170px_110px_44px] gap-4 border-b border-hairline px-5 py-2.5 lg:grid">
          <span className="type-eyebrow">成员</span>
          <span className="type-eyebrow">角色</span>
          <span className="type-eyebrow">加入时间</span>
          <span className="sr-only">操作</span>
        </div>

        <div className="divide-y divide-hairline">
          {members.map((member) => {
            const owner = member.role === "owner";
            const self = member.userId === meQuery.data?.id;
            return (
              <div
                key={member.id}
                className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_170px_110px_44px] lg:items-center lg:gap-4 lg:px-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={member.user.name} src={member.user.image ?? undefined} size={38} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[13px] font-medium text-ink">
                        {member.user.name}
                        {self ? "（你）" : ""}
                      </p>
                      {owner ? (
                        <Crown aria-label="Owner" className="size-3 text-accent-orange" />
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-muted">{member.user.email}</p>
                  </div>
                </div>

                <div>
                  {owner || !canManage ? (
                    <Badge tone={owner ? "orange" : "neutral"}>{roleLabels[member.role]}</Badge>
                  ) : (
                    <Select
                      value={member.role}
                      aria-label={`更改 ${member.user.name} 的角色`}
                      onChange={(event) =>
                        void changeRole(member.id, event.target.value as WorkspaceRole)
                      }
                      className="h-10 max-w-40 text-[11px]"
                      disabled={updateMember.isPending || member.status !== "active"}
                    >
                      <option value="admin">Admin</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </Select>
                  )}
                </div>

                <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                  {shortDate(member.joinedAt.slice(0, 10))}
                </p>

                <div className="flex justify-end lg:justify-start">
                  {canManage && !owner && !self ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-10 px-0"
                      aria-label={`移除 ${member.user.name}`}
                      onClick={() => void remove(member.id)}
                      disabled={removeMember.isPending}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {invitations.length > 0 ? (
        <section className="surface-card overflow-hidden" aria-label="待接受邀请">
          <div className="border-b border-hairline p-5">
            <p className="type-eyebrow">PENDING INVITATIONS</p>
            <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.02em] text-ink">
              等待回应
            </h2>
          </div>
          <div className="divide-y divide-hairline">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div>
                  <p className="text-[13px] text-ink">{invitation.email}</p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                    {roleLabels[invitation.role]} · 到期 {shortDate(invitation.expiresAt.slice(0, 10))}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void revoke(invitation.id)}
                    disabled={revokeInvitation.isPending}
                  >
                    撤销邀请
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={(event) => void submitInvite(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>邀请成员</DialogTitle>
              <DialogDescription>
                邀请发送到邮箱。对方需要先完成登录，才能接受并进入 Workspace。
              </DialogDescription>
            </DialogHeader>
            <FormField label="邮箱">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="traveler@example.com"
                required
              />
            </FormField>
            <FormField label="角色">
              <Select
                value={role}
                onChange={(event) => setRole(event.target.value as typeof role)}
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </Select>
            </FormField>
            <FormField label="留言（可选）">
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="一起补上这趟旅行的日志吧。"
                rows={3}
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={inviteMember.isPending}>
                <Mail aria-hidden="true" />
                发送邀请
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
