"use client";

import { useAddTripParticipant, useRemoveTripParticipant } from "@roamlog/api-client";
import type { TripParticipant } from "@roamlog/contracts";
import {
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
} from "@roamlog/ui";
import { Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { deniedReason } from "./capabilities";
import { ConfirmDialog } from "./dialogs";
import { shortTimestamp } from "./format";
import { useMemberDirectory } from "./member-directory";
import { EmptyBlock, QueryPanel } from "./panel";
import { assertMutationOk, useParticipants } from "./queries";
import { useTripWorkspace } from "./workspace-context";

export function ParticipantsTab({ tripId }: { tripId: string }) {
  const { capabilities, mutate, pending, role } = useTripWorkspace();
  const participants = useParticipants(tripId);
  const directory = useMemberDirectory();
  const addParticipant = useAddTripParticipant();
  const removeParticipant = useRemoveTripParticipant();

  const [formOpen, setFormOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TripParticipant | null>(null);

  const participantIds = useMemo(() => {
    if (participants.state !== "ready") return new Set<string>();
    return new Set(participants.data.map((participant) => participant.userId));
  }, [participants]);

  const available = directory.members.filter((member) => !participantIds.has(member.id));
  const addTitle = capabilities.addParticipant ? undefined : deniedReason(role, "添加参与者");
  const removeTitle = capabilities.removeParticipant
    ? undefined
    : deniedReason(role, "移除参与者");

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

  return (
    <>
      <QueryPanel
        title="参与者"
        meta={participants.state === "ready" ? `${participants.data.length} 位` : "读取中"}
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
              return (
                <li
                  key={participant.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] leading-5 text-ink">
                      {member?.name ?? `成员 ${participant.userId.slice(0, 8)}`}
                      {member ? (
                        <Badge tone={member.role === "viewer" ? "slate" : "green"} className="ml-2">
                          {member.role}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted">
                      {member?.email ?? "成员资料不在当前工作区列表中"} · 加入于{" "}
                      {shortTimestamp(participant.joinedAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoveTarget(participant)}
                    disabled={!capabilities.removeParticipant}
                    title={capabilities.removeParticipant ? "移除这位参与者" : removeTitle}
                    aria-label={`移除参与者 ${member?.name ?? participant.userId.slice(0, 8)}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </QueryPanel>

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
                    {member.name}（{member.role}）
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