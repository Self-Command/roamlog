"use client";

import type { WorkspaceRole } from "@roamlog/contracts";
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@roamlog/ui";
import {
  Activity,
  Crown,
  Eye,
  Mail,
  PenLine,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useDemoStore } from "@/lib/demo-store";
import { shortDate } from "@/lib/demo-format";

const roleLabels: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const roleIcons = {
  owner: Crown,
  admin: Shield,
  editor: PenLine,
  viewer: Eye,
};

export function MembersWorkspace() {
  const {
    state,
    currentUser,
    updateMemberRole,
    removeMember,
    inviteMember,
    revokeInvitation,
  } = useDemoStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [message, setMessage] = useState("");
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const pending = useMemo(
    () =>
      state.invitations.filter(
        (invitation) => !invitation.acceptedAt && !invitation.revokedAt,
      ),
    [state.invitations],
  );
  const onlineCount = state.members.filter(
    (member) => member.user.lastActiveAt?.startsWith("2026-11-17"),
  ).length;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.includes("@")) return;
    inviteMember(email.trim(), role, message.trim() || undefined);
    setEmail("");
    setMessage("");
    setDialogOpen(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`TOGETHER / ${String(state.members.length).padStart(2, "0")} MEMBERS`}
        title="成员与邀请"
        description="一起计划、一起记录。Owner 与 Admin 管理成员；Viewer 可以阅读工作区内容并发表评论。"
        actions={
          <Button type="button" variant="primary" onClick={() => setDialogOpen(true)}>
            <UserPlus aria-hidden="true" />
            邀请成员
          </Button>
        }
      />
      {actionNotice ? (
        <p
          role="status"
          className="rounded-control border border-accent-blue/20 bg-accent-blue/5 px-3 py-2 text-xs text-accent-blue"
        >
          {actionNotice}
        </p>
      ) : null}

      <section
        aria-label="成员统计"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline-strong bg-hairline lg:grid-cols-4"
      >
        {[
          { label: "成员总数", value: state.members.length, hint: "Owner 与同行者", icon: Users },
          { label: "最近活跃", value: onlineCount, hint: "今日有活动", icon: Activity },
          {
            label: "可编辑",
            value: state.members.filter((member) =>
              ["owner", "admin", "editor"].includes(member.role),
            ).length,
            hint: "Owner + Admin + Editor",
            icon: PenLine,
          },
          { label: "待接受邀请", value: pending.length, hint: "7 天后自动失效", icon: Mail },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-1 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="type-eyebrow">{stat.label}</p>
              <stat.icon aria-hidden="true" className="size-3.5 text-muted" />
            </div>
            <p className="mt-3 font-mono text-3xl tracking-[-0.04em] text-ink">
              {String(stat.value).padStart(2, "0")}
            </p>
            <p className="mt-1.5 text-[10px] text-muted">{stat.hint}</p>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <section className="surface-card overflow-hidden" aria-label="工作区成员列表">
            <div className="flex items-center justify-between gap-4 border-b border-hairline p-5">
              <div>
                <p className="type-eyebrow">WORKSPACE PEOPLE</p>
                <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.02em] text-ink">
                  一起旅行的人
                </h2>
              </div>
              <AvatarGroup
                members={state.members.map((member) => ({
                  id: member.userId,
                  name: member.user.name,
                  online: member.user.lastActiveAt?.startsWith("2026-11-17"),
                }))}
                max={4}
                size={26}
              />
            </div>

            <div className="hidden grid-cols-[minmax(0,1fr)_170px_110px_44px] gap-4 border-b border-hairline px-5 py-2.5 lg:grid">
              <span className="type-eyebrow">成员</span>
              <span className="type-eyebrow">角色</span>
              <span className="type-eyebrow">最近活跃</span>
              <span className="sr-only">操作</span>
            </div>

            <div className="divide-y divide-hairline">
              {state.members.map((member) => {
                const owner = member.role === "owner";
                return (
                  <div
                    key={member.id}
                    className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_170px_110px_44px] lg:items-center lg:gap-4 lg:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar
                        name={member.user.name}
                        size={38}
                        online={member.user.lastActiveAt?.startsWith("2026-11-17")}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[13px] font-medium text-ink">
                            {member.user.name}
                            {member.userId === currentUser.id ? "（你）" : ""}
                          </p>
                          {owner ? (
                            <Crown aria-label="Owner" className="size-3 text-accent-orange" />
                          ) : null}
                        </div>
                        <p className="truncate text-[11px] text-muted">{member.user.email}</p>
                      </div>
                    </div>

                    <div>
                      {owner ? (
                        <Badge tone="orange">
                          <Crown aria-hidden="true" className="size-3" />
                          Owner
                        </Badge>
                      ) : (
                        <div>
                          <label htmlFor={`role-${member.id}`} className="sr-only">
                            更改 {member.user.name} 的角色
                          </label>
                          <Select
                            id={`role-${member.id}`}
                            value={member.role}
                            aria-label={`更改 ${member.user.name} 的角色`}
                            onChange={(event) =>
                              updateMemberRole(
                                member.id,
                                event.target.value as WorkspaceRole,
                              )
                            }
                            className="h-10 max-w-40 text-[11px]"
                          >
                            <option value="admin">Admin</option>
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                          </Select>
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                        {member.user.lastActiveAt
                          ? shortDate(member.user.lastActiveAt.slice(0, 10))
                          : "未知"}
                      </p>
                      <p className="mt-1 text-[10px] text-stone">加入于 {shortDate(member.joinedAt.slice(0, 10))}</p>
                    </div>

                    <div className="flex justify-end lg:justify-start">
                      {!owner ? (
                        <button
                          type="button"
                          onClick={() => removeMember(member.id)}
                          aria-label={`移除 ${member.user.name}`}
                          className="flex size-10 items-center justify-center rounded-control text-stone hover:bg-accent-red/10 hover:text-accent-red"
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="surface-card overflow-hidden" aria-label="待接受邀请">
            <div className="flex items-center justify-between gap-4 border-b border-hairline p-5">
              <div>
                <p className="type-eyebrow">INVITATIONS</p>
                <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.02em] text-ink">
                  待接受邀请
                </h2>
              </div>
              <Badge tone="yellow">{pending.length} 待处理</Badge>
            </div>

            {pending.length ? (
              <div className="divide-y divide-hairline">
                {pending.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-hairline-strong bg-surface-2 text-muted">
                      <Mail aria-hidden="true" className="size-4" />
                    </span>
                    <p className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">
                        {invitation.email}
                      </span>
                      <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                        {roleLabels[invitation.role]} · 发送于{" "}
                        {shortDate(invitation.createdAt.slice(0, 10))}
                      </span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="yellow">待接受</Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setActionNotice(
                            `已模拟重新发送邀请至 ${invitation.email}；本地不会调用 Resend。`,
                          )
                        }
                      >
                        <RefreshCw aria-hidden="true" />
                        重新发送
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => revokeInvitation(invitation.id)}
                      >
                        <X aria-hidden="true" />
                        取消
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-10 text-center">
                <p className="font-serif text-xl text-ink">没有等待中的邀请</p>
                <p className="mt-2 text-xs text-muted">所有同行者都已加入工作区。</p>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20">
          <section className="surface-card overflow-hidden">
            <div className="border-b border-hairline p-5">
              <p className="type-eyebrow">ROLES & ACCESS</p>
              <h2 className="mt-1.5 font-serif text-2xl text-ink">角色权限</h2>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                角色变更立即影响编辑、评论与成员管理权限。
              </p>
            </div>
            <div className="divide-y divide-hairline">
              {(["owner", "admin", "editor", "viewer"] as WorkspaceRole[]).map((item) => {
                const Icon = roleIcons[item];
                const description =
                  item === "owner"
                    ? "完整控制工作区、成员、账单与所有内容。"
                    : item === "admin"
                      ? "邀请、移除成员并调整其他成员角色。"
                      : item === "editor"
                        ? "编辑旅行、日志、行程、预算与打包。"
                        : "只读工作区内容，可发表评论与收藏日志。";
                return (
                  <div key={item} className="flex gap-3 px-5 py-3.5">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface-2 text-muted">
                      <Icon aria-hidden="true" className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink">
                          {roleLabels[item]}
                        </p>
                        <span className="font-mono text-[9px] text-stone">
                          {state.members.filter((member) => member.role === item).length}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] leading-5 text-muted">{description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="border-t border-hairline px-5 py-3 text-[10px] leading-5 text-stone">
              Owner 不可被移除或降级；所有权转移需要独立事务。
            </p>
          </section>

          <section className="surface-card p-5">
            <p className="type-eyebrow">INVITE POLICY</p>
            <h2 className="mt-1.5 font-serif text-xl text-ink">邀请说明</h2>
            <div className="mt-4 space-y-3">
              {[
                ["01", "7 天有效", "邀请链接会在 7 天后自动失效。"],
                ["02", "默认 Viewer", "未指定角色时，只能阅读和评论。"],
                ["03", "即时撤销", "取消后，对方无法再次打开工作区。"],
              ].map(([index, title, detail]) => (
                <div key={index} className="flex gap-3">
                  <span className="pt-0.5 font-mono text-[9px] text-stone">{index}</span>
                  <div>
                    <p className="text-[11px] text-body">{title}</p>
                    <p className="mt-0.5 text-[10px] leading-5 text-muted">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="type-eyebrow">INVITE</p>
            <DialogTitle>邀请同行者</DialogTitle>
            <DialogDescription>
              Editor 可以编辑旅行和日志，Viewer 只能阅读和评论。Owner 不能通过邀请授予。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <FormField label="邮箱">
              <Input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="friend@example.com"
              />
            </FormField>
            <FormField label="角色">
              <Select value={role} onChange={(event) => setRole(event.target.value as WorkspaceRole)}>
                <option value="viewer">Viewer · 只读 + 评论</option>
                <option value="editor">Editor · 编辑内容</option>
                <option value="admin">Admin · 管理成员</option>
              </Select>
            </FormField>
            <FormField label="附言" hint="会出现在邀请邮件里；当前不真实发送 Resend 邮件。">
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="一起记录下一趟旅行。"
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="outline">
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
