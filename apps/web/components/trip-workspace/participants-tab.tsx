"use client";

import { useAddTripParticipant, useRemoveTripParticipant } from "@roamlog/api-client";
import type { ParticipantRole, TripParticipant } from "@roamlog/contracts";
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
  Label,
  Select,
  type BadgeProps,
} from "@roamlog/ui";
import { Lock, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { changeTripParticipantRole } from "@/lib/api/access-grants";
import { isApiError, isForbidden } from "@/lib/api/errors";
import { useSessionQuery } from "@/lib/query";

import { deniedReason, roleLabel } from "./capabilities";
import { ConfirmDialog } from "./dialogs";
import { shortTimestamp } from "./format";
import { useMemberDirectory } from "./member-directory";
import { EmptyBlock, Panel, QueryPanel } from "./panel";
import { assertMutationOk, useParticipants } from "./queries";
import { useTripWorkspace } from "./workspace-context";

type Tone = NonNullable<BadgeProps["tone"]>;

/**
 * Invitation status → readable badge.
 *
 * `pending` / `accepted` are the invitation vocabulary this screen is specified
 * against; `invited` / `joined` / `declined` are the values the contract and
 * `presentParticipant` emit today. All of them map to a real business state, so
 * 「未知」 is reserved for values outside this table instead of swallowing a
 * legitimate refusal.
 */
const INVITE_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "待接受", tone: "yellow" },
  invited: { label: "待接受", tone: "yellow" },
  accepted: { label: "已接受", tone: "green" },
  joined: { label: "已接受", tone: "green" },
  declined: { label: "已拒绝", tone: "red" },
};

const UNKNOWN_INVITE_STATUS: { label: string; tone: Tone } = { label: "未知", tone: "slate" };

function inviteStatusOf(status: string) {
  return INVITE_STATUS[status] ?? UNKNOWN_INVITE_STATUS;
}

/**
 * Reuses the role badge semantics already used across the workspace: owner is
 * emphasized, viewer reads as read-only, editor/admin stay on the accent colour.
 * Labels come from `roleLabel`, so Owner / Admin / Editor / Viewer are shared
 * with the members page and the workspace header.
 */
function roleTone(role: string): Tone {
  if (role === "owner") return "orange";
  if (role === "viewer") return "slate";
  return "green";
}

function participantRoleError(error: unknown): string {
  if (isForbidden(error)) return "当前角色不能调整参与者角色。";
  if (isApiError(error)) {
    if (error.status === 401) return "登录状态已失效，请重新登录后再试。";
    if (error.status === 400) return "角色值无效，请重新选择。";
    if (error.status === 404) return "这位参与者已不在列表中，请刷新后重试。";
    // `invalidResponse` is a contract mismatch, not an HTTP failure. Reporting
    // it as 「HTTP 200」 would name a successful status as the error, so keep
    // the two cases distinct.
    if (error.code === "INVALID_RESPONSE") {
      return "服务器返回的参与者数据无法识别，请刷新页面后重试。";
    }
    return `角色调整失败（HTTP ${error.status}），请稍后重试。`;
  }
  return "网络异常，角色没有调整。请检查网络后重试。";
}

