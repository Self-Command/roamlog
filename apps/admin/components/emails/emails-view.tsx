"use client";

import { useEffect, useMemo, useState } from "react";
import { MailCheck, MailWarning, RefreshCw, ShieldAlert } from "lucide-react";

import { canPlatform } from "@roamlog/contracts";
import type { EmailStatus } from "@roamlog/contracts";
import { Badge, Button, EmptyState, Input, Select } from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/admin-types";
import { AdminMutationError } from "../../lib/admin-api-error";
import {
  maskEmail,
  useAdminEmailCountsResource,
  type AdminMutationPort,
} from "../../lib/admin-data-source";
import { formatDateTime } from "../../lib/format";
import type { AdminEmailRecord } from "../../lib/admin-ops-types";
import { AdminFilterBar } from "../admin-ui/admin-filter-bar";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { AdminMetricCard } from "../dashboard/admin-metric-card";

interface EmailsViewProps {
  role: AdminConsoleRole;
  emails: readonly AdminEmailRecord[];
  mutations?: AdminMutationPort;
}

const emailStatusLabels: Record<EmailStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Complained",
  failed: "Failed",
};

const emailStatusTones: Record<EmailStatus, "neutral" | "blue" | "green" | "red" | "yellow"> = {
  queued: "neutral",
  sent: "blue",
  delivered: "green",
  bounced: "yellow",
  complained: "red",
  failed: "red",
};

/**
 * Re-sending a delivered/sent message duplicates a successful delivery, and a
 * complained message must not be retried. Only genuinely failed deliveries are
 * retryable, matching the API's `EMAIL_NOT_RESENDABLE` guard.
 */
const RESENDABLE_STATUSES: ReadonlySet<EmailStatus> = new Set<EmailStatus>(["failed", "bounced"]);

const METRIC_ORDER: readonly EmailStatus[] = [
  "sent",
  "queued",
  "delivered",
  "bounced",
  "complained",
  "failed",
];

const metricIcons = {
  sent: MailCheck,
  queued: MailWarning,
  delivered: MailCheck,
  bounced: MailWarning,
  complained: ShieldAlert,
  failed: MailWarning,
} as const;

const metricLabels: Record<EmailStatus, string> = {
  sent: "已发送",
  queued: "排队中",
  delivered: "已送达",
  bounced: "退信",
  complained: "投诉",
  failed: "失败",
};

const metricTones: Record<EmailStatus, "neutral" | "blue" | "green" | "red" | "orange"> = {
  sent: "blue",
  queued: "neutral",
  delivered: "green",
  bounced: "orange",
  complained: "red",
  failed: "red",
};

