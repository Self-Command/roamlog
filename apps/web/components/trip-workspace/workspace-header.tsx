"use client";

import type { BudgetSummary, Trip, WorkspaceWithRole } from "@roamlog/contracts";
import { Badge, Button, PageGlow } from "@roamlog/ui";
import { ArrowLeft, CalendarDays, Copy, MapPin, Pencil, Route, Tags, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CoverUploader } from "@/components/media";
import { ReportMenu } from "@/components/moderation/report-menu";
import { useMembersQuery, queryKeys } from "@/lib/query";
import { useQueryClient } from "@tanstack/react-query";

import { deniedReason, roleLabel, type TripCapabilities } from "./capabilities";
import { formatMinor } from "./money";
import { Chips, MetaPair } from "./panel";
import { useParticipants, type AsyncResult } from "./queries";
import { formatLongDate, formatDateRange, getTripStatusLabel, getTripStatusTone } from "@/lib/trip-presentation";

const VISIBILITY_LABELS: Record<Trip["visibility"], string> = {
  workspace: "工作区可见",
  custom: "指定可见",
  private: "仅自己",
  public_link: "有公开链接",
};

function coordinateLabel(trip: Trip): string {
  if (trip.originLat === null || trip.originLng === null) return "未记录坐标";
  return `${trip.originLat.toFixed(4)}, ${trip.originLng.toFixed(4)}`;
}

function BudgetBlock({ summary }: { summary: AsyncResult<BudgetSummary> }) {
  if (summary.state === "loading") {
    return <p className="font-mono text-[11px] text-stone">读取预算摘要…</p>;
  }
  if (summary.state === "error") {
    return (
      <div className="space-y-1">
        <p className="font-mono text-[11px] text-accent-red">预算摘要未加载</p>
        <Button type="button" variant="link" size="sm" onClick={summary.retry}>
          重试
        </Button>
      </div>
    );
  }

  const data = summary.data;
  return (
    <div className="space-y-1.5">
      {data.originalTotals.length === 0 ? (
        <p className="font-mono text-[11px] text-stone">还没有记账 · {data.expenseCount} 笔</p>
      ) : (
        <ul className="space-y-1">
          {data.originalTotals.map((total) => (
            <li key={total.currency} className="font-mono text-[11px] text-ink">
              {formatMinor(total.amountMinor, total.currency)}
              <span className="ml-1.5 text-[10px] text-stone">{total.currency} · 已花</span>
            </li>
          ))}
        </ul>
      )}
      {data.overBudget ? <Badge tone="red">超出预算</Badge> : null}
    </div>
  );
}