export function ParticipantsTab({ tripId }: { tripId: string }) {
  const { capabilities, mutate, pending, role, trip } = useTripWorkspace();
  const session = useSessionQuery();
  const participants = useParticipants(tripId);
  const directory = useMemberDirectory();
  const addParticipant = useAddTripParticipant();
  const removeParticipant = useRemoveTripParticipant();

  const [formOpen, setFormOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TripParticipant | null>(null);
  const [roleOverrides, setRoleOverrides] = useState<Record<string, ParticipantRole>>({});
  const [rolePendingId, setRolePendingId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  const currentUserId = session.data?.user.id;
  const canManageRoles =
    role !== "viewer" &&
    (role === "owner" ||
      role === "admin" ||
      (Boolean(currentUserId) && trip.createdById === currentUserId));

  const participantIds = useMemo(() => {
    if (participants.state !== "ready") return new Set<string>();
    return new Set(participants.data.map((participant) => participant.userId));
  }, [participants]);

  const available = directory.members.filter((member) => !participantIds.has(member.id));
  const addTitle = capabilities.addParticipant ? undefined : deniedReason(role, "添加参与者");
  const removeTitle = capabilities.removeParticipant
    ? undefined
    : deniedReason(role, "移除参与者");
  const meta =
    participants.state === "ready"
      ? `${participants.data.length} 位`
      : participants.state === "error"
        ? "读取失败"
        : "读取中";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserId) {
      setFormError("请选择要加入的工作区成员。");
      return;
    }
    setFormError(null);
    const added = await mutate({
      label: "这位参与者",
      execute: async () => {
        const response = await addParticipant.mutateAsync({
          tripId,
          data: { userId: selectedUserId },
        });
        assertMutationOk(response, `/v1/trips/${tripId}/participants`);
        return response;
      },
      forbidden: "当前角色不能添加参与者。",
      failure: "参与者没有添加。",
    });
    if (added) {
      setSelectedUserId("");
      setFormOpen(false);
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    const target = removeTarget;
    const removed = await mutate({
      label: "这位参与者",
      execute: async () => {
        const response = await removeParticipant.mutateAsync({
          tripId,
          userId: target.userId,
        });
        assertMutationOk(response, `/v1/trips/${tripId}/participants/${target.userId}`);
        return response;
      },
      forbidden: "当前角色不能移除参与者。",
      failure: "参与者没有移除。",
    });
    if (removed) setRemoveTarget(null);
  }

  async function changeRole(participant: TripParticipant, nextRole: ParticipantRole) {
    if (!canManageRoles || participant.role === nextRole || rolePendingId) return;
    const previousRole = roleOverrides[participant.id] ?? participant.role;

    setRoleError(null);
    setRolePendingId(participant.id);
    // Optimistic selection, so the control does not snap back while PATCH is in
    // flight. The success value below comes from the server's participant row.
    setRoleOverrides((current) => ({ ...current, [participant.id]: nextRole }));
    try {
      const updated = await changeTripParticipantRole(tripId, participant.userId, nextRole);
      setRoleOverrides((current) => ({ ...current, [participant.id]: updated.role }));
    } catch (error) {
      // Roll back to exactly what the person saw before this attempt.
      setRoleOverrides((current) => ({ ...current, [participant.id]: previousRole }));
      setRoleError(participantRoleError(error));
    } finally {
      setRolePendingId(null);
    }
  }

  if (!capabilities.readParticipants) {
    return (
      <Panel title="参与者" meta={`${roleLabel(role)} · 无权限`}>
        <EmptyBlock
          icon={Lock}
          title="当前角色不能查看参与者"
          description={`${roleLabel(role)} 只能看到自己有权访问的内容，参与者名单不会提供给当前角色。`}
        />
      </Panel>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <QueryPanel
          title="参与者"
          meta={meta}
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFormError(null);
                setFormOpen(true);
              }}
              disabled={!capabilities.addParticipant}
              title={addTitle}
            >
              <Plus aria-hidden="true" />
              添加参与者
            </Button>
          }
          result={participants}
          errorTitle="参与者读取失败"
          isEmpty={(data) => data.length === 0}
          empty={
            <EmptyBlock
              icon={Users}
              title="还没有参与者"
              description="把工作区成员加入这趟旅行，他们才能收到提及和协作通知。"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFormOpen(true)}
                  disabled={!capabilities.addParticipant}
                  title={addTitle}
                >
                  <Plus aria-hidden="true" />
                  添加第一位
                </Button>
              }
            />
          }
        >
          {(data) => (
            <ul className="divide-y divide-hairline">
              {data.map((participant) => {
                const member = directory.byId.get(participant.userId);
                const displayName = member?.name ?? `成员 ${participant.userId.slice(0, 8)}`;
                // Workspace grants cover every member, so an owner/admin keeps that
                // label even when the trip invitation itself says viewer.
                const effectiveRole = member?.role ?? participant.role;
                const tripRole = roleOverrides[participant.id] ?? participant.role;
                const invite = inviteStatusOf(participant.status);
                const showJoinedAt =
                  Boolean(participant.joinedAt) && participant.joinedAt !== participant.invitedAt;
                return (
                  <li
                    key={participant.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={displayName} size={32} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] leading-5 text-ink">{displayName}</p>
                          <Badge
                            tone={roleTone(effectiveRole)}
                            title={
                              member
                                ? "工作区角色，覆盖本次旅行的全部权限"
                                : "旅行内的参与者角色"
                            }
                          >
                            {roleLabel(effectiveRole)}
                          </Badge>
                          <Badge tone={invite.tone}>{invite.label}</Badge>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-4 text-muted">
                          {member?.email ?? "成员资料不在当前工作区列表中"}
                          {participant.invitedAt ? (
                            <> · 邀请于 {shortTimestamp(participant.invitedAt)}</>
                          ) : null}
                          {showJoinedAt ? (
                            <> · 加入于 {shortTimestamp(participant.joinedAt)}</>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {canManageRoles ? (
                        <div className="flex items-center gap-2">
                          <span className="type-meta text-stone">旅行角色</span>
                          <Select
                            value={tripRole}
                            onChange={(event) =>
                              void changeRole(
                                participant,
                                event.target.value as ParticipantRole,
                              )
                            }
                            disabled={pending || rolePendingId !== null}
                            aria-label={`更改 ${displayName} 的旅行角色`}
                            aria-busy={rolePendingId === participant.id}
                            title="工作区 Owner/Admin 的权限高于旅行内角色"
                            className="h-9 w-28 text-xs"
                          >
                            <option value="viewer">可查看</option>
                            <option value="editor">可编辑</option>
                          </Select>
                        </div>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRemoveTarget(participant)}
                        disabled={!capabilities.removeParticipant}
                        title={capabilities.removeParticipant ? "移除这位参与者" : removeTitle}
                        aria-label={`移除参与者 ${displayName}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryPanel>

        {roleError ? (
          <p role="alert" className="px-1 text-xs leading-5 text-accent-red">
            {roleError}
          </p>
        ) : null}

        <p className="px-1 font-mono text-[10px] leading-5 text-stone">
          新邀请默认是 viewer，可另行提升为 editor；分享链接与参与者相互独立。旅行角色只影响这趟旅行内的权限。
        </p>
        {!canManageRoles || (!capabilities.addParticipant && !capabilities.removeParticipant) ? (
          <p role="note" className="px-1 text-[11px] leading-5 text-muted">
            {!canManageRoles
              ? "只有行程创建者或工作区 Owner/Admin 可以调整参与者角色；你仍可以查看当前角色。"
              : null}
            {!canManageRoles && (!capabilities.addParticipant || !capabilities.removeParticipant)
              ? " "
              : null}
            {!capabilities.addParticipant && !capabilities.removeParticipant
              ? `${roleLabel(role)} 角色可以查看参与者，但不能添加或移除。`
              : null}
          </p>
        ) : null}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>添加参与者</DialogTitle>
              <DialogDescription>
                写入 `POST /v1/trips/{tripId}/participants`。只有当前工作区成员可以被加入。
              </DialogDescription>
            </DialogHeader>
            <div>
              <Label htmlFor="participant-select">工作区成员</Label>
              <Select
                id="participant-select"
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
              >
                <option value="">选择成员</option>
                {available.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}（{roleLabel(member.role)}）
                  </option>
                ))}
              </Select>
              {available.length === 0 ? (
                <p className="mt-1 font-mono text-[10px] text-stone">所有工作区成员都已是参与者。</p>
              ) : null}
              {formError ? (
                <p role="alert" className="mt-2 text-xs leading-5 text-accent-red">
                  {formError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "添加中…" : "保存参与者"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="移除这位参与者？"
        description="移除后该成员不再出现在这趟旅行的参与者列表，但仍可以通过工作区访问。"
        confirmLabel="移除"
        pending={pending}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}