export function EmailsView({
  role,
  emails,
  mutations,
}: EmailsViewProps) {
  const [records, setRecords] = useState<readonly AdminEmailRecord[]>(emails);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | EmailStatus>("all");
  const [template, setTemplate] = useState("all");
  const [statusMessage, setStatusMessage] = useState("");

  const canResend = canPlatform(role, "admin:emails:resend");
  const readOnly = role === "analyst";

  useEffect(() => {
    setRecords(emails);
  }, [emails]);

  const templateOptions = useMemo(
    () => [...new Set(records.map((email) => email.template))].sort(),
    [records],
  );

  const filteredEmails = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return records.filter((email) => {
      const matchesQuery =
        !normalizedQuery ||
        `${email.to} ${email.subject} ${email.template}`
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery);
      return (
        matchesQuery &&
        (status === "all" || email.status === status) &&
        (template === "all" || email.template === template)
      );
    });
  }, [query, records, status, template]);

  const latestFailure = useMemo(
    () =>
      records
        .filter((email) => email.error)
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null,
    [records],
  );

  async function resendEmail(record: AdminEmailRecord) {
    if (!canResend || !RESENDABLE_STATUSES.has(record.status)) {
      return;
    }
    if (mutations) {
      try {
        await mutations.resendEmail(record.id);
      } catch (error) {
        setStatusMessage(
          error instanceof AdminMutationError
            ? `重发失败：${error.failure.code} · ${error.failure.detail}`
            : "重发失败，请检查 API 与权限后重试。",
        );
        return;
      }
    }
    const now = new Date().toISOString();
    setRecords((current) =>
      current.map((email) =>
        email.id === record.id
          ? { ...email, status: "queued", error: null, updatedAt: now }
          : email,
      ),
    );
    setStatusMessage(`已重新加入队列：${maskEmail(record.to)}`);
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="DELIVERY / EMAIL"
        title="邮件"
        description="检查 Resend 投递状态、退信与投诉；只有 failed / bounced 的邮件可以重发。收件人一律脱敏展示。"
        readOnly={readOnly}
      />

      {<ApiEmailCounts />}

      <AdminFilterBar>
        <label className="min-w-0 flex-1">
          <span className="type-eyebrow">搜索收件人 / 主题</span>
          <Input
            className="mt-1.5 h-9"
            type="search"
            value={query}
            placeholder="email 或模板"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-40">
          <span className="type-eyebrow">投递状态</span>
          <Select
            className="mt-1.5 h-9"
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value as "all" | EmailStatus)}
          >
            <option value="all">全部状态</option>
            <option value="delivered">Delivered</option>
            <option value="queued">Queued</option>
            <option value="sent">Sent</option>
            <option value="bounced">Bounced</option>
            <option value="complained">Complained</option>
            <option value="failed">Failed</option>
          </Select>
        </label>
        <label className="w-full md:w-48">
          <span className="type-eyebrow">模板</span>
          <Select
            className="mt-1.5 h-9"
            value={template}
            onChange={(event) => setTemplate(event.currentTarget.value)}
          >
            <option value="all">全部模板</option>
            {templateOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </label>
        <span className="flex h-9 items-center border-l border-hairline pl-3 font-mono text-[10px] text-muted max-md:hidden">
          {filteredEmails.length} / {records.length}
        </span>
      </AdminFilterBar>

      {readOnly ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          Analyst 可读取投递日志与失败原因；重发保持可见但禁用。
        </div>
      ) : null}

      {latestFailure ? (
        <div
          role="note"
          aria-label="最近错误原因"
          className="rounded-control border border-hairline bg-surface-1 px-3 py-2"
        >
          <p className="type-eyebrow">最近错误原因</p>
          <p className="mt-1 break-words font-mono text-[10px] leading-4 text-muted">
            <span className="text-body">{latestFailure.error}</span>
            <span className="mx-2 text-stone">·</span>
            {maskEmail(latestFailure.to)}
            <span className="mx-2 text-stone">·</span>
            {formatDateTime(latestFailure.updatedAt)}
          </p>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium text-ink">投递日志</h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              resend delivery state
            </p>
          </div>
          
        </div>

        {filteredEmails.length === 0 ? (
          <EmptyState
            icon={MailWarning}
            title="没有匹配邮件"
            description="调整收件人、模板或投递状态筛选后再试。"
            className="m-4"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
              <caption className="sr-only">邮件投递日志</caption>
              <thead>
                <tr className="border-b border-hairline font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    收件人 / 主题
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    模板
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    状态
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    错误
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    时间
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-normal">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filteredEmails.map((email) => {
                  const resendable = RESENDABLE_STATUSES.has(email.status);
                  const masked = maskEmail(email.to);
                  return (
                    <tr
                      key={email.id}
                      aria-label={`邮件 ${masked}`}
                      className="h-12 transition-colors hover:bg-surface-2/60"
                    >
                      <td className="px-3 py-2">
                        <span className="block max-w-[280px] truncate text-[12px] text-ink">
                          {email.subject}
                        </span>
                        <span className="block max-w-[280px] truncate font-mono text-[9px] text-muted">
                          {masked}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-body">{email.template}</td>
                      <td className="px-3 py-2">
                        <Badge tone={emailStatusTones[email.status]}>
                          {emailStatusLabels[email.status]}
                        </Badge>
                      </td>
                      <td className="max-w-[240px] px-3 py-2">
                        <span className="block truncate font-mono text-[9px] text-muted">
                          {email.error ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-muted">
                        {formatDateTime(email.updatedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={
                              resendable
                                ? `重发邮件至 ${masked}`
                                : `不可重发 ${masked}：当前状态 ${emailStatusLabels[email.status]}`
                            }
                            disabled={!canResend || !resendable}
                            title={
                              !canResend
                                ? "当前角色不可重发邮件"
                                : resendable
                                  ? "重新加入发送队列"
                                  : `仅 failed / bounced 可重发，当前为 ${emailStatusLabels[email.status]}`
                            }
                            onClick={() => resendEmail(email)}
                          >
                            <RefreshCw aria-hidden="true" />
                            重发
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {statusMessage}
      </div>

      <section className="flex items-start gap-3 rounded-card border border-hairline bg-surface-1 p-4">
        <MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-green" />
        <div>
          <h2 className="text-[12px] font-medium text-ink">测试邮件入口未接入</h2>
          <p className="mt-1 max-w-3xl text-[10px] leading-5 text-muted">
            当前 Admin API 没有测试邮件端点，因此页面不再显示“测试邮件”按钮。补齐
            <code className="mx-1 font-mono">POST /v1/admin/emails/test</code>
            与固定模板、频率限制后才会上线该能力。
          </p>
        </div>
      </section>
    </div>
  );
}

function metricCards(counts: Record<EmailStatus, number>, sourceNote: string) {
  return (
    <section aria-label="邮件指标" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {METRIC_ORDER.map((key) => (
        <AdminMetricCard
          key={key}
          label={metricLabels[key]}
          value={String(counts[key])}
          detail={sourceNote}
          tone={metricTones[key]}
          icon={metricIcons[key]}
        />
      ))}
    </section>
  );
}

/** Totals from `GET /v1/admin/metrics` (PostgreSQL aggregation, all statuses). */
function ApiEmailCounts() {
  const resource = useAdminEmailCountsResource();
  const counts = resource.data?.counts ?? null;

  if (!resource.data) {
    return (
      <section
        aria-label="邮件指标"
        className="rounded-card border border-hairline bg-surface-1 p-4 font-mono text-[10px] text-muted"
      >
        {resource.error
          ? "未接入：/v1/admin/metrics 不可用，无法给出真实投递计数。"
          : "读取投递计数…"}
      </section>
    );
  }

  if (!counts) {
    return (
      <section
        aria-label="邮件指标"
        className="rounded-card border border-hairline bg-surface-1 p-4 font-mono text-[10px] text-muted"
      >
        未接入：/v1/admin/metrics 未返回按状态聚合的邮件计数。
      </section>
    );
  }

  return metricCards(counts, "admin/metrics · 数据库聚合");
}