export function TripWorkspaceHeader({
  trip,
  workspace,
  workspaceSlug,
  capabilities,
  budget,
  onDuplicate,
  onDelete,
}: {
  trip: Trip;
  workspace: WorkspaceWithRole;
  workspaceSlug: string;
  capabilities: TripCapabilities;
  budget: AsyncResult<BudgetSummary>;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const [coverError, setCoverError] = useState<string | null>(null);
  const membersQuery = useMembersQuery(workspace.id);
  const participants = useParticipants(trip.id);

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    membersQuery.data?.items.forEach((member) => {
      map.set(member.user.id, member.user.name);
    });
    return map;
  }, [membersQuery.data]);

  const companions = useMemo(() => {
    const names: string[] = [];
    if (participants.state === "ready") {
      for (const participant of participants.data) {
        names.push(memberNames.get(participant.userId) ?? `成员 ${participant.userId.slice(0, 8)}`);
      }
    }
    for (const guest of trip.guestNames) {
      names.push(`${guest}（嘉宾）`);
    }
    return names;
  }, [memberNames, participants, trip.guestNames]);

  const participantsLabel = useMemo(() => {
    if (!capabilities.readParticipants) return "无权限查看参与者";
    if (participants.state === "error") return "参与者读取失败";
    if (participants.state === "loading") return "读取参与者…";
    return `${participants.data.length} 位参与者`;
  }, [capabilities.readParticipants, participants]);

  const editHref = `/w/${workspaceSlug}/trips/${trip.id}/edit`;

  return (
    <header className="relative overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
      <PageGlow accent="orange" className="opacity-25" />

      <div className="relative space-y-6 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/w/${workspaceSlug}/trips`}>
              <ArrowLeft aria-hidden="true" />
              旅行库
            </Link>
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge tone={getTripStatusTone(trip.status)}>{getTripStatusLabel(trip.status)}</Badge>
            <Badge tone="neutral">{VISIBILITY_LABELS[trip.visibility]}</Badge>
            <Badge tone="slate">{roleLabel(workspace.role)}</Badge>
            <ReportMenu
              workspaceId={workspace.id}
              target={{ type: "trip", id: trip.id, label: trip.title }}
              label={`更多操作：${trip.title}`}
            />
          </div>
        </div>

        <div>
          <p className="type-eyebrow">
            {trip.countryCodes.length > 0 ? trip.countryCodes.join(" · ") : "国家未填"} /{" "}
            {trip.durationDays} DAYS / VERSION {trip.version}
          </p>
          <h1 className="type-trip-title mt-3">{trip.title}</h1>
          {trip.summary ? (
            <p className="mt-3 max-w-2xl text-sm leading-6 text-body">{trip.summary}</p>
          ) : (
            <p className="mt-3 text-sm leading-6 text-stone">还没有摘要。</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {capabilities.updateTrip ? (
            <Button asChild variant="primary">
              <Link href={editHref}>
                <Pencil aria-hidden="true" />
                编辑旅行
              </Link>
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled
              title={deniedReason(workspace.role, "编辑旅行")}
            >
              <Pencil aria-hidden="true" />
              编辑旅行
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={onDuplicate}
            disabled={!capabilities.duplicateTrip}
            title={
              capabilities.duplicateTrip ? undefined : deniedReason(workspace.role, "复制旅行")
            }
          >
            <Copy aria-hidden="true" />
            复制
          </Button>

          <Button
            type="button"
            variant="danger"
            onClick={onDelete}
            disabled={!capabilities.deleteTrip}
            title={capabilities.deleteTrip ? undefined : deniedReason(workspace.role, "删除旅行")}
          >
            <Trash2 aria-hidden="true" />
            删除
          </Button>
        </div>

        <div className="grid gap-5 border-t border-hairline pt-5 sm:grid-cols-2 xl:grid-cols-3">
          <MetaPair label="日期 · 天数" hint="含首尾两天">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays aria-hidden="true" className="size-3.5 text-muted" />
              {formatDateRange(trip.startDate, trip.endDate)}
            </span>
            <span className="mt-1 block font-mono text-[11px] text-stone">
              {trip.durationDays} 天 · 最近更新 {formatLongDate(trip.updatedAt.slice(0, 10))}
            </span>
          </MetaPair>

          <MetaPair
            label="起点 · 国家 · 时区"
            hint={trip.timeZone ? `${trip.timeZone}` : "旅行时区未设置"}
          >
            <span className="inline-flex items-center gap-1.5">
              <Route aria-hidden="true" className="size-3.5 text-muted" />
              {trip.origin}
              {trip.originCountryCode ? (
                <span className="font-mono text-[10px] text-muted">{trip.originCountryCode}</span>
              ) : null}
            </span>
            <span className="mt-1 block font-mono text-[11px] text-stone">
              {coordinateLabel(trip)}
            </span>
            {trip.originAddress ? (
              <span className="mt-1 block type-meta text-muted">{trip.originAddress}</span>
            ) : null}
          </MetaPair>

          <MetaPair label="目的地">
            {trip.destinations.length === 0 ? (
              <span className="font-mono text-[11px] text-stone">未填写目的地</span>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {trip.destinations.map((destination) => (
                  <li
                    key={destination}
                    className="inline-flex items-center gap-1 rounded-pill border border-hairline-strong bg-surface-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-body"
                  >
                    <MapPin aria-hidden="true" className="size-3 text-muted" />
                    {destination}
                  </li>
                ))}
              </ul>
            )}
          </MetaPair>

          <MetaPair label="标签">
            <span className="inline-flex items-start gap-1.5">
              <Tags aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted" />
              <Chips items={trip.tags} empty="没有标签" />
            </span>
          </MetaPair>

          <MetaPair label="同行人" hint={participantsLabel}>
            <span className="inline-flex items-start gap-1.5">
              <Users aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted" />
              <Chips items={companions} empty="还没有登记同行嘉宾" />
            </span>
          </MetaPair>

          <MetaPair
            label="预算 · 已花"
            hint={
              trip.budgetAmountMinor !== null && trip.budgetCurrency
                ? `预算 ${formatMinor(trip.budgetAmountMinor, trip.budgetCurrency)} · 分币种不折算`
                : "预算未设置 · 分币种不折算"
            }
          >
            <BudgetBlock summary={budget} />
          </MetaPair>
        </div>
      </div>

      <section
        aria-label="封面"
        className="relative flex flex-col gap-3 border-t border-hairline px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:p-7"
      >
        <div className="max-w-[16rem]">
          <p className="type-eyebrow">封面 / COVER</p>
        </div>
        <div className="w-full sm:max-w-sm">
          <CoverUploader
            workspaceId={workspace.id}
            trip={trip}
            size="cover"
            disabled={!capabilities.setCover}
            onChange={(change) => {
              if (change.trip) {
                queryClient.setQueryData(queryKeys.trip(trip.id), change.trip);
              }
            }}
            onError={(error) => setCoverError(error.message)}
          />
          {coverError ? (
            <p role="alert" className="mt-2 text-[11px] leading-4 text-accent-red">
              {coverError}
            </p>
          ) : null}
        </div>
      </section>
    </header>
  );
}